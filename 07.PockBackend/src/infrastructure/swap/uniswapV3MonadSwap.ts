/**
 * ADAPTER: Uniswap V3 Swap Provider en Monad mainnet.
 *
 * ── Qué hace este adaptador ──────────────────────────────────────────────────
 *
 * Implementa `SwapProvider` usando el router de Uniswap V3 desplegado en Monad.
 * Soporta cotizaciones y ejecución de swaps entre ERC-20.
 *
 * ── Direcciones requeridas ───────────────────────────────────────────────────
 *
 * ANTES DE USAR: Completa las direcciones en `UNISWAP_V3_MONAD_ADDRESSES` en
 * `domain/swap/uniswapV3Monad.ts` con las direcciones reales de Monad mainnet.
 */

import { BalanceReadError } from '../../domain/portfolio/errors';
import type { SwapProvider, SwapPairInfo, SwapQuote, SwapExecutionInput, SwapExecutionResult, SwapFailure } from '../../domain/ports/swap-provider';
import type { DepositChain } from '../../domain/deposit/catalog';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from '../rpc/httpDeadline';

import {
  UNISWAP_V3_MONAD_ADDRESSES,
} from '../../domain/swap/uniswapV3Monad';

/** Un pool conocido en Monad. */
export interface KnownPool {
  readonly tokenA: string;
  readonly tokenB: string;
  readonly feeTier: number;
  readonly poolAddress?: string;
}

/** CONFIGURA AQUÍ LOS POOLS REALES EN MONAD. */
const KNOWN_POOLS = [
  // USDC / USDT0 pool (el par principal para el swap)
  {
    tokenA: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', // USDC Monad (verificado)
    tokenB: '0x...', // TODO: Dirección real de USDT0 en Monad
    feeTier: 3000, // 0.3%
  },
] as const;

/** Mapa rápido: `source:destination:feeTier` → pool info. */
const POOL_MAP = new Map<string, { tokenA: string; tokenB: string; feeTier: number }>();

for (const pool of [
  { tokenA: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', tokenB: '0x...', feeTier: 3000 },
] as const) {
  const key1 = `${pool.tokenA.toLowerCase()}:${pool.tokenB.toLowerCase()}:${pool.feeTier}`;
  const key2 = `${pool.tokenB.toLowerCase()}:${pool.tokenA.toLowerCase()}:${pool.feeTier}`;
  POOL_MAP.set(key1, { tokenA: pool.tokenA, tokenB: pool.tokenB, feeTier: pool.feeTier });
  POOL_MAP.set(key2, { tokenA: pool.tokenA, tokenB: pool.tokenB, feeTier: pool.feeTier });
}

export interface UniswapV3MonadSwapOptions {
  readonly rpcUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly deadline?: DeadlinePolicy;
}

export const DEFAULT_SLIPPAGE_BIPS = 50;
export const QUOTE_TTL_MS = 30_000;
export const QUOTER_TIMEOUT_MS = 5_000;

const encodeAddress = (addr: string): string => {
  const bare = addr.startsWith('0x') ? addr.slice(2) : addr;
  return bare.toLowerCase().padStart(64, '0');
};

const encodeUint256 = (value: bigint): string => value.toString(16).padStart(64, '0');
const encodeUint24 = (value: number): string => value.toString(16).padStart(6, '0');
const encodeUint160 = (value: bigint): string => value.toString(16).padStart(40, '0');

const encodeQuoteExactInputSingle = ({
  tokenIn,
  tokenOut,
  feeTier,
  amountIn,
  sqrtPriceLimitX96 = 0n,
}: {
  tokenIn: string;
  tokenOut: string;
  feeTier: number;
  amountIn: bigint;
  sqrtPriceLimitX96?: bigint;
}): string => {
  return (
    '0x3b0d9b13' +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
    feeTier.toString(16).padStart(64, '0') +
    encodeUint256(amountIn) +
    encodeUint160(0n)
  );
};

const decodeQuoteExactInputSingle = (result: string): bigint => {
  const hex = result.startsWith('0x') ? result.slice(2) : result;
  if (hex.length < 64) throw new Error(`quote result too short: ${hex.length} chars`);
  return BigInt(`0x${hex.slice(0, 64)}`);
};

const applySlippage = (amountOut: bigint, slippageBips: number): bigint => {
  if (slippageBips < 0 || slippageBips > 10000) {
    throw new RangeError(`slippageBips must be 0..10000, got ${slippageBips}`);
  }
  return (amountOut * BigInt(10000 - slippageBips)) / 10000n;
}

export interface UniswapV3MonadSwapOptions {
  readonly rpcUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly deadline?: DeadlinePolicy;
}

const quoteCache = new Map<string, { quote: SwapQuote; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

const makeCacheKey = (source: string, dest: string, chain: string, amountIn: bigint, slippage: number) =>
  `${source}:${dest}:${chain}:${amountIn}:${slippage}`;

const getTokenAddress = (symbol: string, chain: DepositChain): string | null => {
  if (chain !== 'monad') return null;
  if (symbol === 'USDC') return '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
  if (symbol === 'USDT') return '0x...'; // TODO: Dirección real de USDT0 en Monad
  return null;
};

const findPool = (tokenIn: string, tokenOut: string): { feeTier: number; tokenIn: string; tokenOut: string } | null => {
  const key = `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:3000`;
  const pool = POOL_MAP.get(`${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:3000`);
  if (pool) return { ...pool, tokenIn: pool.tokenA, tokenOut: pool.tokenB };

  const reversed = POOL_MAP.get(`${tokenOut.toLowerCase()}:${tokenIn.toLowerCase()}:3000`);
  if (reversed) return { ...reversed, tokenIn: reversed.tokenA, tokenOut: reversed.tokenB };

  return null;
};

export interface UniswapV3MonadSwapOptions {
  readonly rpcUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly deadline?: DeadlinePolicy;
}

export const createUniswapV3MonadSwapProvider = (
  options: UniswapV3MonadSwapOptions = {},
): SwapProvider => {
  const rpcUrl = options.rpcUrl ?? 'https://rpc.monad.xyz';
  const fetchImpl = options.fetchImpl ?? fetch;

  const send = withDeadline(fetchImpl, {
    timeoutMs: 5_000,
    ...options.deadline,
  });

  const rpcCall = async (method: string, params: readonly unknown[]): Promise<string> => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const response = await send(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `RPC HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new BalanceReadError('RPC_REJECTED', `RPC error: ${JSON.stringify(json.error)}`);
    }
    return json.result;
  };

  return {
    async getSupportedPairs() {
      return [
        {
          sourceSymbol: 'USDC',
          destinationSymbol: 'USDT',
          chain: 'monad',
          routerAddress: '0x...',
          feeTier: 3000,
        },
        {
          sourceSymbol: 'USDT',
          destinationSymbol: 'USDC',
          chain: 'monad',
          routerAddress: '0x...',
          feeTier: 3000,
        },
      ];
    },

    async getQuote(sourceSymbol, destinationSymbol, chain, amountIn, slippageBips) {
      if (chain !== 'monad') {
        return { status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' as SwapFailure };
      }

      const pool = findPool(sourceSymbol, destinationSymbol);
      if (!pool) {
        return { status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' as SwapFailure };
      }

      const cacheKey = `${sourceSymbol}:${destinationSymbol}:${chain}:${amountIn}:${slippageBips}`;
      const now = Date.now();
      const cached = quoteCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return { status: 'ok', value: cached.quote };
      }

      try {
        const tokenIn = getTokenAddress(sourceSymbol, chain);
        const tokenOut = getTokenAddress(destinationSymbol, chain);

        if (!tokenIn || !tokenOut) {
          return { status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' as SwapFailure };
        }

        const feeTier = 3000;

        // 1. Cotizar con el quoter V2
        const calldata = encodeQuoteExactInputSingle({
          tokenIn,
          tokenOut,
          feeTier,
          amountIn,
          sqrtPriceLimitX96: 0n,
        });

        const result = await rpcCall('eth_call', [
          { to: '0x...', data: calldata }, // TODO: QUOTER_V2 real
          'latest',
        ]);

        const amountOut = decodeQuoteExactInputSingle(result);
        const amountOutMin = applySlippage(amountOut, slippageBips);
        const price = Number(amountOut) / Number(amountIn);

        const quote: SwapQuote = {
          quoteId: `quote_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          amountIn,
          amountOut,
          amountOutMin,
          validUntil: Date.now() + 30_000,
          price: price.toFixed(6),
          feeTier,
          chain,
        };

        quoteCache.set(cacheKey, { quote, expiresAt: Date.now() + 30_000 });
        return { status: 'ok', value: quote };
      } catch (error) {
        if (error instanceof BalanceReadError) {
          return { status: 'unreadable', reason: error.reason as SwapFailure };
        }
        return { status: 'unreadable', reason: 'UNKNOWN_ERROR' as SwapFailure };
      }
    },

    async executeSwap(input) {
      // TODO: Implementar ejecución real cuando tengamos:
      // 1. Router address verificado
      // 2. Wallet del usuario (firma en frontend)
      // 2. Broadcast de la transacción
      // 3. Confirmación y receipt
      return { status: 'unreadable', reason: 'UNKNOWN_ERROR' as SwapFailure };
    },
  };
};