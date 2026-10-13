/**
 * `GET /api/notifications`, over HTTP.
 *
 * Three properties, and the third is the one a screen quietly breaks:
 *
 *   1. **The same door as every other route.** The session cookie, the same
 *      codec, the same 401. A feed is private data by construction.
 *   2. **Only this person's events.** The DID comes from the session claims, and
 *      the request has no parameter that could name somebody else.
 *   3. **No payload in the item.** A sentence, a category and a time. The row
 *      holds identifiers — and the feed reads the payload for exactly one
 *      thing, the amount — but none of it is what the screen renders.
 */
import { describe, expect, it } from 'vitest';

import { readNotifications, NOTIFICATIONS_PAGE_SIZE } from '../../src/application/webhooks/readNotifications';
import type { PersonWebhookEvent, WebhookEventStore } from '../../src/domain/ports/webhook-event-store';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { recordingLogger } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');
const NOW = new Date('2025-06-01T12:00:00.000Z');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DID = 'did:privy:2test0000000000000000000000000000000';
const OTHER_DID = 'did:privy:2other00000000000000000000000000000';

const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;

const acceptingCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
  read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: DID } : null),
});

/** Rows for two people. The store answers per DID, so a leak has to be a query. */
const rowsFor: Record<string, readonly PersonWebhookEvent[]> = {
  [DID]: [
    { id: 'e3', eventType: 'wallet.created', createdAt: new Date('2025-06-01T11:00:00Z'), payload: { user_did: DID } },
    { id: 'e2', eventType: 'user.created', createdAt: new Date('2025-06-01T10:00:00Z'), payload: { user_did: DID } },
  ],
  [OTHER_DID]: [
    { id: 'x1', eventType: 'user.created', createdAt: new Date('2025-06-01T11:30:00Z'), payload: { user_did: OTHER_DID } },
  ],
};

const fakeStore = (
  rows: Record<string, readonly PersonWebhookEvent[]> = rowsFor,
): WebhookEventStore & { readonly asked: { readonly privyDid: string; readonly limit: number }[] } => {
  const asked: { privyDid: string; limit: number }[] = [];
  return {
    asked,
    async store() {
      throw new Error('the feed must never write');
    },
    async listForPerson(privyDid, limit) {
      asked.push({ privyDid, limit });
      return [...(rows[privyDid] ?? [])].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    },
    async metrics() {
      return { walletsCreated: 0, activeUsers24h: 0, signIns: 0 };
    },
  };
};

const app = (store: WebhookEventStore) =>
  createApp({
    mint: async () => {
      throw new Error('unused');
    },
    sessions: acceptingCodec(),
    readNotifications: readNotifications({ store, log: recordingLogger() }),
    now: () => NOW,
    log: recordingLogger(),
  });

const get = (target: ReturnType<typeof createApp>, headers: Record<string, string> = {}, query = '') =>
  target.request(`/api/notifications${query}`, { headers });

describe('GET /api/notifications — the authenticated person', () => {
  it('returns only their own events, newest first', async () => {
    const store = fakeStore();

    const response = await get(app(store), { cookie: SESSION_COOKIE });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      notifications: { id: string; eventType: string; category: string; message: string; createdAt: string }[];
    };

    expect(body.notifications.map((n) => n.id)).toEqual(['e3', 'e2']);
    // The other person's row is newer than both of these, so a query that forgot
    // the DID would have put it first.
    expect(body.notifications.some((n) => n.id === 'x1')).toBe(false);
    expect(store.asked).toEqual([{ privyDid: DID, limit: NOTIFICATIONS_PAGE_SIZE }]);
  });

  it('asks for this person by DID, and nothing from the request can change it', async () => {
    const store = fakeStore();

    const response = await get(app(store), { cookie: SESSION_COOKIE }, `?privyDid=${OTHER_DID}&userId=${OTHER_DID}`);

    expect(response.status).toBe(200);
    expect(store.asked).toEqual([{ privyDid: DID, limit: NOTIFICATIONS_PAGE_SIZE }]);
    const body = (await response.json()) as { notifications: { id: string }[] };
    expect(body.notifications.some((n) => n.id === 'x1')).toBe(false);
  });

  it('bounds the page, and a caller cannot ask for more', async () => {
    const store = fakeStore();

    await get(app(store), { cookie: SESSION_COOKIE }, '?limit=100000');

    expect(store.asked[0]?.limit).toBe(NOTIFICATIONS_PAGE_SIZE);
    expect(store.asked[0]?.limit).toBeLessThanOrEqual(50);
  });

  it('carries a sentence, a category and a time, and no raw payload', async () => {
    const store = fakeStore();

    const response = await get(app(store), { cookie: SESSION_COOKIE });

    const body = (await response.json()) as { notifications: Record<string, unknown>[] };
    const [first] = body.notifications;

    expect(first).toEqual({
      id: 'e3',
      eventType: 'wallet.created',
      category: 'wallet',
      message: 'Se creó una billetera nueva en tu cuenta.',
      createdAt: '2025-06-01T11:00:00.000Z',
    });

    // Nothing that could carry an identifier from the payload reaches the screen.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('payload');
    expect(serialised).not.toContain('user_did');
    expect(serialised).not.toContain(DID);
    expect(Object.keys(first ?? {}).sort()).toEqual(['category', 'createdAt', 'eventType', 'id', 'message']);
  });
});

describe('GET /api/notifications — the door', () => {
  it('answers 401 without a cookie, and reads nothing', async () => {
    const store = fakeStore();

    const response = await get(app(store));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(store.asked).toEqual([]);
  });

  it('answers 401 for a cookie that does not verify, and reads nothing', async () => {
    const store = fakeStore();

    const response = await get(app(store), { cookie: `${SESSION_COOKIE_NAME}=stale.or.expired` });

    expect(response.status).toBe(401);
    expect(store.asked).toEqual([]);
  });
});

describe('GET /api/notifications — unattributable events', () => {
  it('never appears for anybody, and an empty feed is a 200', async () => {
    // App-level events are stored with no person. They belong to nobody, so the
    // feed for anybody is simply empty — not an error, not a placeholder row.
    const store = fakeStore({});

    const response = await get(app(store), { cookie: SESSION_COOKIE });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      generatedAt: '2025-06-01T12:00:00.000Z',
      notifications: [],
    });
  });
});

describe('GET /api/notifications — an unknown event type', () => {
  it('still produces a usable sentence, not a blank', async () => {
    const store = fakeStore({
      [DID]: [{ id: 'e9', eventType: 'wallet.something_new_2026', createdAt: new Date('2025-06-01T09:00:00Z'), payload: {} }],
    });

    const response = await get(app(store), { cookie: SESSION_COOKIE });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { notifications: { message: string; category: string }[] };
    const [item] = body.notifications;

    expect(item?.message.trim().length).toBeGreaterThan(0);
    expect(item?.category).toBe('other');
    // The sentence must not claim to know what happened.
    expect(item?.message).not.toContain('wallet.something_new_2026');
  });
});

describe('GET /api/notifications — a deposit that says how much', () => {
  const SENDER = '8o9sri4iYYvUKds7Lu3ENa4c7RDswwrrzNugjFkqwjxy';
  const RECIPIENT = '2FYhafYQKkrEMMgF1w5Y517xbd9iD2zX1KbXMvuG76RF';

  const depositRow = (payload: Record<string, unknown>): Record<string, PersonWebhookEvent[]> => ({
    [DID]: [{ id: 'd1', eventType: 'wallet.funds_deposited', createdAt: new Date('2025-06-01T12:00:00Z'), payload }],
  });

  const messageFor = async (payload: Record<string, unknown>): Promise<string> => {
    const response = await get(app(fakeStore(depositRow(payload))), { cookie: SESSION_COOKIE });
    const body = (await response.json()) as { notifications: { message: string }[] };
    return body.notifications[0]?.message ?? '';
  };

  it('renders the amount the catalog says, over HTTP, and no address with it', async () => {
    const message = await messageFor({
      type: 'wallet.funds_deposited',
      wallet_id: 'x2tmz6fpz57yv1q5bciddxzc',
      caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      asset: { type: 'native-token', address: null },
      amount: '6006650',
      sender: SENDER,
      recipient: RECIPIENT,
      transaction_hash: '4BsbV8gu',
    });

    expect(message).toBe('Entraron 0.00600665 SOL.');
    expect(message).not.toContain(SENDER);
    expect(message).not.toContain(RECIPIENT);
  });

  it('keeps the payload out of the body even when the payload names a person', async () => {
    const store = fakeStore(depositRow({ caip2: 'eip155:143', asset: { type: 'native-token' }, amount: '1000000000000000000', wallet_id: 'w1', sender: SENDER }));

    const response = await get(app(store), { cookie: SESSION_COOKIE });

    expect(response.status).toBe(200);
    const serialised = JSON.stringify(await response.json());
    expect(serialised).not.toContain(SENDER);
    expect(serialised).not.toContain('wallet_id');
  });
});

describe('GET /api/notifications — when the rows cannot be read', () => {
  it('answers 502, not an empty feed', async () => {
    const failing: WebhookEventStore = {
      store: async () => {
        throw new Error('the feed must never write');
      },
      listForPerson: async () => {
        throw new Error('connection terminated unexpectedly');
      },
      metrics: async () => ({ walletsCreated: 0, activeUsers24h: 0, signIns: 0 }),
    };

    const response = await get(app(failing), { cookie: SESSION_COOKIE });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'NOTIFICATIONS_UNAVAILABLE' } });
  });
});
