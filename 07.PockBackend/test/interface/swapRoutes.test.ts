/**
 * LA FORMA DE LA RESPUESTA DEL SWAP, EN EL HTTP.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * El caso de uso devuelve la cotización con `bigint` adentro, y la ruta la
 * entregaba con `c.json(result)` tal cual. `JSON.stringify` no sabe serializar
 * un `bigint` y lanza `TypeError: Do not know how to serialize a BigInt`, así
 * que una cotización bien calculada por el motor reventaba con un 500 en la
 * arista, y el front la mostraba como "red caída".
 *
 * El test del caso de uso (`test/swap.test.ts`) no lo podía ver: afirma sobre
 * el valor JavaScript, no sobre el JSON serializado. Qué sale por el puerto es
 * un contrato, y el contrato se escribe acá.
 *
 * ── Por qué los montos se afirman como texto ────────────────────────────────
 *
 * `amountOut` con seis decimales no entra en un double sin redondear el centavo
 * que la operación comunica. El front lo lee como string justamente por eso: si
 * en producción volviera un `number`, el front lo descarta y muestra "no hay
 * precio" — un bug silencioso en la cifra de dinero.
 */
import { describe, expect, it } from 'vitest';

import { createSwapRoutes } from '../../src/interface/http/routes/swap';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import type { SwapQuote, SwapExecutionResult } from '../../src/domain/ports/swap-provider';

const VALID_TOKEN = 'rw1.test.token';
const USER_ID = 'user_tests';

/** Una cotización con `bigint`, como la devuelve el dominio. */
const DOMAIN_QUOTE: SwapQuote = {
  quoteId: 'test-quote-id',
  amountIn: 1_000_000n,
  amountOut: 999_496n,
  amountOutMin: 994_499n,
  validUntil: 1_900_000_000_000,
  price: '0.999496',
  feeTier: 100,
  chain: 'monad',
  blockNumber: 111_822_325,
};

const DOMAIN_EXECUTION: SwapExecutionResult = {
  txHash: '0x' + 'a'.repeat(64),
  amountOut: 999_496n,
  gasUsed: 21_000n,
};

const sessions = {
  read: async (token: string) => (token === VALID_TOKEN ? { userId: USER_ID } : null),
};

const makeApp = () =>
  createSwapRoutes({
    sessions,
    swapUseCase: {
      getQuote: async () => ({ status: 'ok', quote: DOMAIN_QUOTE }),
      executeSwap: async () => ({ status: 'ok', result: DOMAIN_EXECUTION }),
      getSupportedPairs: async () => [],
    },
  });

const authed = (path: string, init: RequestInit) =>
  makeApp().request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${VALID_TOKEN}`,
      ...init.headers,
    },
  });

describe('POST /api/wallet/swap/quote', () => {
  it('serializa la cotización como texto en vez de romper con un BigInt', async () => {
    const response = await authed('/quote', {
      method: 'POST',
      body: JSON.stringify({
        sourceSymbol: 'USDC',
        destinationSymbol: 'USDT0',
        chain: 'monad',
        amountIn: '1000000',
        slippageBips: 50,
      }),
    });

    expect(response.status).toBe(200);

    // Si el cuerpo viniera con un bigint, esto ni siquiera habría llegado tan
    // lejos: `c.json` habría lanzado antes de mandar nada.
    const body = await response.json();

    expect(body).toEqual({
      status: 'ok',
      quote: {
        quoteId: 'test-quote-id',
        amountIn: '1000000',
        amountOut: '999496',
        /*
         * El mínimo recibido viaja en el cuerpo.
         *
         * Sin él, la pantalla tendría que recalcular la protección contra el
         * slippage del lado de afuera del quote, con un precio que puede no ser
         * el que el motor usó — dos cifras del mismo número, otra forma de
         * sembrar dudas.
         */
        amountOutMin: '994499',
        validUntil: 1_900_000_000_000,
        price: '0.999496',
        feeTier: 100,
        chain: 'monad',
        blockNumber: 111_822_325,
      },
    });
  });

  it('sin sesión no hay cotización', async () => {
    const response = await makeApp().request('/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceSymbol: 'USDC', destinationSymbol: 'USDT0', chain: 'monad', amountIn: '1000000', slippageBips: 50 }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('el 400 de un request ilegible mantiene su forma', async () => {
    const response = await authed('/quote', {
      method: 'POST',
      body: JSON.stringify({ sourceSymbol: 'USDC' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'unreadable', reason: 'MALFORMED_REQUEST' });
  });
});

describe('POST /api/wallet/swap/execute', () => {
  it('serializa el resultado de la ejecución con la misma regla', async () => {
    const response = await authed('/execute', {
      method: 'POST',
      body: JSON.stringify({
        quoteId: 'test-quote-id',
        signer: '0x' + 'b'.repeat(130),
        slippageBips: 50,
        deadlineSeconds: 600,
        sourceSymbol: 'USDC',
        destinationSymbol: 'USDT0',
        chain: 'monad',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      result: { txHash: '0x' + 'a'.repeat(64), amountOut: '999496', gasUsed: '21000' },
    });
  });
});
