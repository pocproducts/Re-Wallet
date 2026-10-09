/**
 * The Postgres adapter, against a fake transport.
 *
 * What is under test is the **translation** — three statements this project
 * chose to write into a table that already exists. The choices that are
 * invisible from the application layer, and the ones that would bite:
 *
 *   1. `ON CONFLICT (id) DO NOTHING` on the insert, with `RETURNING`: a drawn id
 *      that is already on file returns no row and is reported as `null`, which is
 *      a collision to retry, not a constraint error to raise at a route.
 *   2. **`paid` is reached by one conditional UPDATE.** `WHERE status = 'pending'
 *      AND expires_at > $paidAt` is what makes a link single-use and an expired
 *      charge unpayable, and both properties live in that predicate. A statement
 *      that wrote `status = 'paid'` unconditionally would let a second tap
 *      overwrite the payer of the first.
 *   3. **No address is ever selected.** The adapter reads a charge's identity,
 *      amount, note, status and dates — and the payee's tag, which is an identity
 *      a person can read out loud. The address stays behind
 *      `POST /api/payment-requests/:id/pay`, which resolves it and hands it to
 *      the send flow.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresPaymentRequestStore } from '../../src/infrastructure/db/paymentRequestStore.pg';

const NOW = new Date('2026-10-04T05:00:00.000Z');
const LATER = new Date('2026-10-05T05:00:00.000Z');
const ID = 'kQ3v7pZ2mR8tY5wB1nF4hJ6sLdC9xGa';

/** Records every statement fragment the tagged template receives. */
const recordingDb = (rows: unknown): Database & { readonly seen: { text: string; values: unknown[] }[] } => {
  const seen: { text: string; values: unknown[] }[] = [];
  const template = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
    seen.push({ text: strings.join('?'), values });
    return rows;
  };
  const query = async (sql: string, params?: unknown[]): Promise<unknown> => {
    seen.push({ text: sql, values: params ?? [] });
    return rows;
  };
  return Object.assign(template, {
    unsafe: (sql: string) => sql,
    query,
    json: (value: unknown) => value,
    seen,
  }) as unknown as Database & { readonly seen: { text: string; values: unknown[] }[] };
};

const sqlOf = (db: { readonly seen: readonly { text: string }[] }): string =>
  db.seen.map((call) => call.text).join('\n');

const valuesOf = (db: { readonly seen: readonly { values: unknown[] }[] }): unknown[] =>
  db.seen.flatMap((call) => call.values);

const ROW = {
  id: ID,
  user_id: '11111111-1111-4111-8111-111111111111',
  amount: '150.25',
  note: 'la vuelta',
  status: 'pending',
  created_at: NOW,
  expires_at: LATER,
  paid_by_user_id: null,
  paid_at: null,
  requester_tag: 'ana.abcd',
};

describe('createPostgresPaymentRequestStore — writing a charge', () => {
  it('writes the columns the table already has, and nothing else', async () => {
    const db = recordingDb([ROW]);

    await createPostgresPaymentRequestStore(db).create({
      id: ID,
      userId: ROW.user_id,
      amount: '150.25',
      note: 'la vuelta',
      createdAt: NOW,
      expiresAt: LATER,
    });

    const sql = sqlOf(db);
    expect(sql).toContain('INSERT INTO rewallet.payment_requests');
    for (const column of ['id', 'user_id', 'amount', 'note', 'status', 'created_at', 'expires_at']) {
      expect(sql).toContain(column);
    }
    // `status` is the table's own default, written out so the row's state is a
    // statement this adapter makes rather than a DEFAULT nobody reads.
    expect(sql).toContain('pending');
    // Nothing that does not exist in the table.
    expect(sql).not.toContain('updated_at');
    expect(sql).not.toContain('paid_by_user_id');
  });

  it('reports a collision as `null` instead of raising', async () => {
    // `DO NOTHING` returns no row: a 192-bit id that is already on file.
    const db = recordingDb([]);

    const created = await createPostgresPaymentRequestStore(db).create({
      id: ID,
      userId: ROW.user_id,
      amount: '1',
      note: null,
      createdAt: NOW,
      expiresAt: LATER,
    });

    expect(created).toBeNull();
    expect(sqlOf(db)).toContain('ON CONFLICT');
    expect(sqlOf(db)).toContain('DO NOTHING');
    expect(sqlOf(db)).toContain('RETURNING');
  });

  it('passes the values as they were decided, not as a re-serialised guess', async () => {
    const db = recordingDb([ROW]);

    await createPostgresPaymentRequestStore(db).create({
      id: ID,
      userId: ROW.user_id,
      amount: '150.25',
      note: 'la vuelta',
      createdAt: NOW,
      expiresAt: LATER,
    });

    const values = valuesOf(db);
    expect(values).toContain(ID);
    expect(values).toContain(ROW.user_id);
    // The amount is a decimal **string**, so no float ever meets the column.
    expect(values).toContain('150.25');
    expect(values).toContain(NOW.toISOString());
    expect(values).toContain(LATER.toISOString());
  });

  it('reads back the payee as a tag, which is an identity and not an address', async () => {
    const db = recordingDb([ROW]);

    const created = await createPostgresPaymentRequestStore(db).create({
      id: ID,
      userId: ROW.user_id,
      amount: '150.25',
      note: null,
      createdAt: NOW,
      expiresAt: LATER,
    });

    expect(created?.requesterTag).toBe('ana.abcd');
    expect(sqlOf(db)).toContain('SELECT u.tag FROM rewallet.users u');
    // The wallet address is not a column of this table and never becomes one.
    expect(sqlOf(db)).not.toContain('wallets');
  });
});

describe('createPostgresPaymentRequestStore — reading a charge', () => {
  it('reads by the id alone, in one statement', async () => {
    const db = recordingDb([ROW]);

    await createPostgresPaymentRequestStore(db).findById(ID);

    const sql = sqlOf(db);
    expect(sql).toContain('FROM rewallet.payment_requests');
    expect(sql).toContain('JOIN rewallet.users u ON u.id = p.user_id');
    expect(valuesOf(db)).toContain(ID);
    // One round trip: the tag is resolved in the same statement that reads the
    // charge, not in a second query after it.
    expect(db.seen).toHaveLength(1);
  });

  it('never selects an address', async () => {
    const db = recordingDb([ROW]);

    await createPostgresPaymentRequestStore(db).findById(ID);

    // `address` is not on the read shape at all, so it cannot be in the SQL
    // either: the payee's wallet is resolved at payment time and nowhere else.
    const sql = sqlOf(db);
    expect(sql).not.toContain('address');
    expect(sql).not.toContain('rewallet.wallets');
    // Nor the payer's: `paid_by_user_id` is a uuid, and nothing here joins it.
    expect(sql).not.toContain('paid_movement_id');
  });

  it('maps the row the way the read shape declares it', async () => {
    const db = recordingDb([{ ...ROW, created_at: NOW.toISOString(), expires_at: LATER.toISOString() }]);

    const row = await createPostgresPaymentRequestStore(db).findById(ID);

    expect(row).toEqual({
      id: ID,
      userId: ROW.user_id,
      amount: '150.25',
      note: 'la vuelta',
      status: 'pending',
      createdAt: NOW,
      expiresAt: LATER,
      paidByUserId: null,
      paidAt: null,
      requesterTag: 'ana.abcd',
    });
  });

  it('reports a charge that is not there as `null`, not as an empty charge', async () => {
    const db = recordingDb([]);

    await expect(createPostgresPaymentRequestStore(db).findById(ID)).resolves.toBeNull();
  });
});

describe('createPostgresPaymentRequestStore — the one conditional UPDATE', () => {
  it('only moves a row that is still pending and not past its deadline', async () => {
    const db = recordingDb([{ ...ROW, status: 'paid', paid_by_user_id: ROW.user_id, paid_at: NOW }]);

    await createPostgresPaymentRequestStore(db).markPaid({
      id: ID,
      paidByUserId: ROW.user_id,
      paidMovementId: '33333333-3333-4333-8333-333333333333',
      paidAt: NOW,
    });

    // The whole "one link, one payment" rule is this predicate. Remove either
    // half and a second tap overwrites the payer, or an expired charge takes a
    // payment it should have refused.
    const sql = sqlOf(db);
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('expires_at >');
    expect(sql).toContain("SET status = 'paid'");
    expect(sql).toContain('paid_by_user_id =');
    expect(sql).toContain('paid_movement_id =');
    expect(sql).toContain('paid_at =');
  });

  it('binds the id, the payer, the movement and the moment — in that order', async () => {
    const db = recordingDb([ROW]);

    await createPostgresPaymentRequestStore(db).markPaid({
      id: ID,
      paidByUserId: ROW.user_id,
      paidMovementId: '33333333-3333-4333-8333-333333333333',
      paidAt: NOW,
    });

    const values = valuesOf(db);
    expect(values).toEqual([ID, ROW.user_id, '33333333-3333-4333-8333-333333333333', NOW.toISOString()]);
  });

  it('reports "nothing to move" as `null`, which is how a second tap is refused', async () => {
    // No row returned: already paid, or past `expires_at`. The use case re-reads
    // to say which of the two it was, because they are different sentences.
    const db = recordingDb([]);

    const moved = await createPostgresPaymentRequestStore(db).markPaid({
      id: ID,
      paidByUserId: ROW.user_id,
      paidMovementId: '33333333-3333-4333-8333-333333333333',
      paidAt: NOW,
    });

    expect(moved).toBeNull();
    expect(sqlOf(db)).toContain('RETURNING');
  });
});
