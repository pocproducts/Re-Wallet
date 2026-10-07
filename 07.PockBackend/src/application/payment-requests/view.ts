/**
 * What a charge looks like on the way out, and the two things this shape cannot
 * hold.
 *
 * ── The view ─────────────────────────────────────────────────────────────────
 *
 * `id`, `amount`, `note`, `status`, `createdAt`, `expiresAt`, `requesterTag`.
 * The dates are ISO strings here so the route does not repeat `toISOString()` on
 * three verbs and get one of them wrong.
 *
 * ── What it does not have, and why each absence is a decision ────────────────
 *
 *   - **No address.** Not the payee's, not anybody's. `docs/contrato-dinero.md:26`
 *     says the recipient is *"un dato que la persona no ve"*; if this response
 *     carried one, the prohibition would be broken by the screen that renders it,
 *     not by the send flow. The payee's address is resolved inside
 *     `payPaymentRequest.ts` and goes straight to `prepareSend`.
 *   - **No `userId`.** The payer's browser has no use for the payee's uuid, and
 *     it is one more identifier that would end up in a log, a crash report or a
 *     support screenshot. The tag is the identity a person is meant to see.
 *   - **No `paidByUserId`, no `paidAt`.** Who paid is the payee's business, not
 *     the payer's: the screen that shows "Carlos pagó" is the payee's Activity,
 *     and it is not this response. Both fields stay on the row.
 *   - **No balance, ever.** Nothing here is a number about somebody's money.
 *
 * ── Why `requesterTag` is the one identity in it ─────────────────────────────
 *
 * Because a pay screen that says "Te piden U$ 150,25" and shows no one is a
 * screen that asks for money in the abstract. The tag is what the contract already
 * uses to *find* a person — `@tag` in `contrato-dinero.md:26` — so it is the one
 * identifier a person already knows how to read and check out loud. It is
 * nullable: a charge whose payee row could not be read shows the amount and says
 * nothing about who, rather than failing the whole read.
 */
import type { StoredPaymentRequest } from '../../domain/ports/payment-request-store';
import { effectivePaymentRequestStatus, type PaymentRequestStatus } from './expiry';

export interface PaymentRequestView {
  /** The shareable secret. The whole of the charge's access control. */
  readonly id: string;
  /** Whole units as a decimal string — see `./amount.ts`. */
  readonly amount: string;
  /** What the charge is for, in the payer's own words, or nothing. */
  readonly note: string | null;
  /**
   * `pending`, `paid`, `expired` or `cancelled` — **derived**: a `pending` row
   * past its deadline reads as `expired`, and the row on disk is untouched.
   */
  readonly status: PaymentRequestStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The payee's `@tag`, or `null` when it could not be read. Never an address. */
  readonly requesterTag: string | null;
}

/** The row as the person reading the link is entitled to see it. */
export const toPaymentRequestView = (row: StoredPaymentRequest, now: Date): PaymentRequestView => ({
  id: row.id,
  amount: row.amount,
  note: row.note,
  status: effectivePaymentRequestStatus(row.status, row.expiresAt, now),
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  requesterTag: row.requesterTag,
});
