/**
 * Balance mirror — how `wallets.balance` finally gets a value.
 *
 * ── The rule this file exists to protect ────────────────────────────────────
 *
 * `wallets.balance` is a MIRROR of on-chain reality, not a piece of accounting.
 * A mirror has one job and one virtue: reading it twice and running it twice has
 * to produce the same state. That is why the only thing written here is the
 * balance the chain says, and only when the stored value disagrees with it.
 *
 * ── What is NOT here: movements ─────────────────────────────────────────────
 *
 * `movements` is a HISTORY of events, and history needs a cause. Every row
 * carries a `txHash` because "the balance went up" is not an event, it is a
 * difference, and a difference has no hash. Deriving a deposit from a balance
 * increase would also be wrong in a way that costs real money: a user who
 * receives 10 and sends 6 in the same window nets +4, and one invented deposit
 * of 4 is a lie with no `txHash` to disprove it.
 *
 * Worse, it is not safe on retry. A process that writes the movement and then
 * dies before committing the new balance re-reads the same difference next run
 * and credits it again. `indexer.ts` — which is still a stub — is where
 * movements belong, because it has a real event source to be idempotent
 * against.
 *
 * ── Why `first_funds_at` is written ONCE ────────────────────────────────────
 *
 * It is a state, not a balance: "has this user ever had money", and the app
 * reads it to decide whether to push "Recibir" at a brand new account. It must
 * never be cleared. A user who receives 100 and spends 100 still received
 * money once, and resetting the latch on the way down would re-onboard them
 * forever, every time their balance touched zero.
 */

import { eq } from 'drizzle-orm';
import { getEnv, type Env } from '@bestpath/config';
import type { Database } from '../db/client';
import { wallets } from '../db/schema';
import { isPositive, toMinorUnits } from '../lib/money';
import { getMonadReader, type MonadReader } from './monad';

/** What one pass did. Returned so a cron run can be logged, not guessed at. */
export interface BalanceSyncResult {
  checked: number;
  /** Wallets whose stored balance actually moved. */
  updated: number;
  /** Wallets that crossed "has ever had funds" for the first time. */
  firstFunds: number;
  /** Wallets skipped because they could not be read. Never throws the run. */
  failed: number;
}

/** The smallest thing this file needs from a logger. */
type SyncLogger = Pick<Console, 'info' | 'warn' | 'error'>;

const NOOP_LOGGER: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * True when the stored balance already equals the on-chain one.
 *
 * Compared as MINOR UNITS, not as strings. Postgres normalises `numeric(20,6)`
 * on the way in, so a value written as `"0.826004"` comes back as `"0.826004"`
 * but a value written as `"0"` comes back as `"0.000000"`, and a string compare
 * would rewrite the row — and its `updated_at` — on every single cron tick,
 * forever. Comparing the numbers is what makes "write only on change" true.
 */
const sameBalance = (a: string, b: string): boolean => toMinorUnits(a) === toMinorUnits(b);

/**
 * Reconcile every wallet's balance with the chain.
 *
 * ONE BAD ROW MUST NOT STOP THE RUN. A malformed address or an RPC hiccup on a
 * single wallet is skipped and counted; the other wallets still get reconciled.
 * The alternative — one failure aborting the pass — turns a single bad row into
 * a balance that silently stops updating for every user, which is exactly the
 * failure nobody notices until someone complains about a wrong number.
 */
export const syncWalletBalances = async (
  db: Database,
  options: { reader?: MonadReader; env?: Env; log?: SyncLogger; now?: Date } = {},
): Promise<BalanceSyncResult> => {
  const reader = options.reader ?? getMonadReader(options.env ?? getEnv());
  const log = options.log ?? NOOP_LOGGER;
  const now = options.now ?? new Date();

  const rows = await db
    .select({
      id: wallets.id,
      address: wallets.address,
      balance: wallets.balance,
      firstFundsAt: wallets.firstFundsAt,
    })
    .from(wallets);

  const result: BalanceSyncResult = { checked: rows.length, updated: 0, firstFunds: 0, failed: 0 };

  for (const row of rows) {
    let onChain: string;
    try {
      onChain = await reader.usdcBalanceOf(row.address);
    } catch (err) {
      result.failed += 1;
      log.warn(
        { walletId: row.id, address: row.address, err },
        'balance sync: no se pudo leer la wallet, se saltea',
      );
      continue;
    }

    const balanceMoved = !sameBalance(row.balance, onChain);
    // The latch, read BEFORE the write and only ever from NULL to a value. There
    // is no branch that clears it, and that omission is the point.
    const isFirstFunds = row.firstFundsAt === null && isPositive(onChain);

    if (!balanceMoved && !isFirstFunds) continue;

    await db
      .update(wallets)
      .set({
        balance: onChain,
        updatedAt: now,
        // Written only when it was NULL. `firstFundsAt` is never overwritten and
        // never reset, so a user who later drops to zero keeps the latch.
        ...(isFirstFunds ? { firstFundsAt: now } : {}),
      })
      .where(eq(wallets.id, row.id));

    if (balanceMoved) result.updated += 1;
    if (isFirstFunds) {
      result.firstFunds += 1;
      log.info({ walletId: row.id, balance: onChain }, 'primeros fondos registrados');
    }
  }

  log.info(result, 'balance sync completado');
  return result;
};
