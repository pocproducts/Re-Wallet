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
import { describe, expect, it } from 'vitest';

import { quoteSwap, type QuoteResult } from '../../src/services/swap';

/** La forma que devuelve `/api/wallet/swap/quote` cuando sí cotiza. */
const COTIZACION_OK = {
  status: 'ok',
  quote: {
    amountOut: '100050446',
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