/**
 * An in-memory `UserStore` that behaves like the real table.
 *
 * ── Why a fake table and not a stub ───────────────────────────────────────────
 *
 * The rules being tested are *about* the table: an email is `UNIQUE`, a DID is
 * `UNIQUE`, and `tag`/`tag_normalized`/`name` are `UNIQUE` too. A stub that
 * returns whatever the test told it to return would pass a test that the database
 * could not pass — the old upsert looked correct against a stub and failed in
 * production with `users_email_key`. So this enforces the same uniqueness the
 * live schema does, and raises the same `UserStoreConflict` the adapter raises,
 * including the `citext` case-insensitivity of `email`.
 */
import { UserStoreConflict } from '../../src/domain/ports/user-store';
import type { NewUserProfile, StoredUser, UserStore } from '../../src/domain/ports/user-store';

/** A row as it exists in `rewallet.users`. */
export interface SeedUser {
  readonly id: string;
  readonly privyDid: string;
  readonly name: string;
  readonly email: string;
  readonly tag: string;
  readonly tagNormalized: string;
}

/** The column a violation names, so a test can assert which one raced. */
export const CONSTRAINTS = {
  did: 'users_privy_did_key',
  email: 'users_email_key',
  name: 'users_name_key',
  tag: 'users_tag_key',
  tagNormalized: 'users_tag_normalized_key',
} as const;

export const seedUser = (overrides: Partial<SeedUser> = {}): SeedUser => ({
  id: '11111111-1111-4111-8111-111111111111',
  privyDid: 'did:privy:2old00000000000000000000000000000000',
  name: 'ana.abcd',
  email: 'ana@example.com',
  tag: 'ana.abcd',
  tagNormalized: 'ana.abcd',
  ...overrides,
});

/** Every operation the fake performed, in order. `adopt`/`create` carry detail. */
export type UserStoreCall =
  | { readonly op: 'findByPrivyDid'; readonly privyDid: string }
  | { readonly op: 'findByEmail'; readonly email: string }
  | { readonly op: 'upsert'; readonly profile: NewUserProfile }
  | { readonly op: 'adoptPrivyDid'; readonly id: string; readonly privyDid: string }
  | { readonly op: 'create'; readonly profile: NewUserProfile };

/** `citext` comparison: trimmed, case-insensitive. */
const citext = (value: string): string => value.trim().toLowerCase();

export interface InMemoryUserStore {
  readonly users: UserStore;
  /** Every call, in order. */
  readonly calls: UserStoreCall[];
  /** Every write that carried a profile (upsert/create). */
  readonly profiles: NewUserProfile[];
  /** The rows as they stand now — what the next login would read. */
  readonly rows: () => SeedUser[];
}

export const inMemoryUserStore = (seed: readonly SeedUser[] = []): InMemoryUserStore => {
  const rows: SeedUser[] = [...seed];
  const calls: UserStoreCall[] = [];
  const profiles: NewUserProfile[] = [];

  let nextId = 0;
  const freshId = (): string => {
    nextId += 1;
    return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
  };

  /**
   * The four `UNIQUE` columns, minus the row at `exceptId`.
   *
   * Enforced on every write because that is what the table does; a fake that let a
   * duplicate through would be testing a schema that does not exist.
   */
  const assertUnique = (candidate: SeedUser, exceptId: string | null): void => {
    const others = rows.filter((row) => row.id !== exceptId);

    const taken = (constraint: string, matches: (row: SeedUser) => boolean): void => {
      if (others.some(matches)) throw new UserStoreConflict(constraint);
    };

    taken(CONSTRAINTS.did, (row) => row.privyDid === candidate.privyDid);
    // `email`, `tag` and `tag_normalized` are `citext`; `name` is `text`.
    taken(CONSTRAINTS.email, (row) => citext(row.email) === citext(candidate.email));
    taken(CONSTRAINTS.name, (row) => row.name === candidate.name);
    taken(CONSTRAINTS.tag, (row) => citext(row.tag) === citext(candidate.tag));
    taken(CONSTRAINTS.tagNormalized, (row) => citext(row.tagNormalized) === citext(candidate.tagNormalized));
  };

  const toStored = (row: SeedUser): StoredUser => ({
    id: row.id,
    privyDid: row.privyDid,
    name: row.name,
    email: row.email,
    tag: row.tag,
    tagNormalized: row.tagNormalized,
  });

  const fromProfile = (profile: NewUserProfile): SeedUser => ({
    id: freshId(),
    privyDid: profile.privyDid,
    name: profile.name,
    email: profile.email,
    tag: profile.tag,
    tagNormalized: profile.tag,
  });

  const users: UserStore = {
    async findByPrivyDid(privyDid) {
      calls.push({ op: 'findByPrivyDid', privyDid });
      const row = rows.find((candidate) => candidate.privyDid === privyDid);
      return row === undefined ? null : toStored(row);
    },

    async findByEmail(email) {
      calls.push({ op: 'findByEmail', email });
      const wanted = citext(email);
      const row = rows.find((candidate) => citext(candidate.email) === wanted);
      return row === undefined ? null : toStored(row);
    },

    async upsert(profile) {
      calls.push({ op: 'upsert', profile });
      profiles.push(profile);
      const existing = rows.find((row) => row.privyDid === profile.privyDid);
      // The live statement's conflict branch is a no-op on every column but
      // `email_verified_at`, which it reassigns to itself. So: return the row.
      if (existing !== undefined) return toStored(existing);

      const candidate = fromProfile(profile);
      assertUnique(candidate, null);
      rows.push(candidate);
      return toStored(candidate);
    },

    async adoptPrivyDid(id, privyDid) {
      calls.push({ op: 'adoptPrivyDid', id, privyDid });
      const index = rows.findIndex((row) => row.id === id);
      const current = rows[index];
      if (current === undefined) {
        throw new Error(`no users row returned while adopting ${privyDid} on the account ${id}`);
      }
      // Only the DID changes. That is the whole contract, and the fake enforces it
      // by building the next row from the current one.
      const next: SeedUser = { ...current, privyDid };
      assertUnique(next, id);
      rows[index] = next;
      return toStored(next);
    },

    async create(profile) {
      calls.push({ op: 'create', profile });
      profiles.push(profile);
      const candidate = fromProfile(profile);
      assertUnique(candidate, null);
      rows.push(candidate);
      return toStored(candidate);
    },
  };

  return { users, calls, profiles, rows: () => [...rows] };
};