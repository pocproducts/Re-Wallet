import type { Env } from '@bestpath/config';
import type { Logger } from '../lib/logger';
import type { Database } from '../db/client';
import type { SessionActor } from '../lib/session';

/**
 * Hono context variables.
 *
 * Everything lives in `Variables` rather than `Bindings` because `c.set()` only
 * applies to Variables; Bindings are the immutable per-request input Hono passes
 * to `fetch` (used for Cloudflare-style runtimes).
 */
export interface AppVars {
  requestId: string;
  sessionId: string | undefined;
  /** Set by requireIdempotencyKey on money routes. */
  idempotencyKey: string | undefined;
  userId: string;
  /** Fully resolved session, present when the request is authenticated. */
  actor: SessionActor;
  env: Env;
  log: Logger;
  db: Database;
}

export type AppEnv = {
  Variables: AppVars;
};
