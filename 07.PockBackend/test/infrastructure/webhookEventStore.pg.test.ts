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
 *   4. The feed also matches the person's own wallets by `wallet_id` — the only
 *      thing Privy's money events carry. An event whose `wallet_id` is not one of
 *      this person's is not in their feed, and one that belongs to nobody is in
 *      nobody's.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresWebhookEventStore } from '../../src/infrastructure/db/webhookEventStore.pg';
import type { VerifiedWebhookEvent } from '../../src/domain/ports/webhook-event-store';
import { containmentShape, PERSON_DID_PATHS, PERSON_WALLET_ID_PATHS } from '../../src/domain/webhooks/attribution';

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

/* ── A model of the feed query's semantics ────────────────────────────────────
 *
 * There is no database in this suite, so the shapes are pinned from both sides:
 * the statement this adapter writes (asserted as text, below) and what that
 * statement means for real Privy payloads (asserted here).
 *
 * The interpreter is deliberately small: it understands exactly the two term
 * shapes the adapter emits — `payload @> $n::jsonb` and
 * `payload @> ANY (SELECT … FROM rewallet.wallets w JOIN rewallet.users u …)` —
 * and refuses anything else rather than guessing. It models Postgres `jsonb`
 * containment for the documents these events are.
 */

interface FixtureWallet {
  readonly provider_wallet_id: string | null;
  readonly userDid: string;
}

/** `a @> b` for the document shapes these events carry: objects and primitives. */
const jsonbContains = (document: unknown, shape: unknown): boolean => {
  if (shape === null) return document === null;
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return document === shape;
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return false;
  return Object.entries(shape as Record<string, unknown>).every(
    ([key, value]) => key in (document as Record<string, unknown>) &&
      jsonbContains((document as Record<string, unknown>)[key], value),
  );
};

/** `jsonb_build_object('data', jsonb_build_object('wallet_id', …))` → `['data', 'wallet_id']`. */
const containmentKeys = (expression: string): string[] | null => {
  const keys: string[] = [];
  let rest = expression.trim();
  while (rest.startsWith('jsonb_build_object(')) {
    const open = rest.indexOf("'", 'jsonb_build_object('.length);
    if (open < 0) return null;
    const close = rest.indexOf("'", open + 1);
    if (close < 0) return null;
    keys.push(rest.slice(open + 1, close));
    // What is inside the call, minus the comma and the closing paren.
    rest = rest.slice(close + 1).trim().replace(/^,\s*/, '').replace(/\)$/, '').trim();
  }
  return rest === 'w.provider_wallet_id' ? keys : null;
};

/**
 * Answers `listForPerson` from the emitted SQL, against fixtures.
 *
 * `rows` are the stored events; `wallets` is `rewallet.wallets` joined to
 * `rewallet.users`. Unknown terms throw, so a change in the adapter's SQL that this
 * model cannot read fails loudly instead of silently passing.
 */
const semanticDb = (
  rows: readonly { readonly id: string; readonly event_type: string; readonly created_at: string; readonly payload: Record<string, unknown> }[],
  wallets: readonly FixtureWallet[],
): Database => {
  const query = async (sql: string, params: readonly unknown[] = []): Promise<unknown> => {
    const where = /WHERE \(([\s\S]*)\)\s*ORDER BY/.exec(sql)?.[1];
    if (where === undefined) throw new Error(`no parenthesised WHERE to read in: ${sql}`);

    const matches = (payload: Record<string, unknown>, term: string): boolean => {
      const constant = /^payload @> \$(\d+)::jsonb$/.exec(term.trim());
      if (constant) return jsonbContains(payload, JSON.parse(String(params[Number(constant[1]) - 1])));

      const owned = /^payload @> ANY \(SELECT ([\s\S]*) FROM rewallet\.wallets w\s+JOIN rewallet\.users u ON u\.id = w\.user_id\s+WHERE u\.privy_did = \$(\d+)\s+AND w\.provider_wallet_id IS NOT NULL\)$/.exec(
        term.trim(),
      );
      if (owned) {
        const keys = containmentKeys(owned[1] as string);
        if (keys === null) throw new Error(`cannot read containment expression: ${owned[1]}`);
        return wallets
          // The statement's own `w.provider_wallet_id IS NOT NULL` is what keeps
          // a null out of the candidate set; `owned[1]` cannot match without it.
          .filter((wallet) => wallet.userDid === params[Number(owned[2]) - 1] && wallet.provider_wallet_id !== null)
          .some((wallet) => jsonbContains(payload, containmentShape(keys.join('.'), wallet.provider_wallet_id as string)));
      }

      throw new Error(`this model does not read the term: ${term}`);
    };

    const terms = where.split(' OR ');
    return rows
      .filter((row) => terms.some((term) => matches(row.payload, term)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  };

  return Object.assign(() => Promise.resolve([]), {
    unsafe: (sql: string) => sql,
    query,
    json: (value: unknown) => value,
  }) as unknown as Database;
};

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

describe('createPostgresWebhookEventStore — attributing money events', () => {
  const MINE = 'fmfdj6yq2rer86yvy1toc52vbhqqle7rr';
  const THEIRS = 'fmfdjother';
  const NOBODY = 'fmfdjunknown';
  const OTHER_DID = 'did:privy:2other00000000000000000000000000000';

  const WALLETS: readonly FixtureWallet[] = [
    { provider_wallet_id: MINE, userDid: DID },
    { provider_wallet_id: THEIRS, userDid: OTHER_DID },
    // A row we wrote before we knew the wallet's id. It must not become a match.
    { provider_wallet_id: null, userDid: DID },
  ];

  const deposit = (walletId: string) => ({
    id: 'e-deposit',
    event_type: 'wallet.funds_deposited',
    created_at: '2025-06-01T11:00:00.000Z',
    payload: {
      id: 'e-deposit',
      type: 'wallet.funds_deposited',
      wallet_id: walletId,
      caip2: 'eip155:143',
      asset: { type: 'native', address: '0x0000000000000000000000000000000000000000' },
      amount: '400000000000000000',
      transaction_hash: '0xabc',
      sender: '0xsender',
      recipient: '0xrecipient',
      block: { number: 1 },
    },
  });

  const broadcast = (walletId: string) => ({
    id: 'e-broadcast',
    event_type: 'transaction.broadcasted',
    created_at: '2025-06-01T10:00:00.000Z',
    payload: { id: 'e-broadcast', type: 'transaction.broadcasted', data: { wallet_id: walletId, transaction_id: 'tx_1', caip2: 'eip155:143' } },
  });

  const account = () => ({
    id: 'e-account',
    event_type: 'user.created',
    created_at: '2025-06-01T09:00:00.000Z',
    payload: { id: 'e-account', type: 'user.created', user_did: DID },
  });

  const idsOf = async (db: Database): Promise<string[]> =>
    (await createPostgresWebhookEventStore(db).listForPerson(DID, 50)).map((row) => row.id);

  it('returns a money event whose wallet_id is one of the person\'s wallets', async () => {
    const db = semanticDb([deposit(MINE)], WALLETS);

    await expect(idsOf(db)).resolves.toEqual(['e-deposit']);
  });

  it('does not return a money event whose wallet_id belongs to nobody', async () => {
    // The failure this exists to prevent: not attributable is not "somebody's".
    const db = semanticDb([deposit(NOBODY)], WALLETS);

    await expect(idsOf(db)).resolves.toEqual([]);
  });

  it('does not return a money event that belongs to another person', async () => {
    const db = semanticDb([deposit(THEIRS)], WALLETS);

    await expect(idsOf(db)).resolves.toEqual([]);
  });

  it('reads the real production shapes, which carry `user_id` and no DID', async () => {
    // The two rows that were really on file: `user_id` at the top level.
    const signedIn = () => ({
      id: 'e-signed-in',
      event_type: 'user.signed_in',
      created_at: '2025-06-01T08:00:00.000Z',
      payload: { id: 'e-signed-in', type: 'user.signed_in', user_id: DID },
    });
    const walletCreated = () => ({
      id: 'e-wallet-created',
      event_type: 'wallet.created',
      created_at: '2025-06-01T09:00:00.000Z',
      payload: { id: 'e-wallet-created', type: 'wallet.created', user_id: DID, wallet_id: MINE },
    });

    // Before `user_id` was in the list, both of these came back empty.
    await expect(idsOf(semanticDb([signedIn()], WALLETS))).resolves.toEqual(['e-signed-in']);
    await expect(idsOf(semanticDb([walletCreated()], WALLETS))).resolves.toEqual(['e-wallet-created']);
  });

  it('does not return another person\'s account event', async () => {
    // `user_id` and the wallet subquery are two independent ways to leak somebody
    // else's event into this feed. Both are checked, here and in the fixtures.
    const theirs = {
      id: 'e-theirs',
      event_type: 'user.signed_in',
      created_at: '2025-06-01T08:00:00.000Z',
      payload: { id: 'e-theirs', type: 'user.signed_in', user_id: OTHER_DID },
    };

    await expect(idsOf(semanticDb([theirs], WALLETS))).resolves.toEqual([]);
  });

  it('finds the transaction shape, where the wallet id is nested under data', async () => {
    const db = semanticDb([broadcast(MINE), broadcast(NOBODY)], WALLETS);

    await expect(idsOf(db)).resolves.toEqual(['e-broadcast']);
  });

  it('does not let a null provider_wallet_id match an event with no wallet id', async () => {
    // The fixtures hold a wallet of this person's whose `provider_wallet_id` is
    // still null. It must contribute no shape at all — not a `{"wallet_id": null}`
    // containment, which would be a match waiting to happen.
    const db = semanticDb([{ ...deposit(MINE), payload: { type: 'wallet.funds_deposited' } }], WALLETS);

    await expect(idsOf(db)).resolves.toEqual([]);
  });

  it('still finds the DID events, alongside the money ones', async () => {
    const db = semanticDb([account(), deposit(MINE), broadcast(MINE)], WALLETS);

    // Newest first, across both rules: one filter, one feed.
    await expect(idsOf(db)).resolves.toEqual(['e-deposit', 'e-broadcast', 'e-account']);
  });

  it('resolves the wallets by the person\'s DID, in the same statement', async () => {
    const db = recordingDb([]);

    await createPostgresWebhookEventStore(db).listForPerson(DID, 50);

    const personParameter = PERSON_DID_PATHS.length + 1;
    const sql = sqlOf(db);
    expect(sql).toContain('JOIN rewallet.users u ON u.id = w.user_id');
    expect(sql).toContain(`u.privy_did = $${personParameter}`);
    expect(valuesOf(db)).toContain(DID);
    // One `OR` per known wallet-id path, built from the domain list.
    for (const path of PERSON_WALLET_ID_PATHS) {
      expect(sql).toContain(`'${path.split('.').slice(-1)[0] as string}'`);
    }
    expect(sql).toContain("jsonb_build_object('data'");
  });

  it('never builds a candidate out of a null provider_wallet_id', async () => {
    const db = recordingDb([]);

    await createPostgresWebhookEventStore(db).listForPerson(DID, 50);

    expect(sqlOf(db)).toContain('w.provider_wallet_id IS NOT NULL');
  });

  it('binds the DID and keeps the hard limit after the extra terms', async () => {
    const db = recordingDb([]);

    await createPostgresWebhookEventStore(db).listForPerson(DID, 50);

    const sql = sqlOf(db);
    const values = valuesOf(db);
    // Every placeholder the statement mentions is supplied, in order.
    const highest = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    expect(values).toHaveLength(highest);
    expect(values.at(-2)).toBe(DID);
    expect(values.at(-1)).toBe(50);
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain(`LIMIT $${highest}`);
  });

  it('keeps the containment shapes the wallet terms test with', async () => {
    // The shapes the SQL builds are the ones the domain list describes.
    expect(containmentShape('wallet_id', MINE)).toEqual({ wallet_id: MINE });
    expect(containmentShape('data.wallet_id', MINE)).toEqual({ data: { wallet_id: MINE } });
    expect(jsonbContains(deposit(MINE).payload, containmentShape('wallet_id', MINE))).toBe(true);
    expect(jsonbContains(deposit(MINE).payload, containmentShape('wallet_id', NOBODY))).toBe(false);
  });
});
