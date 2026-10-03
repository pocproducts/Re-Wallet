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
 * ── Why `detalle` is optional ────────────────────────────────────────────────
 *
 * Because the log was read and it could not say what had happened. A
 * `{"etapa":"wallets_reclamar","codigo":"unknown_error"}` line is the exact shape
 * of a guess: the `codigo` allowlist forces everything the browser does not
 * recognise to travel as `unknown_error`, so "we did not recognise the code" and
 * "the code was something the allowlist does not have" looked the same.
 *
 * `detalle` is the **bounded** content the front assembles itself — real error
 * code, HTTP status, error name — never a free message and never a payload. That
 * is what makes it safe to accept, and what makes it useful.
 *
 * ── Why it is sanitised and not trusted ───────────────────────────────────────
 *
 * Because this route is, on purpose, **temporary and public**: anyone on the
 * internet can POST to it. Trusting the text would be log injection and log
 * spam. So `detalle` goes through the **same** character rule as an unknown code
 * (everything outside `[a-z0-9_]` is removed), additionally collapses runs of
 * whitespace into a single `_`, and is cut at 200 characters. One failure cannot
 * write a field longer than 200 characters, cannot write a second line, and
 * cannot hide a log line behind a newline.
 *
 * And it is still never echoed back: the response stays 204 with an empty body.
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

/**
 * Cap for `detalle`. Larger than `MAX_FIELD_LENGTH` because this one carries a
 * **composition** (code + status + name), not a single identifier, and 200
 * characters is still one log line rather than a paragraph.
 */
const MAX_DETALLE_LENGTH = 200;

/**
 * `detalle` goes through the same character rule as an unknown code, with two
 * additions:
 *
 * 1. Whitespace (newlines included) is collapsed **before** the strip. The
 *    `[a-z0-9_]` rule already deletes it, but turning it into one `_` first keeps
 *    `code_wallet_claim_rejected` readable instead of glued together, and makes
 *    it obvious in the code that one failure cannot write several lines.
 * 2. The length cut goes **last**: clean first, bound afterwards. The other order
 *    could leave the field inside the limit without ever having been cleaned.
 */
export const sanitizeDetalle = (value: string): string =>
  sanitize(value.replace(/\s+/g, '_')).slice(0, MAX_DETALLE_LENGTH);

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
    /*
     * `detalle` is optional: if it is absent, or not a string, nothing is invented
     * and the key simply does not appear in the log. It is an **extra** field, not
     * part of the allowlist decision taken below.
     */
    const detalle = typeof parsed?.['detalle'] === 'string' ? sanitizeDetalle(parsed['detalle']) : '';

    const safeEtapa = sanitizeField(etapa);
    const safeCodigo = sanitizeField(codigo);
    const known = DIAGNOSTIC_CODES.has(codigo);

    log.log('DIAGNOSTIC', {
      etapa: safeEtapa,
      codigo: safeCodigo,
      ...(detalle ? { detalle } : {}),
      allowlisted: known,
      // A rejected code is logged as `rejected`, never as the text received.
      estado: known ? 'ok' : 'rejected',
    });

    // 204 with no body: nothing that was received comes back out.
    return c.body(null, 204);
  });

  return app;
};