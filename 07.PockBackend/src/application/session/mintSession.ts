/**
 * USE CASE: mint a ReWALLET session.
 *
 * Takes the access token Privy issued in the browser and returns **the raw
 * session token, once**, so the HTTP layer can put it in an httpOnly cookie.
 *
 * ── The order of the four things, and why ─────────────────────────────────────
 *
 *   1. Verify the access token → who the caller claims to be
 *   2. Look up the user          → who they actually are (email included)
 *   3. Resolve the account       → the row in `rewallet.users`, by DID then by email
 *   4. Issue the session         → the cookie payload
 *
 * Step 1 failing writes **nothing**. An unverified identity is exactly the bypass
 * the ordering exists to prevent, which is why verification is first and never in
 * parallel.
 *
 * Step 2 is separate from step 1 and cannot be merged into it, because the access
 * token genuinely does not carry an email (see `TokenVerifier`). It is also where
 * the DID is checked a second time: the DID from step 1 is the lookup key, and if
 * the record that comes back is not that same DID's, the provider resolved somebody
 * else and the login is refused. One token, one person, or nothing.
 *
 * Step 2 failing writes **nothing** either, and it fails **loudly**: a login whose
 * identity cannot be resolved is a 502 with the failing step in the log, never a row
 * carrying an invented address. That placeholder path is deleted, not narrowed.
 *
 * Step 4 comes before step 5 on purpose: issuing a session to someone with no
 * WALLETS RECORDED yet produces an account that logs in and sees an app with
 * nothing in it — which is a state the product can show and fix, unlike the state
 * this file used to produce.
 *
 * ── The account is resolved by DID and then by email ──────────────────────────
 *
 * Step 3 used to be a single upsert keyed on the DID, and that is the assumption
 * that produced a 401 for a real person: Privy rotated the DID, the row was left
 * holding one Privy no longer recognises, the upsert missed, and the insert
 * collided on `users_email_key`. Step 3 is now `resolveAccount`, which looks the
 * DID up, falls back to the mailbox, and **adopts** the new DID on the existing
 * row — keeping the id, the name and the tag — instead of trying to create a
 * second account for a mailbox that is already on file. See `resolveAccount`.
 *
 * ── Wallets are NOT provisioned here ─────────────────────────────────────────
 *
 * This file used to ask Privy for a wallet on every login. It does
 * not any more, and the reason is not a refactor: the wallets it created were
 * owned by an **app key quorum** (`owner: null`, `owner_id: "is5plzb8…"`) and the
 * person did not even list them. The right of withdrawal belonged to the app.
 *
 * So the browser creates the wallet — Privy gives client-side creations a user
 * owner — and the backend **verifies** it in a separate operation,
 * `POST /api/wallets/claim` (see `claimWalletsFor`).
 *
 * That makes the wallets step 3.5: announced as pending, and it **cannot fail this
 * login**. A person who is logged in and whose wallet could not be prepared is a
 * person who can still use the app and be told what is wrong; a login that fails
 * because a wallet provider is slow is a person locked out of their own account.
 *
 * ── Why the raw token is returned and not stored ───────────────────────────────
 *
 * It travels exactly one hop, from here to the cookie. It is never persisted and
 * never logged. A use case that logged it or returned it in a body would put the
 * authentication material in two places that do not need it.
 *
 * ── Why every step is logged ──────────────────────────────────────────────────
 *
 * Because a failure here has five possible causes and, without a step marker, all
 * five look identical from the outside: a 401. The `step` recorded before each
 * operation is what turns "login failed" into "login failed at
 * `session.user_upsert`".
 */
import { buildProfile } from '../user/buildProfile';
import { resolveAccount } from '../user/resolveAccount';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { SessionCodec } from '../../domain/ports/session-codec';
import type { TokenVerifier } from '../../domain/ports/token-verifier';
import type { UserDirectory } from '../../domain/ports/user-directory';
import type { UserStore } from '../../domain/ports/user-store';

export interface MintSessionDeps {
  readonly verify: TokenVerifier;
  /** The provider's own user record. Resolves the email. */
  readonly directory: UserDirectory;
  readonly users: UserStore;
  readonly sessions: SessionCodec;
  readonly log?: Logger;
}

export interface MintedSession {
  /** The raw token. Straight into the httpOnly cookie, and never repeated. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly userId: string;
  readonly privyDid: string;
}

/** The only stable identifiers a session carries. No token, no email. */
export interface MintSession {
  (accessToken: string, now?: Date): Promise<MintedSession>;
}

/** Raised when Privy rejects the token. Never surfaced with its reason. */
export class TokenRejected extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Privy token rejected: ${reason}`, options);
    this.name = 'TokenRejected';
  }
}

/**
 * Raised when the caller is authenticated but cannot be named.
 *
 * Distinct from `TokenRejected` because the answers must be distinct: a rejected
 * token is the person's problem and answers 401, while an unresolvable identity is
 * ours and answers 502. Collapsing them would tell a person to log in again when the
 * second attempt will fail identically.
 */
export class IdentityUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Identity could not be resolved: ${reason}`, options);
    this.name = 'IdentityUnavailable';
  }
}

export const mintSession = (deps: MintSessionDeps): MintSession => {
  const log = deps.log ?? noopLogger;

  return async (accessToken: string, now: Date = new Date()): Promise<MintedSession> => {
    let step = 'session.start';

    /**
     * The same resolution the wallet claim uses, so a login and a claim arriving
     * with the same mailbox can never end up on two different rows. `markStep`
     * keeps this use case's failure log accurate: the failing statement is the one
     * that named itself, whichever use case ran it. Built per call, because the
     * step marker below is per call too.
     */
    const resolve = resolveAccount({
      users: deps.users,
      log,
      stepPrefix: 'session',
      markStep: (marker) => { step = marker; },
    });

    log.log(step);

    try {
      // 1. Who the caller claims to be. Nothing is written before this succeeds.
      const identity = await deps.verify.verify(accessToken);
      step = 'session.token_verified';
      log.log(step, { privyDid: identity.privyDid });

      /**
       * 2. Who they actually are. Separate from step 1 because the access token has
       * no email claim to read, and after it — not instead of it — so that a
       * provider outage can never be mistaken for an authenticated caller. The DID
       * step 1 proved is the lookup key: nothing else needs to arrive from the
       * browser.
       */
      step = 'session.identity_lookup';
      const directoryUser = await deps.directory.lookup(identity.privyDid);
      step = 'session.identity_resolved';

      /**
       * The same DID in, the same DID out. It is the lookup key now, so this is no
       * longer a comparison between two independent proofs — it is the assertion
       * that the provider answered the question it was asked. A record belonging to
       * anybody else means the mailbox about to be written belongs to anybody else.
       */
      if (directoryUser.privyDid !== identity.privyDid) {
        throw new IdentityUnavailable('the fetched Privy user is not the DID the access token verified');
      }
      log.log(step, { privyDid: directoryUser.privyDid, hasDisplayName: directoryUser.displayName !== null });

      // 3. The account. Exists, adopts a rotated DID, or is created; never half-created.
      const account = await resolve(
        buildProfile({ privyDid: identity.privyDid, email: directoryUser.email, displayName: directoryUser.displayName }),
      );
      const user = account.user;
      step = 'session.user_ready';
      log.log(step, { userId: user.id, tag: user.tag, resolution: account.resolution });

      /**
       * 4. The wallets: announced, not created.
       *
       * There is nothing to await here on purpose. The wallet is created in the
       * browser and claimed in a separate request, and the claim is verified
       * against Privy on its own terms. This step exists so that a login log says
       * "the session is open, the wallets are still pending" instead of leaving a
       * reader to guess whether wallets were ever part of it.
       */
      step = 'session.wallets_pending';
      log.log(step, { userId: user.id, claimRequired: true });

      // 5. The session. The raw token is created here and leaves exactly once.
      step = 'session.issue';
      const issued = await deps.sessions.issue({ userId: user.id, privyDid: identity.privyDid }, now);
      log.log('session.issued', { userId: user.id, expiresAt: issued.expiresAt.toISOString() });

      return {
        token: issued.token,
        expiresAt: issued.expiresAt,
        userId: user.id,
        privyDid: identity.privyDid,
      };
    } catch (error) {
      /**
       * The step marker is the whole point of this catch: the reason goes to the
       * log, the caller only learns that it failed.
       */
      log.error('session.failed', {
        step,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
};