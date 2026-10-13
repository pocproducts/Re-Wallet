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
  /**
   * Lo mínimo que se recibe si el precio se mueve contra la persona antes de
   * que la operación confirme. El motor lo calcula aplicando el slippage, y es
   * lo único que la pantalla puede prometer.
   *
   * `null` cuando el backend no lo declara: la pantalla muestra el guion de
   * "no lo sé" en vez de una protección inventada.
   */
  readonly amountOutMin: string | null;
  /** El fee del pool en bips (ej: 100 = 0.01%), si el backend lo declara. */
  readonly feeTier: number | null;
  /** Timestamp (ms) hasta el que la cotización es válida, si viene. */
  readonly validUntil: number | null;
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
 * Si la cotización simulada está habilitada para el código que corre.
 *
 * ── Por qué esta función existe y no una constante ───────────────────────────
 *
 * Porque la decisión tiene que ser **una sola**. Escrita como constante, cada
 * archivo que la necesite la evalúa en su propio momento del arranque y dos
 * pantallas pueden terminar discrepando sobre si el mock está puesto. Con una
 * función, el único lugar que decide es este.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * Encendida en el servidor de desarrollo local y en **`beta.rewallet.win`**,
 * que es el entorno de prueba: apagada en `app.rewallet.win`, el dominio de
 * marca. La decisión vive dentro del build; no hay que pasar ninguna variable.
 *
 * Queda un escape explícito para forzarla en cualquier otro host:
 * `VITE_SWAP_MOCK=1` en el build.
 *
 * ── Por qué compara contra `true` y contra `'1'` en vez de evaluar si hay algo ─
 *
 * Porque `import.meta.env.VITE_SWAP_MOCK` siempre es un texto, y cualquier texto
 * no vacío es verdadero en JavaScript: `VITE_SWAP_MOCK=false` encendería el mock
 * en un build de producción. Se enciende con el `1` exacto y con nada más. Del
 * lado de `DEV` pasa lo mismo al revés: Vite lo define como booleano, así que un
 * texto colado ahí no lo puede encender por accidente.
 */
export const isSwapMockEnabled = (): boolean =>
  import.meta.env.DEV === true ||
  import.meta.env.VITE_SWAP_MOCK === '1' ||
  (typeof window !== 'undefined' && window.location.hostname === 'beta.rewallet.win');

/**
 * Cotiza de mentira: inventa el precio y el identificador.
 *
 * Devuelve siempre 1:1 con seis decimales en el destino, sin mirar `chain`,
 * `sourceSymbol` ni `destinationSymbol`. El `quoteId` lo genera con el reloj y
 * `Math.random()`, así que no sirve para firmar nada: el backend no lo conoce.
 *
 * Es una simulación, no una cotización. Sirve para recorrer la pantalla sin
 * motor, y por eso `isSwapMockEnabled()` la mantiene fuera de todo build que
 * sirva a alguien de verdad —una cotización inventada es la forma más
 * convincente de mentir.
 */
export const quoteSwapMock = async (params: {
  readonly sourceSymbol: string;
  readonly destinationSymbol: string;
  readonly chain: string;
  readonly amountRaw: string;
}): Promise<QuoteResult> => {
  /*
   * `amountRaw` llega en unidades **mínimas** del origen: es el contrato del
   * endpoint, y `useAssetTrade` ya mandó `Math.round(monto * 10^decimales)`.
   *
   * La primera versión de esto lo leía como un monto humano y lo volvía a
   * multiplicar por 10⁶, así que un USDC cotizaba un millón de USDT0. Un mock
   * con las unidades mal no sirve ni para mirar la pantalla, que es lo único
   * para lo que un mock sirve.
   */
  const amountRaw = params.amountRaw.trim();
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
    return { availability: 'unavailable', failure: 'NETWORK_UNAVAILABLE' };
  }

  /*
   * La cotización es la identidad: el monto sale igual de lo que entró.
   *
   * Vale sólo si el destino tiene los mismos decimales que el origen, que es el
   * caso de USDC y USDT0 en Monad —los dos de 6— y el único que este mock puede
   * afirmar sin leer nada. Con otro par el número sería inventado, que es
   * exactamente lo que el mock ya es, pero acá por lo menos no es además una
   * unidad distinta.
   */
  return {
    availability: 'available',
    quote: {
      amountOut: amountRaw,
      price: '1',
      /*
       * 1:1 sin slippage: la simulación no tiene precio que pueda moverse,
       * así que no hay mínimo que proteger. El campo igual viaja para que la
       * pantalla muestre su forma completa.
       */
      amountOutMin: amountRaw,
      feeTier: 100,
      validUntil: Date.now() + 10_000,
      quoteId: `mock-quote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      /*
       * Sin bloque, y no uno sacado del reloj.
       *
       * Un número de bloque se lee como la referencia verificable de la
       * cotización. Uno inventado es peor que ninguno, y el cliente real ya sabe
       * mostrar la ausencia: `blockNumber` es nulable y hay un test que lo fija.
       */
      blockNumber: null,
    },
  };
};

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
  /**
   * La tolerancia al deslizamiento en puntos básicos.
   *
   * El default es 50 (0,5%), el mismo "Auto" que usa Uniswap. La pantalla lo
   * puede cambiar y el valor viaja en la request: el slippage no es un detalle
   * de la UI, es parte de la protección que la cotización promete.
   */
  readonly slippageBips?: number;
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
      slippageBips: params.slippageBips ?? 50,
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

  const amountOutMin = asDigitString(quote.amountOutMin);

  return {
    availability: 'available',
    quote: {
      amountOut,
      price,
      amountOutMin,
      feeTier: typeof quote.feeTier === 'number' && Number.isFinite(quote.feeTier) ? quote.feeTier : null,
      validUntil: typeof quote.validUntil === 'number' && Number.isFinite(quote.validUntil) ? quote.validUntil : null,
      quoteId: typeof quote.quoteId === 'string' ? quote.quoteId : '',
      blockNumber: asDigitString(quote.blockNumber),
    },
  };
};