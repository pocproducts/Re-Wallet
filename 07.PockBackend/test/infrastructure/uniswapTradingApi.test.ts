/**
 * EL ADAPTADOR DEL TRADING API, Y LO QUE HACE CUANDO NO HAY RESPUESTA.
 *
 * ── Por qué la red no aparece en este archivo ───────────────────────────────
 *
 * `vitest.config.ts` dice que en este proyecto ningún test toca la red, y no
 * por conveniencia: es la razón por la que la arquitectura inyecta el
 * verificador de token, el provisionador de wallet y los stores. Un test que
 * necesita que el API de Uniswap esté arriba es un test que solo corre el día
 * que el API de Uniswap está arriba.
 *
 * Por eso el `fetch` entra por constructor. Estos checks fijan las decisiones
 * que un refactor rompe en silencio: qué se manda, qué se acepta como número, y
 * sobre todo qué pasa cuando la respuesta no se entiende.
 *
 * ── Laproperty que más importa ──────────────────────────────────────────────
 *
 * Un `amountOut` ausente no es un precio de cero. Es la ausencia de un precio.
 * El API responde `200` también cuando no encuentra ruta, y en un cuerpo sin
 * ese campo un `0` sería un número cierto y falso. Estos checks fijan que eso
 * llegue como `QUOTE_NOT_FOUND`, no como un cero que la pantalla pueda pintar.
 */
import { describe, expect, it } from 'vitest';

import { createUniswapTradingApiAdapter } from '../../src/infrastructure/swap/adapters/uniswapTradingApiAdapter';

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const USDT0 = '0xe7cd86e13ac4309349f30b3435a9d337750fc82d';

/** Un `fetch` que siempre responde lo mismo. */
const fetchQueResponde = (
  status: number,
  body: unknown,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
};

const cotizar = (
  adapter: ReturnType<typeof createUniswapTradingApiAdapter>,
  amount = 100_000_000n,
) => adapter.getQuote('USDC', 'USDT0', 'monad', amount, 50);

describe('el adaptador del Trading API', () => {
  describe('cuando no hay API key', () => {
    it('dice que no puede preguntar, no que no hay mercado', () => {
      // Sin clave, el API responde 401. Si esto devolviera QUOTE_NOT_FOUND,
      // la pantalla diría que no hay par, cuando nadie preguntó.
      const adapter = createUniswapTradingApiAdapter({ apiKey: null });

      return expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'RPC_UNAVAILABLE',
      });
    });

    it('tampoco hace ninguna llamada a la red', async () => {
      const { fetchImpl, calls } = fetchQueResponde(200, {});
      const adapter = createUniswapTradingApiAdapter({ apiKey: null, fetchImpl });

      await cotizar(adapter);

      expect(calls).toHaveLength(0);
    });
  });

  describe('el cuerpo que manda', () => {
    it('pregunta por Monad, en EXACT_INPUT, contra USDC y USDT0', async () => {
      const { fetchImpl, calls } = fetchQueResponde(200, {
        quote: { amountOut: '100059100' },
      });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await cotizar(adapter);

      expect(calls).toHaveLength(1);
      const init = calls[0]?.init;
      const body = JSON.parse(String(init?.body));

      expect(body.tokenInChainId).toBe(143);
      expect(body.tokenOutChainId).toBe(143);
      expect(body.tokenIn.toLowerCase()).toBe(USDC.toLowerCase());
      expect(body.tokenOut.toLowerCase()).toBe(USDT0.toLowerCase());
      expect(body.amount).toBe('100000000');
      expect(body.type).toBe('EXACT_INPUT');
    });

    it('manda el slippage como porcentaje, no como bips', async () => {
      // 50 bips es 0.5%. Mandar `50` seria pedir fifty por ciento de slippage.
      const { fetchImpl, calls } = fetchQueResponde(200, {
        quote: { amountOut: '100059100' },
      });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await cotizar(adapter);

      const body = JSON.parse(String(calls[0]?.init?.body));
      expect(body.slippageTolerance).toBeCloseTo(0.5);
    });

    it('lleva la API key en el header que el API espera', async () => {
      const { fetchImpl, calls } = fetchQueResponde(200, {
        quote: { amountOut: '100059100' },
      });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await cotizar(adapter);

      const headers = calls[0]?.init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
    });
  });

  describe('cuando la respuesta no se entiende', () => {
    it('un cuerpo sin amountOut es QUOTE_NOT_FOUND, no cero', async () => {
      // El API responde 200 tambien cuando no encuentra ruta. Este es el caso
      // que mas se prestaria a mentir si el chequeo fuera `?? 0`.
      const { fetchImpl } = fetchQueResponde(200, { quote: {} });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'QUOTE_NOT_FOUND',
      });
    });

    it('un amountOut que no es número no se convierte en cero', async () => {
      const { fetchImpl } = fetchQueResponde(200, { quote: { amountOut: 'mucho' } });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'QUOTE_NOT_FOUND',
      });
    });

    it('un amountOut de cero es liquidez insuficiente, no un precio', async () => {
      // El API puede devolver 0 cuando la pool esta vacia. Un precio de 0 es
      // cierto, pero no es un precio: no hay nada que ejecutar.
      const { fetchImpl } = fetchQueResponde(200, { quote: { amountOut: '0' } });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'INSUFFICIENT_LIQUIDITY',
      });
    });

    it('un 401 es rechazo, no indisponibilidad', async () => {
      const { fetchImpl } = fetchQueResponde(401, {
        errorCode: 'Unauthorized',
        detail: 'Unauthenticated api key or session',
      });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'mal', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'RPC_REJECTED',
      });
    });

    it('un cuerpo que no es JSON es respuesta malformada', async () => {
      const fetchImpl = (async () =>
        new Response('no soy json', { status: 200 })) as unknown as typeof fetch;
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'RPC_MALFORMED_RESPONSE',
      });
    });

    it('una red caída es indisponibilidad, no rechazo', async () => {
      const fetchImpl = (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch;
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'RPC_UNAVAILABLE',
      });
    });
  });

  describe('lo que devuelve cuando sí puede cotizar', () => {
    it('entrega el amountOut y un mínimo con slippage aplicado', async () => {
      const { fetchImpl } = fetchQueResponde(200, {
        quote: { amountOut: '100059100' },
        transaction: { to: '0xa6CE4F10d83dBdDAc17E68e1837ca9cE6a1b596e', data: '0x1234' },
      });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await cotizar(adapter);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      expect(result.value.amountOut).toBe(100059100n);
      // 50 bips es 0.5%: (100059100 * 9950) / 10000 = 99558804.5, y la
      // division entera de BigInt redondea hacia abajo. Redondear hacia arriba
      // protegeria menos a la persona que el slippage que ella eligio.
      expect(result.value.amountOutMin).toBe(99558804n);
      expect(result.value.amountOutMin).toBeLessThan(result.value.amountOut);
    });

    it('la transacción viaja en el quoteId, con el router que devolvio el API', async () => {
      // Si el calldata quedara afuera del quoteId, el caso de uso tendria que
      // serializarlo y "opino"; el puerto dice que el quoteId es opaco.
      const router = '0xa6CE4F10d83dBdDAc17E68e1837ca9cE6a1b596e';
      const { fetchImpl } = fetchQueResponde(200, {
        quote: { amountOut: '100059100' },
        transaction: { to: router, data: '0xabcdef', value: '0', gasLimit: '0x30d40' },
      });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await cotizar(adapter);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      const guardado = JSON.parse(result.value.quoteId) as Record<string, unknown>;
      expect(guardado.to).toBe(router);
      expect(guardado.data).toBe('0xabcdef');
      expect(guardado.chain).toBe('monad');
    });

    it('la cotización caduca en 30 segundos', async () => {
      // Una DeFi caduca en segundos. Sin vencimiento, alguien confirma un precio
      // que la cadena ya no esta honoring.
      const { fetchImpl } = fetchQueResponde(200, { quote: { amountOut: '100059100' } });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const antes = Date.now();
      const result = await cotizar(adapter);
      const despues = Date.now();
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      // La ventana se mide contra el reloj, no contra un instante: `Date.now()`
      // corre dentro del adaptador y puede caer un milisegundo despues del que
      // se leyo aca. Fijar la vida exacta daria 30000 y 30001 en corridas
      // distintas, y eso no seria un fallo del codigo.
      expect(result.value.validUntil).toBeGreaterThan(antes + 25_000);
      expect(result.value.validUntil).toBeLessThanOrEqual(despues + 30_000);
    });
  });

  describe('pares que el API no puede servir', () => {
    it('una cadena que el API no conoce no se ofrece', async () => {
      const { fetchImpl, calls } = fetchQueResponde(200, {});
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await adapter.getQuote(
        'USDC',
        'USDT0',
        'ethereum' as never,
        100n,
        50,
      );

      expect(result).toEqual({ status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' });
      expect(calls).toHaveLength(0);
    });

    it('convertir un activo en sí mismo no es un par', async () => {
      const { fetchImpl, calls } = fetchQueResponde(200, {});
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await adapter.getQuote('USDC', 'USDC', 'monad', 100n, 50);

      expect(result).toEqual({ status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' });
      expect(calls).toHaveLength(0);
    });

    it('un símbolo que no existe en Monad no se resuelve a una dirección inventada', async () => {
      // La versión anterior hacia `symbol === 'USDC' ? direccion : '0x...'`, y el
      // placeholder producía un amountOut numérico y falso.
      const { fetchImpl, calls } = fetchQueResponde(200, {});
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await adapter.getQuote('USDT', 'USDC', 'monad', 100n, 50);

      expect(result).toEqual({ status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' });
      expect(calls).toHaveLength(0);
    });
  });
});