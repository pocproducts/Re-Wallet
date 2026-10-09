/**
 * `POST /api/wallet/policy/evaluate` — pregunta si un envío puede hacerse.
 *
 * ── Por qué es un endpoint aparte y no una parte de `send` ───────────────────
 *
 * Porque la pantalla necesita **decidir antes de mandar**: si la respuesta
 * fuera "no", la persona yaSigned una transacción que no va a llegar a la red.
 * Con este endpoint, la UI pregunta primero, muestra "necesita confirmación" o
 * "no permitido" con su motivo, y solo después ofrece el botón de firmar.
 *
 * ── Por qué no aplica la política ────────────────────────────────────────────
 *
 * Evaluar no es enviar. Un `evaluate` no mueve plata, no crea movimiento y no
 * quema una clave de idempotencia. Solo escribe la fila de auditoría —que es lo
 * que hace que "por qué no pudo" tenga respuesta — y por eso reevaluar el mismo
 * envío es barato y sin efecto.
 *
 * ── Contrato ─────────────────────────────────────────────────────────────────
 *
 *   POST /evaluate
 *     Body: { amountRaw: "600000000", recipient: "@carlos" }
 *     200: { verdict, decisive, reasons, triggered, perRule }
 *     400: { error: 'AMOUNT_INVALID' | 'RECIPIENT_REQUIRED' }
 */
import { Hono } from 'hono';

import type { EvaluateSendPolicy } from '../../../application/policy/evaluateSendPolicyUseCase';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';

export interface PolicyRoutesDeps {
  readonly sessions: { read: (token: string, now: Date) => Promise<{ userId: string } | null> };
  readonly evaluateSendPolicy: EvaluateSendPolicy;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

/** Solo dígitos: el mismo contrato que el envío usa para `amountRaw`. */
const DIGITS = /^[0-9]+$/;

export const createPolicyRoutes = (deps: PolicyRoutesDeps) => {
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

  app.post('/evaluate', async (c) => {
    const claims = await requireAuth(c);
    if (claims instanceof Response) return claims;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'MALFORMED_REQUEST' }, 400);
    }

    const { amountRaw, recipient } = body as {
      amountRaw?: unknown;
      recipient?: unknown;
    };

    const amountText = typeof amountRaw === 'string' ? amountRaw : String(amountRaw ?? '');
    if (!DIGITS.test(amountText)) {
      return c.json({ error: 'AMOUNT_INVALID' }, 400);
    }

    const recipientText = typeof recipient === 'string' ? recipient.trim() : '';
    if (recipientText.length === 0) {
      return c.json({ error: 'RECIPIENT_REQUIRED' }, 400);
    }

    let amount: bigint;
    try {
      amount = BigInt(amountText);
    } catch {
      return c.json({ error: 'AMOUNT_INVALID' }, 400);
    }

    try {
      const result = await deps.evaluateSendPolicy({
        userId: claims.userId,
        amount,
        recipient: recipientText,
      });

      // El código HTTP es 200 siempre: un `deny` no es un error de la API, es una
      // respuesta que la pantalla necesita poder pintar con su motivo.
      return c.json(result, 200);
    } catch (error) {
      log.error('policy.evaluate_failed', { error });
      return c.json({ error: 'EVALUATION_FAILED' }, 500);
    }
  });

  return app;
};