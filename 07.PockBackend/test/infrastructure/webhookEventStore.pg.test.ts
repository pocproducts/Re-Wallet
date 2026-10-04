/**
 * The Postgres adapter, against a fake transport.
 *
 * What is under test is the **translation** — the SQL that this project chose to
 * write into a table that already exists. Three of its choices are invisible from
 * the application layer and are the ones that would bite:
 *
 *   1. `ON CONFLICT (source, external_id) DO NOTHING`, with `RETURNING id`, and
 *      "no row returned" reported as a duplicate rather than raised. Privy
 *      retries; the retry must not raise a constraint error at a route.
 *   2. `signature_valid = true` is written on every row this adapter writes,
 *      because a row that says the signature was checked is an audit fact.
 *   3. The feed filters on `payload @> …` for the same shapes the intake reads
 *      the person from, ordered newest first with a hard `LIMIT`.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresWebhookEventStore } from '../../src/infrastructure/db/webhookEventStore.pg';
import type { VerifiedWebhookEvent } from '../../src/domain/ports/webhook-event-store';

const DID = 'did:privy:2test0000000000000000000000000000000';
const NOW = new Date('2025-06-01T12:00:00.000Z');

const EVENT: VerifiedWebhookEvent = {
  source: 'privy',
  eventType: 'user.created',
  externalId: 'evt_1',
  privyDid: DID,
  payload: { id: 'evt_1', type: 'user.created', user_did: DID },
  receivedAt: NOW,
};

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

const sqlOf = (db: { readonly seen: { text: string; values: unknown[] }[] }): string =>
  db.seen.map((call) => call.text).join('\n');

const valuesOf = (db: { readonly seen: { text: string; values: unknown[] }[] }): unknown[] =>
  db.seen.flatMap((call) => call.values);

describe('createPostgresWebhookEventStore — writing', () => {
  it('writes the verified row into the columns the table already has', async () => {
    const db = recordingDb([{ id: '22222222-2222-4222-8222-222222222222' }]);

    await createPostgresWebhookEventStore(db).store(EVENT);

    const sql = sqlOf(db);
    expect(sql).toContain('INSERT INTO rewallet.webhook_events');
    for (const column of ['source', 'event_type', 'external_id', 'payload', 'signature_valid', 'created_at']) {
      expect(sql).toContain(column);
    }
    // The signature was checked before this row was written, and the row says so.
    expect(sql).toContain('true');
    // Nothing that does not exist in the table.
    expect(sql).not.toContain('processed_at');
    expect(sql).not.toContain('privy_did');
  });

  it('passes the event, not a re-serialised guess at it', async () => {
    const db = recordingDb([{ id: '22222222-2222-4222-8222-222222222222' }]);

    await createPostgresWebhookEventStore(db).store(EVENT);

    const values = valuesOf(db);
    expect(values).toContain('privy');
    expect(values).toContain('user.created');
    expect(values).toContain('evt_1');
    expect(values).toContain(NOW.toISOString());
    expect(values.some((value) => JSON.stringify(value)?.includes('user_did'))).toBe(true);
  });

  it('reports a conflict as a duplicate instead of raising', async () => {
    // `DO NOTHING` returns no row. A retry is a delivery we already honoured.
    const db = recordingDb([]);

    const result = await createPostgresWebhookEventStore(db).store(EVENT);

    expect(result).toEqual({ inserted: false });
    expect(sqlOf(db)).toContain('ON CONFLICT');
    expect(sqlOf(db)).toContain('DO NOTHING');
    expect(sqlOf(db)).toContain('RETURNING');
  });

  it('reports a first write as inserted', async () => {
    const db = recordingDb([{ id: '22222222-2222-4222-8222-222222222222' }]);

    await expect(createPostgresWebhookEventStore(db).store(EVENT)).resolves.toEqual({ inserted: true });
  });
});

describe('createPostgresWebhookEventStore — the feed query', () => {
  it('filters by this person, newest first, with a hard limit', async () => {
    const db = recordingDb([]);

    await createPostgresWebhookEventStore(db).listForPerson(DID, 50);

    const sql = sqlOf(db);
    expect(sql).toContain('FROM rewallet.webhook_events');
    expect(sql).toContain('payload');
    // Bounded: the limit is a parameter, and the query cannot grow without it.
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('DESC');
    expect(valuesOf(db)).toContain(50);
    // Only the columns the item is built from. The payload itself is not selected:
    // the sentence is computed in the application, from the event type.
    expect(sql).not.toContain('SELECT payload');
  });

  it('matches every shape the intake reads the person from', async () => {
    const db = recordingDb([]);

    await createPostgresWebhookEventStore(db).listForPerson(DID, 50);

    const sql = sqlOf(db);
    expect(sql.match(/@>/g)?.length).toBeGreaterThanOrEqual(2);
    const serialised = JSON.stringify(valuesOf(db));
    expect(serialised).toContain('user_did');
    expect(serialised).toContain(`user\\":{\\"id\\":\\"${DID}`);
  });

  it('returns rows as the feed needs them, and nothing more', async () => {
    const db = recordingDb([
      { id: 'e3', event_type: 'wallet.created', created_at: '2025-06-01T11:00:00.000Z' },
      { id: 'e2', event_type: 'user.created', created_at: '2025-06-01T10:00:00.000Z' },
    ]);

    const rows = await createPostgresWebhookEventStore(db).listForPerson(DID, 50);

    expect(rows).toEqual([
      { id: 'e3', eventType: 'wallet.created', createdAt: new Date('2025-06-01T11:00:00.000Z') },
      { id: 'e2', eventType: 'user.created', createdAt: new Date('2025-06-01T10:00:00.000Z') },
    ]);
  });
});
