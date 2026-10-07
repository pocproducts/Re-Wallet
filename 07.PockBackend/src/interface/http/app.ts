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
<<<<<<< HEAD
import type { ReadPortfolio } from '../../application/portfolio/readPortfolio';
import type { ClaimWalletsFor } from '../../application/wallet-claim/claimWalletsFor';
import type { IngestPrivyWebhook } from '../../application/webhooks/ingestPrivyWebhook';
import type { ReadNotifications } from '../../application/webhooks/readNotifications';
=======
import type { ClaimWalletsFor } from '../../application/wallet-claim/claimWalletsFor';
>>>>>>> origin/main
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { SessionCodec } from '../../domain/ports/session-codec';
import type { TokenVerifier } from '../../domain/ports/token-verifier';
import { SESSION_COOKIE_NAME } from './cookie';
import { createAuthRoutes } from './routes/auth';
import { createDiagnosticsRoutes } from './routes/diagnostics';
<<<<<<< HEAD
import { createNotificationsRoutes } from './routes/notifications';
import { createPortfolioRoutes } from './routes/portfolio';
import { createWalletsRoutes } from './routes/wallets';
import { createWebhookRoutes } from './routes/webhooks';
=======
import { createWalletsRoutes } from './routes/wallets';
>>>>>>> origin/main

export interface AppDeps {
  readonly mint: MintSession;
  readonly sessions: SessionCodec;
  /** Present in production; the wallets route needs the same verifier. */
  readonly verify?: TokenVerifier;
  readonly claim?: ClaimWalletsFor;
<<<<<<< HEAD
  /** Absent when no chain readers are wired: the route is then not there. */
  readonly readPortfolio?: ReadPortfolio;
  /** Absent when no signing secret is wired: the intake is then not there. */
  readonly ingestWebhook?: IngestPrivyWebhook;
  readonly readNotifications?: ReadNotifications;
=======
>>>>>>> origin/main
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

  /*
   * `/api/wallets/claim` is mounted only when both of its dependencies exist.
   * Not for tidiness: a route that answered "claim is not configured" to a browser
   * that genuinely created a wallet would be indistinguishable, from the outside,
   * from a rejection — and the honest answer to "this deployment cannot verify
   * ownership" is that the route is not there.
   */
  if (deps.verify && deps.claim) {
    app.route('/api/wallets', createWalletsRoutes({ verify: deps.verify, claim: deps.claim, log }));
  }

<<<<<<< HEAD
  /*
   * `/api/portfolio` is mounted when the chain readers are wired. Same reasoning
   * as the claim route: a portfolio route that answered "balances are not
   * configured" would be indistinguishable, from a screen, from a portfolio of
   * zeroes. The honest answer is that the route does not exist.
   */
  if (deps.readPortfolio) {
    app.route(
      '/api/portfolio',
      createPortfolioRoutes({
        sessions: deps.sessions,
        readPortfolio: deps.readPortfolio,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * The webhook intake and the feed it feeds are mounted as one pair. The intake
   * exists only to have rows for the feed to read, so a deployment with one
   * without the other is half a feature rather than a smaller one.
   *
   * The intake has no cookie: its credential is the Svix signature. What is
   * *not* mounted without it is an endpoint that would accept anything anybody on
   * the internet sends.
   */
  if (deps.ingestWebhook) {
    app.route('/api/webhooks/privy', createWebhookRoutes({ ingest: deps.ingestWebhook, now: deps.now, log }));
  }

  if (deps.readNotifications) {
    app.route(
      '/api/notifications',
      createNotificationsRoutes({
        sessions: deps.sessions,
        readNotifications: deps.readNotifications,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

=======
>>>>>>> origin/main
  // TEMPORARY. Removed together with the browser-side Privy problem it explains.
  app.route('/api/diagnostics', createDiagnosticsRoutes({ log }));

  return app;
};