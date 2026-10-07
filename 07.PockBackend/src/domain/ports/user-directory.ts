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
 * So the frontend sends **one** token, the access token, and this port turns the
 * DID that token proves into the authoritative user record. Nothing else has to
 * reach the server to find out who the person is.
 *
 * ── Why the port carries no credentials and no trust ───────────────────────────
 *
 * `lookup` receives an identifier and returns facts. It never decides whether the
 * caller is authenticated — that is `TokenVerifier`'s job, and it stays first. The
 * DID it receives is already a verified one, so the port holds nothing secret: an
 * attacker who learns a DID still needs a valid access token to make this call
 * happen. The use case then compares the DID that comes back against the verified
 * one, so a lookup that returned somebody else's record cannot lend its email to
 * this session.
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
   * Resolves the user behind a verified Privy DID.
   *
   * The DID is the Privy user id, so it addresses the record directly. It is an
   * identifier, not a credential: this port does not authenticate anybody, and the
   * DID it is handed has already been proven by `TokenVerifier`.
   *
   * **Throws** when the identifier is not a DID, when the user cannot be found, when
   * the record that comes back belongs to somebody else, or when the user has no
   * email linked. It never resolves with an invented address and never resolves with
   * a half-filled record: those are the two ways this port could quietly
   * reintroduce the placeholder it exists to remove.
   */
  lookup(privyDid: string): Promise<DirectoryUser>;
}
