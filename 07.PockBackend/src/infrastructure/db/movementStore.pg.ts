/**
 * ADAPTER: one pending row in `rewallet.movements` per prepared send.
 *
 * ── The real columns of the existing table ────────────────────────────────────
 *
 * `wallet_id`, `type`, `amount`, `title`, `status`, `meta`, `created_at`,
 * `updated_at`. No table is created and no column is added.
 *
 * The table states what a movement is, in CHECK constraints, and this adapter
 * writes exactly what it says:
 *
 * - `movements_type_valid` — `send` is one of the eight.
 * - `movements_status_valid` — `pending` is one of the four, and it is the
 *   truthful one: the transaction exists and **nobody has signed it yet**. The
 *   status that says otherwise (`completed`) is a claim about a hash that does
 *   not exist, and an Activity list that says "completed" for a transfer nobody
 *   sent is a list nobody can trust.
 * - `amount numeric(20, 6)` — six decimal places. SOL has nine, so `amount`
 *   holds the readable amount at the column's scale and `meta.amountRaw` holds
 *   the exact integer the transaction was built from. Nothing is lost, and the
 *   exact number is always in the row.
 *
 * ── Why the wallet is found inside the statement ──────────────────────────────
 *
 * `movements_wallet_id_fkey` points at `rewallet.wallets.id`, and the caller has
 * a **user id** and a wallet **chain** — never a wallet id it could put in a
 * column it does not control. So the row is selected by its owner and its chain
 * in the same statement that inserts the movement: `monad` and `ethereum` are
 * the same EVM row, exactly as everywhere else in this project
 * (`../portfolio/networks.ts`).
 *
 * When no such row comes back the answer is `null`, not an insert that fails on
 * the foreign key: the caller already knows the wallet from the rows it read, so
 * a missing row here means the rows changed underneath it, and the honest answer
 * is "the rows are unavailable" rather than a constraint error in a log.
 */
import type { MovementStore, PendingSendMovement } from '../../domain/ports/movement-store';
import type { WalletChain } from '../../domain/wallet/chains';
import type { Database } from './client';

interface MovementRow {
  readonly id: string;
  readonly status: string;
}

export const createPostgresMovementStore = (db: Database): MovementStore => ({
  async createPending(userId, walletChain: WalletChain, movement: PendingSendMovement) {
    const rows = (await db`
      INSERT INTO rewallet.movements (wallet_id, type, amount, title, status, meta)
      SELECT w.id, ${movement.type}, ${movement.amount}, ${movement.title},
             ${movement.status}, ${JSON.stringify(movement.meta)}::jsonb
        FROM rewallet.wallets w
       WHERE w.user_id = ${userId}
         AND w.chain_type = ${walletChain}
      RETURNING id, status
    `) as unknown as MovementRow[];

    const row = rows[0];
    if (row === undefined) return null;
    return { id: row.id, status: 'pending' };
  },
});
