/**
 * USE CASE: give a person their wallets.
 *
 * **This file owns the EVM → Solana order.** Not the adapter, not the schema, not
 * a config value.
 *
 * ── Why the order lives here and not in the adapter ───────────────────────────
 *
 * An adapter that knows the order has it in two places: the loop that walks it,
 * and the provider, which has its own. If Privy one day provisions Solana first,
 * or if the adapter is copied for another use case, the rule gets duplicated and
 * the two copies start disagreeing without anyone noticing.
 *
 * Here the adapter **receives one chain and creates that chain**. It has no idea an
 * order exists. Adding a third chain is one line in `WALLET_CHAIN_ORDER` and this
 * loop picks it up.
 *
 * ── Why idempotency is handled here ───────────────────────────────────────────
 *
 * Because re-provisioning is an orphaned wallet, and the skip must happen
 * *before* the provider is asked. Reading the store first is the only way to know
 * which chains are already covered.
 */
import { WALLET_CHAIN_ORDER } from '../../domain/wallet/chains';
import type { WalletChain } from '../../domain/wallet/chains';
import type { WalletProvisioner } from '../../domain/ports/wallet-provisioner';
import type { KnownWallet, WalletStore } from '../../domain/ports/wallet-store';

export interface ProvisionWalletsInput {
  /** The person, in Privy's vocabulary. */
  readonly ownerDid: string;
  /** `rewallet.users.id`. The wallets table is keyed by this, not by the DID. */
  readonly userId: string;
}

export interface ProvisionWalletsFor {
  (input: ProvisionWalletsInput): Promise<readonly KnownWallet[]>;
}

/**
 * The ports arrive as dependencies, not as singletons. That is what lets the whole
 * use case be tested without a network and without a database, which is the only
 * reason the order can have a real assertion behind it.
 */
export const provisionWalletsFor =
  (provisioner: WalletProvisioner, store: WalletStore): ProvisionWalletsFor =>
  async ({ ownerDid, userId }: ProvisionWalletsInput): Promise<readonly KnownWallet[]> => {
    const known = await store.findByUserId(userId);
    const byChain = new Map<WalletChain, KnownWallet>();
    for (const wallet of known) byChain.set(wallet.chain, wallet);

    const result: KnownWallet[] = [];

    // The order of this loop IS the order of the contract. A comment can go stale;
    // the array cannot.
    for (const chain of WALLET_CHAIN_ORDER) {
      const existing = byChain.get(chain);
      if (existing) {
        result.push(existing);
        continue;
      }

      const created = await provisioner.provision({
        ownerDid,
        chain,
        // Generated here, not in the adapter: this is the file that knows that
        // "same person, same chain" has to be one operation to be repeatable.
        idempotencyKey: `${ownerDid}:${chain}`,
      });

      const wallet: KnownWallet = {
        providerWalletId: created.providerWalletId,
        address: created.address,
        chain,
      };

      byChain.set(chain, wallet);
      await store.save(userId, wallet);
      result.push(wallet);
    }

    return result;
  };