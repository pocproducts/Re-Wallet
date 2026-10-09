/**
 * The intake: one signed Privy webhook becomes one stored row, or one rejection.
 *
 * ── Why nothing unverified is ever stored ────────────────────────────────────
 *
 * A webhook endpoint on a public Worker is an open write surface for anybody on
 * the internet unless the signature is checked first. Storing a payload "for
 * observability" would put one table on the wrong side of that line: the feed
 * reads from it, and a feed is a screen a person trusts. An unverified payload is
 * refused, and **nothing is written** — not the payload, not a row with
 * `signature_valid = false`. Rejection is the whole answer.
 *
 * ── Why a duplicate is a success ──────────────────────────────────────────────
 *
 * Privy retries until it gets a 2xx, and a retry carries the same event id. The
 * row is already on file, so the delivery has been honoured: answering 200 with
 * an empty body stops the retry loop. Answering 4xx would start it — Privy would
 * keep delivering an event we already have, and every attempt would be a 4xx in
 * somebody's dashboard. The defence against a replay is `external_id`, and the
 * freshness check is a second, independent defence against a captured request
 * being replayed later; neither one is a reason to fail a delivery.
 *
 * ── Why there is no second job ────────────────────────────────────────────────
 *
 * Storing is all this does. No wallet work, no push, no `processed_at`: the
 * columns exist for a worker that has not been written, and writing them here
 * would claim that something was processed when nothing was.
 */
import type { WebhookEventStore } from '../../domain/ports/webhook-event-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import { extractPersonDid } from '../../domain/webhooks/attribution';
import type { SignatureRejection, SvixHeaders } from '../../domain/webhooks/svixSignature';
import { verifySvixSignature } from '../../domain/webhooks/svixSignature';

export type WebhookRejection = SignatureRejection | 'BAD_PAYLOAD' | 'NO_EVENT_ID';

export type IngestResult =
  | { readonly ok: true; readonly inserted: boolean; readonly eventType: string }
  | { readonly ok: false; readonly reason: WebhookRejection };

export interface IngestPrivyWebhook {
  (input: {
    /** The **raw** body, exactly as it arrived. */
    readonly body: string;
    readonly headers: SvixHeaders;
    readonly now: Date;
  }): Promise<IngestResult>;
}

/** The field names Privy and Svix are read through, in order of preference. */
const EVENT_TYPE_FIELDS = ['type', 'event_type', 'eventType'] as const;
const EVENT_ID_FIELDS = ['id', 'event_id', 'eventId', 'external_id'] as const;

const firstString = (payload: Record<string, unknown>, fields: readonly string[]): string | null => {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
};

export const ingestPrivyWebhook = (deps: {
  readonly store: WebhookEventStore;
  readonly signingSecret: string;
  readonly toleranceSeconds?: number;
  readonly log?: Logger;
}): IngestPrivyWebhook => {
  const log = deps.log ?? noopLogger;

  return async (input): Promise<IngestResult> => {
    // 1. Authenticity and freshness, before anything is parsed or written.
    const verdict = await verifySvixSignature({
      body: input.body,
      headers: input.headers,
      secret: deps.signingSecret,
      now: input.now,
      ...(deps.toleranceSeconds === undefined ? {} : { toleranceSeconds: deps.toleranceSeconds }),
    });

    if (!verdict.ok) {
      log.error(`webhook.privy rejected (${verdict.reason})`);
      return { ok: false, reason: verdict.reason };
    }

    // 2. The payload. Signed, but still not a document we understand.
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.body);
    } catch {
      log.error('webhook.privy rejected (the body is not JSON)');
      return { ok: false, reason: 'BAD_PAYLOAD' };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.error('webhook.privy rejected (the body is not a JSON object)');
      return { ok: false, reason: 'BAD_PAYLOAD' };
    }
    const payload = parsed as Record<string, unknown>;

    const eventType = firstString(payload, EVENT_TYPE_FIELDS);
    if (eventType === null) {
      log.error('webhook.privy rejected (no event type in the payload)');
      return { ok: false, reason: 'BAD_PAYLOAD' };
    }

    // 3. The deduplication key. The body's own id when it has one — the
    // transport id identifies a delivery, not an event, and deduping on it would
    // store one row per retry.
    const externalId = firstString(payload, EVENT_ID_FIELDS) ?? input.headers.id;
    if (externalId === null || externalId.length === 0) {
      log.error('webhook.privy rejected (no event id and no transport id)');
      return { ok: false, reason: 'NO_EVENT_ID' };
    }

    // 4. Store. Attributed to nobody, that is a normal case, not a problem:
    // Privy sends app-level events and the table keeps them for the operator.
    const { inserted } = await deps.store.store({
      source: 'privy',
      eventType,
      externalId,
      privyDid: extractPersonDid(payload),
      payload,
      receivedAt: input.now,
    });

    log.log('webhook.privy stored', { eventType, inserted, externalId });
    return { ok: true, inserted, eventType };
  };
};
