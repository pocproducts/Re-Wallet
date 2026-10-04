/**
 * PORT: the movements a person made.
 *
 * ── Why a send writes a movement before anything is signed ───────────────────
 *
 * Because a transfer that is prepared and never signed is a thing that happened
 * in this app, and an Activity list that only knows about finished transfers
 * cannot answer "what did I just try to do?". The row is written `pending`, and
 * the task that confirms it (T2) moves it to `completed` with the hash. This
 * file is the **write** side only: nothing here reads movements yet, and adding a
 * read would mean adding a second shape for the same rows.
 *
 * ── Why `type`, `status` and `meta` are fixed by the schema, not chosen here ──
 *
 * `rewallet.movements` carries `movements_type_valid` and `movements_status_valid`
 * as CHECK constraints: `type` is one of `deposit, send, receive, yield, swap,
 * bridge, card_purchase, refund`, and `status` is one of `pending, completed,
 * failed, cancelled`. A send is a **`send`**, and it is **`pending`** until a
 * hash exists. Both values are in the port's type, so an invented one is a
 * compilation error rather than a constraint violation found in production on
 * somebody's money.
 *
 * ── Why `amount` is a decimal string in whole units and the exact integer goes
 *    in `meta` ────────────────────────────────────────────────────────────────
 *
 * `movements.amount` is `numeric(20, 6)`. Six decimal places is enough for USDC
 * and **not** enough for SOL, which has nine. So `amount` carries the amount a
 * person reads, at the scale the column can hold, and `meta.amountRaw` carries
 * the exact integer the transaction was built from. Nothing is lost; the exact
 * number is always in the row.
 */
import type { WalletChain } from '../wallet/chains';

/** The movement this port writes. Nothing else exists yet. */
export interface PendingSendMovement {
  /** `movements_type_valid`: a send between people. */
  readonly type: 'send';
  /**
   * The amount in whole units, at most six decimal places.
   *
   * `numeric(20, 6)` cannot hold a ninth decimal place, so this is the *display*
   * amount and the exact integer travels in `meta.amountRaw`.
   */
  readonly amount: string;
  /** What a movement list shows in one line. */
  readonly title: string;
  /** `movements_status_valid`: prepared, not yet signed, not yet on chain. */
  readonly status: 'pending';
  /** Chain, asset, recipient, exact amount and the `requestId` it came from. */
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface MovementStore {
  /**
   * Writes one pending movement against the wallet row that owns it.
   *
   * `walletChain` is the **wallet** chain, not the network: `monad` and
   * `ethereum` are the same EVM address in the same row, exactly as everywhere
   * else in this project (`../portfolio/networks.ts`).
   *
   * `null` when there is no such row. Not an exception: the caller already knows
   * the wallet from the rows it read, so a missing row here means the rows
   * changed underneath, and the honest answer is "the rows are unavailable"
   * rather than an orphan row with a foreign key.
   */
  createPending(
    userId: string,
    walletChain: WalletChain,
    movement: PendingSendMovement,
  ): Promise<{ readonly id: string; readonly status: 'pending' } | null>;
}
