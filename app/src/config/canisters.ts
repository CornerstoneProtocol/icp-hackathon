// Token definitions - add more stablecoins here as needed
export const SUPPORTED_TOKENS = {
  ckUSDC: {
    name: 'ckUSDC',
    symbol: 'ckUSDC',
    decimals: 6,
    canisterId: 'xobql-2x777-77774-qaaja-cai', // Mainnet ckUSDC canister
  },
  ckUSDT: {
    name: 'ckUSDT',
    symbol: 'ckUSDT',
    decimals: 6,
    canisterId: 'cngnf-vqaaa-aaaar-qag4q-cai', // Mainnet ckUSDT canister
  },
} as const;

// Default token to use across the app - change this to switch default stablecoin
export const TOKEN_CONFIG = SUPPORTED_TOKENS.ckUSDC;

export type DeployedCanisterIds = {
  registry?: string;
  ckusdc?: string;
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
      ckusdc: (import.meta.env.VITE_CKUSDC_CANISTER_ID as string | undefined) ?? undefined,
      ckusdt: (import.meta.env.VITE_CKUSDT_CANISTER_ID as string | undefined) ?? undefined,
      host,
      identityProvider: `${host}?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai`, // Local Internet Identity
    };
  }
  
  // For mainnet/production
  return {
    registry: import.meta.env.VITE_REGISTRY_CANISTER_ID as string | undefined,
    ckusdc: SUPPORTED_TOKENS.ckUSDC.canisterId,
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
  if (canisterId === canistersConfig.ckusdc) {
    return SUPPORTED_TOKENS.ckUSDC;
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
  if (normalized === 'ckusdc') {
    return SUPPORTED_TOKENS.ckUSDC;
  }
  if (normalized === 'ckusdt') {
    return SUPPORTED_TOKENS.ckUSDT;
  }
  return null;
}