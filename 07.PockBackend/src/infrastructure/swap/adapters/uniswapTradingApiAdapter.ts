/**
 * ADAPTER: Uniswap Trading API como `SwapProvider`.
 *
 * ── Por qué este adapter existe ──────────────────────────────────────────────
 *
 * Monad no tiene QuoterV2 desplegado. La documentacion oficial de Uniswap lista
 * cuatro contratos para Monad —Factory, Universal Router, Multicall, TickLens— y
 * el Quoter no esta entre ellos. El `0x61fFE...` canonico responde bytecode pero
 * `quoteExactInputSingle` devuelve `0x` a 1, 10 y 100 USDC.
 *
 * Ese Quoter era la unica forma de obtener un `amountOut` en el adaptador de V3,
 * asi que sin el no habia cotizacion. El Trading API es la via que usa el web
 * app de Uniswap para la misma operacion: corre el ruteo, devuelve el mejor
 * precio entre el protocolo Uniswap y UniswapX, y devuelve la transaccion ya
 * armada para firmar.
 *
 * ── Por qué esto no es "pegar el Uniswap de antes" ───────────────────────────
 *
 * El puerto `SwapProvider` ya era agnostico: el caso de uso no sabe quien cotiza.
 * Este adapter no cambia el puerto, cambia quien lo cumple. Si manana se quiere
 * cotizar con Kuru Flow, es un adapter mas al lado de este y el caso de uso no se
 * entera — que es exactamente para lo que existe `getProviderForPair`.
 *
 * ── Por qué la API key ausente no es un error de cotizacion ─────────────────
 *
 * Sin `UNISWAP_API_KEY` este adapter **no dice "no hay precio"**: dice "no puedo
 * preguntar". Son afirmaciones distintas y la diferencia importa. Si se
 * confundieran, el caso de uso cairia en `QUOTE_NOT_FOUND` y la pantalla
 * diria que no hay mercado, cuando en realidad nadie pregunto. Por eso la
 * ausencia de la clave es un fallo de configuracion (`RPC_UNAVAILABLE`), no un
 * resultado de mercado.
 */

import type {
  SwapProvider,
  SwapPairInfo,
  SwapQuote,
  SwapExecutionInput,
  SwapFailure,
} from '../../../domain/ports/swap-provider';
import type { DepositChain } from '../../../domain/deposit/catalog';
import {
  UNISWAP_TRADING_API,
  MONAD_STABLECOIN_ADDRESSES,
} from '../../../domain/swap/uniswapV3Monad';

/**
 * La cadena que el Trading API conoce. El puerto habla de `DepositChain` porque
 * el dominio tiene mas cadenas; el API tiene las suyas, y la unica que el API
 * sirve hoy para este producto es Monad.
 */
const TRADING_API_CHAIN_IDS: Readonly<Record<string, number>> = {
  monad: 143,
};

const TOKEN_BY_SYMBOL: Readonly<Record<string, string>> = {
  USDC: MONAD_STABLECOIN_ADDRESSES.USDC,
  USDT0: MONAD_STABLECOIN_ADDRESSES.USDT0,
};

/**
 * ── Por qué solo EXACT_INPUT ────────────────────────────────────────────────
 *
 * El puerto permite `slippageBips` y devuelve `amountOutMin`. El API calcula el
 * minimo desde el slippage que le pasemos, asi que el control sigue siendo
 * nuestro. Se pide EXACT_INPUT porque es lo que dice la pantalla: "quiero
 * convertir estos 100 USDC", no "quiero recibir exactamente X".
 */
const TRADE_TYPE_EXACT_INPUT = 'EXACT_INPUT' as const;

/** El cuerpo que el API espera. Solo los campos que se usan. */
interface QuoteRequestBody {
  readonly tokenInChainId: number;
  readonly tokenOutChainId: number;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string;
  readonly swapper: string;
  readonly type: typeof TRADE_TYPE_EXACT_INPUT;
  readonly slippageTolerance: number;
}

/**
 * ── Por qué se estrecha la respuesta ────────────────────────────────────────
 *
 * El API devuelve un cuerpo grande del que solo interesa un pedazo. Leer's sin
 * estrechar seria `any`, y un `any` que llega a la pantalla es como un `0`: un
 * numero cierto y falso.
 *
 * ── Por qué el `amountOut` está en `quote.output.amount` ────────────────────
 *
 * Porque no está en `quote.amountOut`. La primera versión de este adapter leía
 * `quote.amountOut`, que **existe como concepto pero no como campo**: la
 * respuesta real trae la cifra en `quote.output.amount`, y `quote.amountOut`
 * viene `undefined`. Con `asString(undefined)` eso terminaba en
 * `QUOTE_NOT_FOUND` — un "no hay precio" que en realidad era "no miraste donde
 * estaba el precio".
 *
 * Verificado contra `rpc.monad.xyz` y contra el API, mismo bloque
 * (111822325): el precio implícito que devuelve el API, 1.000504 USDT0 por USDC,
 * y el que se lee del `slot0()` del pool, 1.000591, son el mismo numero con el
 * spread del swap encima. Esa comparacion es la que prueba que los dos lados
 * dicen lo mismo.
 */
interface QuoteResponseQuote {
  readonly quote?: {
    readonly input?: { readonly amount?: unknown };
    readonly output?: { readonly amount?: unknown };
    readonly quoteId?: unknown;
    readonly blockNumber?: unknown;
    readonly priceImpact?: unknown;
    readonly routeString?: unknown;
    /** Los hops: `[[hop, hop], [hop]]`. Un `number`, no una ruta obvia. */
    readonly route?: unknown;
  };
  readonly transaction?: {
    readonly to?: unknown;
    readonly data?: unknown;
    readonly value?: unknown;
    readonly gasLimit?: unknown;
  };
  readonly permitTransaction?: {
    readonly to?: unknown;
    readonly data?: unknown;
    readonly value?: unknown;
  };
  readonly gasCostWei?: unknown;
}

/**
 * El precio implícito como texto con seis decimales.
 *
 * ── Por qué texto y no `number` ─────────────────────────────────────────────
 *
 * Porque un precio de DeFi en `number` pierde precisión justo en el lugar donde
 * no puede perderla, y porque el puerto lo declara `string` a propósito. Con
 * `bigint` la división entera trunca —`100050446 / 100000000 = 1`, y se pierde
 * el medio punto que es exactamente la diferencia entre dos stablecoins— así que
 * se escala antes de dividir.
 *
 * `amountOut / amountIn` es "cuánto destino por cada origen". El puerto pide al
 * revés —"cuánto origen por cada destino"—, que es lo que se lee como precio.
 */
const formatPrice = (amountOut: bigint, amountIn: bigint): string => {
  if (amountIn <= 0n || amountOut <= 0n) return '0';
  const scale = 1_000_000n;
  // Redondea al sexto decimal, que es la escala con la que los dos activos
  // cuentan: más exacto que eso es ruido de división entera.
  const inverse = (amountIn * scale + amountOut / 2n) / amountOut;
  const whole = inverse / scale;
  const frac = (inverse % scale).toString().padStart(6, '0');
  return `${whole}.${frac}`;
};

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asBigIntString = (value: unknown): string | null => {
  const text = asString(value);
  if (text === null) return null;
  // `BigInt` acepta "0x..." y decimal, pero no un string vacio ni basura.
  try {
    const parsed = BigInt(text);
    return parsed.toString();
  } catch {
    return null;
  }
};

/** Un entero dentro de un rango, o `null`. Un bloque negativo no existe. */
const asBlockNumber = (value: unknown): number | null => {
  const text = asBigIntString(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export interface UniswapTradingApiOptions {
  readonly apiKey: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

export const createUniswapTradingApiAdapter = (
  options: UniswapTradingApiOptions,
): SwapProvider => {
  const { apiKey, fetchImpl = fetch, baseUrl = UNISWAP_TRADING_API.BASE_URL } = options;

  const chainIdOf = (chain: DepositChain): number | null => TRADING_API_CHAIN_IDS[chain] ?? null;

  const tokenOf = (symbol: string): string | null =>
    TOKEN_BY_SYMBOL[symbol.toUpperCase()] ?? null;

  return {
    async getSupportedPairs(): Promise<readonly SwapPairInfo[]> {
      // El API no expone un listado de pares; lo declara el registry. Lo que
      // este adapter puede aportar es decir quais pares **resuelve**: si el
      // simbolo no tiene direccion en la cadena, el par no existe aca.
      const pares: SwapPairInfo[] = [];

      for (const [sourceSymbol, tokenIn] of Object.entries(TOKEN_BY_SYMBOL)) {
        for (const destinationSymbol of Object.keys(TOKEN_BY_SYMBOL)) {
          if (sourceSymbol === destinationSymbol) continue;
          pares.push({
            sourceSymbol,
            destinationSymbol,
            chain: 'monad',
            routerAddress: UNISWAP_TRADING_API.BASE_URL,
            feeTier: 0,
          });
        }
      }

      return pares;
    },

    async getQuote(sourceSymbol, destinationSymbol, chain, amountIn, slippageBips) {
      const chainId = chainIdOf(chain);
      if (chainId === null) {
        return { status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' as SwapFailure };
      }

      const tokenIn = tokenOf(sourceSymbol);
      const tokenOut = tokenOf(destinationSymbol);
      if (tokenIn === null || tokenOut === null || sourceSymbol === destinationSymbol) {
        return { status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' as SwapFailure };
      }

      // ── Sin clave no hay cotizacion, y no es lo mismo que "no hay precio" ──
      if (apiKey === null || apiKey.trim() === '') {
        return { status: 'unreadable', reason: 'RPC_UNAVAILABLE' as SwapFailure };
      }

      if (amountIn <= 0n) {
        return { status: 'unreadable', reason: 'INSUFFICIENT_LIQUIDITY' as SwapFailure };
      }

      const body: QuoteRequestBody = {
        tokenInChainId: chainId,
        tokenOutChainId: chainId,
        tokenIn,
        tokenOut,
        amount: amountIn.toString(),
        // El API pide EXACT_INPUT porque es lo que dice la pantalla: "quiero
        // convertir estos 100 USDC", no "quiero recibir exactamente X".
        // `protocols` **no** se limita a V3: la ruta que el API encontro para
        // USDC/USDT0 en Monad es de **V4**, con fee 0.0075%. Fijar un solo
        // protocolo habria devuelto "no hay ruta" sobre un par con $27M de
        // liquidez.
        //
        // El `swapper` es el que paga, y acá va el cero porque todavia no se sabe
        // quien firma: la cotizacion no lo necesita, y la transaccion final se
        // vuelve a pedir con la direccion real de la persona.
        swapper: '0x0000000000000000000000000000000000000000',
        type: TRADE_TYPE_EXACT_INPUT,
        slippageTolerance: Number(slippageBips) / 100,
      };

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/quote`, {
          method: 'POST',
          headers: {
            [UNISWAP_TRADING_API.API_KEY_HEADER]: apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch {
        return { status: 'unreadable', reason: 'RPC_UNAVAILABLE' as SwapFailure };
      }

      if (response.status === UNISWAP_TRADING_API.UNAUTHENTICATED_STATUS) {
        return { status: 'unreadable', reason: 'RPC_REJECTED' as SwapFailure };
      }

      if (!response.ok) {
        return { status: 'unreadable', reason: 'RPC_REJECTED' as SwapFailure };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { status: 'unreadable', reason: 'RPC_MALFORMED_RESPONSE' as SwapFailure };
      }

      const container = payload as QuoteResponseQuote | null;
      // ── La cifra vive en `quote.output.amount` ─────────────────────────────
      // Verificado contra el API real el 2026-10: `quote.amountOut` no existe
      // como campo. Leerlo daba `undefined` y terminaba en `QUOTE_NOT_FOUND`
      // sobre un par que cotiza bien.
      const amountOutRaw = asBigIntString(container?.quote?.output?.amount);

      // ── Sin `amountOut` legible no hay cotizacion ─────────────────────────
      // El API responde 200 tambien cuando no encuentra ruta. Un cuerpo sin
      // `output.amount` no es "precio cero": es "no me dijeron el precio".
      if (amountOutRaw === null) {
        return { status: 'unreadable', reason: 'QUOTE_NOT_FOUND' as SwapFailure };
      }

      const amountOut = BigInt(amountOutRaw);
      if (amountOut <= 0n) {
        return { status: 'unreadable', reason: 'INSUFFICIENT_LIQUIDITY' as SwapFailure };
      }

      // El slippage ya viene aplicado por el API, pero el puerto pide que el
      // minimo lo declare el que cotiza. Se recalcula sobre el mismo bips.
      const factor = 10_000n - BigInt(slippageBips > 0 ? slippageBips : 0);
      const amountOutMin = (amountOut * factor) / 10_000n;

      const quote: SwapQuote = {
        // El `quoteId` del API, no el JSON armado a mano. Es el identificador con
        // el que el API reconoce la cotizacion cuando se ejecute, y learner a
        // reconstruirlo aca seria volver a adivinar lo que el API ya sabe.
        quoteId: asString(container?.quote?.quoteId) ?? '',
        amountIn,
        amountOut,
        amountOutMin,
        // 30 segundos: una DeFi cotizacion envejece en segundos, y una persona
        // que tardo mas de eso ya no esta confirmando el mismo precio.
        validUntil: Date.now() + 30_000,
        // El precio implicito, derivado de la misma respuesta que el `amountOut`
        // y con la misma escala. `1 USDT0 = X USDC`: el inverso de "cuanto
        // recibo por cada unidad que mando".
        price: formatPrice(amountOut, amountIn),
        feeTier: 0,
        chain,
        // El bloque que el API usó para calcular. Si no viene, `undefined`: la
        // cita queda sin referencia, y el front lo muestra como tal en vez de
        // inventar un "ahora".
        ...(asBlockNumber(container?.quote?.blockNumber) !== null
          ? { blockNumber: asBlockNumber(container?.quote?.blockNumber) as number }
          : {}),
      };

      return { status: 'ok', value: quote };
    },

    async executeSwap(_input: SwapExecutionInput) {
      // ── Por qué todavía no se ejecuta ───────────────────────────────────
      // Firmar es un acto de la persona. El API devuelve la transacción ya
      // armada dentro del `quoteId`, y la firma ocurre en el navegador, con el
      // wallet de ella. Este puerto corre dentro del Worker y no tiene la clave
      // de nadie: devolver un hash acá sería inventarlo.
      if (apiKey === null || apiKey.trim() === '') {
        return { status: 'unreadable', reason: 'RPC_UNAVAILABLE' as SwapFailure };
      }

      return { status: 'unreadable', reason: 'UNKNOWN_ERROR' as SwapFailure };
    },
  };
};