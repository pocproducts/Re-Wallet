/**
 * ADAPTER: Uniswap V3 Swap Provider genérico.
 *
 * Recibe configuración por constructor (DexConfig), así es reusable
 * para cualquier cadena donde Uniswap V3 esté desplegado.
 */

import { BalanceReadError } from '@domain/portfolio/errors';
import type {
  SwapProvider,
  SwapPairInfo,
  SwapQuote,
  SwapExecutionInput,
  SwapExecutionResult,
  SwapFailure,
} from '../../domain/ports/swap-provider';
import type { DepositChain } from '../../domain/deposit/catalog';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from '@infrastructure/rpc/httpDeadline';
import {
  encodeQuoteExactInputSingle,
  decodeQuoteExactInputSingle,
  applySlippage,
  FEE_TIERS,
  QUOTE_EXACT_INPUT_SINGLE_SELECTOR,
  encodeAddress,
  encodeUint256,
  encodeUint160,
} from '@domain/swap/uniswapV3';

// El archivo que define este tipo es este mismo: se importa a sí mismo por
// nombre cuando otro módulo lo necesita, no desde una ruta interna del dominio.
export type { UniswapV3ChainConfig } from './uniswapV3Adapter';

export interface UniswapV3AdapterOptions {
  readonly config: UniswapV3ChainConfig;
  readonly fetchImpl?: typeof fetch;
  readonly deadline?: DeadlinePolicy;
}

export const createUniswapV3Adapter = (
  options: UniswapV3AdapterOptions = {},
): SwapProvider => {
  const { config, fetchImpl = fetch, deadline } = options;

  const send = withDeadline(fetchImpl, {
    timeoutMs: 5_000,
    ...deadline,
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

  // Cache
  const quoteCache = new Map<string, { quote: SwapQuote; expiresAt: number }>();
  const CACHE_TTL_MS = 30_000;

  const makeCacheKey = (source: string, dest: string, chain: string, amountIn: bigint, slippage: number) =>
    `${source}:${dest}:${chain}:${amountIn}:${slippage}`;

  const getTokenAddress = (symbol: string, chain: DepositChain): string | null => {
    if (config.chain !== chain) return null;
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