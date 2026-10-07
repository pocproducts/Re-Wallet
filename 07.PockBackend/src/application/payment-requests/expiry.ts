/**
 * EXPIRY IS DERIVED AT READ TIME, and this file is the argument.
 *
 * ── The decision ─────────────────────────────────────────────────────────────
 *
 * A charge that is `pending` and past `expires_at` **reads as `expired`**, and
 * this project never writes `'expired'` on its own. The row stays `pending`;
 * `status` records what *happened*, and a deadline passing is not something that
 * happened to the charge — it is a fact about `expires_at` that anybody can
 * evaluate, forever, with no help.
 *
 * ── Why not a stored transition ──────────────────────────────────────────────
 *
 * Because storing it needs a sweeper, and there is no sweeper. This is a Cloudflare
 * Worker with no cron trigger configured, no queue and no scheduled handler. A
 * stored transition would therefore only ever happen **when somebody happened to
 * look**, which produces the two worst possible shapes at once:
 *
 *   - a row that says `pending` for three days after its link died, so a query
 *     for outstanding charges (`WHERE status = 'pending'`) counts money nobody
 *     can still collect; and
 *   - a row that says `expired` in one place and `pending` in another, because two
 *     requests raced through whatever path happened to write it.
 *
 * Both of those are *the row lying*. A derived status cannot lie: it is a pure
 * function of two columns that only the person who created the charge ever writes.
 *
 * ── Why the two rows mean different things to whoever queries this later ──────
 *
 * This is the part worth being precise about, because "expired but still
 * `pending`" sounds like an inconsistency and is not:
 *
 * | Row                                  | Means                                                            |
 * |--------------------------------------|------------------------------------------------------------------|
 * | `pending`, `expires_at` in the past  | **nobody ever touched it.** It was created, it was shared, and no payment and no cancellation arrived. The `expires_at` index finds these in one query. |
 * | `expired`                            | somebody **acted**: a sweep, an operator, or a future cancellation path wrote that down. It is a record of an event. |
 *
 * The first is a *derivable* fact; the second is a *recorded* one. Collapsing them
 * loses the ability to ask "how many links did people actually abandon?", which is
 * a different number from "how many are unpayable?" — the first is a product
 * signal about share links, the second is a statement about money.
 *
 * `'expired'` therefore stays in the port's vocabulary, because the schema states
 * it and a future sweep or a cancellation route may write it — and this read path
 * is already correct when they do: a row that says `expired` reads as `expired`.
 *
 * ── Why the write side cannot rely on this ───────────────────────────────────
 *
 * Because a derived status is a read-time answer, not a guarantee. Two payments
 * arriving at the same instant would both see `pending`, and both would prepare a
 * transfer. So the payment path does **not** trust the derived status to stop the
 * second one: the `UPDATE` that marks the charge paid is conditional
 * (`status = 'pending' AND expires_at > $paidAt`, see
 * `../../infrastructure/db/paymentRequestStore.pg.ts`), and whoever loses the race
 * gets no row back. The derived status is for people; the predicate is for money.
 */

import type { PaymentRequestStatus } from '../../domain/ports/payment-request-store';

export type { PaymentRequestStatus };

/**
 * What a person is told, which is not always what the row says.
 *
 * It is the row's status unless the row is `pending` and the clock has passed its
 * deadline. Nothing else is recomputed: `paid` stays `paid` forever, because a
 * payment is an event and events do not expire.
 */
export const effectivePaymentRequestStatus = (
  stored: PaymentRequestStatus,
  expiresAt: Date,
  now: Date,
): PaymentRequestStatus => (stored === 'pending' && expiresAt.getTime() <= now.getTime() ? 'expired' : stored);

/**
 * Has the deadline passed?
 *
 * `<=` and not `<`: a charge whose `expires_at` is exactly this instant is over.
 * The link said "until here", and "here" has arrived. The same comparison is in
 * the conditional `UPDATE`, so the read and the write agree on the boundary
 * instead of differing by one second in a way only one of them notices.
 */
export const hasExpired = (expiresAt: Date, now: Date): boolean => expiresAt.getTime() <= now.getTime();

/**
 * How long a charge lives, when the person does not say.
 *
 * 24 hours, and it is the same 24 hours the QR path uses: `contrato-dinero.md`
 * says *"un solo plazo para los dos caminos"*. A charge that outlived a
 * conversation, or died inside one, is not what anybody agreed to.
 */
export const DEFAULT_PAYMENT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Shorter than this and a link is not a link. */
export const MIN_PAYMENT_REQUEST_TTL_MS = 60 * 1000;

/** Longer than this and a charge outlives the agreement it was made under. */
export const MAX_PAYMENT_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The longest note a charge may carry, in characters. */
export const MAX_PAYMENT_REQUEST_NOTE_LENGTH = 280;
