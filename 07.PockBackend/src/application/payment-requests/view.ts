/**
 * What a charge looks like on the way out, and the two things this shape cannot
 * hold.
 *
 * ── The view ─────────────────────────────────────────────────────────────────
 *
 * `id`, `amount`, `note`, `chain`, `asset`, `status`, `createdAt`, `expiresAt`,
 * `requesterTag`. The dates are ISO strings here so the route does not repeat
 * `toISOString()` on three verbs and get one of them wrong.
 *
 * ── Why `chain` and `asset` are in here ──────────────────────────────────────
 *
 * Because this response is what makes `/cobrar/{id}` legible without the URL
 * carrying the chain: the id is the whole of the link, and the thing that says
 * "10 USDC on Monad" is this shape and not the path. The payer does not choose
 * either of them — they are what the charge **is** — so they are the two fields
 * a pay screen needs and nothing more.
 *
 * `decimals` travels with the symbol because a screen that showed the amount
 * without it would be guessing the scale, and a wrong guess there is not a typo,
 * it is a different number of money.
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

/** What the charge is denominated in, as the screen reads it. */
export interface PaymentRequestAssetView {
  /** `USDC`, `ETH`, `SOL`. The catalog's spelling, on the chain below. */
  readonly symbol: string;
  /**
   * How many decimals the asset has on that chain.
   *
   * The server resolved it from the catalog at creation and the client never gets
   * to say otherwise. A screen that showed this wrong would show an amount that
   * is not the amount that moves.
   */
  readonly decimals: number;
}

export interface PaymentRequestView {
  /** The shareable secret. The whole of the charge's access control. */
  readonly id: string;
  /** Whole units as a decimal string — see `./amount.ts`. */
  readonly amount: string;
  /**
   * What the charge is for, in the payer's own words, or nothing.
   */
  readonly note: string | null;
  /**
   * The chain the charge names, in the catalog's vocabulary.
   *
   * It is here so that the link says what it asks without the pay screen having
   * to ask anybody: `/cobrar/{id}` stays a URL with no chain in it, and this is
   * what tells the app whether it is looking at an EVM transfer or a Solana one.
   */
  readonly chain: string;
  /** The asset and its scale. Never a token address, never a mint. */
  readonly asset: PaymentRequestAssetView;
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
  chain: row.chain,
  asset: { symbol: row.assetSymbol, decimals: row.assetDecimals },
  status: effectivePaymentRequestStatus(row.status, row.expiresAt, now),
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  requesterTag: row.requesterTag,
});
