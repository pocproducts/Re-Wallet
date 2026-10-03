/**
 * ADAPTER: create wallets with Privy.
 *
 * ── The only thing it knows ───────────────────────────────────────────────────
 *
 * How to ask the provider for a wallet. **It does not know the order, does not
 * know how many there are, and does not know that a "one per chain" rule exists:**
 * it receives a chain and returns a wallet. Everything else belongs to
 * `provisionWalletsFor`.
 *
 * ── The chain type translation ────────────────────────────────────────────────
 *
 * `WalletChain` is ours; Privy's is `WalletChainType`. The `switch` is exhaustive
 * on purpose: if the provider ever adds a chain, TypeScript stops compiling here,
 * and this file is exactly where that decision belongs.
 *
 * ── `owner: { user_id }`, and not `owner_id` ──────────────────────────────────
 *
 * `WalletCreateParams` (`@privy-io/node/resources/wallets/wallets.d.ts:4218`) offers
 * two owner fields and they mean different things:
 *
 * - `owner?: SharedAPI.OwnerInput` — declared at `…/wallets.d.ts:4245`, typed
 *   `OwnerInput` at `…/resources/shared.d.ts:70`, documented as "The owner of the
 *   resource, specified as a **Privy user ID**, a P-256 public key, or null to
 *   remove the current owner". The user variant is `OwnerInputUser`
 *   (`…/shared.d.ts:83-85`): `{ user_id: string }`.
 * - `owner_id?: SharedAPI.OwnerIDInput` — declared at `…/wallets.d.ts:4250`, typed
 *   `OwnerIDInput` at `…/resources/shared.d.ts:65`, documented as "The **key quorum
 *   ID** to set as the owner of the resource. If you provide this, do not specify an
 *   owner."
 *
 * So `owner_id` is the key-quorum channel and `owner.user_id` is the user channel.
 * This adapter is assigning a wallet to an authenticated **person**, so it uses the
 * form documented for users. Both are typed `string`-shaped (`OwnerIDInput` is
 * `string | null`), which is exactly why the bare DID compiled cleanly while meaning
 * something else entirely — the type system cannot tell a key quorum id from a DID.
 */
import type { Wallet } from '@privy-io/node';

import type {
  ProvisionWalletInput,
  ProvisionedWallet,
  WalletProvisioner,
} from '../../domain/ports/wallet-provisioner';
import type { WalletChain } from '../../domain/wallet/chains';

/** Privy's name for a chain. The mapping is total and closed. */
const toPrivyChainType = (chain: WalletChain): 'ethereum' | 'solana' => {
  switch (chain) {
    case 'ethereum':
      return 'ethereum';
    case 'solana':
      return 'solana';
    default: {
      const unreachable: never = chain;
      throw new Error(`No Privy translation for chain: ${String(unreachable)}`);
    }
  }
};

/**
 * The minimal surface this adapter needs from the Privy wallets service.
 *
 * Declared structurally instead of importing `PrivyClient`, for the same reason
 * `privyTokenVerifier` does it: the adapter is only testable offline if the client
 * can be a stub. `PrivyClient` satisfies this interface exactly.
 */
export interface PrivyWalletsClient {
  wallets(): {
    create(params: {
      chain_type: 'ethereum' | 'solana';
      owner: { user_id: string };
      idempotency_key: string;
    }): Promise<Wallet>;
  };
}

export const createPrivyWalletProvisioner = (client: PrivyWalletsClient): WalletProvisioner => ({
  async provision(input: ProvisionWalletInput): Promise<ProvisionedWallet> {
    const wallet: Wallet = await client.wallets().create({
      chain_type: toPrivyChainType(input.chain),
      /**
       * `owner.user_id` carries the person's Privy DID, which is what guarantees
       * that only that authenticated person controls the wallet. Writing the wrong
       * owner produces a wallet the *app* controls, and nobody notices until
       * somebody tries to withdraw from it.
       *
       * The object form, not the bare string in `owner_id`: see the header note on
       * `OwnerInput` vs `OwnerIDInput`.
       */
      owner: { user_id: input.ownerDid },
      /**
       * The provider's own idempotency. Provisioning the same person on the same
       * chain twice returns the existing wallet instead of minting a second one —
       * and a second one is money sitting in a TEE that belongs to nobody.
       *
       * The field is `idempotency_key`, not the raw `privy-idempotency-key`
       * header name: the SDK's `WithIdempotency<>` wrapper turns the object into
       * the header.
       */
      idempotency_key: input.idempotencyKey,
    });

    return { providerWalletId: wallet.id, address: wallet.address, chain: input.chain };
  },
});