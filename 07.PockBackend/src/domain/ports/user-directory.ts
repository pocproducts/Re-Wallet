/**
 * PORT: ask the provider who the person actually is.
 *
 * ── Why this port exists at all ────────────────────────────────────────────────
 *
 * The access token cannot answer "what is this person's email". Verification proves
 * *who* the caller is — that is the DID, and that is all it carries: the SDK's own
 * payload reader enumerates `aud`, `iss`, `iat`, `exp`, `sid`, `sub` and nothing
 * else. Guessing at an undocumented `email` claim and, when it was absent, inventing
 * a placeholder address is what put fabricated rows into the design. Those rows
 * claim to be a mailbox and are not one.
 *
 * So the frontend now also sends Privy's **id token**, and this port turns it into
 * the authoritative user record.
 *
 * ── Why the port carries no credentials and no trust ───────────────────────────
 *
 * `lookup` receives an opaque token and returns facts. It never decides whether the
 * caller is authenticated — that is `TokenVerifier`'s job, and it stays first. The
 * use case compares the DID that comes back against the verified one, so a valid id
 * token belonging to somebody else cannot lend its email to this session.
 *
 * ── Why there is no `email: string | null` ─────────────────────────────────────
 *
 * Because the schema cannot represent it. `rewallet.users.email` is `NOT NULL` and
 * `UNIQUE`, so "we could not find out who this is" is not a row, it is a refused
 * login. The type makes that unrepresentable: the only way to get a `DirectoryUser`
 * is to have a real email in hand.
 */
export interface DirectoryUser {
  /** The Privy DID this record belongs to. Compared against the verified one. */
  readonly privyDid: string;

  /**
   * The real mailbox, exactly as the provider reports it.
   *
   * Written verbatim to `rewallet.users.email`. Not slugified, lowercased or
   * rewritten: a mailbox is somebody else's data and this column is the only place
   * the product keeps it.
   */
  readonly email: string;

  /**
   * A display name if the provider has one, `null` otherwise.
   *
   * `null` is a normal state, not a failure: `rewallet.users.name` is `NOT NULL`, so
   * `buildProfile` falls back to the email local part. It is display-only and never
   * an authorisation input.
   */
  readonly displayName: string | null;
}

export interface UserDirectory {
  /**
   * Resolves the user behind an id token.
   *
   * **Throws** when the token does not verify, when the user cannot be found, or when
   * the user has no email linked. It never resolves with an invented address and
   * never resolves with a half-filled record: those are the two ways this port could
   * quietly reintroduce the placeholder it exists to remove.
   */
  lookup(idToken: string): Promise<DirectoryUser>;
}
