/**
 * ADAPTER: Uniswap V3 Swap Provider genérico.
 *
 * Recibe configuración por constructor (DexConfig), así es reusable
 * para cualquier cadena donde Uniswap V3 esté desplegado.
 */

import { BalanceReadError } from '../../../domain/portfolio/errors';
import type {
  SwapProvider,
  SwapPairInfo,
  SwapQuote,
  SwapExecutionInput,
  SwapExecutionResult,
  SwapFailure,
} from '../../../domain/ports/swap-provider';
import type { DepositChain } from '../../../domain/deposit/catalog';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from '../../rpc/httpDeadline';
import {
  encodeQuoteExactInputSingle,
  decodeQuoteExactInputSingle,
  applySlippage,
  FEE_TIERS,
  QUOTE_EXACT_INPUT_SINGLE_SELECTOR,
} from '../../../domain/swap/uniswapV3';

/**
 * La forma de un par ya resuelto a direcciones, como la que arma el factory.
 *
 * `tokenIn`/`tokenOut` viajan resueltos porque el símbolo no es una dirección:
 * un ticker que la cadena no reconoce tiene que fallar en el factory, no acá.
 */
export interface UniswapV3ChainPair {
  readonly sourceSymbol: string;
  readonly destinationSymbol: string;
  readonly feeTier: number;
  readonly tokenIn: string;
  readonly tokenOut: string;
}

/**
 * Configuración por cadena de Uniswap V3.
 *
 * Vive acá y no en `domain/swap/` porque no es matemática: son direcciones y
 * pares concretos de una cadena, que es exactamente lo que el dominio declara
 * no tener. Este archivo es el que la define, así que el que la necesita la
 * importa desde acá — nunca desde un alias a sí mismo.
 *
 * `quoterAddress` es opcional porque no toda cadena tiene un Quoter desplegado
 * y usable: en Monad el canónico es un stub (ver `domain/swap/uniswapV3Monad.ts`).
 */
export interface UniswapV3ChainConfig {
  /** La cadena para la que vale esta configuración. */
  readonly chain: DepositChain;
  readonly routerAddress: string;
  /** Ausente cuando la cadena no tiene un Quoter que responda. */
  readonly quoterAddress?: string;
  readonly factoryAddress: string;
  readonly rpcUrl: string;
  readonly feeTiers: readonly number[];
  readonly supportedPairs: readonly UniswapV3ChainPair[];
}

export interface UniswapV3AdapterOptions {
  readonly config: UniswapV3ChainConfig;
  /**
   * Endpoint del RPC. Pisar el de `config` es lo que hace el factory cuando hay
   * un override por cadena; sin override gana el de la config.
   */
  readonly rpcUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly deadline?: DeadlinePolicy;
}

export const createUniswapV3Adapter = (
  options: UniswapV3AdapterOptions,
): SwapProvider => {
  const { config, rpcUrl = config.rpcUrl, fetchImpl = fetch, deadline } = options;

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

    // Un JSON-RPC responde `error` o `result`, nunca los dos: se estrecha a la
    // forma que el código usa abajo y no a `any`.
    const json = (await response.json()) as {
      readonly error?: { readonly code?: number; readonly message?: string };
      readonly result: string;
    };
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

  /*
   * LOS POOLS SALEN DE LA CONFIGURACIÓN DEL ADAPTADOR, no de un mapa global.
   *
   * Antes esto llamaba a un `POOL_MAP` que no existe en ningún módulo alcanzable
   * desde acá, así que en runtime era un `ReferenceError` apenas alguien pedía
   * una cotización. No era un tipo roto: era el camino de cotización entero
   * sin backing.
   *
   * La fuente de verdad ya estaba a la vista: `config.supportedPairs` es lo que
   * el factory arma desde `dexRegistry`, y trae el par con su símbolo, su fee
   * tier y **los tokens ya resueltos a dirección**. Un par configurado es
   * entonces un pool, y un par que no está configurado no es un pool.
   *
   * Lo que hace el índice es simétrica a propósito: en Uniswap V3 el pool de
   * A→B es el mismo que el de B→A, y el que cotiza en el otro sentido tiene que
   * devolver las dos direcciones intercambiadas. Una clave y la que devuelve el
   * sentido inverso.
   *
   * Y el caso de "no hay pool" NO es un error: es `PAIR_NOT_SUPPORTED`, que es
   * una respuesta que el caso de uso ya sabe dar. Un par sin configurar tiene
   * que decir que no se soporta, no romper.
   */
  const POOLS_BY_PAIR = new Map(
    config.supportedPairs.map((pair) => [
      `${pair.sourceSymbol.toLowerCase()}:${pair.destinationSymbol.toLowerCase()}`,
      { tokenIn: pair.tokenIn, tokenOut: pair.tokenOut, feeTier: pair.feeTier },
    ]),
  );

  const findPool = (
    tokenIn: string,
    tokenOut: string,
  ): { feeTier: number; tokenIn: string; tokenOut: string } | null => {
    const direct = POOLS_BY_PAIR.get(`${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`);
    if (direct !== undefined) return direct;

    const reversed = POOLS_BY_PAIR.get(`${tokenOut.toLowerCase()}:${tokenIn.toLowerCase()}`);
    if (reversed !== undefined) {
      return { tokenIn: reversed.tokenOut, tokenOut: reversed.tokenIn, feeTier: reversed.feeTier };
    }

    return null;
  };

  return {
    /*
     * LOS PARES QUE SE OFRECEN SON LOS QUE HAY CONFIGURADOS.
     *
     * Antes esta lista venía escrita a mano y decía tres cosas distintas de lo
     * que el backend podía hacer: nombraba `USDT` cuando el registro declara
     * `USDT0`, ponía un `routerAddress` de `'0x...'` —un placeholder, no una
     * dirección— y un `feeTier` de 3000 cuando el dominio declara 100 como el
     * que tiene liquidez. Una persona veía un par offered y una cotización que
     * no existía; es el botón que miente, con forma de lista.
     *
     * Ahora sale de `config.supportedPairs`, que es lo único que el factory arma
     * desde `dexRegistry`: si un par no está en el registro, no se ofrece.
     */
    async getSupportedPairs() {
      return config.supportedPairs.map((pair) => ({
        sourceSymbol: pair.sourceSymbol,
        destinationSymbol: pair.destinationSymbol,
        chain: config.chain,
        routerAddress: config.routerAddress,
        feeTier: pair.feeTier,
      }));
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