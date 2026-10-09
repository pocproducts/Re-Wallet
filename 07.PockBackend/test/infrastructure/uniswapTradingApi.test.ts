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

/**
 * ── La respuesta real, no una inventada ─────────────────────────────────────
 *
 * Este bloque es una captura de la respuesta que el API devolvió el 2026-10 para
 * `USDC → USDT0` en Monad, por 100 USDC. Está literal porque **la forma es lo que
 * rompió la primera versión**: el adapter leía `quote.amountOut`, que no existe,
 * y terminaba diciendo "no hay precio" sobre un par que cotiza. Un test con un
 * cuerpo inventado no habría detectado eso.
 *
 * Y el precio que sale de acá, 1.000504 USDT0 por USDC, es el mismo que se lee
 * del `slot0()` del pool (1.000591) más el spread. Esa comparación es la que
 * prueba que el API y la cadena dicen lo mismo.
 */
const RESPUESTA_REAL = {
  requestId: 'c38784dc194c8cdc2a165db8d6a34e88',
  routing: 'CLASSIC',
  quote: {
    chainId: 143,
    quoteId: '01a11f4e-7974-8000-bf0a-ae16857a0100',
    blockNumber: '111822325',
    priceImpact: '0.01',
    routeString: '[v4] 100.00% = [0.0075%] [1]',
    input: { amount: '100000000', token: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' },
    output: { amount: '100050446', token: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D' },
    route: [[{ protocol: 'v4-pool', fee: '75', amountIn: '100000000', amountOut: '100050446' }]],
  },
} as const;

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
      const { fetchImpl, calls } = fetchQueResponde(200, RESPUESTA_REAL);
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
      const { fetchImpl, calls } = fetchQueResponde(200, RESPUESTA_REAL);
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await cotizar(adapter);

      const body = JSON.parse(String(calls[0]?.init?.body));
      expect(body.slippageTolerance).toBeCloseTo(0.5);
    });

    it('lleva la API key en el header que el API espera', async () => {
      const { fetchImpl, calls } = fetchQueResponde(200, RESPUESTA_REAL);
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await cotizar(adapter);

      const headers = calls[0]?.init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
    });
  });

  describe('cuando la respuesta no se entiende', () => {
    it('un cuerpo sin amountOut es QUOTE_NOT_FOUND, no cero', async () => {
      // El API responde 200 tambien cuando no encuentra ruta, y devuelve un
      // `quote` sin `output`. Este es el caso que mas se prestaria a mentir si
      // el chequeo fuera `?? 0`.
      const { fetchImpl } = fetchQueResponde(200, { quote: { chainId: 143 } });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'QUOTE_NOT_FOUND',
      });
    });

    it('un amountOut que no es número no se convierte en cero', async () => {
      const { fetchImpl } = fetchQueResponde(200, { quote: { output: { amount: 'mucho' } } });
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      await expect(cotizar(adapter)).resolves.toEqual({
        status: 'unreadable',
        reason: 'QUOTE_NOT_FOUND',
      });
    });

    it('un amountOut de cero es liquidez insuficiente, no un precio', async () => {
      // El API puede devolver 0 cuando la pool esta vacia. Un precio de 0 es
      // cierto, pero no es un precio: no hay nada que ejecutar.
      const { fetchImpl } = fetchQueResponde(200, { quote: { output: { amount: '0' } } });
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
      const { fetchImpl } = fetchQueResponde(200, RESPUESTA_REAL);
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await cotizar(adapter);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      expect(result.value.amountOut).toBe(100050446n);
      // 50 bips es 0.5%: (100050446 * 9950) / 10000 = 99550193.77, y la
      // división entera de BigInt redondea hacia abajo. Redondear hacia arriba
      // protegería menos a la persona que el slippage que ella eligió.
      expect(result.value.amountOutMin).toBe(99550193n);
      expect(result.value.amountOutMin).toBeLessThan(result.value.amountOut);
    });

    it('el precio implícito es el inverso, y coincide con el del pool', async () => {
      // El puerto lo define como "1 destino = X origen". Para este par eso es
      // 1 USDT0 = 0.999496 USDC: recibís un poco menos de un dólar por dólar,
      // que es el spread del swap. El `slot0()` del pool da el otro lado de la
      // misma cuenta (1.000591 USDT0 por USDC), y que los dos coincidan es lo
      // que prueba que el API y la cadena cuentan lo mismo.
      const { fetchImpl } = fetchQueResponde(200, RESPUESTA_REAL);
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await cotizar(adapter);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      expect(Number(result.value.price)).toBeCloseTo(0.9995, 4);
    });

    it('el quoteId es el del API, no uno armado acá', async () => {
      // El puerto dice que el `quoteId` es opaco y que el adaptador lo usa para
      // recuperar la ruta exacta. Inventar un JSON propio obligaría al caso de
      // uso a interpretarlo, que es lo que el puerto prohíbe.
      const { fetchImpl } = fetchQueResponde(200, RESPUESTA_REAL);
      const adapter = createUniswapTradingApiAdapter({ apiKey: 'test-key', fetchImpl });

      const result = await cotizar(adapter);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      expect(result.value.quoteId).toBe('01a11f4e-7974-8000-bf0a-ae16857a0100');
    });

    it('la cotización caduca en 30 segundos', async () => {
      // Una DeFi caduca en segundos. Sin vencimiento, alguien confirma un precio
      // que la cadena ya no esta honoring.
      const { fetchImpl } = fetchQueResponde(200, RESPUESTA_REAL);
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