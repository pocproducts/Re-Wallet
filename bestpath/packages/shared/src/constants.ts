/** Chain, token and event constants shared across workspaces. */

export const MONAD_CHAIN_IDS = {
  mainnet: 143,
  testnet: 10143,
} as const;

export type MonadChainName = keyof typeof MONAD_CHAIN_IDS;

export const MONAD = {
  mainnet: {
    chainId: MONAD_CHAIN_IDS.mainnet,
    name: 'Monad Mainnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrl: 'https://rpc.monad.xyz',
    explorerUrl: 'https://monadscan.com',
  },
  testnet: {
    chainId: MONAD_CHAIN_IDS.testnet,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    explorerUrl: 'https://testnet.monadscan.com',
  },
} as const;

export const USDC = {
  symbol: 'USDC',
  decimals: 6,
} as const;

export const YIELD = {
  /** Reference rate, basis points. The live rate is read from chain at runtime. */
  referenceRateBps: 565,
  accrualCronHourUtc: 0,
} as const;

/** Movement types, mirrored from the DB enum-ish text column. */
export const MOVEMENT_TYPES = ['deposit', 'send', 'receive', 'yield'] as const;

export const PAYMENT_REQUEST = {
  /** nanoid length, per the schema. */
  idLength: 10,
  ttlDays: 7,
} as const;

export const LIMITS = {
  maxContacts: 20,
  minAmount: '1.00',
} as const;

export const IDEMPOTENCY_TTL_HOURS = 24;

/** Webhook event sources. */
export const WEBHOOK_SOURCES = ['privy', 'monad', 'pimlico'] as const;

export const API_VERSION = '0.1.0';
