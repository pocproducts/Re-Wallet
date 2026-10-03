/**
 * ADAPTER: which wallets does Privy say this person owns?
 *
 * ── It reads the SAME record `privyUserDirectory` reads ───────────────────────
 *
 * `client.users._get(privyDid)` — `resources/users/users.d.ts:60-63` documents it
 * by example, and the underscore is a naming collision with the older
 * token-based `users().get({ id_token })`, not a privacy boundary (see the
 * header of `privyUserDirectory`). One fetch, one record, two facts read out of
 * it: the mailbox for the session and the wallets for the claim.
 *
 * ── Where the wallets actually are ────────────────────────────────────────────
 *
 * The installed `User` type carries **no** `wallets` field
 * (`resources/users/users.d.ts:1051`: `linked_accounts`, `linked_mfa_methods`, …).
 * The embedded wallets are entries **inside `linked_accounts`**, and the ones
 * that matter are `LinkedAccountEthereumEmbeddedWallet` (`…/users.d.ts:587`) and
 * `LinkedAccountSolanaEmbeddedWallet` (`…/users.d.ts:840`):
 *
 * ```ts
 * { id: string | null, address: string, chain_type: 'ethereum' | 'solana',
 *   connector_type: 'embedded', wallet_client: 'privy', wallet_client_type: 'privy', … }
 * ```
 *
 * Two consequences, and both of them are the whole point of this file:
 *
 *  1. `id` is **the ownership evidence**. It is the id Privy stores against the
 *     user, so a wallet that appears here is one the person controls.
 *  2. A wallet owned by an app key quorum does **not** appear here. That is not
 *     an inference: it is the same production check that opened the bug, where
 *     the created wallets came back with `owner: null` and the user's record had
 *     `wallets: []`. Such a claim is rejected here, by construction, and not by
 *     a rule somebody wrote about it.
 *
 * ── Why an entry with no `id` is skipped and not guessed ──────────────────────
 *
 * `id` is `string | null` in the type. A `null` is not an ownership proof, so it
 * contributes nothing to the list. There is no fallback that reconstructs an id
 * from the address: an id this file cannot read is an id nobody may write.
 *
 * ── Why the fetched id is re-checked ──────────────────────────────────────────
 *
 * Same rule as `privyUserDirectory`: a lookup that returned somebody else's
 * record would otherwise lend their wallets to this session, so the id that comes
 * back must be the id that was asked for.
 */
import type { User } from '@privy-io/node';

import type { OwnedWallet, WalletOwnershipVerifier } from '../../domain/ports/wallet-ownership-verifier';
import { WALLET_CHAIN_ORDER } from '../../domain/wallet/chains';
import type { WalletChain } from '../../domain/wallet/chains';

/**
 * The minimal surface this adapter needs from the Privy users resource.
 *
 * Structural, exactly like `privyUserDirectory`, so the adapter is testable
 * offline. `PrivyClient.users` satisfies it.
 */
export interface PrivyUsersClient {
  users(): {
    _get(userId: string): Promise<Pick<User, 'id' | 'linked_accounts'>>;
  };
}

/** Raised when the provider cannot answer the ownership question. */
export class PrivyOwnershipUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Privy ownership lookup failed: ${reason}`, options);
    this.name = 'PrivyOwnershipUnavailable';
  }
}

/**
 * `did:privy:...` and nothing else.
 *
 * The third time this pattern is spelled out, in three adapters, on purpose: a
 * malformed identifier must never become a provider request.
 */
const DID_PATTERN = /^did:privy:[A-Za-z0-9._~-]{1,128}$/;

/**
 * Only the chains this product supports can come back out.
 *
 * A row the provider reports for a chain ReWALLET does not have is filtered
 * rather than cast, for the same reason `walletStore.pg.ts` filters unknown
 * `chain_type`: a cast would turn "the provider knows something we do not" into a
 * `WalletChain` the rest of the code would happily act on.
 */
const toWalletChain = (value: unknown): WalletChain | null =>
  (WALLET_CHAIN_ORDER as readonly unknown[]).includes(value) ? (value as WalletChain) : null;

/** `true` when the linked account carries a usable Privy wallet id. */
const walletIdOf = (account: object): string | null => {
  if (!('id' in account)) return null;
  const id = (account as { id: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export const createPrivyWalletOwnershipVerifier = (client: PrivyUsersClient): WalletOwnershipVerifier => ({
  async ownedBy(privyDid: string): Promise<readonly OwnedWallet[]> {
    if (!DID_PATTERN.test(privyDid)) {
      throw new PrivyOwnershipUnavailable('the owner key is not a Privy DID');
    }

    let user: Pick<User, 'id' | 'linked_accounts'>;
    try {
      user = await client.users()._get(privyDid);
    } catch (error) {
      // The reason stays server-side. The caller only learns that it failed, and
      // it fails: an unknown ownership answer is never treated as an empty one.
      throw new PrivyOwnershipUnavailable('user not found or lookup rejected', { cause: error });
    }

    if (user.id !== privyDid) {
      throw new PrivyOwnershipUnavailable('fetched user id does not match the requested DID');
    }

    const owned: OwnedWallet[] = [];
    for (const account of user.linked_accounts) {
      // The embedded wallets are the linked accounts of type `wallet`. The union
      // also contains external wallets of that type, and those have **no** `id`,
      // which `walletIdOf` turns into "not proof of anything" — exactly right.
      if (account.type !== 'wallet') continue;

      const chain = toWalletChain(account.chain_type);
      if (chain === null) continue;

      const providerWalletId = walletIdOf(account);
      if (providerWalletId === null) continue;

      const address = (account as { address?: unknown }).address;
      if (typeof address !== 'string' || address.length === 0) continue;

      owned.push({ providerWalletId, address, chain });
    }

    return owned;
  },
});
