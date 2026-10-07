import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, isWorkerRuntime, __resetDb } from '../../src/db/client';

/**
 * The pool cache, per runtime.
 *
 * The bug: a `scheduled` event fired five minutes after the last HTTP request
 * reused a pool cached on `globalThis`, and its first query failed with
 * `Failed query: select "id", "address", "balance", "first_funds_at" from
 * "wallets"` — against a table that was right there, on the database the Worker
 * reads for every request. It did not fail on the second run of the same
 * process, which is what made it look like a schema problem.
 *
 * The two runtimes need OPPOSITE answers and neither one is the default:
 *
 *   - Node keeps the pool, because `tsx watch` reloads on every save and a pool
 *     per reload exhausts connections.
 *   - The Worker does not, because the isolate outlives the invocations and
 *     Hyperdrive already pools at the edge. A per-isolate pool only competes for
 *     `origin_connection_limit` with connections nobody is using.
 *
 * `postgres()` is lazy, so building a client here opens no socket and needs no
 * database: these assertions are about the caching decision, not about SQL.
 */

const NODE_UA = 'Node.js/22';
const WORKER_UA = 'Cloudflare-Workers';
const A = 'postgres://u:p@host/db-a';
const B = 'postgres://u:p@host/db-b';

beforeEach(() => {
  __resetDb();
});

describe('recognising the runtime', () => {
  it('is true only for workerd', () => {
    expect(isWorkerRuntime(WORKER_UA)).toBe(true);
  });

  // Node 21+ also has a `navigator`, with a `userAgent` of its own. A check
  // that merely tested "does navigator exist" would misclassify every modern
  // Node as a Worker, and the dev pool would stop being reused.
  it('is false for Node, which also has a navigator', () => {
    expect(isWorkerRuntime(NODE_UA)).toBe(false);
    expect(isWorkerRuntime(undefined)).toBe(false);
  });
});

describe('in Node the pool is cached, one per URL', () => {
  it('the same URL gives the same client back', () => {
    expect(getDb(A, NODE_UA)).toBe(getDb(A, NODE_UA));
  });

  it('a DIFFERENT URL gives a different client', () => {
    // The previous version ignored its argument after the first call, so a
    // second URL silently got the first URL's pool. Harmless with one database
    // and a landmine the day there are two: the process would write to whichever
    // was opened first and nothing would say so.
    expect(getDb(A, NODE_UA)).not.toBe(getDb(B, NODE_UA));
  });
});

describe('in the Worker the pool is NOT reused across invocations', () => {
  it('two calls in the same isolate give two clients', () => {
    // This is the fix. An isolate is reused across invocations, so a cached pool
    // outlives the event that created it, and the first query after a quiet
    // period fails.
    expect(getDb(A, WORKER_UA)).not.toBe(getDb(A, WORKER_UA));
  });

  it('and it is not merely "the cache was empty"', () => {
    getDb(A, WORKER_UA);
    const second = getDb(A, WORKER_UA);
    expect(second).toBeDefined();
    expect(getDb(A, WORKER_UA)).not.toBe(second);
  });
});

describe('the cache does not leak between runtimes', () => {
  it('a Node pool and a Worker client for the same URL are different objects', () => {
    // Proves the Worker path never reads or writes the Node cache, so a pool
    // created during local dev cannot be picked up by a scheduled event.
    expect(getDb(A, NODE_UA)).not.toBe(getDb(A, WORKER_UA));
  });
});
