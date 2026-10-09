/**
 * FACTORY: Resuelve el SwapProvider correcto según el par y la cadena.
 *
 * Usa el DEX_REGISTRY para encontrar el DEX que soporta el par,
 * y devuelve el adapter correspondiente ya configurado.
 */

import { BalanceReadError } from '../../domain/portfolio/errors';
import type { SwapProvider, SwapPairInfo, SwapQuote, SwapExecutionInput, SwapExecutionResult, SwapFailure } from '../../domain/ports/swap-provider';
import type { DepositChain } from '../../domain/deposit/catalog';
import { DEX_REGISTRY, getDexConfig, findPairInRegistry, getSupportedPairsForChain, type DexConfig } from './dexRegistry';
import { createUniswapV3Adapter, type UniswapV3ChainConfig } from './adapters/uniswapV3Adapter';
import { MONAD_STABLECOIN_ADDRESSES } from '../../domain/swap/uniswapV3Monad';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from '../rpc/httpDeadline';

/**
 * ── Por qué un lookup y no un `if` por símbolo ──────────────────────────────
 *
 * La versión anterior resolvía el token con `p.sourceSymbol === 'USDC' ? ... : '0x...'`.
 * Eso devolvía el placeholder para cualquier otro activo, de modo que el par
 * USDC → USDT0 cotizaba contra la dirección `0x...` y daba un resultado
 * numérico — 0 — en lugar de decir "no sé". Un `0` es una afirmación cierta
 * ("recibís cero"), y acá era mentira.
 *
 * Ahora un símbolo que no está en el mapa lanza, y el par no se ofrece.
 */
const MONAD_TOKEN_BY_SYMBOL: Readonly<Record<string, string>> = {
  USDC: MONAD_STABLECOIN_ADDRESSES.USDC,
  USDT0: MONAD_STABLECOIN_ADDRESSES.USDT0,
};

const resolveTokenAddress = (symbol: string): string => {
  const address = MONAD_TOKEN_BY_SYMBOL[symbol.toUpperCase()];
  if (address === undefined) {
    throw new Error(`Sin direccion para el token "${symbol}" en Monad`);
  }
  return address;
};

type SwapProviderFactory = {
  readonly getProviderForPair: (sourceSymbol: string, destinationSymbol: string, chain: DepositChain) => Promise<SwapProvider>;
  readonly getSupportedPairs: (chain: DepositChain) => Promise<readonly SwapPairInfo[]>;
  readonly getProvider: (dexId: string, chain: DepositChain) => SwapProvider | null;
};

export const createSwapProviderFactory = (options: {
  readonly rpcUrlOverrides?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly deadline?: DeadlinePolicy;
} = {}): SwapProviderFactory => {
  const { rpcUrlOverrides = {}, fetchImpl = fetch, deadline } = options;

  const send = withDeadline(fetchImpl, {
    timeoutMs: 5_000,
    ...deadline,
  });

  // Cache de adapters por (dexId, chain)
  const adapterCache = new Map<string, SwapProvider>();

  const getProvider = (dexId: string, chain: DepositChain): SwapProvider | null => {
    const cacheKey = `${dexId}:${chain}`;
    const cached = adapterCache.get(cacheKey);
    if (cached) return cached;

    const dexConfig = DEX_REGISTRY.find((d) => d.dexId === dexId && d.chain === chain);
    if (!dexConfig) return null;

    if (dexConfig.dexId === 'uniswap-v3') {
      const config = {
        routerAddress: dexConfig.routerAddress,
        quoterAddress: dexConfig.quoterAddress,
        factoryAddress: dexConfig.factoryAddress,
        rpcUrl: dexConfig.rpcUrl,
        supportedPairs: dexConfig.supportedPairs.map(p => ({
          sourceSymbol: p.sourceSymbol,
          destinationSymbol: p.destinationSymbol,
          feeTier: p.feeTier,
          tokenIn: resolveTokenAddress(p.sourceSymbol),
          tokenOut: resolveTokenAddress(p.destinationSymbol),
        })),
        feeTiers: dexConfig.feeTiers,
      } as const;

      const adapter = createUniswapV3Adapter({
        config,
        rpcUrl: rpcUrlOverrides?.[chain] ?? dexConfig.rpcUrl,
      });

      adapterCache.set(`${dexId}:${chain}`, adapter);
      return adapter;
    }

    return null;
  };

  const getProviderForPair = async (sourceSymbol: string, destinationSymbol: string, chain: DepositChain): Promise<SwapProvider> => {
    const result = findPairInRegistry(sourceSymbol, destinationSymbol, chain);
    if (!result) {
      throw new BalanceReadError('PAIR_NOT_SUPPORTED', `Pair ${sourceSymbol}/${destinationSymbol} not supported on ${chain}`);
    }

    const provider = getProvider(result.dexConfig.dexId, chain);
    if (!provider) {
      throw new BalanceReadError('PAIR_NOT_SUPPORTED', `No provider for ${result.dexConfig.dexId} on ${chain}`);
    }

    return provider;
  };

  const getSupportedPairs = async (chain: DepositChain): Promise<readonly SwapPairInfo[]> => {
    return getSupportedPairsForChain(chain);
  };

  return {
    getProviderForPair,
    getSupportedPairs,
    getProvider,
  };
};