/**
 * `/api/auth/session` — the door.
 *
 * Three operations on the same thing:
 *
 * - `POST`   issue a session from a Privy access token
 * - `GET`    say whether the current cookie is good
 * - `DELETE` close it
 *
 * The body of `POST` is `{ accessToken }` and nothing else. There is no onboarding
 * form any more, so there is no `name` and no `phone` to accept.
 *
 * ── Why one token and not two ──────────────────────────────────────────────────
 *
 * The access token is the authority on *who is calling* — it is verified, and only
 * it is. Its DID is also the key to the provider's user record, where the mailbox
 * lives, because the access token carries no email claim at all. So the frontend
 * sends one token and the backend derives everything else.
 *
 * It used to also require a second, provider-specific token as a lookup key. That
 * key is redundant: the verified DID already addresses the user record, so the
 * requirement is gone rather than worked around.
 */
import { Hono } from 'hono';

import { IdentityUnavailable, type MintSession } from '../../../application/session/mintSession';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { accountConflict } from '../errors';
import {
  buildSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from '../cookie';

export const UNAUTHENTICATED_BODY = { error: { code: 'UNAUTHENTICATED' } } as const;

/**
 * The other failure, kept distinct on purpose.
 *
 * 401 says "we do not believe you"; 502 says "we believe you and we could not finish".
 * A person cannot fix a 502 by logging in again, and telling them to would be a lie
 * about the cause. The step that died is in the log; the code is all they get.
 */
export const IDENTITY_UNAVAILABLE_BODY = { error: { code: 'IDENTITY_UNAVAILABLE' } } as const;

export interface AuthDeps {
  readonly mint: MintSession;
  readonly sessions: SessionCodec;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createAuthRoutes = (deps: AuthDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  /**
   * `POST /auth/session`
   *
   * **The response body is empty on purpose.** The token travels in the httpOnly
   * cookie and nowhere else; returning it in the body too would put it back in
   * reach of any script on the page, which is precisely what `HttpOnly` exists to
   * prevent.
   */
  app.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
    }

    const parsed = body as Record<string, unknown> | null;
    const accessToken = parsed?.['accessToken'];

    // One required field. A login with no verified access token has no DID and
    // therefore no identity to look up, so it never reaches the use case.
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
    }

    try {
      const minted = await deps.mint(accessToken, clock());
      const maxAge = Math.floor((minted.expiresAt.getTime() - clock().getTime()) / 1000);
      c.header('Set-Cookie', buildSessionCookie(minted.token, cookieName, maxAge));

      // 204, not 200 with a payload: there is nothing in the body to send.
      return c.body(null, 204);
    } catch (error) {
      /**
       * Authenticated but unnameable is not an authentication failure. It is also
       * **not** swallowed into the 401: that is the path that used to answer when the
       * identity could not be resolved, and it told the person to try again forever.
       */
      if (error instanceof IdentityUnavailable) {
        log.error('POST /auth/session could not resolve an identity', error);
        return c.json(IDENTITY_UNAVAILABLE_BODY, 502);
      }

      /**
       * Authenticated, and the account cannot be resolved without contradicting
       * something. Answered as a conflict, never as the 401 below: a 401 sends
       * the browser round the login loop, and a DID whose stored mailbox is not
       * the one that just logged in fails identically on every attempt.
       */
      const conflict = accountConflict(error, c, log);
      if (conflict !== null) return conflict;

      // A Privy token that does not verify is an invalid token. The person sees
      // exactly what a dead cookie looks like; the reason stays in the log.
      log.error('POST /auth/session rejected', error);
      return c.json(UNAUTHENTICATED_BODY, 401);
    }
  });

  /**
   * `GET /auth/session`
   *
   * The minimum: `{ authenticated: true }`. No user id, no email, no expiry — the
   * front asks "is there a session?", not "who am I?".
   */
  app.get('/', async (c) => {
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) {
      return c.json(UNAUTHENTICATED_BODY, 401);
    }

    // A malformed or expired cookie is a normal state, not an error to report.
    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) {
      return c.json(UNAUTHENTICATED_BODY, 401);
    }

    return c.json({ authenticated: true }, 200);
  });

  /**
   * `DELETE /auth/session`
   *
   * No session guard on purpose: logging out has to work precisely when the
   * cookie is already dead.
   */
  app.delete('/', (c) => {
    c.header('Set-Cookie', clearSessionCookie(cookieName));
    return c.body(null, 204);
  });

  return app;
};