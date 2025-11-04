// Token definitions - add more stablecoins or ckTokens here as needed
export const SUPPORTED_TOKENS = {
  ckBTC: {
    name: 'ckBTC',
    symbol: 'ckBTC',
    decimals: 8,
    canisterId: 'mxzaz-hqaaa-aaaar-qaada-cai', // Mainnet ckBTC canister
  },
  ckUSDT: {
    name: 'ckUSDT',
    symbol: 'ckUSDT',
    decimals: 6,
    canisterId: 'cngnf-vqaaa-aaaar-qag4q-cai', // Mainnet ckUSDT canister
  },
} as const;

// Default token to use across the app - change this to switch default ckToken
export const TOKEN_CONFIG = SUPPORTED_TOKENS.ckBTC;

export type DeployedCanisterIds = {
  registry?: string;
  ckbtc?: string;
  ckusdt?: string;
  host?: string;
  identityProvider?: string;
};

const fromEnv = () => {
  const host = (import.meta.env.VITE_IC_HOST as string | undefined) ?? 'https://ic0.app';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  
  // For local development
  if (isLocal) {
    return {
      registry: (import.meta.env.VITE_REGISTRY_CANISTER_ID as string | undefined) ?? 'x4hhs-wh777-77774-qaaka-cai',
      ckbtc: (import.meta.env.VITE_CKBTC_CANISTER_ID as string | undefined) ?? undefined,
      ckusdt: (import.meta.env.VITE_CKUSDT_CANISTER_ID as string | undefined) ?? undefined,
      host,
      identityProvider: `${host}?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai`, // Local Internet Identity
    };
  }
  
  // For mainnet/production
  return {
    registry: import.meta.env.VITE_REGISTRY_CANISTER_ID as string | undefined,
    ckbtc: SUPPORTED_TOKENS.ckBTC.canisterId,
    ckusdt: SUPPORTED_TOKENS.ckUSDT.canisterId,
    host,
    identityProvider: 'https://identity.ic0.app',
  };
};

export const canistersConfig: DeployedCanisterIds = {
  ...fromEnv(),
};

// Helper to get token config by canister ID
export function getTokenConfigByCanisterId(
  canisterId: string
): typeof SUPPORTED_TOKENS[keyof typeof SUPPORTED_TOKENS] | null {
  if (canisterId === canistersConfig.ckbtc) {
    return SUPPORTED_TOKENS.ckBTC;
  }
  if (canisterId === canistersConfig.ckusdt) {
    return SUPPORTED_TOKENS.ckUSDT;
  }
  return null;
}

// Helper to get token config by symbol
export function getTokenConfigBySymbol(
  symbol: string
): typeof SUPPORTED_TOKENS[keyof typeof SUPPORTED_TOKENS] | null {
  const normalized = symbol.toLowerCase();
  if (normalized === 'ckbtc') {
    return SUPPORTED_TOKENS.ckBTC;
  }
  if (normalized === 'ckusdt') {
    return SUPPORTED_TOKENS.ckUSDT;
  }
  return null;
}