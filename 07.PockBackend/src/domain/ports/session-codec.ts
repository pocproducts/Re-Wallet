/**
 * PORT: the session cookie, as a value.
 *
 * ── Why the token is opaque to everything above this port ─────────────────────
 *
 * Signing a JWT is cryptography, and the session-minting use case should not have
 * to know that the session is a signed token, nor which algorithm signs it. It
 * only needs "give me a token for this user" and "tell me who this token is for".
 *
 * ── Why the raw token is returned exactly once ────────────────────────────────
 *
 * It is minted here, handed to the HTTP layer, and written into an httpOnly
 * cookie. It is never persisted and never logged. If a second place ever asks for
 * it, that place is a bug.
 */
export interface SessionClaims {
  readonly userId: string;
  readonly privyDid: string;
}

export interface IssuedSession {
  /** The raw token. Goes straight into the cookie, once. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface SessionCodec {
  issue(claims: SessionClaims, now: Date): Promise<IssuedSession>;

  /**
   * `null` when the token is absent, malformed, badly signed or expired.
   *
   * A malformed token is a **normal** outcome, not an exception: it is what a
   * stale cookie in someone's browser looks like.
   */
  read(token: string, now: Date): Promise<SessionClaims | null>;
}