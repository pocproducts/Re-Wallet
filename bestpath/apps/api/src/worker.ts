/**
 * The Cloudflare Worker entry point.
 *
 * WHY A SEPARATE ENTRY, and not the same index.ts
 *
 * `src/index.ts` calls `serve()` from `@hono/node-server` and imports `dotenv`.
 * Neither exists in `workerd`: there is no HTTP server to bind a port to (the
 * runtime hands us a `fetch` event) and no filesystem to read a `.env` from. The
 * honest way to be portable is two thin entries that both delegate to the same
 * `createApp()` — the app never learns where it is running.
 *
 * The whole deployment surface is this file plus `wrangler.toml`. Everything
 * else — routes, services, custody, Aave — is identical between the two, which
 * is the point: a behaviour difference between local and production is a bug
 * waiting to happen.
 */

import { getEnv } from '@bestpath/config';
import { createApp } from './app';
import { createLogger } from './lib/logger';
import { getDb } from './db/client';
import { syncWalletBalances } from './services/balance';

/**
 * The Worker interface, narrowed to what we actually use.
 *
 * Secrets arrive as string lookups and bindings arrive as objects, so the index
 * signature has to admit both. A typed interface with fourteen fields is how one
 * of them ends up silently `undefined` in production.
 */
interface WorkerEnv {
  [key: string]: string | { connectionString: string } | undefined;
  /**
   * Hyperdrive's pooled connection string. The binding is what makes Postgres
   * work here: Workers reach the database through Hyperdrive's TCP pool, and
   * `postgres@3.4.4+` is on the supported driver list. No driver swap needed,
   * which is why this deploy did not touch `db/client.ts` beyond the URL.
   */
  HYPERDRIVE?: { connectionString: string };
}

/** `ExecutionContext` is not in lib.dom, and the Workers types are not installed. */
interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/**
 * `DATABASE_URL` resolution, in order.
 *
 * Hyperdrive first, then the raw URL. The fallback is not nostalgia: `wrangler
 * dev` and a smoke test on a laptop have no Hyperdrive binding, and a database
 * that only works on one of the two is a database we cannot debug.
 */
const databaseUrlFor = (env: WorkerEnv): string => {
  const pooled = env.HYPERDRIVE?.connectionString;
  if (pooled) return pooled;
  // Narrowed by hand: the index signature has to admit objects for the bindings,
  // so every plain read is `string | { connectionString }` until checked.
  const raw = env.DATABASE_URL;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  // Failing loudly beats a Worker that boots and 500s on every request with a
  // message nobody can act on.
  throw new Error(
    'Neither HYPERDRIVE.connectionString nor DATABASE_URL is set. ' +
      'Run: wrangler hyperdrive create, or wrangler secret put DATABASE_URL.',
  );
};

/**
 * THE `/api` PREFIX IS STRIPPED HERE, and without it nothing works.
 *
 * The frontend calls `/api/auth/...` because that is what the Vite dev proxy
 * rewrites to `/auth/...`. In production there is no Vite and no proxy, so the
 * Worker has to do the same rewrite or every call 404s — a failure that only
 * shows up after deploying, with the API itself healthy and the tests green.
 *
 * So the two environments keep the SAME public URL shape, and the strip lives
 * exactly where the dev proxy lived.
 */
const API_PREFIX = '/api';

export const stripApiPrefix = (request: Request): Request => {
  const { pathname, search, hash } = new URL(request.url);
  if (pathname === API_PREFIX) {
    return new Request(new URL('/', request.url), request);
  }
  if (!pathname.startsWith(`${API_PREFIX}/`)) return request;
  return new Request(new URL(pathname.slice(API_PREFIX.length) + search + hash, request.url), request);
};

export default {
  async fetch(request: Request, workerEnv: WorkerEnv, ctx: WorkerExecutionContext): Promise<Response> {
    // getEnv validates and throws on bad config, which is deliberate in a wallet
    // backend: it must never serve traffic half-configured. The `await` on
    // nothing is not needed — this stays sync, but the assignment is wrapped so
    // the throw happens before any request is handled.
    const env = getEnv({ ...workerEnv, DATABASE_URL: databaseUrlFor(workerEnv) } as never);
    const log = createLogger(env);
    const app = createApp(env);

    void ctx.waitUntil(Promise.resolve());

    return app.fetch(stripApiPrefix(request), { env, log, executionCtx: ctx } as never);
  },

  /**
   * The cron entry: reconcile every wallet balance with the chain.
   *
   * WHY A CRON AND NOT THE SESSION READ. `wallets.balance` is a mirror, and a
   * mirror has to be refreshed by something that is allowed to be late. Refreshing
   * it inside `GET /auth/session` would put a network call and two writes on the
   * path that decides whether the app loads at all, and a slow RPC would turn
   * into a 500 on the session: the login would break because a balance could not
   * be read. A mirror that is five minutes stale is fine; a login that fails is
   * not.
   *
   * WHY IT MUST NOT THROW. A Cloudflare cron does not retry. An unhandled
   * rejection here means the mirror silently stops updating, and the symptom is
   * a wrong number on someone's profile days later, with nothing in the app to
   * explain it. So the failure is caught, logged with the reason, and the run
   * ends. The next tick tries again.
   */
  async scheduled(
    _controller: unknown,
    workerEnv: WorkerEnv,
    ctx: WorkerExecutionContext,
  ): Promise<void> {
    try {
      const env = getEnv({ ...workerEnv, DATABASE_URL: databaseUrlFor(workerEnv) } as never);
      const log = createLogger(env);
      const db = getDb(env.DATABASE_URL);
      await syncWalletBalances(db, { env, log });
    } catch (err) {
      // `console.error` and not the pino logger: the logger is built from the
      // env that just failed to load, so on a config error the one thing that
      // still works is the platform log.
      console.error('[rewallet] balance sync (cron) falló', err);
    }
  },
};
