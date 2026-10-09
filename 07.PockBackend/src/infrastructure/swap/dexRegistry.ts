/**
 * REGISTRY DE DEXs - Configuración centralizada multi-DEX + multi-chain.
 *
 * Cada DEX registra su configuración por cadena. El factory resuelve
 * el adapter correcto automáticamente según (par, cadena).
 */

import type { DepositChain } from '../../domain/deposit/catalog';
import type { SwapPairInfo } from '../../domain/ports/swap-provider';
import {
  UNISWAP_V3_MONAD_ADDRESSES,
  DEFAULT_FEE_TIER,
} from '../../domain/swap/uniswapV3Monad';

/** Configuración de un DEX en una cadena específica. */
export interface DexConfig {
  /** Identificador único del DEX: 'uniswap-v3', 'kuru', 'ambient', '1inch', etc. */
  readonly dexId: string;
  /** Nombre legible: 'Uniswap V3', 'Kuru', 'Ambient Finance'. */
  readonly name: string;
  /** Cadena donde opera este DEX. */
  readonly chain: DepositChain;
  /** Dirección del Router V3 (para swaps). */
  readonly routerAddress: string;
  /** Dirección del Quoter V2 (para cotizaciones). */
  readonly quoterAddress: string;
  /** Dirección de la Factory V3 (para derivar pools). */
  readonly factoryAddress: string;
  /** Pares soportados en esta cadena. */
  readonly supportedPairs: readonly SwapPairInfo[];
  /** Fee tiers soportados (en bips * 100: 100=0.01%, 3000=0.3%). */
  readonly feeTiers: readonly number[];
  /** RPC endpoint para esta cadena. */
  readonly rpcUrl: string;
  /** Explorador de bloques para links de transacciones. */
  readonly blockExplorerUrl?: string;
}

/** Pares soportados por DEX + cadena. */
export interface SwapPairInfo {
  readonly sourceSymbol: string;
  readonly destinationSymbol: string;
  readonly chain: DepositChain;
  readonly routerAddress: string;
  readonly feeTier: number;
}

/** Registry global de DEXs configurados. */
export const DEX_REGISTRY: readonly DexConfig[] = [
  // ============================================================
  // UNISWAP V3 - MONAD MAINNET
  // ============================================================
  {
    dexId: 'uniswap-v3',
    name: 'Uniswap V3',
    chain: 'monad',
    routerAddress: UNISWAP_V3_MONAD_ADDRESSES.ROUTER_V3,
    quoterAddress: UNISWAP_V3_MONAD_ADDRESSES.QUOTER_V2,
    factoryAddress: UNISWAP_V3_MONAD_ADDRESSES.FACTORY_V3,
    supportedPairs: [
      {
        sourceSymbol: 'USDC',
        destinationSymbol: 'USDT0',
        chain: 'monad',
        routerAddress: UNISWAP_V3_MONAD_ADDRESSES.ROUTER_V3,
        feeTier: DEFAULT_FEE_TIER,
      },
      {
        sourceSymbol: 'USDT0',
        destinationSymbol: 'USDC',
        chain: 'monad',
        routerAddress: UNISWAP_V3_MONAD_ADDRESSES.ROUTER_V3,
        feeTier: DEFAULT_FEE_TIER,
      },
    ],
    feeTiers: [100, 500],
    rpcUrl: 'https://rpc.monad.xyz',
    blockExplorerUrl: 'https://monadscan.com',
  },

  // ============================================================
  // FUTURO: UNISWAP V3 - ARBITRUM
  // ============================================================
  // {
  //   dexId: 'uniswap-v3',
  //   name: 'Uniswap V3',
  //   chain: 'arbitrum',
  //   routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  //   quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  //   factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  //   wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  //   supportedPairs: [
  //     { sourceSymbol: 'USDC', destinationSymbol: 'USDT', chain: 'arbitrum', routerAddress: '...', feeTier: 3000 },
  //   ],
  //   feeTiers: [100, 500, 3000, 10000],
  //   rpcUrl: 'https://arb1.arbitrum.io/rpc',
  //   blockExplorerUrl: 'https://arbiscan.io',
  // },

  // ============================================================
  // FUTURO: KURU - MONAD
  // ============================================================
  // {
  //   dexId: 'kuru',
  //   name: 'Kuru',
  //   chain: 'monad',
  //   routerAddress: '0x...',
  //   quoterAddress: '0x...',
  //   factoryAddress: '0x...',
  //   wethAddress: '0x...',
  //   supportedPairs: [...],
  //   feeTiers: [3000],
  //   rpcUrl: 'https://rpc.monad.xyz',
  //   blockExplorerUrl: 'https://monadscan.com',
  // },
];

/**
 * Obtiene la configuración de un DEX para una cadena.
 */
export const getDexConfig = (dexId: string, chain: DepositChain): DexConfig | undefined =>
  DEX_REGISTRY.find((d) => d.dexId === dexId && d.chain === chain);

/**
 * Obtiene todos los DEXs disponibles en una cadena.
 */
export const getDexesForChain = (chain: DepositChain): readonly DexConfig[] =>
  DEX_REGISTRY.filter((d) => d.chain === chain);

/**
 * Busca un par soportado en cualquier DEX de la cadena.
 */
export const findPairInRegistry = (
  sourceSymbol: string,
  destinationSymbol: string,
  chain: DepositChain
): { dexConfig: DexConfig; pair: SwapPairInfo } | undefined => {
  for (const dexConfig of DEX_REGISTRY) {
    if (dexConfig.chain !== chain) continue;
    const pair = dexConfig.supportedPairs.find(
      (p) => p.sourceSymbol === sourceSymbol && p.destinationSymbol === destinationSymbol
    );
    if (pair) return { dexConfig, pair };
  }
  return undefined;
}

/**
 * Obtiene todos los pares únicos soportados en una cadena (para UI).
 */
export const getSupportedPairsForChain = (chain: DepositChain): readonly SwapPairInfo[] => {
  const pairs: SwapPairInfo[] = [];
  for (const dexConfig of DEX_REGISTRY) {
    if (dexConfig.chain === chain) {
      pairs.push(...dexConfig.supportedPairs);
    }
  }
  // Deduplicar por source:destination
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = `${p.sourceSymbol}:${p.destinationSymbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};