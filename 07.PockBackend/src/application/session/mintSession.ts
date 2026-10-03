/**
 * USE CASE: mint a ReWALLET session.
 *
 * Takes the access token Privy issued in the browser and returns **the raw
 * session token, once**, so the HTTP layer can put it in an httpOnly cookie.
 *
 * ── The order of the five things, and why ─────────────────────────────────────
 *
 *   1. Verify the access token → who the caller claims to be
 *   2. Look up the user          → who they actually are (email included)
 *   3. Find or create            → the row in `rewallet.users`
 *   4. Provision the wallets     → EVM first, then Solana
 *   5. Issue the session         → the cookie payload
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
 * wallets produces an account that logs in and sees an empty app.
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
 * `session.wallets`".
 */
import { buildProfile } from '../user/buildProfile';
import type { ProvisionWalletsFor } from '../provision-wallet/provisionWalletsFor';
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
  readonly provisionWallets: ProvisionWalletsFor;
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

      // 3. The account. Exists or is created; never half-created.
      step = 'session.user_upsert';
      const user = await deps.users.upsert(
        buildProfile({ privyDid: identity.privyDid, email: directoryUser.email, displayName: directoryUser.displayName }),
      );
      step = 'session.user_ready';
      log.log(step, { userId: user.id, tag: user.tag });

      // 4. The wallets, in the order owned by the use case.
      step = 'session.wallets_provision';
      const wallets = await deps.provisionWallets({ ownerDid: identity.privyDid, userId: user.id });
      step = 'session.wallets_ready';
      log.log(step, {
        count: wallets.length,
        order: wallets.map((wallet) => wallet.chain),
      });

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