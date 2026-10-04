/**
 * ADAPTER: the `rewallet.webhook_events` rows.
 *
 * ── The table already existed, and this adapter adds nothing to it ────────────
 *
 * `id`, `source`, `event_type`, `payload`, `signature_valid`, `processed_at`,
 * `error`, `created_at`, `external_id`. No column is created, no constraint is
 * changed, and `rewallet.webhook_events_source_valid` (`source = 'privy'`) is the
 * schema stating the same thing this module hardcodes.
 *
 * `processed_at` and `error` are deliberately **not written**. They exist for a
 * worker that consumes events, and writing `processed_at = now()` on intake
 * would claim that something consumed an event when all that happened is that a
 * row exists.
 *
 * ── `ON CONFLICT (source, external_id) DO NOTHING` ────────────────────────────
 *
 * That unique constraint is the deduplication. Privy retries carry the same
 * event id, so the second delivery returns no row; the adapter reports
 * `{ inserted: false }` and the intake answers 200. A retry is a delivery we
 * already honoured — not a constraint violation to raise at a route.
 *
 * `RETURNING id` is what distinguishes the two cases: a row means the event was
 * written, no row means the event was already on file.
 *
 * ── Why `signature_valid` is a literal `true` and not a parameter ─────────────
 *
 * There is no code path that reaches this adapter without a verified signature,
 * so the parameter could only ever be `true` — and a parameter is an invitation to
 * pass `false` later. The literal makes "this row records that the signature was
 * checked" a property of the SQL.
 *
 * ── Why the feed filters on `payload @> …` ────────────────────────────────────
 *
 * The person is not a column: the table has none, and one was not added. The
 * GIN index on `payload` serves a containment test, and `personDidContainments`
 * builds one shape per path **from the same list the intake reads the person
 * from** (`src/domain/webhooks/attribution.ts`), so writing and reading cannot
 * disagree about where a person lives in a payload.
 *
 * The payload is not selected: the item is a sentence, and the sentence is
 * computed from `event_type` in the application layer.
 */
import type { PersonWebhookEvent, WebhookEventStore } from '../../domain/ports/webhook-event-store';
import { personDidContainments } from '../../domain/webhooks/attribution';
import type { Database } from './client';

interface EventRow {
  readonly id: string;
  readonly event_type: string;
  readonly created_at: string | Date;
}

export const createPostgresWebhookEventStore = (db: Database): WebhookEventStore => ({
  async store(event) {
    /*
     * Positional parameters, `::jsonb` on the payload. The Neon HTTP driver has no
     * json helper on the template function, and the payload is a document rather
     * than a string to be quoted by hand.
     */
    const rows = (await db.query(
      `
        INSERT INTO rewallet.webhook_events
          (source, event_type, external_id, payload, signature_valid, created_at)
        VALUES ($1, $2, $3, $4::jsonb, true, $5)
        ON CONFLICT (source, external_id) DO NOTHING
        RETURNING id
      `,
      [event.source, event.eventType, event.externalId, JSON.stringify(event.payload), event.receivedAt.toISOString()],
    )) as unknown as EventRow[];

    return { inserted: rows.length > 0 };
  },

  async listForPerson(privyDid, limit) {
    /*
     * One `OR` per path the intake reads the person from. The number of paths is
     * a list in the domain, not a constant here, so the statement is built with
     * positional parameters — the DID travels as a **bound** parameter inside a
     * jsonb document and never as SQL text.
     */
    const shapes = personDidContainments(privyDid);
    const predicate = shapes.map((_, index) => `payload @> $${index + 1}::jsonb`).join(' OR ');
    const limitParameter = shapes.length + 1;

    const rows = (await db.query(
      `
        SELECT id, event_type, created_at
          FROM rewallet.webhook_events
         WHERE (${predicate})
         ORDER BY created_at DESC
         LIMIT $${limitParameter}
      `,
      [...shapes.map((shape) => JSON.stringify(shape)), limit],
    )) as unknown as EventRow[];

    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    }));
  },
});
