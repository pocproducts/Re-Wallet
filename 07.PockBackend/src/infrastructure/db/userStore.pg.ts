/**
 * ADAPTER: the `rewallet.users` row.
 *
 * ── What this writes, and what it does not ────────────────────────────────────
 *
 * The real columns of the existing table, reused as they are. This Worker creates
 * no schema and no migration; the row it writes is the row the rest of ReWALLET
 * already expects:
 *
 *   users(id uuid pk, privy_did text not null unique, name text not null unique,
 *         tag citext not null unique, tag_normalized citext not null unique,
 *         email citext not null unique, email_verified_at timestamptz not null)
 *
 * `email_verified_at` is deliberately **not** written: the row's existence is the
 * proof that the account is verified (the schema has no `email_verified` boolean
 * precisely for this reason), and the column defaults to `now()`.
 *
 * ── Why these are five statements and not one ─────────────────────────────────
 *
 * Because the decision between "update", "adopt" and "create" needs a **read**,
 * and hiding the read inside a single `INSERT ... ON CONFLICT` would make the
 * interesting case — the DID Privy rotated, the person did not change — look
 * exactly like the ordinary one in the log, which is the bug this file exists to
 * fix. The decision itself lives in `resolveAccount`; this file only performs
 * steps.
 *
 * `upsert` survives as `ON CONFLICT (privy_did) DO UPDATE` because the "DID is
 * known" branch still has a window, and two logins for one person inside it mean
 * one of them gets a constraint violation. The assigned column is
 * `email_verified_at` set to **its own value**, because `rewallet.users` has no
 * `updated_at` (the `touched_at` triggers cover `wallets`, `movements`,
 * `yield_positions` and `policy_rules`, not `users`): a self-assignment is the
 * cheapest way to make the conflict branch fire without mutating anything.
 *
 * ── Why `adoptPrivyDid` writes one column ────────────────────────────────────
 *
 * `name`, `tag` and `tag_normalized` are a person's handle, not a function of the
 * DID. An adoption caused by a provider-side identifier rotation must not rename
 * anybody: the statement is `SET privy_did = …` and nothing else, and the id the
 * statement returns is the id every wallet, movement and policy row already points
 * at. A unique violation on `privy_did` here means another row took the DID in the
 * gap between the resolver's read and this write, and it surfaces as
 * `UserStoreConflict` — a named condition, not a 500 with a driver message.
 */
import type { NewUserProfile, StoredUser, UserStore } from '../../domain/ports/user-store';
import { UserStoreConflict } from '../../domain/ports/user-store';
import type { Database } from './client';

/** The shape `RETURNING` produces. Postgres `uuid`/`citext` arrive as strings. */
interface UserRow {
  readonly id: string;
  readonly privy_did: string;
  readonly name: string;
  readonly email: string;
  readonly tag: string;
  readonly tag_normalized: string;
}

const COLUMNS = 'id, privy_did, name, email, tag, tag_normalized';

const toStoredUser = (row: UserRow): StoredUser => ({
  id: row.id,
  privyDid: row.privy_did,
  name: row.name,
  email: row.email,
  tag: row.tag,
  tagNormalized: row.tag_normalized,
});

/**
 * Postgres SQLSTATE for `unique_violation`.
 *
 * The HTTP driver reports it as `code`; some drivers wrap it as `severity`. Both
 * are checked, because "did we translate this" must not depend on which one the
 * transport happened to use.
 */
const UNIQUE_VIOLATION = '23505';

interface DriverError {
  readonly code?: unknown;
  readonly severity?: unknown;
  readonly constraint?: unknown;
}

const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as DriverError | null;
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    (candidate.code === UNIQUE_VIOLATION || candidate.severity === UNIQUE_VIOLATION)
  );
};

const constraintName = (error: unknown): string => {
  const candidate = error as DriverError | null;
  return typeof candidate?.constraint === 'string' ? candidate.constraint : 'unknown_constraint';
};

/**
 * Runs `write`, turning a lost unique-constraint race into `UserStoreConflict`.
 *
 * Every statement that can collide goes through here, so there is no path where a
 * driver message reaches the HTTP layer with a table and an index name in it.
 * Anything that is not a unique violation is re-thrown untouched: an outage must
 * not be disguised as a conflict.
 */
const guarded = async <T>(write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserStoreConflict(constraintName(error), { cause: error });
    }
    throw error;
  }
};

const one = (rows: unknown, context: string): UserRow => {
  const row = (rows as UserRow[])[0];
  if (row === undefined) {
    // A `RETURNING` with no row on a write that reported success is a broken
    // assumption, not a conflict, and it is named rather than silently tolerated.
    throw new Error(`no users row returned while ${context}`);
  }
  return row;
};

export const createPostgresUserStore = (db: Database): UserStore => ({
  async findByPrivyDid(privyDid: string): Promise<StoredUser | null> {
    const rows = (await db`
      SELECT ${db.unsafe(COLUMNS)}
      FROM rewallet.users
      WHERE privy_did = ${privyDid}
      LIMIT 1
    `) as unknown as UserRow[];
    const row = rows[0];
    return row === undefined ? null : toStoredUser(row);
  },

  async findByEmail(email: string): Promise<StoredUser | null> {
    // `email` is `citext`, so this comparison is already case-insensitive in the
    // database — the same rule the resolver applies in memory.
    const rows = (await db`
      SELECT ${db.unsafe(COLUMNS)}
      FROM rewallet.users
      WHERE email = ${email}
      LIMIT 1
    `) as unknown as UserRow[];
    const row = rows[0];
    return row === undefined ? null : toStoredUser(row);
  },

  async upsert(profile: NewUserProfile): Promise<StoredUser> {
    const rows = await guarded(async () =>
      (await db`
        INSERT INTO rewallet.users (privy_did, name, email, tag, tag_normalized)
        VALUES (${profile.privyDid}, ${profile.name}, ${profile.email}, ${profile.tag}, ${profile.tag})
        ON CONFLICT (privy_did) DO UPDATE SET email_verified_at = rewallet.users.email_verified_at
        RETURNING ${db.unsafe(COLUMNS)}
      `) as unknown as UserRow[],
    );
    return toStoredUser(one(rows, 'updating the account for a known DID'));
  },

  async adoptPrivyDid(id: string, privyDid: string): Promise<StoredUser> {
    const rows = await guarded(async () =>
      (await db`
        UPDATE rewallet.users
        SET privy_did = ${privyDid}
        WHERE id = ${id}
        RETURNING ${db.unsafe(COLUMNS)}
      `) as unknown as UserRow[],
    );
    return toStoredUser(one(rows, `adopting ${privyDid} on the account ${id}`));
  },

  async create(profile: NewUserProfile): Promise<StoredUser> {
    const rows = await guarded(async () =>
      (await db`
        INSERT INTO rewallet.users (privy_did, name, email, tag, tag_normalized)
        VALUES (${profile.privyDid}, ${profile.name}, ${profile.email}, ${profile.tag}, ${profile.tag})
        RETURNING ${db.unsafe(COLUMNS)}
      `) as unknown as UserRow[],
    );
    return toStoredUser(one(rows, `creating the account for ${profile.privyDid}`));
  },
});