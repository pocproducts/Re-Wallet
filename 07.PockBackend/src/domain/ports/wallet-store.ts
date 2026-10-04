/**
 * PORT: the wallets a person already has.
 *
 * It exists so the provisioning use case can **skip** the ones that already
 * exist. Without it, logging in twice would ask Privy for a second wallet per
 * chain and only the `UNIQUE (user_id, chain_type)` constraint would object —
 * which is the database complaining *after* the provider has already minted the
 * orphan.
 *
 * ── Note on the identifier ────────────────────────────────────────────────────
 *
 * `rewallet.wallets` has `user_id` (a uuid), not a Privy DID, so this port takes
 * the uuid. The translation DID → `users.id` happens once, in the session use
 * case, which is the only place that knows about both.
 */
import type { WalletChain } from '../wallet/chains';
import type { EvmNetworkId } from '../wallet/evmNetwork';

export interface KnownWallet {
  readonly providerWalletId: string | null;
  readonly address: string;
  readonly chain: WalletChain;
  /**
   * Which EVM network this person operates on, as CAIP-2. `null` on a non-EVM
   * row, and `null` on an EVM row whose stored value is not one we support —
   * so a caller refuses instead of operating on a network nobody chose. See
   * `../wallet/evmNetwork.ts`.
   */
  readonly evmNetwork: EvmNetworkId | null;
}

export interface WalletStore {
  /** Every wallet row owned by this user, whatever the chain. */
  findByUserId(userId: string): Promise<readonly KnownWallet[]>;

  /**
   * Writes a freshly provisioned wallet.
   *
   * `ON CONFLICT (user_id, chain_type) DO NOTHING`: the constraint is the last
   * line of defence for the race where two logins for the same person overlap,
   * and the caller already has a valid address either way.
   */
  save(userId: string, wallet: KnownWallet): Promise<void>;
}