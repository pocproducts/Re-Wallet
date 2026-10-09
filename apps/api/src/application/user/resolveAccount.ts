/**
 * USE CASE: one email address, one account — no matter which DID Privy files it
 * under today.
 *
 * ── The rule, and why it is this rule ────────────────────────────────────────
 *
 * The email is the stable identity. It is the thing the person **proves** by
 * receiving a code in it. The DID is a technical identifier the provider is free
 * to rotate, and it demonstrably does: in production the row was left holding a
 * DID Privy no longer recognised, the lookup-by-DID missed, and the insert died
 * on `users_email_key` — a 401 for someone who had just proved they own the
 * mailbox.
 *
 * So, in order, and never as one clever statement:
 *
 *   1. DID known        → update that account, exactly as before
 *   2. DID unknown, email known → the row **adopts** the new DID
 *   3. neither known    → create the account
 *   4. DID known, email different → **refuse**: `IdentityConflict`
 *
 * Two people cannot collide on step 2: reaching it requires having received the
 * code sent to that address, and it only ever rewrites `privy_did` on a row that
 * already holds that mailbox.
 *
 * ── Why the statements are separate ───────────────────────────────────────────
 *
 * Because a single `INSERT ... ON CONFLICT` cannot express this. The interesting
 * branch — "the DID is gone but the person is not" — needs a **read** to discover,
 * and a read is what tells an adoption apart from an ordinary update in the log.
 * A statement that hides that decision also hides it from the person reading the
 * log at 3am.
 *
 * ── What adoption does NOT do ────────────────────────────────────────────────
 *
 * It does not regenerate `name`, `tag` or `tag_normalized`. Those are a person's
 * handle; the DID is not. It does not touch `email` either: the mailbox is the
 * identity being matched, and a row already holding it gains nothing from having
 * it rewritten in a different case.
 */
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { NewUserProfile, StoredUser, UserStore } from '../../domain/ports/user-store';

/** How the account was found. The three answers a caller can act on differently. */
export type AccountResolution =
  /** The DID was already on file: an ordinary re-login. */
  | 'existing'
  /** The DID rotated; the row kept its handle and adopted the new DID. */
  | 'adopted'
  /** Neither DID nor mailbox was on file: a genuinely new account. */
  | 'created';

export interface ResolvedAccount {
  readonly user: StoredUser;
  readonly resolution: AccountResolution;
  /** Set only when `resolution` is `adopted`: the DID this account was filed under. */
  readonly previousPrivyDid?: string;
}

/**
 * Raised when the DID is known but the mailbox Privy reports is not the one on
 * file. Rule 4, failing closed.
 *
 * Distinct from `TokenRejected` (the person is authenticated) and from
 * `IdentityUnavailable` (the lookup worked; this is a contradiction between two
 * verified facts). Overwriting the stored mailbox would be the one move that can
 * silently move somebody else's account to somebody else's inbox, so it is not
 * taken — the login fails and the reason goes to the log.
 *
 * The message names the two DIDs and never the mailboxes: the log is read by
 * humans and shipped to aggregators, and a mailbox is neither needed nor
 * appropriate there.
 */
export class IdentityConflict extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Account identity conflict: ${reason}`, options);
    this.name = 'IdentityConflict';
  }
}

/** `citext` semantics: trimmed and case-insensitive, because that is the column. */
const sameMailbox = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface ResolveAccountDeps {
  readonly users: UserStore;
  readonly log?: Logger;
  /**
   * Namespace for the step markers and log lines, so the session flow says
   * `session.*` and the wallet-claim flow says `wallets.*` for the same decision.
   */
  readonly stepPrefix: string;
  /**
   * Called with the step marker **before** each statement runs.
   *
   * This exists so a caller that keeps a `step` variable for its own error log
   * stays accurate: without it, a failure inside this use case would be reported
   * against whichever step the caller happened to be on, which is exactly the
   * "five causes, one indistinguishable 401" problem the step markers exist to
   * remove.
   */
  readonly markStep?: (step: string) => void;
}

export interface ResolveAccount {
  (profile: NewUserProfile): Promise<ResolvedAccount>;
}

/**
 * Resolves a verified login to exactly one row of `rewallet.users`.
 *
 * Takes an already-built profile, so the caller keeps the guarantee that a real
 * mailbox is required (`buildProfile` throws before this is reached) and this
 * function has no way to invent one either: `NewUserProfile` cannot be built
 * without an email.
 */
export const resolveAccount = (deps: ResolveAccountDeps): ResolveAccount => {
  const log = deps.log ?? noopLogger;
  const prefix = deps.stepPrefix;

  return async (profile: NewUserProfile): Promise<ResolvedAccount> => {
    const step = (name: string): string => {
      const marker = `${prefix}.${name}`;
      deps.markStep?.(marker);
      return marker;
    };

    // 1. Does this DID already name an account?
    const byDid = await deps.users.findByPrivyDid(profile.privyDid);

    if (byDid !== null) {
      // 4. Same DID, different mailbox: a contradiction, refused rather than resolved.
      if (!sameMailbox(byDid.email, profile.email)) {
        throw new IdentityConflict(
          `the account filed under ${profile.privyDid} is not the mailbox Privy reports for it; ` +
            'the stored address was not overwritten',
        );
      }
      // 1. The ordinary re-login. Still an upsert, so two simultaneous logins for
      //    one person resolve to one row instead of a unique violation.
      step('user_update');
      const user = await deps.users.upsert(profile);
      log.log(`${prefix}.account_existing`, { resolution: 'existing', userId: user.id, tag: user.tag });
      return { user, resolution: 'existing' };
    }

    // 2. The DID is unknown. Is the person known anyway?
    const byEmail = await deps.users.findByEmail(profile.email);

    if (byEmail !== null) {
      // 2. Adoption. `adoptPrivyDid` writes the DID and nothing else, so the
      //    handle, the id and every wallet keyed by that id survive untouched.
      step('user_adopt_did');
      const user = await deps.users.adoptPrivyDid(byEmail.id, profile.privyDid);
      const previousPrivyDid = byEmail.privyDid;
      log.log(`${prefix}.account_adopted`, {
        resolution: 'adopted',
        userId: user.id,
        tag: user.tag,
        previousPrivyDid,
        privyDid: profile.privyDid,
      });
      return { user, resolution: 'adopted', previousPrivyDid };
    }

    // 3. Neither the identifier nor the mailbox is on file: a new account.
    step('user_insert');
    const user = await deps.users.create(profile);
    log.log(`${prefix}.account_created`, { resolution: 'created', userId: user.id, tag: user.tag });
    return { user, resolution: 'created' };
  };
};