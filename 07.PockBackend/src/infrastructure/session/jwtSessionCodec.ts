/**
 * ADAPTER: the session token.
 *
 * ── Why the token is stateless ────────────────────────────────────────────────
 *
 * This POC has one session concept and no session list, no "active devices" screen
 * and no revocation push. A signed token carries everything `GET /api/auth/session`
 * needs and costs one HMAC verification, with no row to read and nothing to write
 * on every login. `rewallet.sessions` exists in the database and is deliberately
 * untouched by this Worker.
 *
 * The trade-off is explicit: **logging out is client-side.** `DELETE` clears the
 * cookie; a stolen token stays valid until it expires (30 days). When the product
 * needs server-side revocation, this port gains a lookup and nothing above it
 * changes — which is the reason it is a port.
 *
 * ── The cookie value is the JWT ───────────────────────────────────────────────
 *
 * The `rw1_` prefix is what makes a leaked token recognisable as a token in a log
 * or a screenshot. It carries no information.
 */
import { SignJWT, jwtVerify } from 'jose';

import type { IssuedSession, SessionClaims, SessionCodec } from '../../domain/ports/session-codec';

/** Recognisable in a log; carries nothing. */
export const SESSION_TOKEN_PREFIX = 'rw1_';

/** 30 days. Long enough to not nag, short enough to be a decision. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface JwtSessionCodecOptions {
  readonly secret: string;
  readonly ttlSeconds?: number;
}

export const createJwtSessionCodec = (options: JwtSessionCodecOptions): SessionCodec => {
  if (!options.secret) {
    throw new Error('SESSION_SECRET is not defined. Without it any token can be forged.');
  }

  const key = new TextEncoder().encode(options.secret);
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;

  return {
    async issue(claims: SessionClaims, now: Date): Promise<IssuedSession> {
      const expiresAt = new Date(now.getTime() + ttl * 1000);
      const jwt = await new SignJWT({ did: claims.privyDid })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.userId)
        .setIssuedAt(Math.floor(now.getTime() / 1000))
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(key);

      return { token: `${SESSION_TOKEN_PREFIX}${jwt}`, expiresAt };
    },

    async read(token: string, now: Date): Promise<SessionClaims | null> {
      if (!token.startsWith(SESSION_TOKEN_PREFIX)) return null;

      try {
        const { payload } = await jwtVerify(token.slice(SESSION_TOKEN_PREFIX.length), key, {
          algorithms: ['HS256'],
          currentDate: now,
        });
        if (typeof payload.sub !== 'string' || typeof payload['did'] !== 'string') return null;
        return { userId: payload.sub, privyDid: payload['did'] };
      } catch {
        // A malformed, tampered or expired cookie is a normal state, not an error.
        return null;
      }
    },
  };
};