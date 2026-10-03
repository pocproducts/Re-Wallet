/**
 * ADAPTER: the authoritative Privy user, fetched by id token.
 *
 * ── Why the access token was not enough ───────────────────────────────────────
 *
 * `privyTokenVerifier` used to guess an `email` claim out of the verified access
 * token. It is not there: `lib/auth.d.ts` reads `aud`, `iss`, `iat`, `exp`, `sid`
 * and `sub`, so the guess failed on every login and the caller fell back to
 * a fabricated address. The identity was never in the access token. It is in the user
 * record, and the id token is what unlocks that record.
 *
 * ── What this calls, and where the shape comes from ───────────────────────────
 *
 * `client.users().get({ id_token })` —
 * `public-api/services/users.d.ts:19`, whose input type is
 * `PrivyUsersService.GetInput = { id_token: string }` (`…users.d.ts:21-24`). The SDK
 * verifies the token itself: "This verifies the token and parses the payload into a
 * `User` object" (`…users.d.ts:9`).
 *
 * The returned `User` (`resources/users/users.d.ts:1037`) has **no** `email` field
 * and **no** display-name field. Its identity lives in `linked_accounts`, whose email
 * variant is `LinkedAccountEmail { address, first_verified_at, latest_verified_at,
 * type: 'email', verified_at }` (`…users.d.ts:510-516`). That is the only place an
 * email exists, and it is what is read here.
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
 * The minimal surface this adapter needs from the Privy users service.
 *
 * Structural, so the adapter is testable offline. `PrivyClient` satisfies it.
 */
export interface PrivyUsersClient {
  users(): {
    get(input: { id_token: string }): Promise<Pick<User, 'id' | 'linked_accounts'>>;
  };
}

/** Raised when the provider cannot name the person. Never carries a real address. */
export class PrivyIdentityUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Privy user lookup did not yield an identity: ${reason}`, options);
    this.name = 'PrivyIdentityUnavailable';
  }
}

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
  async lookup(idToken: string): Promise<DirectoryUser> {
    if (!idToken || idToken.split('.').length !== 3) {
      throw new PrivyIdentityUnavailable('id token does not look like a JWT');
    }

    let user: Pick<User, 'id' | 'linked_accounts'>;
    try {
      user = await client.users().get({ id_token: idToken });
    } catch (error) {
      // The reason stays server-side. The caller learns only that it failed.
      throw new PrivyIdentityUnavailable('id token rejected or user not found', { cause: error });
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
