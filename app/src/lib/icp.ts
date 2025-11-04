import { Actor, HttpAgent } from '@dfinity/agent';
import { AuthClient } from '@dfinity/auth-client';
import { Principal } from '@dfinity/principal';
import { idlFactory as projectIdlFactory } from './project.idl';
import { idlFactory as registryIdlFactory } from './registry.idl';
import { canistersConfig } from '@/config/canisters';
import { resetAgentCache } from './icp-storage';

export type Address = string; // Principal as string
export type Amount = bigint;

export type ContractsConfig = {
  registry?: string;
  project?: string;
};

// Configuration (favor values from canistersConfig, fall back to defaults)
const HOST = canistersConfig.host || 'https://ic0.app';
const PROJECT_CANISTER_ID = (import.meta.env.VITE_PROJECT_CANISTER_ID as string | undefined) || 'xjaw7-xp777-77774-qaajq-cai';
const REGISTRY_CANISTER_ID = canistersConfig.registry || '2ozfp-2h777-77774-qabca-cai';

// ============================================================================
// Authentication & Agent Management
// ============================================================================

let authClient: AuthClient | null = null;
let agent: HttpAgent | null = null;

export async function initAuth(): Promise<AuthClient> {
  if (!authClient) {
    authClient = await AuthClient.create();
  }
  return authClient;
}

export async function getAgent(): Promise<HttpAgent> {
  if (!agent) {
    const identity = await getIdentity();
    agent = new HttpAgent({ host: HOST, identity });
    // For local development, fetch root key
    if (HOST.includes('localhost') || HOST.includes('127.0.0.1')) {
      await agent.fetchRootKey();
    }
  }
  return agent;
}

export type LoginMethod = 'ii' | 'plug' | 'bitfinity';

export async function login(method: LoginMethod = 'ii'): Promise<void> {
  resetAgentCache();
  switch (method) {
    case 'ii': {
      const client = await initAuth();
      const identityProvider = canistersConfig.identityProvider || 'https://identity.ic0.app';
      return new Promise((resolve, reject) => {
        client.login({
          identityProvider,
          onSuccess: () => {
            agent = null;
            resolve();
          },
          onError: (err) => reject(err),
        });
      });
    }
    case 'plug': {
      if (!window.ic?.plug) throw new Error('Plug wallet not found');
      const whitelist = [PROJECT_CANISTER_ID, REGISTRY_CANISTER_ID].filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );
      const connected = await window.ic.plug.requestConnect({
        whitelist,
        host: HOST,
      });
      if (!connected) throw new Error('User denied Plug connection');
      return;
    }

    case 'bitfinity': {
      if (!window.ic?.bitfinityWallet) throw new Error('Bitfinity wallet not found');
      const whitelist = [PROJECT_CANISTER_ID, REGISTRY_CANISTER_ID].filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );
      await window.ic.bitfinityWallet.requestConnect({
        whitelist,
        host: HOST,
      });
      return;
    }

    default:
      throw new Error('Unsupported login method');
  }
}

export async function logout(): Promise<void> {
  const client = await initAuth();
  await client.logout();
  agent = null;
}

export async function isAuthenticated(): Promise<boolean> {
  const client = await initAuth();
  return await client.isAuthenticated();
}

export async function getIdentity() {
  const client = await initAuth();
  return client.getIdentity();
}

export async function getPrincipal(): Promise<Principal | null> {
  try {
    const identity = await getIdentity();
    return identity.getPrincipal();
  } catch {
    return null;
  }
}

export async function getAccount(): Promise<Address | null> {
  const principal = await getPrincipal();
  return principal ? principal.toText() : null;
}

// ============================================================================
// Actor Creation
// ============================================================================

export async function createProjectActor(canisterId: string = PROJECT_CANISTER_ID) {
  const identity = await getIdentity();
  const agent = new HttpAgent({ host: HOST, identity });
  
  // For local development, fetch root key
  if (HOST.includes('localhost') || HOST.includes('127.0.0.1')) {
    await agent.fetchRootKey();
  }
  
  return Actor.createActor(projectIdlFactory, {
    agent,
    canisterId,
  });
}

export async function createRegistryActor(canisterId: string = REGISTRY_CANISTER_ID) {
  const identity = await getIdentity();
  const agent = new HttpAgent({ host: HOST, identity });
  
  // For local development, fetch root key
  if (HOST.includes('localhost') || HOST.includes('127.0.0.1')) {
    await agent.fetchRootKey();
  }
  
  return Actor.createActor(registryIdlFactory, {
    agent,
    canisterId,
  });
}

// ============================================================================
// Type Definitions (matching Rust structs)
// ============================================================================

export type ProjectParams = {
  stablecoin: string;
  min_raise: bigint;
  max_raise: bigint;
  fundraise_deadline: bigint;
  phase_aprs_bps: number[];
  phase_durations: bigint[];
  phase_withdraw_caps_bps: number[];
  token_name: string;
  token_symbol: string;
};

export type DocRecord = {
  doc_types: string[];
  doc_hashes: string[];
  metadata_uris: string[];
  submitted_at: bigint;
};

export type AppraisalRecord = {
  percent_complete: number;
  appraisal_hash: string;
  submitted_at: bigint;
};

export type AccountState = {
  balance: bigint;
  interest_correction: bigint;
  revenue_correction: bigint;
  interest_withdrawn: bigint;
  revenue_withdrawn: bigint;
};

export type ProjectState = {
  owner: Principal;
  params: ProjectParams;
  paused: boolean;
  current_phase: number;
  last_closed_phase: number;
  fundraise_closed: boolean;
  fundraise_successful: boolean;
  total_raised: bigint;
  pool_balance: bigint;
  reserve_balance: bigint;
  accrual_base: bigint;
  last_accrual_ts: bigint;
  principal_buffer: bigint;
  principal_redeemed: bigint;
  total_dev_withdrawn: bigint;
  phase_withdrawn: bigint[];
  phase_docs: DocRecord[][];
  appraisals: AppraisalRecord[];
  phase5_percent_complete: number;
  last_appraisal_hash: string | null;
  total_supply: bigint;
  interest_per_share_x18: bigint;
  revenue_per_share_x18: bigint;
  accounts:
    | Map<string, AccountState>
    | Array<[Principal | string, AccountState]>
    | Record<string, AccountState>;
};

export type ProjectListing = {
  id: bigint;
  creator: Principal | string;
  project_canister: Principal | string | null | [Principal] | [];
  token_canister: Principal | string | null | [Principal] | [];
  metadata_uri: string;
  params: ProjectParams;
  created_at: bigint;
};

const principalToText = (principal: unknown): string => {
  if (typeof principal === 'string') {
    return principal;
  }
  if (principal && typeof (principal as { toText?: () => string }).toText === 'function') {
    return (principal as { toText: () => string }).toText();
  }
  return String(principal ?? '');
};

export const normalizeStateAccounts = (accounts: unknown): Map<string, AccountState> => {
  if (accounts instanceof Map) {
    return accounts as Map<string, AccountState>;
  }

  if (Array.isArray(accounts)) {
    return new Map(
      accounts.map(([principal, account]) => [principalToText(principal), account as AccountState])
    );
  }

  if (accounts && typeof accounts === 'object') {
    return new Map(
      Object.entries(accounts as Record<string, AccountState>).map(([principal, account]) => [
        principalToText(principal),
        account,
      ])
    );
  }

  return new Map();
};

// ============================================================================
// Real-time vs Static Data (similar to your original structure)
// ============================================================================

export type ProjectRealtimeState = {
  reserveBalance: bigint;
  poolBalance: bigint;
  principalBuffer: bigint;
  totalDevWithdrawn: bigint;
  paused: boolean;
  fundraiseClosed: boolean;
  fundraiseSuccessful: boolean;
  claimableInterest?: bigint;
  claimableRevenue?: bigint;
  userBalance?: bigint;
};

export type ProjectStaticConfig = {
  owner: string;
  projectName: string;
  tokenSymbol: string;
  minRaise: bigint;
  maxRaise: bigint;
  fundraiseDeadline: bigint;
  perPhaseAprBps: number[];
  phaseDurations: bigint[];
  phaseWithdrawCapsBps: number[];
};

// ============================================================================
// Project Data Fetching
// ============================================================================

export async function fetchProjectRealtimeState(
  canisterId: string,
  accountPrincipal?: Principal
): Promise<ProjectRealtimeState> {
  const actor = await createProjectActor(canisterId);
  
  const state = await actor.get_state() as ProjectState;
  const accountsMap = normalizeStateAccounts(state.accounts);
  
  let claimableInterest, claimableRevenue, userBalance;
  if (accountPrincipal) {
    claimableInterest = await actor.claimable_interest(accountPrincipal) as bigint;
    claimableRevenue = await actor.claimable_revenue(accountPrincipal) as bigint;
    const accountState = accountsMap.get(accountPrincipal.toText());
    userBalance = accountState?.balance || 0n;
  }
  
  return {
    reserveBalance: state.reserve_balance,
    poolBalance: state.pool_balance,
    principalBuffer: state.principal_buffer,
    totalDevWithdrawn: state.total_dev_withdrawn,
    paused: state.paused,
    fundraiseClosed: state.fundraise_closed,
    fundraiseSuccessful: state.fundraise_successful,
    ...(accountPrincipal && { claimableInterest, claimableRevenue, userBalance }),
  };
}

export async function fetchProjectStaticConfig(
  canisterId: string
): Promise<ProjectStaticConfig> {
  const actor = await createProjectActor(canisterId);
  const state = await actor.get_state() as ProjectState;
  
  return {
    owner: state.owner.toText(),
    projectName: state.params.token_name,
    tokenSymbol: state.params.token_symbol,
    minRaise: state.params.min_raise,
    maxRaise: state.params.max_raise,
    fundraiseDeadline: state.params.fundraise_deadline,
    perPhaseAprBps: state.params.phase_aprs_bps,
    phaseDurations: state.params.phase_durations,
    phaseWithdrawCapsBps: state.params.phase_withdraw_caps_bps,
  };
}

export async function fetchProjectPhaseCaps(
  canisterId: string
): Promise<bigint[]> {
  try {
    const actor = await createProjectActor(canisterId);
    const state = await actor.get_state() as ProjectState;
    
    // Calculate phase caps based on max_raise and withdraw caps
    const phaseCaps: bigint[] = [];
    for (let i = 0; i < 6; i++) {
      const capBps = BigInt(state.params.phase_withdraw_caps_bps[i]);
      const cap = (state.params.max_raise * capBps) / 10000n;
      phaseCaps.push(cap);
    }
    
    return phaseCaps;
  } catch (error) {
    console.error('Error fetching project phase caps:', error);
    return Array(6).fill(0n);
  }
}

// ============================================================================
// Project Interaction Methods
// ============================================================================

export async function deposit(
  canisterId: string,
  amount: bigint
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.deposit(amount);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function closePhase(
  canisterId: string,
  phaseId: number,
  docs: DocRecord
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.close_phase(phaseId, docs);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function submitAppraisal(
  canisterId: string,
  percent: number,
  appraisalHash: string
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.submit_appraisal(percent, appraisalHash);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function withdrawPhaseFunds(
  canisterId: string,
  amount: bigint
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.withdraw_phase_funds(amount);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function fundReserve(
  canisterId: string,
  amount: bigint
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.fund_reserve(amount);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function submitSalesProceeds(
  canisterId: string,
  amount: bigint
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.submit_sales_proceeds(amount);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function claimInterest(
  canisterId: string,
  amount: bigint
): Promise<bigint> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.claim_interest(amount);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
  
  return result.Ok as bigint;
}

export async function claimRevenue(
  canisterId: string
): Promise<bigint> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.claim_revenue();
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
  
  return result.Ok as bigint;
}

export async function withdrawPrincipal(
  canisterId: string,
  shares: bigint
): Promise<bigint> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.withdraw_principal(shares);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
  
  return result.Ok as bigint;
}

export async function refundIfMinNotMet(
  canisterId: string
): Promise<bigint> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.refund_if_min_not_met();
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
  
  return result.Ok as bigint;
}

export async function accrueInterest(canisterId: string): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.accrue_interest();
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function pauseProject(canisterId: string): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.pause();
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function unpauseProject(canisterId: string): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.unpause();
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

export async function transferShares(
  canisterId: string,
  to: Principal,
  amount: bigint
): Promise<void> {
  const actor = await createProjectActor(canisterId);
  const result = await actor.transfer_shares(to, amount);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

// ============================================================================
// Registry Interaction Methods
// ============================================================================

export async function listProjects(): Promise<ProjectListing[]> {
  const actor = await createRegistryActor();
  return await actor.list_projects() as ProjectListing[];
}

export async function getProject(id: bigint): Promise<ProjectListing | null> {
  const actor = await createRegistryActor();
  const result = await actor.get_project(id);
  return result.length > 0 ? result[0] : null;
}

export async function registerProject(
  params: ProjectParams,
  metadataUri: string
): Promise<ProjectListing> {
  try {
    console.log('[registerProject] Calling registry with params:', {
      ...params,
      min_raise: params.min_raise.toString(),
      max_raise: params.max_raise.toString(),
      fundraise_deadline: params.fundraise_deadline.toString(),
    });

    const actor = await createRegistryActor();
    const result = await actor.register_project(params, metadataUri);

    console.log('[registerProject] Raw result:', result);

    // Handle Result type from Rust
    if (result && 'Err' in result) {
      throw new Error(result.Err);
    }

    // Extract listing from Ok variant
    const listing = result.Ok as ProjectListing;

    console.log('[registerProject] Project registered with canisters:', {
      id: listing.id.toString(),
      project_canister: listing.project_canister,
      token_canister: listing.token_canister,
    });

    return listing;
  } catch (error) {
    console.error('[registerProject] Error:', error);
    throw error;
  }
}

export async function assignCanisters(
  id: bigint,
  projectCanister: Principal,
  tokenCanister: Principal
): Promise<void> {
  const actor = await createRegistryActor();
  const result = await actor.assign_canisters(id, projectCanister, tokenCanister);
  
  if ('Err' in result) {
    throw new Error(result.Err);
  }
}

// ============================================================================
// Amount Conversion Utilities
// ============================================================================

const DECIMALS = 6; // Assuming 6 decimals like USDC

export function toStablecoin(amount: string | number): bigint {
  const v = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, decimal = ''] = v.split('.');
  const paddedDecimal = decimal.padEnd(DECIMALS, '0').slice(0, DECIMALS);
  return BigInt(whole + paddedDecimal);
}

export function fromStablecoin(amount: bigint): string {
  const str = amount.toString().padStart(DECIMALS + 1, '0');
  const whole = str.slice(0, -DECIMALS) || '0';
  const decimal = str.slice(-DECIMALS);
  return `${whole}.${decimal}`.replace(/\.?0+$/, '');
}

// ============================================================================
// Utility Functions
// ============================================================================

export function principalToAddress(principal: Principal): Address {
  return principal.toText();
}

export function addressToPrincipal(address: Address): Principal {
  return Principal.fromText(address);
}
