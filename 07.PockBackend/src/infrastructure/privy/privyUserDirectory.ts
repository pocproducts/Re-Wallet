/**
 * ADAPTER: the authoritative Privy user, fetched by DID.
 *
 * ── Why the DID and not a token ───────────────────────────────────────────────
 *
 * `privyTokenVerifier` used to guess an `email` claim out of the verified access
 * token. It is not there: `lib/auth.d.ts` reads `aud`, `iss`, `iat`, `exp`, `sid`
 * and `sub`, so the guess failed on every login and the caller fell back to
 * a fabricated address. The identity was never in the access token. It is in the user
 * record, and that record is addressable by the very identifier the verified token
 * already proved: the DID in `sub`.
 *
 * So nothing extra has to reach this server. The frontend sends one token, the
 * backend verifies it once, and the DID it yields is both the lookup key and the
 * cross-check. A second token would be a second way to be wrong.
 *
 * ── What this calls, and where the shape comes from ───────────────────────────
 *
 * `client.users._get(privyDid)` —
 * `resources/users/users.d.ts:60-63` documents it by example:
 *
 * ```ts
 * const user = await client.users._get('user_id');
 * ```
 *
 * The method is underscore-prefixed in `@privy-io/node@0.35.0` because it shadows
 * the older token-based `users().get({ id_token })` service. The underscore is a
 * naming collision, not a privacy boundary: this is the SDK's own documented-by-
 * example path for a single user by Privy user id, and the DID is that id.
 * `UserListParams` (`…users.d.ts`) extends only `CursorParams` and has no id
 * filter, so there is nothing to filter a list with instead.
 *
 * The returned `User` has **no** `email` field and **no** display-name field. Its
 * identity lives in `linked_accounts`, whose email variant is
 * `LinkedAccountEmail { address, first_verified_at, latest_verified_at, type: 'email',
 * verified_at }`. That is the only place an email exists, and it is what is read
 * here.
 *
 * ── Why the fetched id is re-checked here and again in the use case ────────────
 *
 * Because a lookup that returns somebody else's record is the one failure this
 * file cannot detect by looking at the email. `user.id` is compared against the
 * DID that was asked for, in the adapter (fail fast) and against the verified DID
 * in `mintSession` (defence in depth). Neither is a formality.
 *
 * ── Why there is no fallback ──────────────────────────────────────────────────
 *
 * A user with no linked email produces a `PrivyIdentityUnavailable`, not an
 * invention. There is no reserved-TLD address here and no way to reach one: a login
 * that cannot name the person must not create a row claiming it can.
 */
import type { User } from '@privy-io/node';

import type { DirectoryUser, UserDirectory } from '../../domain/ports/user-directory';

/**
 * The minimal surface this adapter needs from the Privy users resource.
 *
 * Structural, so the adapter is testable offline. `PrivyClient.users` satisfies it.
 */
export interface PrivyUsersClient {
  users(): {
    _get(userId: string): Promise<Pick<User, 'id' | 'linked_accounts'>>;
  };
}

/** Raised when the provider cannot name the person. Never carries a real address. */
export class PrivyIdentityUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Privy user lookup did not yield an identity: ${reason}`, options);
    this.name = 'PrivyIdentityUnavailable';
  }
}

/**
 * `did:privy:...` and nothing else.
 *
 * The same shape `privyTokenVerifier` enforces on the verified token. Repeating it
 * here is cheap and keeps a malformed identifier from ever becoming a provider
 * request.
 */
const DID_PATTERN = /^did:privy:[A-Za-z0-9._~-]{1,128}$/;

/** The one linked account that can produce `rewallet.users.email`. */
const emailAddressOf = (user: Pick<User, 'linked_accounts'>): string | null => {
  for (const account of user.linked_accounts) {
    if (account.type !== 'email') continue;
    const address = account.address?.trim();
    if (address !== undefined && address.length > 0 && address.length <= 320) {
      return address;
    }
  }
  return null;
};

/**
 * The display name, when the payload carries one.
 *
 * The installed `User` type has no such field, so this is `null` today. It is read
 * anyway because the shape of a provider's response is not this file to legislate:
 * when Privy adds a name, it starts being stored without another migration.
 */
const displayNameOf = (user: Pick<User, 'linked_accounts'>): string | null => {
  const record = user as unknown as Record<string, unknown>;
  for (const key of ['name', 'display_name'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0 && value.length <= 120) {
      return value.trim();
    }
  }
  return null;
};

export const createPrivyUserDirectory = (client: PrivyUsersClient): UserDirectory => ({
  async lookup(privyDid: string): Promise<DirectoryUser> {
    if (!DID_PATTERN.test(privyDid)) {
      throw new PrivyIdentityUnavailable('lookup key is not a Privy DID');
    }

    let user: Pick<User, 'id' | 'linked_accounts'>;
    try {
      user = await client.users()._get(privyDid);
    } catch (error) {
      // The reason stays server-side. The caller learns only that it failed.
      throw new PrivyIdentityUnavailable('user not found or lookup rejected', { cause: error });
    }

    /**
     * The record must be the one that was asked for. If it is not, this lookup
     * resolved somebody else's mailbox and the login is refused rather than
     * written.
     */
    if (user.id !== privyDid) {
      throw new PrivyIdentityUnavailable('fetched user id does not match the requested DID');
    }

    const email = emailAddressOf(user);
    if (email === null) {
      /**
       * The whole point. No email, no row: `rewallet.users.email` is `NOT NULL` and
       * `UNIQUE`, and a made-up address satisfies it while telling the truth to
       * nobody.
       */
      throw new PrivyIdentityUnavailable('user has no linked email account');
    }

    return { privyDid: user.id, email, displayName: displayNameOf(user) };
  },
});