/**
 * THE APPLICATION.
 *
 * One object that lists everything a person can ask for, and wires the ports into
 * the routes. Every dependency arrives as an argument — that is what lets the
 * whole HTTP surface be tested with no network and no database.
 *
 * ── Why there is no session guard here ────────────────────────────────────────
 *
 * `06. Backend` guards every route by default and lists the public ones. This POC
 * has exactly one protected concern (`GET /api/auth/session`), and a global
 * middleware that strips `/api` would be a second place where the prefix has to be
 * right. A route that validates its own cookie cannot be made circular by a
 * routing mistake.
 */
import { Hono } from 'hono';

import type { MintSession } from '../../application/session/mintSession';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { SessionCodec } from '../../domain/ports/session-codec';
import { SESSION_COOKIE_NAME } from './cookie';
import { createAuthRoutes } from './routes/auth';
import { createDiagnosticsRoutes } from './routes/diagnostics';

export interface AppDeps {
  readonly mint: MintSession;
  readonly sessions: SessionCodec;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createApp = (deps: AppDeps) => {
  const log = deps.log ?? noopLogger;
  const app = new Hono();

  /**
   * What nobody should ever see: a system error with its real message, the failed
   * query, the stack. That goes to telemetry. The person gets an actionable code
   * and nothing else.
   */
  app.onError((error, c) => {
    log.error('unhandled error', error);
    return c.json({ error: { code: 'INTERNAL' } }, 500);
  });

  app.route(
    '/api/auth/session',
    createAuthRoutes({
      mint: deps.mint,
      sessions: deps.sessions,
      cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
      now: deps.now,
      log,
    }),
  );

  // TEMPORARY. Removed together with the browser-side Privy problem it explains.
  app.route('/api/diagnostics', createDiagnosticsRoutes({ log }));

  return app;
};