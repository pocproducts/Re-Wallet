/**
 * PORT: the row in `rewallet.users`.
 *
 * ── One email, one account ───────────────────────────────────────────────────
 *
 * The live table is `users(id uuid pk, privy_did text not null unique, name text
 * not null unique, tag citext not null unique, tag_normalized citext not null
 * unique, email citext not null unique, email_verified_at timestamptz not null)` —
 * four `UNIQUE` columns, and the email is the one the person actually **proves**
 * by receiving a code in it. The DID is a technical identifier the provider is
 * free to rotate, and it demonstrably does: a real login arrived with a DID Privy
 * no longer knew, the `ON CONFLICT (privy_did)` insert therefore missed, and the
 * write died on `users_email_key` with a 401 to a legitimate person.
 *
 * So the port no longer offers a single `upsert` that has to be clever enough to
 * be correct. It offers the **steps** — find by DID, find by email, adopt,
 * update, insert — and the decision (which of them to take) lives in
 * `resolveAccount`, in the application layer, where it is readable and testable
 * with no database. That split is the whole point of the port.
 *
 * ── Why `upsert` survives anyway ─────────────────────────────────────────────
 *
 * Because "DID is known → touch that row" still has a window, and two logins for
 * the same person inside it mean one of them gets a constraint violation — a 500
 * for a completely ordinary double click. `ON CONFLICT (privy_did) DO UPDATE`
 * absorbs that one specific race without inventing anything, so it stays.
 *
 * ── Why `tag` is never regenerated ───────────────────────────────────────────
 *
 * `tag` is a handle shown to people and referenced by everything that mentions a
 * person. `create` and `adoptPrivyDid` are therefore not symmetric: `create`
 * derives a fresh `name`/`tag`/`tag_normalized` from `NewUserProfile`, while
 * `adoptPrivyDid` writes **only** `privy_did`. Rotating a technical identifier
 * must not rename a human.
 *
 * ── Mailboxes compare case-insensitively ─────────────────────────────────────
 *
 * `rewallet.users.email` is `citext`, so `Ana@Example.com` and `ana@example.com`
 * are the same mailbox to Postgres. A resolver that compared them with `===` would
 * treat a provider-side casing change as a second person and refuse a valid login.
 */
export interface StoredUser {
  readonly id: string;
  readonly privyDid: string;
  readonly name: string;
  readonly email: string;
  readonly tag: string;
  /** The live `tag_normalized` column, read so adoption can be asserted on it. */
  readonly tagNormalized: string;
}

export interface NewUserProfile {
  readonly privyDid: string;
  /**
   * The person's real mailbox, as the provider reports it.
   *
   * `rewallet.users.email` is `NOT NULL`, `UNIQUE` and format-checked, so a profile
   * without one is not representable. It is fetched from Privy's user record, not
   * guessed: when the lookup cannot produce it, the login is refused instead of
 * writing an invented address — see `UserDirectory` and `buildProfile`.
   */
  readonly email: string;
  /**
   * Display-only, and `UNIQUE` too.
   *
   * `buildProfile` writes the same value it writes to `tag` precisely because a
   * free-text provider name is neither deterministic nor collision-free.
   */
  readonly name: string;
  /** Lowercase, matching `USER_TAG_PATTERN` in the existing schema. */
  readonly tag: string;
}

/**
 * Raised by the adapter when Postgres refuses a write on a `UNIQUE` constraint
 * (SQLSTATE 23505) that this flow cannot absorb.
 *
 * It exists so a race between two logins surfaces as a **named, logged condition**
 * instead of a 500 carrying a driver message. The message a driver produces names
 * a table and an index to a browser; this names a condition to a log reader.
 *
 * `constraint` is the Postgres constraint name, kept for diagnosis and never sent
 * to a client.
 */
export class UserStoreConflict extends Error {
  readonly constraint: string;

  constructor(constraint: string, options?: { cause?: unknown }) {
    super(`rewallet.users write refused by a unique constraint: ${constraint}`, options);
    this.name = 'UserStoreConflict';
    this.constraint = constraint;
  }
}

export interface UserStore {
  /** The row filed under this DID, or `null`. */
  findByPrivyDid(privyDid: string): Promise<StoredUser | null>;

  /**
   * The row holding this mailbox, or `null`.
   *
   * Case-insensitive, because the column is `citext`. This is the lookup that
   * turns a rotated DID into the same account instead of a second person.
   */
  findByEmail(email: string): Promise<StoredUser | null>;

  /** Insert, or return the row that already exists for this DID. */
  upsert(profile: NewUserProfile): Promise<StoredUser>;

  /**
   * Point an existing row at a new DID.
   *
   * **Only `privy_did` is written.** `name`, `tag` and `tag_normalized` are left
   * exactly as they are: they are a person's handle, not a function of the DID,
   * and regenerating them because a provider rotated a technical identifier would
   * break every existing reference to that person.
   */
  adoptPrivyDid(id: string, privyDid: string): Promise<StoredUser>;

  /** Insert a row that provably does not exist yet. Plain insert, no upsert. */
  create(profile: NewUserProfile): Promise<StoredUser>;
}