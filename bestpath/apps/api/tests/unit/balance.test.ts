import { describe, it, expect, vi } from 'vitest';
import { syncWalletBalances } from '../../src/services/balance';
import type { MonadReader } from '../../src/services/monad';
import type { Database } from '../../src/db/client';

/**
 * The balance mirror, without a chain and without Postgres.
 *
 * The properties here are not "does it copy a number". They are the three that
 * make a mirror safe to run from a cron forever:
 *
 *   1. writing only on change. A pass that rewrote every row would churn
 *      `updated_at` on every tick, and the column would stop meaning "when this
 *      balance last moved" and start meaning "when the cron last ran".
 *   2. `first_funds_at` is a latch, not a balance: set once on the way UP, and
 *      there is no branch that clears it, because the user it describes has
 *      already been onboarded.
 *   3. one bad row does not stop the pass. Otherwise a single malformed address
 *      silently freezes every other user's balance, and nobody notices until a
 *      number is wrong.
 *
 * Also pinned: this writes NOTHING to `movements`. Movements are a history of
 * events, and a balance difference is not an event.
 */

interface FakeWallet {
  id: string;
  address: string;
  balance: string;
  firstFundsAt: Date | null;
}

interface Write {
  set: Record<string, unknown>;
}

/**
 * A db that answers the two shapes `syncWalletBalances` uses, and records writes.
 *
 * `insert` throws on purpose rather than being absent: the mirror has no business
 * creating rows, and a fake that quietly tolerates it would let that regress
 * unnoticed.
 */
const fakeDb = (rows: FakeWallet[]) => {
  const writes: Write[] = [];
  const db = {
    select: () => ({ from: () => Promise.resolve(rows.map((r) => ({ ...r }))) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ set: values });
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => {
      throw new Error('the balance mirror must never insert');
    },
  } as unknown as Database;
  return { db, writes };
};

/** A reader that answers from a map, and throws for an address it does not know. */
const readerFor = (balances: Record<string, string>): MonadReader => ({
  async usdcBalanceOf(address: string): Promise<string> {
    const value = balances[address];
    if (value === undefined) throw new Error(`no such address: ${address}`);
    return value;
  },
});

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date('2026-09-27T10:00:00.000Z');
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

const W1 = '0x6c9F272E77A84fe90E83372c37Bfd6Da05aB7ae1';
const W2 = '0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6';

describe('the mirror writes only what disagrees with the chain', () => {
  it('a wallet whose balance matches is left completely alone', async () => {
    // The load-bearing case for a cron: the overwhelmingly common answer is
    // "nothing changed", and a pass that wrote anyway would touch every row on
    // every tick.
    const { db, writes } = fakeDb([
      { id: 'a', address: W1, balance: '0.826004', firstFundsAt: LONG_AGO },
    ]);

    const result = await syncWalletBalances(db, { reader: readerFor({ [W1]: '0.826004' }), log: silent });

    expect(result).toEqual({ checked: 1, updated: 0, firstFunds: 0, failed: 0 });
    expect(writes).toHaveLength(0);
  });

  it('a wallet whose balance moved is updated to the on-chain value', async () => {
    const { db, writes } = fakeDb([
      { id: 'a', address: W1, balance: '0.000000', firstFundsAt: LONG_AGO },
    ]);

    const result = await syncWalletBalances(db, { reader: readerFor({ [W1]: '0.826004' }), log: silent });

    expect(result.updated).toBe(1);
    expect(writes[0]?.set['balance']).toBe('0.826004');
  });

  it('"0" and "0.000000" are the same balance, not a change to write', async () => {
    // Postgres normalises `numeric(20,6)` on the way in, so a row can hold a
    // short string from an older write. Comparing the strings would rewrite it
    // every single tick.
    const { db, writes } = fakeDb([{ id: 'a', address: W1, balance: '0', firstFundsAt: null }]);

    await syncWalletBalances(db, { reader: readerFor({ [W1]: '0.000000' }), log: silent });
    expect(writes).toHaveLength(0);
  });
});

describe('first_funds_at is a latch', () => {
  it('is set the first time a wallet is seen holding money', async () => {
    const { db, writes } = fakeDb([{ id: 'a', address: W1, balance: '0.000000', firstFundsAt: null }]);

    const result = await syncWalletBalances(db, {
      reader: readerFor({ [W1]: '0.826004' }),
      log: silent,
      now: NOW,
    });

    expect(result.firstFunds).toBe(1);
    expect(writes[0]?.set['firstFundsAt']).toEqual(NOW);
  });

  it('is NEVER cleared when the balance goes back to zero', async () => {
    // The regression this whole section exists for: the user received money and
    // spent it. They still received money once, and resetting the latch would
    // push "Recibir" at them forever, on every visit, for the rest of their life.
    const { db, writes } = fakeDb([
      { id: 'a', address: W1, balance: '100.000000', firstFundsAt: LONG_AGO },
    ]);

    const result = await syncWalletBalances(db, { reader: readerFor({ [W1]: '0.000000' }), log: silent });

    expect(result.firstFunds).toBe(0);
    expect(writes[0]?.set['balance']).toBe('0.000000');
    // The key must be ABSENT, not null: writing null is how a latch gets lost.
    expect('firstFundsAt' in (writes[0]?.set ?? {})).toBe(false);
  });

  it('an empty wallet with no latch yet is not "first funds"', async () => {
    const { db, writes } = fakeDb([{ id: 'a', address: W1, balance: '0.000000', firstFundsAt: null }]);

    const result = await syncWalletBalances(db, { reader: readerFor({ [W1]: '0.000000' }), log: silent });

    expect(result.firstFunds).toBe(0);
    expect(writes).toHaveLength(0);
  });
});

describe('one bad row does not stop the pass', () => {
  it('an unreadable wallet is counted and skipped, and the others still sync', async () => {
    const { db, writes } = fakeDb([
      { id: 'bad', address: '0xnot-an-address', balance: '0.000000', firstFundsAt: null },
      { id: 'good', address: W2, balance: '0.000000', firstFundsAt: null },
    ]);

    const warn = vi.fn();
    const result = await syncWalletBalances(db, {
      reader: readerFor({ [W2]: '0.826004' }),
      log: { info: () => {}, warn, error: () => {} },
    });

    expect(result).toEqual({ checked: 2, updated: 1, firstFunds: 1, failed: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    // The good wallet was written AFTER the bad one: the loop kept going.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.set['balance']).toBe('0.826004');
  });
});
