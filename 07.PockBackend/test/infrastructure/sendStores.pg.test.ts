/**
 * THE WRITES A SEND MAKES: one row in `rewallet.movements` and one claim plus
 * one answer in `rewallet.idempotency_keys`.
 *
 * ── Why this is under test without a database ────────────────────────────────
 *
 * Both adapters write **real money state**, and both have a way to be wrong that
 * the use case's own tests cannot see, because a fake store cannot misbehave the
 * way SQL can:
 *
 *   1. **A movement with the wrong wallet, or with a type the table's CHECK
 *      refuses.** `movements_type_valid` and `movements_status_valid` are the
 *      database's own statement of what a movement is.
 *   2. **A claim that never becomes an answer, or an answer that can be
 *      overwritten.** The claim is what makes a double tap a replay, and it is
 *      released only while it is still empty.
 *   3. **A cross-person replay.** `key` is the table's PRIMARY KEY, so the key
 *      that is stored has to carry the person in it — otherwise one person's
 *      `requestId` would block another's send.
 *
 * The fake transport records the statement and the values, which is what the
 * driver would send.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresMovementStore } from '../../src/infrastructure/db/movementStore.pg';
import { createPostgresIdempotencyStore } from '../../src/infrastructure/db/idempotencyStore.pg';
import { idempotencyKeyFor } from '../../src/domain/ports/idempotency-store';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const ENDPOINT = '/api/send/prepare';
const REQUEST_ID = '3b6f1f2e-6a6d-4a2f-9a44-9f2b1c9d0e11';

interface Recorded {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A transport that answers with `rows` and records what it was asked to do. */
const fakeDb = (rows: readonly unknown[]): { db: Database; recorded: Recorded[] } => {
  const recorded: Recorded[] = [];
  const template = (strings: TemplateStringsArray, ...values: unknown[]) => {
    recorded.push({ sql: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  return { db: Object.assign(template, { unsafe: (sql: string) => sql }) as unknown as Database, recorded };
};

const movement = {
  type: 'send' as const,
  amount: '1.5',
  title: 'Send 1.5 USDC to 0x5aAe…eAed',
  status: 'pending' as const,
  meta: { chain: 'monad', symbol: 'USDC', recipient: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', amountRaw: '1500000' },
};

describe('rewallet.movements', () => {
  it('writes the movement against the wallet row that owns it, and returns its id', async () => {
    const { db, recorded } = fakeDb([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pending' }]);

    const created = await createPostgresMovementStore(db).createPending(USER_ID, 'ethereum', movement);

    expect(created).toEqual({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pending' });
    expect(recorded[0]?.sql).toContain('INSERT INTO rewallet.movements');
    // The wallet is found by its owner and its chain, in the same statement.
    expect(recorded[0]?.sql).toContain('rewallet.wallets');
    expect(recorded[0]?.values).toContain(USER_ID);
    expect(recorded[0]?.values).toContain('ethereum');
    expect(recorded[0]?.values).toContain('send');
    expect(recorded[0]?.values).toContain('pending');
  });

  it('writes the type and the status the table CHECKs allow', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresMovementStore(db).createPending(USER_ID, 'solana', movement);

    // `movements_type_valid` and `movements_status_valid` are the database
    // stating what a movement is; an application that invents a fifth status
    // finds out at write time, in production, on somebody's money.
    expect(recorded[0]?.values).toContain('send');
    expect(recorded[0]?.values).toContain('pending');
    expect(recorded[0]?.values).not.toContain('confirmed');
  });

  it('writes `meta` as jsonb, not as a string of json', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresMovementStore(db).createPending(USER_ID, 'ethereum', movement);

    expect(recorded[0]?.sql).toContain('::jsonb');
  });

  it('reports no movement when the wallet row is gone, instead of writing an orphan', async () => {
    const { db } = fakeDb([]);

    // `movements_wallet_id_fkey` would refuse it anyway; refusing here keeps the
    // failure a 502 about rows rather than a constraint error in a log.
    expect(await createPostgresMovementStore(db).createPending(USER_ID, 'ethereum', movement)).toBeNull();
  });
});

describe('rewallet.idempotency_keys', () => {
  it('stores a key that carries the person and the endpoint in it', () => {
    const mine = idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID);

    // `key` is the table's PRIMARY KEY, so without the person inside it one
    // person's `requestId` would be somebody else's replay.
    expect(mine).not.toBe(idempotencyKeyFor(OTHER_USER, ENDPOINT, REQUEST_ID));
    expect(mine).not.toBe(idempotencyKeyFor(USER_ID, '/api/pool/deposit', REQUEST_ID));
    expect(mine).toContain(REQUEST_ID);
  });

  it('claims the key with an insert that loses gracefully to the one already there', async () => {
    const { db, recorded } = fakeDb([{ key: idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID) }]);

    const claimed = await createPostgresIdempotencyStore(db).reserve({
      key: idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID),
      userId: USER_ID,
      endpoint: ENDPOINT,
      expiresAt: new Date('2026-10-05T05:00:00.000Z'),
    });

    expect(claimed).toBe(true);
    expect(recorded[0]?.sql).toContain('ON CONFLICT (key) DO NOTHING');
  });

  it('reports a lost claim as not claimed, and never as an error', async () => {
    const { db } = fakeDb([]);

    const claimed = await createPostgresIdempotencyStore(db).reserve({
      key: idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID),
      userId: USER_ID,
      endpoint: ENDPOINT,
      expiresAt: new Date('2026-10-05T05:00:00.000Z'),
    });

    expect(claimed).toBe(false);
  });

  it('stores the answer against the key, scoped to its person and endpoint', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresIdempotencyStore(db).complete({
      key: idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID),
      userId: USER_ID,
      endpoint: ENDPOINT,
      response: { chainId: 143 },
      statusCode: 200,
    });

    expect(recorded[0]?.sql).toContain('UPDATE rewallet.idempotency_keys');
    expect(recorded[0]?.values).toContain(200);
    expect(recorded[0]?.values).toContain(USER_ID);
  });

  it('reads an answer only for the person, the endpoint, and a claim that finished', async () => {
    const { db, recorded } = fakeDb([{ response: { chainId: 143 }, status_code: 200 }]);

    const found = await createPostgresIdempotencyStore(db).find({
      key: idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID),
      userId: USER_ID,
      endpoint: ENDPOINT,
    });

    expect(found).toEqual({ response: { chainId: 143 }, statusCode: 200 });
    expect(recorded[0]?.sql).toContain('user_id');
    expect(recorded[0]?.sql).toContain('endpoint');
    // A claim with no answer yet is not an answer, and must never be served.
    expect(recorded[0]?.sql).toContain('status_code > 0');
  });

  it('releases only an empty claim, so a stored answer is never deleted', async () => {
    const { db, recorded } = fakeDb([]);

    await createPostgresIdempotencyStore(db).release({
      key: idempotencyKeyFor(USER_ID, ENDPOINT, REQUEST_ID),
      userId: USER_ID,
      endpoint: ENDPOINT,
    });

    expect(recorded[0]?.sql).toContain('DELETE FROM rewallet.idempotency_keys');
    expect(recorded[0]?.sql).toContain('status_code = 0');
  });
});
