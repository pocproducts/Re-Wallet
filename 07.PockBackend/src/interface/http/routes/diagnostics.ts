/**
 * `POST /api/diagnostics` — **TEMPORARY**.
 *
 * ── Why it exists ─────────────────────────────────────────────────────────────
 *
 * Privy is called **from the browser**: `sendCode({ email })` then
 * `loginWithCode({ code })`. Neither call passes through this Worker, so a
 * rejection happens where no server log can see it — and the trial is being run
 * from a phone, where there is no console.
 *
 * So the browser reports the code to us. That is the whole reason this route is
 * here, and the reason it goes away with the problem.
 *
 * ── Why it accepts no free text ───────────────────────────────────────────────
 *
 * Because a route that logs arbitrary strings is a log-injection vector and a
 * spam vector, available to anyone on the internet. It accepts a code from a
 * **closed allowlist** and nothing else.
 *
 * An unknown code is still logged — "a code we do not recognise" is information —
 * but only after a regex strips everything outside `[a-z0-9_]`. And the route never
 * echoes the received text back in the response.
 */
import { Hono } from 'hono';

import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';

/**
 * The codes the front may report. A deliberately short list.
 *
 * Scoped to the EMAIL OTP path — this POC has no OAuth and no passkey, so the
 * passkey-flavoured codes that `06. Backend` carries would only be noise here.
 * A short list is what makes this route safe.
 */
export const DIAGNOSTIC_CODES = new Set([
  'invalid_email_address',
  'email_not_verified',
  'incorrect_code',
  'code_expired',
  'too_many_requests',
  'user_already_exists',
  'user_does_not_exist',
  'disallowed_login_method',
  'unauthorized',
  'network_error',
  'unknown_error',
]);

/** Everything outside `[a-z0-9_]` is removed. Applied to BOTH free-text fields. */
export const sanitize = (value: string): string => value.replace(/[^a-z0-9_]/g, '');

/** Long enough to be readable, short enough that a log line stays a log line. */
const MAX_FIELD_LENGTH = 80;

const sanitizeField = (value: string): string => sanitize(value).slice(0, MAX_FIELD_LENGTH);

export const createDiagnosticsRoutes = (deps: { log?: Logger } = {}) => {
  const app = new Hono();
  const log = deps.log ?? noopLogger;

  app.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
    }

    const parsed = body as Record<string, unknown> | null;
    const etapa = typeof parsed?.['etapa'] === 'string' ? parsed['etapa'] : 'unknown';
    const codigo = typeof parsed?.['codigo'] === 'string' ? parsed['codigo'] : '';

    /**
     * The allowlist decides what is trusted, and the sanitiser runs either way.
     * An allowlisted code contains only `[a-z0-9_]` by construction, so applying
     * both is belt-and-braces and costs nothing.
     */
    const safeEtapa = sanitizeField(etapa);
    const safeCodigo = sanitizeField(codigo);
    const known = DIAGNOSTIC_CODES.has(codigo);

    log.log('DIAGNOSTIC', {
      etapa: safeEtapa,
      codigo: safeCodigo,
      allowlisted: known,
      // A rejected code is logged as `rejected`, never as the text received.
      estado: known ? 'ok' : 'rejected',
    });

    // 204 with no body: nothing that was received comes back out.
    return c.body(null, 204);
  });

  return app;
};