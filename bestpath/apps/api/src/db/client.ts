import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Where the code is running, decided by the runtime's own user agent.
 *
 * Exported and pure so the decision can be tested instead of asserted: the bug
 * this file was fixed for lives entirely on the difference between the two
 * answers.
 */
export const isWorkerRuntime = (userAgent?: string): boolean =>
  userAgent === 'Cloudflare-Workers';

/**
 * The pool cache. Keyed BY URL, which the previous version was not.
 *
 * `getDb(url)` ignored its argument after the first call: a second URL got the
 * first URL's client. That is harmless while the app has one database and a
 * landmine the day it has two — the process would write to whichever one was
 * opened first, and nothing in the types or the logs would say so.
 */
const globalForDb = globalThis as unknown as { __bestpathDb?: Map<string, Database> };

/**
 * Whether a pool for this URL may be reused at all.
 *
 * `nodejs_compat` does NOT make the Worker a process: an isolate is reused
 * across invocations, but the connections inside a cached pool do not survive
 * the gap between an HTTP request and a scheduled event five minutes later, and
 * the first query after that gap fails with `Failed query: select …` against a
 * table that is right there.
 *
 * In Node the opposite is true and the cache is necessary: `tsx watch` reloads
 * on every save, and a pool per reload exhausts connections. So the two runtimes
 * get opposite answers on purpose, and Hyperdrive is what makes the Worker's
 * answer affordable — pooling happens at the edge, not in the isolate.
 */
const cacheable = (userAgent?: string): boolean => !isWorkerRuntime(userAgent);

export function createDb(databaseUrl: string, options: { max: number } = { max: 10 }): Database {
  const client = postgres(databaseUrl, {
    // ONE connection in the Worker, ten in Node. Not a tuning knob: the Worker
    // runs a single sequential job per invocation and Hyperdrive does the pooling
    // at the edge, so a bigger per-isolate pool only competes for the origin's
    // `origin_connection_limit` (20 on this project) with connections nobody is
    // using. Node genuinely needs more than one — `register/finish` runs a
    // transaction while other queries are in flight, and `max: 1` would
    // serialise them behind the transaction's connection.
    max: options.max,
    // Left as-is for Node, where the pool IS the pool. On the Worker every
    // invocation gets a fresh client, so there is nothing to keep alive.
    idle_timeout: 20,
    // Required on Hyperdrive: it multiplexes over a single socket, and a
    // server-side prepared statement would collide across sessions.
    prepare: false,
  });
  return drizzle(client, { schema });
}

/**
 * The db for this URL.
 *
 * In the Worker this is a fresh client per invocation; in Node it is one cached
 * pool per URL. The function keeps its name and its shape either way, so no
 * caller has to know which runtime it is in.
 */
export function getDb(databaseUrl: string, userAgent?: string): Database {
  const ua = userAgent ?? (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  if (!cacheable(ua)) {
    return createDb(databaseUrl, { max: 1 });
  }
  if (!globalForDb.__bestpathDb) globalForDb.__bestpathDb = new Map();
  const cache = globalForDb.__bestpathDb;
  const existing = cache.get(databaseUrl);
  if (existing) return existing;
  const created = createDb(databaseUrl, { max: 10 });
  cache.set(databaseUrl, created);
  return created;
}

/** Test helper. Drops the cached pools. */
export function __resetDb(): void {
  globalForDb.__bestpathDb = undefined;
}
