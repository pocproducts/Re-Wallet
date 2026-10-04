/**
 * The intake use case, on its own.
 *
 * The property worth stating once: **the store is called on exactly one path.**
 * Every rejection returns before it. That is what "an unverified payload is not
 * stored" means in code, and it is asserted by a store that throws if it is
 * reached, rather than by counting rows afterwards.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ingestPrivyWebhook } from '../../src/application/webhooks/ingestPrivyWebhook';
import type { VerifiedWebhookEvent, WebhookEventStore } from '../../src/domain/ports/webhook-event-store';
import { recordingLogger } from '../support/fixtures';

const SECRET = 'whsec_dGVzdF9zaWduaW5nX3NlY3JldF9ieXRlcw==';
const NOW = new Date('2025-06-01T12:00:00.000Z');
const DID = 'did:privy:2test0000000000000000000000000000000';

const sign = (id: string, timestamp: string, body: string): string => {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
};

const store = (behaviour: { readonly duplicate?: boolean } = {}) => {
  const stored: VerifiedWebhookEvent[] = [];
  const webhookStore: WebhookEventStore = {
    async store(event) {
      stored.push(event);
      return { inserted: behaviour.duplicate !== true && stored.length === 1 };
    },
    async listForPerson() {
      return [];
    },
  };
  return { stored, webhookStore };
};

/** A store that fails the test if anything reaches it. */
const unusableStore = (): WebhookEventStore => ({
  async store() {
    throw new Error('an unverified event must never reach the store');
  },
  async listForPerson() {
    return [];
  },
});

const ingest = (webhookStore: WebhookEventStore, toleranceSeconds?: number) =>
  ingestPrivyWebhook({ store: webhookStore, signingSecret: SECRET, toleranceSeconds, log: recordingLogger() });

const raw = JSON.stringify({ id: 'evt_1', type: 'user.created', user_did: DID });
const at = String(Math.floor(NOW.getTime() / 1000));

const deliver = (body: string, options: { id?: string; timestamp?: string; signature?: string } = {}) => ({
  body,
  headers: {
    id: options.id ?? 'msg_1',
    timestamp: options.timestamp ?? at,
    signature: options.signature ?? sign(options.id ?? 'msg_1', options.timestamp ?? at, body),
  },
  now: NOW,
});

describe('ingestPrivyWebhook — one verified event, one row', () => {
  it('stores the event it was given', async () => {
    const { stored, webhookStore } = store();

    const result = await ingest(webhookStore)(deliver(raw));

    expect(result).toEqual({ ok: true, inserted: true, eventType: 'user.created' });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({
      source: 'privy',
      eventType: 'user.created',
      externalId: 'evt_1',
      privyDid: DID,
      payload: { id: 'evt_1', type: 'user.created', user_did: DID },
      receivedAt: NOW,
    });
  });

  it('reports a duplicate as delivered, not as a failure', async () => {
    const { webhookStore } = store({ duplicate: true });

    const result = await ingest(webhookStore)(deliver(raw));

    // The delivery was honoured: the event is on file, Privy must stop retrying,
    // and a retry answer would start a retry loop against an event we already have.
    expect(result).toEqual({ ok: true, inserted: false, eventType: 'user.created' });
  });

  it('falls back to the transport id when the body carries no event id', async () => {
    const { stored, webhookStore } = store();
    const body = JSON.stringify({ type: 'user.created', user_did: DID });

    await ingest(webhookStore)(deliver(body));

    expect(stored[0]?.externalId).toBe('msg_1');
  });

  it('stores an event that belongs to nobody, without asking who it is', async () => {
    const { stored, webhookStore } = store();
    const body = JSON.stringify({ id: 'evt_app', type: 'app.updated', data: { region: 'sa-east-1' } });

    const result = await ingest(webhookStore)(deliver(body));

    expect(result.ok).toBe(true);
    expect(stored[0]?.privyDid).toBeNull();
  });

  it('accepts `event_type` and `event_id` as the field names for the type and the id', async () => {
    const { stored, webhookStore } = store();
    const body = JSON.stringify({ event_id: 'evt_2', event_type: 'wallet.created', user_did: DID });

    const result = await ingest(webhookStore)(deliver(body));

    expect(result).toEqual({ ok: true, inserted: true, eventType: 'wallet.created' });
    expect(stored[0]?.externalId).toBe('evt_2');
    expect(stored[0]?.privyDid).toBe(DID);
  });

  it('does not attribute an event from a field name nobody verified', async () => {
    const { stored, webhookStore } = store();
    // `user_id` is a shape this project has not seen from Privy. Reading it would
    // be a guess about who an event belongs to, and a wrong guess puts one
    // person's event in another person's feed.
    const body = JSON.stringify({ id: 'evt_3', type: 'user.created', user_id: DID });

    const result = await ingest(webhookStore)(deliver(body));

    expect(result.ok).toBe(true);
    expect(stored[0]?.privyDid).toBeNull();
  });
});

describe('ingestPrivyWebhook — every rejection happens before the store', () => {
  it('rejects a bad signature', async () => {
    await expect(
      ingest(unusableStore())(deliver(raw, { signature: 'v1,bm90LWEtc2lnbmF0dXJl' })),
    ).resolves.toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects missing signature headers', async () => {
    await expect(
      ingest(unusableStore())({ body: raw, headers: { id: null, timestamp: null, signature: null }, now: NOW }),
    ).resolves.toEqual({ ok: false, reason: 'MISSING_HEADERS' });
  });

  it('rejects a stale timestamp', async () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
    await expect(ingest(unusableStore())(deliver(raw, { timestamp: old }))).resolves.toEqual({
      ok: false,
      reason: 'STALE',
    });
  });

  it('rejects a malformed timestamp', async () => {
    await expect(ingest(unusableStore())(deliver(raw, { timestamp: 'soon' }))).resolves.toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });

  it('rejects a body that is not JSON, and one that is not an object', async () => {
    await expect(ingest(unusableStore())(deliver('not json'))).resolves.toEqual({
      ok: false,
      reason: 'BAD_PAYLOAD',
    });
    await expect(ingest(unusableStore())(deliver('"a string"'))).resolves.toEqual({
      ok: false,
      reason: 'BAD_PAYLOAD',
    });
    await expect(ingest(unusableStore())(deliver('null'))).resolves.toEqual({
      ok: false,
      reason: 'BAD_PAYLOAD',
    });
  });

  it('rejects a signed payload with no event type', async () => {
    await expect(ingest(unusableStore())(deliver(JSON.stringify({ id: 'evt_3' })))).resolves.toEqual({
      ok: false,
      reason: 'BAD_PAYLOAD',
    });
  });

  it('honours an explicit tolerance, and does not widen it on its own', async () => {
    const fifteenMinutesAgo = String(Math.floor(NOW.getTime() / 1000) - 900);
    const { webhookStore } = store();

    await expect(ingest(webhookStore)(deliver(raw, { timestamp: fifteenMinutesAgo }))).resolves.toEqual({
      ok: false,
      reason: 'STALE',
    });
    await expect(
      ingest(webhookStore, 1800)(deliver(raw, { timestamp: fifteenMinutesAgo })),
    ).resolves.toEqual({ ok: true, inserted: true, eventType: 'user.created' });
  });
});
