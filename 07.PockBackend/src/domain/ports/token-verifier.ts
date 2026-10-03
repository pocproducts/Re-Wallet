/**
 * PORT: verify the access token issued by Privy.
 *
 * ── What arrives here ─────────────────────────────────────────────────────────
 *
 * The browser calls Privy directly (`sendCode` → `loginWithCode`) and hands us
 * the access token that Privy issued afterwards. The 6-digit code **never reaches
 * this server**: Privy verified it, not us.
 *
 * ── Why the DID is the only thing we keep ─────────────────────────────────────
 *
 * Everything else in the token is a fact about a session, not about a person. The
 * DID (`sub`) is the identifier the rest of the system recognises.
 *
 * ── Why there is no email claim ───────────────────────────────────────────────
 *
 * Because there isn't one. The SDK's own payload reader enumerates `aud`, `iss`,
 * `iat`, `exp`, `sid` and `sub`, and nothing else. A previous version of this port
 * carried an optional `email` that the SDK never populated, which is how the login
 * ended up inventing a placeholder address for the database.
 *
 * The mailbox is a **profile fact, not an authentication fact**, and profile facts
 * are read from the provider's user record (`UserDirectory`) after this returns.
 */
export interface VerifiedIdentity {
  /** The Privy DID. It lives in the standard `sub` claim. */
  readonly privyDid: string;
}

export interface TokenVerifier {
  /**
   * Resolves with the identity if the token is valid and current.
   *
   * **Throws** if it is not — bad signature, wrong app, expired, wrong shape.
   * It does not return `null`: `null` and "rejected" are indistinguishable at the
   * call site, and that confusion is exactly where a bypass would live.
   *
   * The reason is for the log, never for the person: every rejection produces the
   * same 401.
   */
  verify(accessToken: string): Promise<VerifiedIdentity>;
}