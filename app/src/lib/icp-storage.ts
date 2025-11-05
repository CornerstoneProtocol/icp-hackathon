import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory as assetIdlFactory } from './asset-canister.did'

export type Uploaded = { cid: string; path: string; uri: string }[];

// Asset canister interface
interface AssetCanister {
  store: (arg: {
    key: string;
    content_type: string;
    content_encoding: string;
    content: Uint8Array;
    sha256: [] | [Uint8Array];
  }) => Promise<void>;
  
  get: (arg: { key: string; accept_encodings: string[] }) => Promise<{
    content: Uint8Array;
    content_type: string;
    content_encoding: string;
    total_length: bigint;
    sha256: [] | [Uint8Array];
  }>;
  
  list: (arg: {}) => Promise<Array<{
    key: string;
    content_type: string;
    encodings: Array<{
      content_encoding: string;
      sha256: [] | [Uint8Array];
      length: bigint;
      modified: bigint;
    }>;
  }>>;
}

const LOG_PREFIX = '[ICP Storage]';

function log(...args: unknown[]) {
  console.info(LOG_PREFIX, ...args);
}

function deriveAssetCanisterId(): string | undefined {
  const legacyEnv = import.meta.env.VITE_ASSET_CANISTER_ID as string | undefined;
  if (legacyEnv) {
    return legacyEnv;
  }

  const frontendEnv = import.meta.env.VITE_FRONTEND_CANISTER_ID as string | undefined;
  if (frontendEnv) {
    return frontendEnv;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  const hostname = window.location.hostname;
  const suffixes = ['.ic0.app', '.raw.ic0.app', '.icp0.io', '.raw.icp0.io', '.localhost'];

  for (const suffix of suffixes) {
    if (hostname.endsWith(suffix)) {
      const candidate = hostname.slice(0, -suffix.length);
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

const ASSET_CANISTER_ID = deriveAssetCanisterId();

let agentPromise: Promise<HttpAgent> | null = null;
let assetActorPromise: Promise<AssetCanister> | null = null;

import { AuthClient } from '@dfinity/auth-client';

/**
 * Create and configure the HTTP agent for ICP with authentication
 */
async function getAgent(): Promise<HttpAgent> {
  if (!agentPromise) {
    log('Creating ICP agent...');
    agentPromise = (async () => {
      const host = import.meta.env.VITE_IC_HOST || 'https://ic0.app';
      
      // Try to get authenticated identity
      const authClient = await AuthClient.create();
      const identity = authClient.getIdentity();
      
      const agent = new HttpAgent({ 
        host,
        identity, // Use the authenticated identity
      });
      
      // Fetch root key for certificate validation on local replica
      if (
        import.meta.env.MODE === 'development' ||
        host.includes('localhost') ||
        host.includes('127.0.0.1')
      ) {
        try {
          await agent.fetchRootKey();
          log('Fetched root key for local development');
        } catch (error) {
          log('Failed to fetch root key:', error);
        }
      }
      
      log('Agent created with identity:', identity.getPrincipal().toText());
      return agent;
    })();
  }
  return agentPromise;
}

/**
 * Get or create the asset canister actor
 */
async function getAssetActor(): Promise<AssetCanister> {
  if (!assetActorPromise) {
    log('Creating asset canister actor...');
    assetActorPromise = (async () => {
      if (!ASSET_CANISTER_ID) {
        throw new Error('Asset canister ID missing. Unable to determine frontend canister ID.');
      }

      const agent = await getAgent();
      const canisterId = Principal.fromText(ASSET_CANISTER_ID);
      
      const actor = Actor.createActor<AssetCanister>(assetIdlFactory, {
        agent,
        canisterId,
      });

      log('Asset canister actor created:', ASSET_CANISTER_ID);
      return actor;
    })();
  }
  return assetActorPromise;
}

/**
 * Calculate SHA-256 hash of file content
 */
async function calculateSha256(content: Uint8Array): Promise<Uint8Array> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', content);
    return new Uint8Array(hashBuffer);
  }
  
  // Fallback for environments without Web Crypto API
  // Note: In production, you should use a proper crypto library
  throw new Error('SHA-256 calculation requires Web Crypto API');
}

/**
 * Read file as Uint8Array
 */
async function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      resolve(new Uint8Array(arrayBuffer));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Generate a deterministic key for the file
 * Uses timestamp + filename to create unique paths
 */
function generateFileKey(filename: string): string {
  const timestamp = Date.now();
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `/uploads/${timestamp}/${sanitized}`;
}

/**
 * Upload files to ICP asset canister
 * Returns metadata with canister URLs instead of IPFS CIDs
 */
export async function icpUpload(files: File[]): Promise<Uploaded> {
  if (!files || files.length === 0) {
    throw new Error('No files provided for upload');
  }

  const actor = await getAssetActor();
  const results: Uploaded = [];

  log('Uploading files:', files.map(f => ({ name: f.name, size: f.size, type: f.type })));

  for (const file of files) {
    try {
      // Read file content
      const content = await readFileAsBytes(file);
      
      // Calculate SHA-256 hash
      const sha256 = await calculateSha256(content);
      
      // Generate unique key for this file
      const key = generateFileKey(file.name);
      
      // Determine content type
      const contentType = file.type || 'application/octet-stream';
      
      log(`Uploading ${file.name} (${content.length} bytes) to ${key}...`);
      
      // Store in asset canister
      await actor.store({
        key,
        content_type: contentType,
        content_encoding: 'identity',
        content,
        sha256: [sha256],
      });
      
      log(`Successfully uploaded ${file.name}`);
      
      // Create ICP URL for the asset
      // Format: https://<canister-id>.raw.ic0.app<key>
      const canisterId = ASSET_CANISTER_ID!;
      const uri = `${canisterId}.localhost:4943${key}`;
      console.log(uri);
      
      
      results.push({
        cid: key, // Use the key as the identifier instead of IPFS CID
        path: file.name,
        uri,
      });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error(LOG_PREFIX, `Failed to upload ${file.name}:`, error);
      
      // Provide helpful error messages
      if (/unauthorized/i.test(msg) || /not allowed/i.test(msg)) {
        throw new Error(`Not authorized to upload to asset canister. Please ensure you are authenticated with the correct identity.`);
      }
      
      if (/canister.*not found/i.test(msg)) {
        throw new Error(`Asset canister not found. Please ensure the frontend canister ID is correct.`);
      }
      
      throw new Error(`Failed to upload ${file.name}: ${msg}`);
    }
  }

  log('All uploads completed successfully');
  return results;
}

/**
 * Alternative: Upload to project's own canister storage
 * This assumes each project has its own storage capability
 */
export async function icpUploadToProject(
  projectCanisterId: string,
  files: File[]
): Promise<Uploaded> {
  if (!files || files.length === 0) {
    throw new Error('No files provided for upload');
  }

  const agent = await getAgent();
  const canisterId = Principal.fromText(projectCanisterId);
  
  // Create actor for the specific project canister
  const actor = Actor.createActor<AssetCanister>(assetIdlFactory, {
    agent,
    canisterId,
  });

  const results: Uploaded = [];

  log(`Uploading files to project canister ${projectCanisterId}:`, 
    files.map(f => ({ name: f.name, size: f.size })));

  for (const file of files) {
    const content = await readFileAsBytes(file);
    const sha256 = await calculateSha256(content);
    const key = generateFileKey(file.name);
    const contentType = file.type || 'application/octet-stream';
    
    await actor.store({
      key,
      content_type: contentType,
      content_encoding: 'identity',
      content,
      sha256: [sha256],
    });
    
    const uri = `https://${projectCanisterId}.raw.ic0.app${key}`;
    
    results.push({
      cid: key,
      path: file.name,
      uri,
    });
  }

  log('Project upload completed');
  return results;
}

/**
 * List all uploaded assets
 */
export async function listAssets(): Promise<Array<{
  key: string;
  contentType: string;
  size: bigint;
}>> {
  const actor = await getAssetActor();
  const assets = await actor.list({});
  
  return assets.map(asset => ({
    key: asset.key,
    contentType: asset.content_type,
    size: asset.encodings[0]?.length || 0n,
  }));
}

/**
 * Retrieve an asset by key
 */
export async function getAsset(key: string): Promise<{
  content: Uint8Array;
  contentType: string;
}> {
  const actor = await getAssetActor();
  const result = await actor.get({
    key,
    accept_encodings: ['identity'],
  });
  
  return {
    content: result.content,
    contentType: result.content_type,
  };
}

/**
 * Reset agent cache (call this after login/logout)
 */
export function resetAgentCache(): void {
  log('Resetting agent cache');
  agentPromise = null;
  assetActorPromise = null;
}
