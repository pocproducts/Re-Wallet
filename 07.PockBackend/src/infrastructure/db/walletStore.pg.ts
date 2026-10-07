/**
 * ADAPTER: the `rewallet.wallets` rows.
 *
 * ── The real columns of the existing table ────────────────────────────────────
 *
 * `user_id`, `address`, `provider_wallet_id`, `chain_type`. No schema is created
 * and no column is added.
 *
 * The table's CHECK constraints are strict on purpose and this adapter respects
 * them: `wallets_address_format` validates the address **against the declared
 * chain**, and `wallets_chain_type_valid` restricts `chain_type` to
 * `('ethereum','solana')`. That is exactly why the creation order is EVM first —
 * writing them the other way round produces an error the database catches.
 *
 * ── Why `ON CONFLICT DO NOTHING` ──────────────────────────────────────────────
 *
 * `UNIQUE (user_id, chain_type)` means a second write for the same pair is a
 * constraint violation. The caller already holds a valid address from Privy, and
 * the row it wanted exists, so swallowing the duplicate is the correct outcome —
 * the constraint is the last line of defence against two overlapping logins.
 */
import { WALLET_CHAIN_ORDER } from '../../domain/wallet/chains';
import type { WalletChain } from '../../domain/wallet/chains';
import type { KnownWallet, WalletStore } from '../../domain/ports/wallet-store';
import type { Database } from './client';

interface WalletRow {
  readonly address: string;
  readonly provider_wallet_id: string | null;
  readonly chain_type: string;
}

/**
 * Only chains the schema accepts can come back out.
 *
 * A row with an unknown `chain_type` is filtered rather than cast: a cast would
 * turn a value the database allows today but the product does not support into a
 * `WalletChain` that the rest of the code would happily act on.
 */
const toWalletChain = (value: string): WalletChain | null =>
  (WALLET_CHAIN_ORDER as readonly string[]).includes(value) ? (value as WalletChain) : null;

export const createPostgresWalletStore = (db: Database): WalletStore => ({
  async findByUserId(userId: string): Promise<readonly KnownWallet[]> {
    const rows = (await db`
      SELECT address, provider_wallet_id, chain_type
        FROM rewallet.wallets
       WHERE user_id = ${userId}
       ORDER BY created_at ASC
    `) as unknown as WalletRow[];

    return rows.flatMap((raw) => {
      const row = raw as WalletRow;
      const chain = toWalletChain(row.chain_type);
      if (chain === null) return [];
      return [{ address: row.address, providerWalletId: row.provider_wallet_id, chain }];
    });
  },

  async save(userId: string, wallet: KnownWallet): Promise<void> {
    await db`
      INSERT INTO rewallet.wallets (user_id, address, provider_wallet_id, chain_type)
      VALUES (${userId}, ${wallet.address}, ${wallet.providerWalletId}, ${wallet.chain})
      ON CONFLICT (user_id, chain_type) DO NOTHING
    `;
  },
});