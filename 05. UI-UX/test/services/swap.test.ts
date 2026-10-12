/**
 * EL CLIENTE DEL SWAP.
 *
 * ── Por qué estos tests fijan el cuerpo de la respuesta ─────────────────────
 *
 * Porque la primera versión de este cliente seecoinventó un cuerpo plausible y
 * por eso el bug del backend —leer `quote.amountOut` en vez de
 * `quote.output.amount`— pasó la suite del front sin que nadie lo notara. La
 * forma de la respuesta es un contrato, y un contrato se escribe en el test.
 *
 * ── La propiedad central ─────────────────────────────────────────────────────
 *
 * Que "no hay precio" tenga causas distintas y no se colapsen. Una persona tiene
 * derecho a leer que ese par no tiene mercado hoy, y no que la aplicación se
 * rompió; y al revés, tampoco tiene derecho a que le digan "no hay mercado"
 * cuando lo que pasó fue que la red no respondió.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isSwapMockEnabled,
  quoteSwap,
  quoteSwapMock,
  type QuoteResult,
} from '../../src/services/swap';

/** La forma que devuelve `/api/wallet/swap/quote` cuando sí cotiza. */
const COTIZACION_OK = {
  status: 'ok',
  quote: {
    amountOut: '100050446',
    amountOutMin: '100025446',
    feeTier: 100,
    validUntil: 1_900_000_000_000,
    price: '0.999496',
    quoteId: '01a11f4e-7974-8000-bf0a-ae16857a0100',
    blockNumber: '111822325',
  },
};

const responderCon = (body: unknown, status = 200) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
};

const pedir = async () =>
  quoteSwap({
    sourceSymbol: 'USDC',
    destinationSymbol: 'USDT0',
    chain: 'monad',
    amountRaw: '100000000',
  });

describe('el cliente del swap', () => {
  it('traduce una cotización disponible', async () => {
    const restore = responderCon(COTIZACION_OK);
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'available' }>;
      expect(result.availability).toBe('available');
      if (result.availability !== 'available') return;
      // El texto, no un `number`: un saldo con 6 decimales no entra en un double
      // sin redondear el centavo que la operación comunica.
      expect(result.quote.amountOut).toBe('100050446');
      expect(result.quote.amountOutMin).toBe('100025446');
      expect(result.quote.feeTier).toBe(100);
      expect(result.quote.validUntil).toBe(1_900_000_000_000);
      expect(result.quote.quoteId).toBe('01a11f4e-7974-8000-bf0a-ae16857a0100');
      expect(result.quote.blockNumber).toBe('111822325');
    } finally {
      restore();
    }
  });

  it('el bloque puede faltar sin romper la cotización', async () => {
    const restore = responderCon({ ...COTIZACION_OK, quote: { ...COTIZACION_OK.quote, blockNumber: undefined } });
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'available' }>;
      expect(result.availability).toBe('available');
      if (result.availability !== 'available') return;
      // Sin bloque, la cita queda sin referencia y se muestra como tal. Poner
      // "ahora" sería inventar el rastro que la hace verificable.
      expect(result.quote.blockNumber).toBeNull();
    } finally {
      restore();
    }
  });

  it('sin ruta no es lo mismo que sin red', async () => {
    const sinRuta = responderCon({ status: 'unreadable', reason: 'QUOTE_NOT_FOUND' });
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'unavailable' }>;
      // "No hay mercado" y "no pudimos preguntar" son afirmaciones distintas.
      expect(result.failure).toBe('NO_ROUTE');
    } finally {
      sinRuta();
    }
  });

  it('sin liquidity suficiente tampoco es un error', async () => {
    const sinLiquidez = responderCon({ status: 'unreadable', reason: 'INSUFFICIENT_LIQUIDITY' });
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'unavailable' }>;
      expect(result.failure).toBe('NOT_ENOUGH_LIQUIDITY');
    } finally {
      sinLiquidez();
    }
  });

  it('un backend sin API key se distingue de una red caída', async () => {
    const sinKey = responderCon({ status: 'unreadable', reason: 'RPC_UNAVAILABLE' });
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'unavailable' }>;
      // Es un problema de configuración del despliegue, no del mercado. La
      // pantalla lo dice distinto a propósito.
      expect(result.failure).toBe('NOT_CONFIGURED');
    } finally {
      sinKey();
    }
  });

  it('un amountOut que no es un número no se muestra como cero', async () => {
    const restore = responderCon({ ...COTIZACION_OK, quote: { ...COTIZACION_OK.quote, amountOut: 'mucho' } });
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'unavailable' }>;
      // Si esto fuera `?? 0`, la pantalla pintaría "0 USDT0": un número cierto y
      // falso, y la forma más convincente de mentir.
      expect(result.availability).toBe('unavailable');
    } finally {
      restore();
    }
  });

  it('un backend que no declara mínimo no se ve como protección inventada', async () => {
    const restore = responderCon({
      ...COTIZACION_OK,
      quote: { ...COTIZACION_OK.quote, amountOutMin: undefined, feeTier: undefined, validUntil: undefined },
    });
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'available' }>;
      if (result.availability !== 'available') return;
      /*
       * Sería trivial completar el mínimo con una cuenta hecha en el front, y
       * es exactamente lo que no se hace: el mínimo lo promete el motor, y sin
       * su número no hay número. El guion de "no lo sé" es la salida honesta.
       */
      expect(result.quote.amountOut).toBe('100050446');
      expect(result.quote.amountOutMin).toBeNull();
      expect(result.quote.feeTier).toBeNull();
      expect(result.quote.validUntil).toBeNull();
    } finally {
      restore();
    }
  });

  it('un monto que no son dígitos no gasta una ida al servidor', async () => {
    let llamado = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      llamado = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const result = await quoteSwap({
        sourceSymbol: 'USDC',
        destinationSymbol: 'USDT0',
        chain: 'monad',
        amountRaw: '0',
      });
      expect(result.availability).toBe('unavailable');
      expect(llamado).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('la red caída es indisponibilidad', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('failed to fetch');
    }) as unknown as typeof fetch;
    try {
      const result = (await pedir()) as Extract<QuoteResult, { availability: 'unavailable' }>;
      expect(result.failure).toBe('NETWORK_UNAVAILABLE');
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * LA COTIZACIÓN SIMULADA.
 *
 * ── Por qué esto tiene tests ────────────────────────────────────────────────
 *
 * `quoteSwapMock` inventa un precio: no mira el par, no mira la cadena y no toca
 * la red. Es lo contrario de lo que esta app promete, y existe por una sola
 * razón — recorrer la pantalla de cambio mientras no haya motor.
 *
 * Lo que estos tests protegen no es el mock: es **la bandera que lo apaga**. Un
 * mock que se enciende solo en un build de deploy no rompe ningún otro test,
 * porque los números que devuelve son plausibles. El único lugar donde ese error
 * se puede ver es acá.
 */
describe('la cotización simulada', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('está encendida en el servidor de desarrollo local', () => {
    /*
     * Sin stubs, a propósito: la corrida de tests usa el modo `test`, así que
     * Vite define `DEV` como `true`. Es el mismo estado que el servidor de
     * desarrollo, y por eso la aserción se apoya en el entorno real y no en uno
     * inventado para la ocasión.
     */
    expect(isSwapMockEnabled()).toBe(true);
  });

  it('está apagada en un build de deploy', () => {
    vi.stubEnv('DEV', false);

    expect(isSwapMockEnabled()).toBe(false);

    /*
     * El caso que importa de verdad: alguien escribió la variable con algo que
     * *parece* verdadero. `VITE_SWAP_MOCK` siempre es texto, y cualquier texto no
     * vacío es verdadero en JavaScript — así que `false` encendería el mock en
     * producción si la comparación no fuera contra el `1` exacto.
     */
    for (const escrito of ['true', 'false', '', 'si', '0']) {
      vi.stubEnv('VITE_SWAP_MOCK', escrito);
      expect(isSwapMockEnabled()).toBe(false);
    }
  });

  it('se puede forzar a propósito, y sólo con el 1 exacto', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SWAP_MOCK', '1');

    expect(isSwapMockEnabled()).toBe(true);
  });

  it('el mock no mira el par: devuelve lo que entró', async () => {
    const monad = await quoteSwapMock({
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
      amountRaw: '1000000',
    });
    const otro = await quoteSwapMock({
      sourceSymbol: 'PEPE',
      destinationSymbol: 'BTC',
      chain: 'solana',
      amountRaw: '1000000',
    });

    expect(monad.availability).toBe('available');
    expect(otro.availability).toBe('available');
    if (monad.availability !== 'available' || otro.availability !== 'available') return;

    /*
     * `'1000000'` y no un millón de millones.
     *
     * El monto llega en unidades mínimas —es el contrato del endpoint, y
     * `useAssetTrade` ya mandó `Math.round(monto * 10^decimales)`— y vuelve tal
     * cual. La primera versión lo leía como un monto humano y lo multiplicaba
     * otra vez por 10⁶, así que 1 USDC cotizaba un millón de USDT0 y el mock no
     * servía ni para mirarlo, que es lo único para lo que sirve un mock.
     */
    expect(monad.quote.amountOut).toBe('1000000');
    expect(monad.quote.price).toBe('1');

    // Que el par no cambie nada es justamente lo que lo vuelve inútil como
    // cotización: es un mock, no un mercado.
    expect(otro.quote.amountOut).toBe(monad.quote.amountOut);
  });

  it('el identificador del mock no se puede confundir con uno del backend', async () => {
    const result = await quoteSwapMock({
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
      amountRaw: '1000000',
    });
    if (result.availability !== 'available') return;

    expect(result.quote.quoteId.startsWith('mock-quote-')).toBe(true);
    // Un `quoteId` del backend es un UUID v7. Ninguno de esos puede empezar así.
    expect(result.quote.quoteId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('el mock no inventa un número de bloque', async () => {
    const result = await quoteSwapMock({
      sourceSymbol: 'USDC',
      destinationSymbol: 'USDT0',
      chain: 'monad',
      amountRaw: '1000000',
    });
    if (result.availability !== 'available') return;

    /*
     * Un número de bloque se lee como la referencia verificable de la
     * cotización. Inventarlo con el reloj era prometer un rastro que no existe, y
     * "no sé en qué bloque" ya tiene su propio valor en esta app.
     */
    expect(result.quote.blockNumber).toBeNull();
  });

  it('un monto que no son dígitos no cotiza', async () => {
    for (const amountRaw of ['0', '', '1,5', 'mucho']) {
      const result = await quoteSwapMock({
        sourceSymbol: 'USDC',
        destinationSymbol: 'USDT0',
        chain: 'monad',
        amountRaw,
      });

      expect(result.availability).toBe('unavailable');
    }
  });
});