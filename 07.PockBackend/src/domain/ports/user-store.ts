/**
 * PORT: the row in `rewallet.users`.
 *
 * ── Why one `upsert` and not `find` + `create` ────────────────────────────────
 *
 * Because `find`-then-`create` has a window between the two, and in that window a
 * second request for the same person inserts a second row. `rewallet.users` has
 * `UNIQUE (privy_did)`, so the loser gets a constraint violation — which is a
 * confusing 500 for what is a completely normal double-click.
 *
 * The decision of *what to write* is still not the store's: the use case builds a
 * complete profile and the store just writes it.
 */
export interface StoredUser {
  readonly id: string;
  readonly privyDid: string;
  readonly name: string;
  readonly email: string;
  readonly tag: string;
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

export interface UserStore {
  /** Insert, or return the row that already exists for this DID. */
  upsert(profile: NewUserProfile): Promise<StoredUser>;
}