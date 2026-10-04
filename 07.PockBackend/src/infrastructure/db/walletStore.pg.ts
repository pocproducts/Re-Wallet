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
 * ── `ON CONFLICT DO NOTHING` ──────────────────────────────────────────────────
 *
 * `UNIQUE (user_id, chain_type)` means a second write for the same pair is a
 * constraint violation. The caller already holds a valid address from Privy, and
 * the row it wanted exists, so swallowing the duplicate is the correct outcome —
 * the constraint is the last line of defence against two overlapping logins.
 *
 * ── `evm_network` is a column, not a row ──────────────────────────────────────
 *
 * One EVM address serves every configured EVM network, so the network in use is
 * a property of the row and not the identity of one. It is written from
 * `KnownWallet.evmNetwork` and defaults to Ethereum mainnet; see
 * `src/domain/wallet/evmNetwork.ts` and `sql/`.
 */
import { WALLET_CHAIN_ORDER } from '../../domain/wallet/chains';
import type { WalletChain } from '../../domain/wallet/chains';
import { DEFAULT_EVM_NETWORK, toEvmNetworkId } from '../../domain/wallet/evmNetwork';
import type { KnownWallet, WalletStore } from '../../domain/ports/wallet-store';
import type { Database } from './client';

interface WalletRow {
  readonly address: string;
  readonly provider_wallet_id: string | null;
  readonly chain_type: string;
  readonly evm_network: string;
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
      SELECT address, provider_wallet_id, chain_type, evm_network
        FROM rewallet.wallets
       WHERE user_id = ${userId}
       ORDER BY created_at ASC
    `) as unknown as WalletRow[];

    return rows.flatMap((raw) => {
      const row = raw as WalletRow;
      const chain = toWalletChain(row.chain_type);
      if (chain === null) return [];

      /*
       * The column is only an answer on an EVM row. On a Solana row it holds the
       * `NOT NULL` default and means nothing, so it is reported as no network
       * rather than as Ethereum. An unsupported value is reported the same way:
       * the row is still the person's row — dropping it would say they have no
       * EVM wallet — but whoever reads it must refuse instead of operating.
       */
      const evmNetwork = chain === 'ethereum' ? toEvmNetworkId(row.evm_network) : null;

      return [{
        address: row.address,
        providerWalletId: row.provider_wallet_id,
        chain,
        evmNetwork,
      }];
    });
  },

  async save(userId: string, wallet: KnownWallet): Promise<void> {
    /*
     * La columna se escribe siempre, nunca se deja al `DEFAULT` de la base.
     *
     * Pero el default es **de Ethereum y solo para filas EVM**. Una fila de
     * Solana se escribe en `null`: guardar `eip155:1` ahí sería afirmar que una
     * wallet de Solana está en Ethereum mainnet. No es un valor inútil, es una
     * respuesta falsa, y una base que miente se corrige con una migración.
     */
    const evmNetwork =
      wallet.chain === 'ethereum' ? (wallet.evmNetwork ?? DEFAULT_EVM_NETWORK) : null;

    await db`
      INSERT INTO rewallet.wallets (user_id, address, provider_wallet_id, chain_type, evm_network)
      VALUES (${userId}, ${wallet.address}, ${wallet.providerWalletId}, ${wallet.chain}, ${evmNetwork})
      ON CONFLICT (user_id, chain_type) DO NOTHING
    `;
  },
});