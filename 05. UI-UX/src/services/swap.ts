/**
 * EL CLIENTE DEL SWAP.
 *
 * ── Por qué solo cotiza y no ejecuta ─────────────────────────────────────────
 *
 * Porque la ejecución necesita dos firmas: la de **Permit2** —el permiso para
 * que Uniswap gaste el USDC— y la de la transacción de swap. El backend devuelve
 * la transacción armada y la persona la firma en el navegador, con su wallet.
 * Un botón que dijera "comprar" sin esas firmas sería un botón que miente, y
 * este proyecto no pone botones que mienten.
 *
 * Lo que sí hace este cliente es traer el **precio real**. Que antes no existía:
 * el número que se veía salía de una tabla escrita a mano, y un tipo de cambio
 * inventado es la forma más convincente de mentir.
 *
 * ── Por qué el monto va en unidades mínimas ──────────────────────────────────
 *
 * Porque es lo que espera el backend y lo que viaja en la cadena. USDC tiene 6
 * decimales: enviar `100` en vez de `100000000` sería pasarle un centavo por
 * dólar, y la cotización que volvería no sería de la operación que la persona
 * está mirando.
 */
import { postJson, ApiError } from './api';

/** Veredicto de una cotización: el precio existe y qué hay que firmarlo. */
export type QuoteAvailability = 'available' | 'unavailable';

/** Por qué no hay cotización. El front elige la frase. */
export type QuoteFailure =
  | 'NETWORK_UNAVAILABLE'
  /** El API no encontró ruta para ese par. No es un error: es que no hay mercado. */
  | 'NO_ROUTE'
  /** No hay liquidity suficiente para este monto. */
  | 'NOT_ENOUGH_LIQUIDITY'
  /** Faltó la API key del backend, o no es válida. */
  | 'NOT_CONFIGURED';

export interface SwapQuote {
  /** Cuánto se recibe, en unidades mínimas del activo destino. */
  readonly amountOut: string;
  /** El precio implícito, tal como lo declara el backend. */
  readonly price: string;
  /** El identificador del API para ejecutar después. Opaque. */
  readonly quoteId: string;
  /** El bloque en el que el API hizo la cuenta. Rastro verificable. */
  readonly blockNumber: string | null;
}

export interface QuoteAvailable {
  readonly availability: 'available';
  readonly quote: SwapQuote;
}

export interface QuoteUnavailable {
  readonly availability: 'unavailable';
  readonly failure: QuoteFailure;
}

export type QuoteResult = QuoteAvailable | QuoteUnavailable;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asDigitString = (value: unknown): string | null =>
  typeof value === 'string' && /^\d+$/.test(value) ? value : null;

/**
 * Un precio es un decimal, no un entero: `0.999496` es un precio valido y
 * `^\d+$` lo rechaza. Validarlo con la misma regla que un monto habria hecho
 * que toda cotizacion de un par que no vale exactamente uno se leyera como
 * "sin ruta" — y USDC contra USDT0 vale justamente eso.
 */
const asPriceString = (value: unknown): string | null =>
  typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? value : null;

/**
 * Cotiza un par.
 *
 * `amountRaw` en unidades mínimas del **origen**. `chain` va como el id que el
 * backend ya entiende —`'monad'`— y no como el número EIP-155, porque el
 * contrato del endpoint usa el nombre y mandarle el número sería una traducción
 * que este cliente no tiene por qué inventar.
 */
export const quoteSwap = async (params: {
  readonly sourceSymbol: string;
  readonly destinationSymbol: string;
  readonly chain: string;
  readonly amountRaw: string;
}): Promise<QuoteResult> => {
  const amountRaw = params.amountRaw.trim();
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
    return { availability: 'unavailable', failure: 'NETWORK_UNAVAILABLE' };
  }

  let body: unknown;
  try {
    body = await postJson('/api/wallet/swap/quote', {
      sourceSymbol: params.sourceSymbol,
      destinationSymbol: params.destinationSymbol,
      chain: params.chain,
      amountIn: amountRaw,
      slippageBips: 50,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      // `QUOTE_NOT_FOUND` del backend es "no hay ruta". No es lo mismo que la
      // red caída: una persona tiene derecho a leer que ese par no tiene
      // mercado hoy, y no que la app se rompió.
      if (error.code === 'QUOTE_NOT_FOUND') {
        return { availability: 'unavailable', failure: 'NO_ROUTE' };
      }
      if (error.code === 'INSUFFICIENT_LIQUIDITY') {
        return { availability: 'unavailable', failure: 'NOT_ENOUGH_LIQUIDITY' };
      }
      if (error.code === 'RPC_UNAVAILABLE' || error.code === 'RPC_REJECTED') {
        return { availability: 'unavailable', failure: 'NOT_CONFIGURED' };
      }
      return { availability: 'unavailable', failure: 'NETWORK_UNAVAILABLE' };
    }
    throw error;
  }

  const record = asRecord(body);
  if (record === null) return { availability: 'unavailable', failure: 'NETWORK_UNAVAILABLE' };

  if (record.status === 'unreadable') {
    const reason = record.reason;
    if (reason === 'QUOTE_NOT_FOUND') {
      return { availability: 'unavailable', failure: 'NO_ROUTE' };
    }
    if (reason === 'INSUFFICIENT_LIQUIDITY') {
      return { availability: 'unavailable', failure: 'NOT_ENOUGH_LIQUIDITY' };
    }
    if (reason === 'RPC_UNAVAILABLE' || reason === 'RPC_REJECTED') {
      return { availability: 'unavailable', failure: 'NOT_CONFIGURED' };
    }
    return { availability: 'unavailable', failure: 'NETWORK_UNAVAILABLE' };
  }

  const quote = asRecord(record.quote);
  if (quote === null) return { availability: 'unavailable', failure: 'NO_ROUTE' };

  // El backend ya devuelve `amountOut` como texto decimal en unidades mínimas.
  // Se relee acá porque un `number` perdería precisión justo en la cifra que
  // comunica la operación.
  const amountOut = asDigitString(quote.amountOut);
  const price = asPriceString(quote.price);
  if (amountOut === null || price === null) {
    return { availability: 'unavailable', failure: 'NO_ROUTE' };
  }

  return {
    availability: 'available',
    quote: {
      amountOut,
      price,
      quoteId: typeof quote.quoteId === 'string' ? quote.quoteId : '',
      blockNumber: asDigitString(quote.blockNumber),
    },
  };
};