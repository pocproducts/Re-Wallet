/**
 * `POST /api/wallet/swap/quote` — cotiza un swap.
 * `POST /api/wallet/swap/execute` — ejecuta un swap ya cotizado.
 * `GET  /api/wallet/swap/pairs` — lista los pares soportados.
 *
 * ── Contrato ──────────────────────────────────────────────────────────────────
 *
 * POST /quote
 *   Body: { sourceSymbol, destinationSymbol, chain, amountIn, slippageBips }
 *   200: { status: 'ok', quote: SwapQuote }
 *   400: { status: 'unreadable', reason: SwapFailure }
 *
 * POST /execute
 *   Body: { quoteId, signer, slippageBips, deadlineSeconds, sourceSymbol, destinationSymbol, chain }
 *   200: { status: 'ok', result: SwapExecutionResult }
 *   400: { status: 'unreadable', reason: SwapFailure }
 *
 * GET /pairs
 *   200: { pairs: SwapPairInfo[] }
 */

import { Hono } from 'hono';

import type { SwapUseCase } from '../../../application/swap/swapUseCase';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import type { SwapQuote } from '../../../domain/ports/swap-provider';

/*
 * La cotización y la ejecución llegan del dominio con `bigint`.
 *
 * `c.json` llama a `JSON.stringify`, que no sabe serializar un `bigint` y lanza
 * `TypeError: Do not know how to serialize a BigInt`. Sin este mapeo, una
 * cotización que el motor calculó bien revienta con un 500 en la arista —y el
 * front la lee como red caída, una afirmación falsa sobre lo que pasó.
 *
 * El texto se queda como texto porque un `number` redondería justo la cifra que
 * la operación comunica: `amountOut` con 6 decimales no entra en un double sin
 * deslizar el centavo.
 */
const quoteToJson = (quote: SwapQuote) => ({
  quoteId: quote.quoteId,
  amountIn: quote.amountIn.toString(),
  amountOut: quote.amountOut.toString(),
  amountOutMin: quote.amountOutMin.toString(),
  validUntil: quote.validUntil,
  price: quote.price,
  feeTier: quote.feeTier,
  chain: quote.chain,
  blockNumber: quote.blockNumber ?? null,
});

export interface SwapRoutesDeps {
  readonly sessions: { read: (token: string, now: Date) => Promise<{ userId: string } | null> };
  readonly swapUseCase: ReturnType<typeof import('../../../application/swap/swapUseCase').createSwapUseCase>;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createSwapRoutes = (deps: SwapRoutesDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  const requireAuth = async (c: any) => {
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    return claims;
  };

  app.get('/pairs', async (c) => {
    const claims = await requireAuth(c);
    if (claims instanceof Response) return claims;

    try {
      const pairs = await deps.swapUseCase.getSupportedPairs();
      return c.json({ pairs }, 200);
    } catch (error) {
      log.error('swap.pairs_failed', { error });
      return c.json({ pairs: [] }, 500);
    }
  });

  app.post('/quote', async (c) => {
    const claims = await requireAuth(c);
    if (claims instanceof Response) return claims;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ status: 'unreadable', reason: 'MALFORMED_REQUEST' }, 400);
    }

    const { sourceSymbol, destinationSymbol, chain, amountIn, slippageBips } = body as {
      sourceSymbol?: string;
      destinationSymbol?: string;
      chain?: string;
      amountIn?: string;
      slippageBips?: number;
    };

    if (!sourceSymbol || !destinationSymbol || !chain || amountIn === undefined) {
      return c.json({ status: 'unreadable', reason: 'MALFORMED_REQUEST' }, 400);
    }

    const slippage = slippageBips ?? 50;
    if (slippage < 0 || slippage > 10000) {
      return c.json({ status: 'unreadable', reason: 'SLIPPAGE_EXCEEDED' }, 400);
    }

    let amountInBigInt: bigint;
    try {
      amountInBigInt = BigInt(amountIn);
    } catch {
      return c.json({ status: 'unreadable', reason: 'MALFORMED_REQUEST' }, 400);
    }

    const result = await deps.swapUseCase.getQuote({
      sourceSymbol,
      destinationSymbol,
      chain: chain as any,
      amountIn: amountInBigInt,
      slippageBips: slippage,
    });

    if (result.status === 'unreadable') {
      return c.json(result, 400);
    }

    return c.json({ status: 'ok', quote: quoteToJson(result.quote) }, 200);
  });

  app.post('/execute', async (c) => {
    const claims = await requireAuth(c);
    if (claims instanceof Response) return claims;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ status: 'unreadable', reason: 'MALFORMED_REQUEST' }, 400);
    }

    const { quoteId, signer, slippageBips, deadlineSeconds, sourceSymbol, destinationSymbol, chain } = body as {
      quoteId?: string;
      signer?: string;
      slippageBips?: number;
      deadlineSeconds?: number;
      sourceSymbol?: string;
      destinationSymbol?: string;
      chain?: string;
    };

    if (!quoteId || !signer || slippageBips === undefined || deadlineSeconds === undefined) {
      return c.json({ status: 'unreadable', reason: 'MALFORMED_REQUEST' }, 400);
    }

    // El par se exige aquí y no después: sin él, la ejecución no sabe qué
    // cotizar y el caso de uso tendría que adivinarlo.
    if (!sourceSymbol || !destinationSymbol || !chain) {
      return c.json({ status: 'unreadable', reason: 'MALFORMED_REQUEST' }, 400);
    }

    const slippage = slippageBips;
    if (slippage < 0 || slippage > 10000) {
      return c.json({ status: 'unreadable', reason: 'SLIPPAGE_EXCEEDED' }, 400);
    }

    const deadline = deadlineSeconds;
    if (deadline < 30 || deadline > 3600) {
      return c.json({ status: 'unreadable', reason: 'UNKNOWN_ERROR' }, 400);
    }

    const result = await deps.swapUseCase.executeSwap({
      quoteId,
      signer,
      slippageBips: slippage,
      deadlineSeconds: deadline,
      sourceSymbol,
      destinationSymbol,
      chain: chain as any,
    });

    if (result.status === 'unreadable') {
      return c.json(result, 400);
    }

    return c.json(
      {
        status: 'ok',
        result: {
          txHash: result.result.txHash,
          amountOut: result.result.amountOut.toString(),
          gasUsed: result.result.gasUsed.toString(),
        },
      },
      200,
    );
  });

  return app;
};