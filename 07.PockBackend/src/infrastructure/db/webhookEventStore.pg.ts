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
 * ── Why the same `OR` also matches the person's wallets ──────────────────────
 *
 * Privy's money events (`wallet.funds_deposited`, `transaction.*`) carry no DID.
 * They carry `wallet_id`, so without this the feed answers "no notifications"
 * with **no error** — silent, and with the wrong explanation.
 *
 * Their ids are resolved by the same statement, in a subquery over
 * `rewallet.wallets w JOIN rewallet.users u ON u.id = w.user_id` filtered by
 * `u.privy_did = $n`. One SELECT: the alternative — a port method that reads the
 * person's wallet ids and then a second query — is a round trip to join a fact
 * this statement already has both sides of.
 *
 * Two properties this buys, and both are the reason for the shape of the SQL:
 *
 *   - **An id that is not in `rewallet.wallets` for this person attributes the
 *     event to nobody.** The subquery is scoped by the person's DID, so another
 *     person's wallet id is not in it, and an unknown id is in no one else's
 *     either. There is no fallback to "somebody".
 *   - **`provider_wallet_id IS NOT NULL` is written out.** The column is
 *     nullable. A null in the candidate array would build a containment against
 *     a JSON null and, worse, make the comparison a null — a query that quietly
 *     stops answering. Skipping nulls keeps "unknown id" an absence, which is
 *     what it is.
 *
 * The wallet-id terms are `payload @> ANY (SELECT …)` rather than one
 * `payload @> $n::jsonb` per id, because the ids are not known before the
 * statement runs — that is the cost of resolving them here instead of in a second
 * round trip. The containment test itself is unchanged, and the DID terms remain
 * constant per path, so the GIN index still serves them.
 *
 * The payload is selected, and read for three fields. It used not to be: the
 * sentence was computed from `event_type` alone, and this header said so. A real
 * deposit arrived, and the notification could not say how much — so the
 * projection now carries the payload and `describeEvent` asks one question of it:
 * how much, on which chain, in which asset. Every other field of it stays
 * unreadable from the feed, and none of it reaches the item.
 */
import type { PersonWebhookEvent, PrivyMetrics, WebhookEventStore } from '../../domain/ports/webhook-event-store';
import { PERSON_DID_PATHS, PERSON_WALLET_ID_PATHS, personDidContainments } from '../../domain/webhooks/attribution';
import type { Database } from './client';

interface EventRow {
  readonly id: string;
  readonly event_type: string;
  readonly created_at: string | Date;
  readonly payload: Record<string, unknown>;
}

/**
 * The `jsonb_build_object` chain for one dotted path, read off the wallet id.
 *
 * `walletContainment('wallet_id')` → `jsonb_build_object('wallet_id', w.provider_wallet_id)`;
 * `walletContainment('data.wallet_id')` wraps it once more. The keys are this
 * project's own constant list — nothing a request can reach reaches this string.
 */
const walletContainment = (path: string): string =>
  path
    .split('.')
    .reverse()
    .reduce((inner, key) => `jsonb_build_object('${key}', ${inner})`, 'w.provider_wallet_id');

/**
 * One candidate shape per row of `rewallet.wallets` that is this person's.
 *
 * An empty result is not an error: `x @> ANY` over an empty array is `false`, and
 * an event whose `wallet_id` is unknown to us is simply not in anybody's feed.
 */
const walletContainmentTerm = (path: string, personParameter: number): string =>
  `payload @> ANY (SELECT ${walletContainment(path)}
         FROM rewallet.wallets w
         JOIN rewallet.users u ON u.id = w.user_id
        WHERE u.privy_did = $${personParameter}
          AND w.provider_wallet_id IS NOT NULL)`;

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
     * One `OR` per known path: the DID paths the intake reads the person from, and
     * the wallet-id paths the money events carry instead. The number of paths is
     * a list in the domain, not a constant here, so the statement is built with
     * positional parameters — the DID travels as a **bound** parameter inside a
     * jsonb document and never as SQL text, and the same DID is what scopes the
     * wallet subqueries.
     */
    const shapes = personDidContainments(privyDid);
    const personParameter = shapes.length + 1;
    const terms = [
      ...shapes.map((_, index) => `payload @> $${index + 1}::jsonb`),
      ...PERSON_WALLET_ID_PATHS.map((path) => walletContainmentTerm(path, personParameter)),
    ];
    const predicate = terms.join(' OR ');
    const limitParameter = personParameter + 1;

    const rows = (await db.query(
      `
        SELECT id, event_type, created_at, payload
          FROM rewallet.webhook_events
         WHERE (${predicate})
         ORDER BY created_at DESC
         LIMIT $${limitParameter}
      `,
      [...shapes.map((shape) => JSON.stringify(shape)), privyDid, limit],
    )) as unknown as EventRow[];

    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      payload: row.payload ?? {},
    }));
  },

  async metrics({ now }) {
    /*
     * One statement, three aggregates. The event-type counts are trivial; the
     * 24-hour distinct-person count reads the DID out of the jsonb payload along
     * the **same paths the intake attributes with** (`PERSON_DID_PATHS`) — a
     * second, hand-written list would silently disagree with ingestion the day
     * a path is added there. `payload #>> '{a,b}'` resolves a nested path to
     * text, yielding NULL when the path is absent, so `COALESCE` over all known
     * paths is the DID or NULL, and `COUNT(DISTINCT ...)` ignores NULLs.
     *
     * The window edge is a bound parameter, not `now()` in the SQL: the caller
     * owns the clock, and a test can stand still.
     */
    const didExpressions = PERSON_DID_PATHS.map(
      (path) => `payload #>> '{${path.split('.').join(',')}}'`,
    );
    const didExtraction = `COALESCE(${didExpressions.join(', ')})`;

    const rows = (await db.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'wallet.created')::int AS wallets_created,
          COUNT(*) FILTER (WHERE event_type = 'user.signed_in')::int AS sign_ins,
          (
            SELECT COUNT(DISTINCT did)::int
              FROM (
                SELECT ${didExtraction} AS did
                  FROM rewallet.webhook_events
                 WHERE created_at >= $1::timestamptz - INTERVAL '24 hours'
              ) recent
          ) AS active_users_24h
          FROM rewallet.webhook_events
      `,
      [now],
    )) as unknown as { wallets_created: number; sign_ins: number; active_users_24h: number }[];

    const row = rows[0] ?? { wallets_created: 0, sign_ins: 0, active_users_24h: 0 };
    const metrics: PrivyMetrics = {
      walletsCreated: row.wallets_created,
      activeUsers24h: row.active_users_24h,
      signIns: row.sign_ins,
    };
    return metrics;
  },
});
