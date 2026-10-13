/**
 * `POST /api/webhooks/privy`, over HTTP.
 *
 * This endpoint is the only unauthenticated-by-cookie write in the Worker, and
 * that is exactly why it is tested this hard: it is reachable by anybody on the
 * internet. The three properties that make it safe are asserted here and none of
 * them is about the happy path:
 *
 *   1. **Nothing unverified is stored.** A bad signature, and headers that are
 *      not there at all, both answer 401 and write nothing. Not "write it with a
 *      flag": write nothing.
 *   2. **The body is the signed thing.** The signature covers the raw bytes, so a
 *      body edited after signing is refused.
 *   3. **Freshness and replay are two different defences.** An old timestamp is
 *      refused as stale; a replay with a *fresh* signature is refused by
 *      `external_id` already being on file — and still answers 200, because the
 *      delivery has been honoured and Privy must stop retrying it.
 *
 * Signing here uses `node:crypto` on purpose. A test that reuses the
 * implementation's own HMAC helper proves only that the code agrees with itself;
 * this one re-derives the scheme from the documented string
 * `<id>.<timestamp>.<body>`.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ingestPrivyWebhook } from '../../src/application/webhooks/ingestPrivyWebhook';
import type {
  StoredWebhookEvent,
  VerifiedWebhookEvent,
  WebhookEventStore,
} from '../../src/domain/ports/webhook-event-store';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { recordingLogger } from '../support/fixtures';

const SECRET = 'whsec_dGVzdF9zaWduaW5nX3NlY3JldF9ieXRlcw==';
const NOW = new Date('2025-06-01T12:00:00.000Z');

const DID = 'did:privy:2test0000000000000000000000000000000';
const USER_ID = '11111111-1111-4111-8111-111111111111';

/** The scheme, re-derived: base64(HMAC-SHA256(key, `${id}.${ts}.${body}`)). */
const sign = (id: string, timestamp: string, body: string, secret: string = SECRET): string => {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const mac = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
};

const body = (event: Record<string, unknown>): string => JSON.stringify(event);

/** A store that enforces `UNIQUE (source, external_id)`, like the real table does. */
const fakeStore = (): WebhookEventStore & { readonly rows: VerifiedWebhookEvent[] } => {
  const rows: VerifiedWebhookEvent[] = [];
  return {
    rows,
    async store(event: VerifiedWebhookEvent): Promise<StoredWebhookEvent> {
      const already = rows.some((row) => row.source === event.source && row.externalId === event.externalId);
      if (already) return { inserted: false };
      rows.push(event);
      return { inserted: true };
    },
    async listForPerson() {
      return [];
    },
    async metrics() {
      return { walletsCreated: 0, activeUsers24h: 0, signIns: 0 };
    },
  };
};

const app = (store: WebhookEventStore, signingSecret: string = SECRET) =>
  createApp({
    mint: async () => {
      throw new Error('this route must never mint a session');
    },
    sessions: { issue: async () => ({ token: 'rw1.x', expiresAt: NOW }), read: async () => null } as SessionCodec,
    ingestWebhook: ingestPrivyWebhook({ store, signingSecret, log: recordingLogger() }),
    now: () => NOW,
    log: recordingLogger(),
  });

const post = (
  target: ReturnType<typeof createApp>,
  payload: string,
  headers: Record<string, string> = {},
) =>
  target.request('/api/webhooks/privy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: payload,
  });

/** A correctly signed request. `timestamp` defaults to "now". */
const signed = (
  target: ReturnType<typeof createApp>,
  event: Record<string, unknown>,
  options: { readonly id?: string; readonly timestamp?: string; readonly secret?: string; readonly signature?: string } = {},
) => {
  const raw = body(event);
  const id = options.id ?? 'msg_1';
  const timestamp = options.timestamp ?? String(Math.floor(NOW.getTime() / 1000));
  const signature = options.signature ?? sign(id, timestamp, raw, options.secret ?? SECRET);
  return post(target, raw, {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': signature,
  });
};

describe('POST /api/webhooks/privy — a validly signed event', () => {
  it('answers 200 with an empty body and stores the verified event', async () => {
    const store = fakeStore();
    const event = { object: 'event', type: 'user.created', user_did: DID, created_at: '2025-06-01T11:59:59Z' };

    const response = await signed(app(store), event);

    expect(response.status).toBe(200);
    // Empty body: Privy stops retrying on 200, and a webhook answer is not a
    // document. A body here would be a payload the endpoint chose to invent.
    expect(await response.text()).toBe('');

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toEqual({
      source: 'privy',
      eventType: 'user.created',
      externalId: 'msg_1',
      privyDid: DID,
      payload: event,
      receivedAt: NOW,
    });
  });

  it('takes the event type and the external id from the body, not from the headers', async () => {
    const store = fakeStore();
    const event = { id: 'evt_abc', type: 'wallet.created', user_did: DID };

    await signed(app(store), event, { id: 'msg_transport_only' });

    // The transport id identifies the delivery; the body's id identifies the
    // event. Deduping on the transport id would store one row per retry.
    expect(store.rows[0]?.eventType).toBe('wallet.created');
    expect(store.rows[0]?.externalId).toBe('evt_abc');
  });

  it('stores an app-level event with no person, rather than refusing it', async () => {
    const store = fakeStore();

    const response = await signed(app(store), { object: 'event', type: 'app.updated', data: { region: 'sa-east-1' } });

    expect(response.status).toBe(200);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.privyDid).toBeNull();
  });
});

describe('POST /api/webhooks/privy — nothing unverified is stored', () => {
  it('answers 401 for a bad signature and writes nothing', async () => {
    const store = fakeStore();

    const response = await signed(app(store), { type: 'user.created', user_did: DID }, {
      signature: 'v1,bm90LWEtc2lnbmF0dXJl',
    });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 when no signature headers are present at all, and writes nothing', async () => {
    const store = fakeStore();

    const response = await post(app(store), body({ type: 'user.created', user_did: DID }));

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 when only some of the three headers are present, and writes nothing', async () => {
    const store = fakeStore();
    const raw = body({ type: 'user.created', user_did: DID });
    const timestamp = String(Math.floor(NOW.getTime() / 1000));

    const response = await post(app(store), raw, {
      'svix-id': 'msg_1',
      'svix-timestamp': timestamp,
      // no svix-signature
    });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 for a body edited after it was signed', async () => {
    const store = fakeStore();
    const id = 'msg_1';
    const timestamp = String(Math.floor(NOW.getTime() / 1000));

    // Signed over `{"type":"user.created"}`, delivered with the DID added.
    const signature = sign(id, timestamp, JSON.stringify({ type: 'user.created' }));
    const response = await post(app(store), JSON.stringify({ type: 'user.created', user_did: DID }), {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 for a signature made with the wrong secret', async () => {
    const store = fakeStore();

    const response = await signed(app(store), { type: 'user.created', user_did: DID }, {
      secret: 'whsec_d29ya3VfY2xvb2tpZV9fbm90X3RoaXM=',
    });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 for a malformed timestamp instead of throwing', async () => {
    const store = fakeStore();

    const response = await signed(app(store), { type: 'user.created', user_did: DID }, {
      timestamp: 'not-a-number',
    });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });
});

describe('POST /api/webhooks/privy — freshness and replay', () => {
  it('answers 401 as stale for a correctly signed event with an old timestamp, and writes nothing', async () => {
    const store = fakeStore();
    const tenMinutesAgo = String(Math.floor(NOW.getTime() / 1000) - 600);

    const response = await signed(app(store), { type: 'user.created', user_did: DID }, { timestamp: tenMinutesAgo });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'WEBHOOK_SIGNATURE_STALE' } });
    expect(store.rows).toEqual([]);
  });

  it('answers 401 as stale for a timestamp from the future', async () => {
    const store = fakeStore();
    const inTenMinutes = String(Math.floor(NOW.getTime() / 1000) + 600);

    const response = await signed(app(store), { type: 'user.created', user_did: DID }, { timestamp: inTenMinutes });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('stores one row when the same event id is delivered twice', async () => {
    const store = fakeStore();
    const target = app(store);
    const event = { id: 'evt_abc', type: 'wallet.created', user_did: DID };

    const first = await signed(target, event, { id: 'msg_1' });
    const second = await signed(target, event, { id: 'msg_2' });

    // Both deliveries were honoured — a retry must not make Privy retry again.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store.rows).toHaveLength(1);
  });

  it('refuses a replay with a fresh signature on external_id, not on the clock', async () => {
    const store = fakeStore();
    const target = app(store);
    const event = { id: 'evt_abc', type: 'wallet.created', user_did: DID };

    await signed(target, event, { id: 'msg_1' });
    // A minute later, an attacker or a misconfigured sender replays the exact
    // bytes with a fresh, correctly signed header set.
    const replayed = await signed(target, event, { id: 'msg_3' });

    expect(replayed.status).toBe(200);
    expect(await replayed.text()).toBe('');
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.externalId).toBe('evt_abc');
  });
});

describe('POST /api/webhooks/privy — what it does not accept', () => {
  it('answers 400 for a body that is not JSON, and writes nothing', async () => {
    const store = fakeStore();
    const target = app(store);
    const id = 'msg_1';
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    const raw = 'not json at all';

    const response = await post(target, raw, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': sign(id, timestamp, raw),
    });

    expect(response.status).toBe(400);
    expect(store.rows).toEqual([]);
  });

  it('answers 400 for a signed payload with no event type, and writes nothing', async () => {
    const store = fakeStore();

    const response = await signed(app(store), { user_did: DID });

    expect(response.status).toBe(400);
    expect(store.rows).toEqual([]);
  });

  it('does nothing beyond storing: no other request reaches the store', async () => {
    const store = fakeStore();
    const target = app(store);

    await signed(target, { id: 'evt_1', type: 'user.created', user_did: DID });
    await signed(target, { id: 'evt_2', type: 'user.updated', user_did: DID });

    // Two events, two rows, one write each. The intake has no second job.
    expect(store.rows.map((row) => row.eventType)).toEqual(['user.created', 'user.updated']);
  });

  it('has no read method, so this endpoint cannot be asked what it received', async () => {
    const store = fakeStore();

    const response = await app(store).request('/api/webhooks/privy');

    expect(response.status).toBe(404);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 for a session cookie alone, because the cookie is not the credential', async () => {
    const store = fakeStore();

    // The route has no door for the session cookie. A signed-out browser with a
    // valid-looking cookie is still an anonymous writer here.
    const response = await post(app(store), body({ type: 'user.created', user_did: DID }), {
      cookie: `${SESSION_COOKIE_NAME}=rw1.super.secret`,
    });

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 401 when the signature header carries only a future scheme version', async () => {
    const store = fakeStore();
    const id = 'msg_1';
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    const raw = body({ id: 'evt_1', type: 'user.created', user_did: DID });

    const response = await post(app(store), raw, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v2,${sign(id, timestamp, raw).slice('v1,'.length)}`,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'WEBHOOK_SIGNATURE_MALFORMED' } });
    expect(store.rows).toEqual([]);
  });

  it('answers the internal error boundary when the database is unreachable, not a 200', async () => {
    const failing: WebhookEventStore = {
      async store() {
        throw new Error('connection terminated unexpectedly');
      },
      async listForPerson() {
        return [];
      },
    async metrics() {
      return { walletsCreated: 0, activeUsers24h: 0, signIns: 0 };
    },
    };

    const response = await signed(app(failing), { id: 'evt_1', type: 'user.created', user_did: DID });

    // A write that did not happen must not look like one that did.
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('connection terminated');
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL' } });
  });
});

describe('POST /api/webhooks/privy — not mounted without a signing secret', () => {
  it('is absent, rather than accepting unverified events', async () => {
    const store = fakeStore();
    const withoutIngest = createApp({
      mint: async () => {
        throw new Error('unused');
      },
      sessions: { issue: async () => ({ token: 'rw1.x', expiresAt: NOW }), read: async () => null } as SessionCodec,
      now: () => NOW,
    });

    const response = await post(withoutIngest, body({ type: 'user.created', user_did: DID }));

    expect(response.status).toBe(404);
    expect(store.rows).toEqual([]);
  });
});
