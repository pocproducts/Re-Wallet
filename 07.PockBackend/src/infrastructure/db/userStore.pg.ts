/**
 * ADAPTER: the `rewallet.users` row.
 *
 * ── What this writes, and what it does not ────────────────────────────────────
 *
 * The real columns of the existing table, reused as they are. This Worker creates
 * no schema and no migration; the row it writes is the row the rest of ReWALLET
 * already expects.
 *
 * `email_verified_at` is deliberately **not** written: the row's existence is the
 * proof that the account is verified (the schema has no `email_verified` boolean
 * precisely for this reason), and the column defaults to `now()`.
 *
 * ── Why `ON CONFLICT (privy_did) DO UPDATE` ───────────────────────────────────
 *
 * Because a `find`-then-`insert` has a window between the two, and two logins for
 * the same person inside that window mean one of them gets a constraint violation
 * — a 500 for what is a completely ordinary double click.
 *
 * `DO UPDATE` rather than `DO NOTHING`: the statement has to return a row either
 * way, and a `DO NOTHING` returning nothing is the classic `INSERT ... RETURNING`
 * trap. Nothing is overwritten — a person's name and email are not ours to change
 * on a re-login.
 *
 * The assigned column is `email_verified_at` set to **its own value**, because
 * `rewallet.users` has no `updated_at` (the `touched_at` triggers cover
 * `wallets`, `movements`, `yield_positions` and `policy_rules`, not `users`). A
 * self-assignment is the cheapest way to make the conflict branch fire without
 * mutating anything.
 */
import type { NewUserProfile, StoredUser, UserStore } from '../../domain/ports/user-store';
import type { Database } from './client';

/** The shape `RETURNING` produces. Postgres `uuid`/`citext` arrive as strings. */
interface UserRow {
  readonly id: string;
  readonly privy_did: string;
  readonly name: string;
  readonly email: string;
  readonly tag: string;
}

const toStoredUser = (row: UserRow): StoredUser => ({
  id: row.id,
  privyDid: row.privy_did,
  name: row.name,
  email: row.email,
  tag: row.tag,
});

export const createPostgresUserStore = (db: Database): UserStore => ({
  async upsert(profile: NewUserProfile): Promise<StoredUser> {
    const rows = (await db`
      INSERT INTO rewallet.users (privy_did, name, email, tag, tag_normalized)
      VALUES (${profile.privyDid}, ${profile.name}, ${profile.email}, ${profile.tag}, ${profile.tag})
      ON CONFLICT (privy_did) DO UPDATE SET email_verified_at = rewallet.users.email_verified_at
      RETURNING id, privy_did, name, email, tag
    `) as unknown as UserRow[];

    const row = rows[0] as UserRow | undefined;
    if (!row) {
      throw new Error(`No users row returned for ${profile.privyDid}`);
    }
    return toStoredUser(row);
  },
});