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
import type { KnownWallet, ReachableByTag, TaggedPerson, WalletStore } from '../../domain/ports/wallet-store';
import type { Database } from './client';

interface WalletRow {
  readonly address: string;
  readonly provider_wallet_id: string | null;
  readonly chain_type: string;
  readonly evm_network: string;
}

/** The tag-resolution row: the person's own handle next to an optional wallet. */
interface TagRow {
  readonly tag: string;
  /** `null` when this person has no wallet row on the chain that was asked for. */
  readonly address: string | null;
  readonly provider_wallet_id: string | null;
  readonly chain_type: string | null;
  readonly evm_network: string | null;
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

export const createPostgresWalletStore = (db: Database): WalletStore & ReachableByTag => ({
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

  /*
   * ── `findByTag`: the tag is resolved, and the address stops here ────────────
   *
   * One statement, and the join is the whole design:
   *
   *   FROM rewallet.users u
   *   LEFT JOIN rewallet.wallets w ON w.user_id = u.id AND w.chain_type = $2
   *    WHERE u.tag_normalized = $1
   *
   * The `WHERE` is on `tag_normalized` — `citext`, `UNIQUE`, and already indexed
   * as the schema ships it — so this is one index lookup and not a scan. The
   * `@` is **not** stripped here: the caller normalizes and validates the handle
   * against the schema's own pattern before it can reach this method, and an
   * adapter that did it again would be a second, quieter answer to "what is a
   * tag".
   *
   * The join is a `LEFT` join on purpose, and it is what keeps the two refusals
   * apart: a person with no wallet on this chain still **produces a row**, with
   * `address = NULL`. An inner join would fold that person into `nobody` and the
   * use case would tell somebody they do not exist when they do.
   *
   * The chain is part of the join condition and not of the projection, so
   * `monad` and `ethereum` reach the one EVM row each person has, and a Solana
   * send can never pick up an EVM address — the same `WALLET_CHAIN_FOR` mapping
   * the sender uses, applied on the other side of the same table.
   *
   * Nothing here creates, adopts or renames a person: `SELECT` is the only
   * keyword in this statement, so a tag that belongs to nobody stays a tag that
   * belongs to nobody, and there is no row a caller could guess into existence.
   */
  async findByTag(tag: string, chain: WalletChain): Promise<TaggedPerson> {
    const rows = (await db`
      SELECT u.tag, w.address, w.provider_wallet_id, w.chain_type, w.evm_network
        FROM rewallet.users u
        LEFT JOIN rewallet.wallets w
          ON w.user_id = u.id
         AND w.chain_type = ${chain}
       WHERE u.tag_normalized = ${tag}
       LIMIT 1
    `) as unknown as TagRow[];

    const row = rows[0];
    if (row === undefined) return { kind: 'nobody' };

    /*
     * A row can come back with a chain the schema allows and the product does
     * not, so the value is filtered rather than cast, exactly as `findByUserId`
     * does. It reads as "this person has no wallet we can pay here", which is the
     * honest reading of an address we are not willing to use.
     */
    const rowChain = row.chain_type === null ? null : toWalletChain(row.chain_type);

    if (row.address === null || row.address === undefined || rowChain === null) {
      return { kind: 'person', tag: row.tag, wallet: null };
    }

    return {
      kind: 'person',
      tag: row.tag,
      wallet: {
        address: row.address,
        providerWalletId: row.provider_wallet_id,
        chain: rowChain,
        // Only an EVM row names a network, for the same reason as in `findByUserId`.
        evmNetwork: rowChain === 'ethereum' ? toEvmNetworkId(row.evm_network) : null,
      },
    };
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
    let evmNetwork: string | null = null;
    if (wallet.chain === 'ethereum') {
      // If Privy provides a chainId, use it to determine the network
      if (wallet.chainId !== undefined && wallet.chainId !== null) {
        // Convert chainId to CAIP-2 format: eip155:<chainId>
        evmNetwork = `eip155:${wallet.chainId}`;
      } 
      // If no chainId from Privy, fall back to the evmNetwork that Privy might have sent
      else if (wallet.evmNetwork && typeof wallet.evmNetwork === 'string') {
        evmNetwork = wallet.evmNetwork;
      }
      // Finally, fallback to default (Ethereum mainnet) if neither is available
      else {
        evmNetwork = DEFAULT_EVM_NETWORK;
      }
    }

    await db`
      INSERT INTO rewallet.wallets (user_id, address, provider_wallet_id, chain_type, evm_network)
      VALUES (${userId}, ${wallet.address}, ${wallet.providerWalletId}, ${wallet.chain}, ${evmNetwork})
      ON CONFLICT (user_id, chain_type) DO NOTHING
    `;
  },
});