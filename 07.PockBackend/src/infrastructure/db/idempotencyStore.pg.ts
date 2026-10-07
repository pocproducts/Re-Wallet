/**
 * ADAPTER: `rewallet.idempotency_keys` — the claim, and then the answer.
 *
 * ── The real columns of the existing table ────────────────────────────────────
 *
 * `key` (PRIMARY KEY), `user_id`, `endpoint`, `response` (jsonb NOT NULL),
 * `status_code`, `created_at`, `expires_at` (NOT NULL). No column is added and
 * no constraint is dropped.
 *
 * ── Why `reserve` writes a placeholder instead of the answer ─────────────────
 *
 * Because the answer does not exist yet. The claim is what makes two overlapping
 * taps one send: whoever inserts first owns the key, and the other one is told
 * "not yours". `ON CONFLICT (key) DO NOTHING RETURNING key` answers `false` for
 * the loser, which is an ordinary outcome and not an error.
 *
 * The placeholder is `response = '{}'` with `status_code = 0`, both of which the
 * table allows — `response` is NOT NULL and has no default, so an empty object
 * is the honest "nothing to report yet". It can never be **served**, because
 * `find` only answers rows with `status_code > 0`.
 *
 * ── Why `release` refuses to delete an answer ────────────────────────────────
 *
 * `WHERE … AND status_code = 0`. A claim is given back only while it is still
 * empty, so a preparation that failed for an ordinary reason leaves no trace and
 * a stored answer can never be deleted — which means a replay can never change
 * its answer halfway through.
 */
import type {
  IdempotencyScope,
  IdempotencyStore,
  IdempotentResponse,
} from '../../domain/ports/idempotency-store';
import type { Database } from './client';

interface StoredRow {
  readonly response: unknown;
  readonly status_code: number;
}

interface KeyRow {
  readonly key: string;
}

export const createPostgresIdempotencyStore = (db: Database): IdempotencyStore => ({
  async find({ key, userId, endpoint }: IdempotencyScope): Promise<IdempotentResponse | null> {
    const rows = (await db`
      SELECT response, status_code
        FROM rewallet.idempotency_keys
       WHERE key = ${key}
         AND user_id = ${userId}
         AND endpoint = ${endpoint}
         AND status_code > 0
    `) as unknown as StoredRow[];

    const row = rows[0];
    if (row === undefined) return null;
    return { response: row.response, statusCode: row.status_code };
  },

  async reserve({ key, userId, endpoint, expiresAt }: IdempotencyScope & { expiresAt: Date }): Promise<boolean> {
    const rows = (await db`
      INSERT INTO rewallet.idempotency_keys (key, user_id, endpoint, response, status_code, expires_at)
      VALUES (${key}, ${userId}, ${endpoint}, '{}'::jsonb, 0, ${expiresAt.toISOString()})
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `) as unknown as KeyRow[];

    return rows.length > 0;
  },

  async complete({ key, userId, endpoint, response, statusCode }: IdempotencyScope & {
    response: unknown;
    statusCode: number;
  }): Promise<void> {
    await db`
      UPDATE rewallet.idempotency_keys
         SET response = ${JSON.stringify(response)}::jsonb,
             status_code = ${statusCode}
       WHERE key = ${key}
         AND user_id = ${userId}
         AND endpoint = ${endpoint}
    `;
  },

  async release({ key, userId, endpoint }: IdempotencyScope): Promise<void> {
    await db`
      DELETE FROM rewallet.idempotency_keys
       WHERE key = ${key}
         AND user_id = ${userId}
         AND endpoint = ${endpoint}
         AND status_code = 0
    `;
  },
});
