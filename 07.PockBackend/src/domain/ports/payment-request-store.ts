/**
 * PORT: the charges a person asks for, and the one payment each of them takes.
 *
 * ── The table, before and after `sql/0005` ──────────────────────────────────
 *
 * `rewallet.payment_requests` carries `id text PRIMARY KEY`, `user_id uuid`,
 * `amount numeric(38,18)`, `note text`, `status text`, `paid_by_user_id uuid`,
 * `paid_movement_id uuid`, `created_at`, `paid_at` and `expires_at`, with three
 * partial indexes.
 *
 * `amount` was `numeric(20,6)` until `sql/0005_payment_request_asset_chain.sql`,
 * and the table also gained `chain`, `asset_symbol` and `asset_decimals` — all
 * `NOT NULL`, so a charge cannot exist without saying what it is a charge for.
 * That migration is why this port has the three fields it has: the charge names
 * its asset now, and the asset is what gives the amount its scale.
 *
 * Four of the table's constraints are doing the work this feature needs, and they
 * are stated here so that a change to any of them is a change to this port:
 *
 *   - `payment_requests_id_format` — `^[A-Za-z0-9_-]{10,32}$`. **This is the
 *     shape of the secret.** The link travels in the clear, so the id is the only
 *     thing that keeps an outsider out of somebody else's outstanding charge, and
 *     the constraint is what makes "the id is 32 random characters" a fact about
 *     the database rather than a habit in one module. See
 *     `../../application/payment-requests/id.ts`.
 *   - `payment_requests_amount_positive` — `amount > 0`. A charge of nothing is
 *     not a charge, and the database says so before anybody writes the sentence.
 *   - `payment_requests_status_valid` — `pending | paid | expired | cancelled`.
 *     Four states, and `markPaid` moves a row to exactly one of them.
 *   - `payment_requests_chain_format`, `payment_requests_asset_symbol_format` and
 *     `payment_requests_asset_decimals_range` — the shape of a row that names
 *     what it is a charge for. **These assert form, not membership.** The
 *     catalog lives in TypeScript, so whether `monad` is a chain this app has is
 *     decided by `createPaymentRequest` at creation, not by the table.
 *
 * ── Why there is no `listForUser` ─────────────────────────────────────────────
 *
 * Nothing reads a person's charges yet, and a method with no caller is a second
 * answer to "which charges are outstanding?" waiting to disagree with the first.
 * The read that exists is the one the link needs: by id.
 *
 * ── Why `markPaid` takes the moment and returns the row, or nothing ──────────
 *
 * Because "paid" is a transition and a transition has a condition. The statement
 * is `WHERE id = $1 AND status = 'pending' AND expires_at > $paidAt`, so a second
 * payment and a payment of an expired charge both come back as **no row**, and
 * `null` is how this port says "there was nothing to move". The caller re-reads to
 * tell those two apart, because they are different sentences to a person.
 *
 * ── Why `paidMovementId` is an argument and not part of the read shape ───────
 *
 * `paid_movement_id` points at the `rewallet.movements` row the payment wrote.
 * It is written once and never read back through this port: what a charge needs
 * afterwards is *who* paid and *when*, both of which are on the read shape. The
 * movement id is still a required argument — the column is `NOT NULL` in every
 * row that is `paid` as a matter of this project's meaning rather than the
 * schema's, and a payment with no movement attached is a payment nobody recorded.
 */
import type { DepositChain } from '../deposit/catalog';

/**
 * The four states `payment_requests_status_valid` allows.
 *
 * Declared here, next to the row it describes, because the row is where the state
 * lives. What a person is *told* for a `pending` row past its deadline is a
 * separate question, answered by
 * `../../application/payment-requests/expiry.ts`.
 */
export type PaymentRequestStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

export interface NewPaymentRequest {
  readonly id: string;
  /** The person asking for the money. Never taken from the request. */
  readonly userId: string;
  /** Whole units as a decimal string — see `../../application/payment-requests/amount.ts`. */
  readonly amount: string;
  /**
   * The chain the charge names, in the catalog's vocabulary.
   *
   * Already validated against `../../domain/deposit/catalog.ts` before it got
   * here: a charge in a chain this app does not have is not a charge, and the
   * refusal belongs to the person who asked for it, not to whoever pays it.
   */
  readonly chain: DepositChain;
  /** The asset symbol as the catalog spells it on that chain. Uppercase by the table's CHECK. */
  readonly assetSymbol: string;
  /**
   * The asset's decimals, **resolved by the server from the catalog**.
   *
   * Not taken from the body, ever: it is a fact about the token, not about the
   * request, and accepting it from a client is handing out authority over the
   * number that gets charged for money.
   */
  readonly assetDecimals: number;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * A row as it stands, in the stored vocabulary.
 *
 * `status` is **what is written**, not what a person is told: a `pending` row
 * whose deadline passed is `pending` here and reads as `expired`, and the
 * difference is the whole of `expiry.ts`.
 */
export interface StoredPaymentRequest {
  readonly id: string;
  readonly userId: string;
  readonly amount: string;
  /**
   * What the charge is denominated in.
   *
   * Typed as `string` and not as `DepositChain` on purpose: this is what the row
   * says, and the row is only as good as its CHECK — which asserts the *shape*
   * of a chain, not its membership in the catalog, because the catalog is
   * TypeScript and the database cannot see it. Whoever needs a chain it can
   * trust resolves it against the catalog at the moment of use
   * (`../payment-requests/payPaymentRequest.ts`), so a row naming a chain the
   * app no longer has is a bounded refusal and not an undefined lookup.
   */
  readonly chain: string;
  readonly assetSymbol: string;
  readonly assetDecimals: number;
  readonly note: string | null;
  readonly status: PaymentRequestStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly paidByUserId: string | null;
  readonly paidAt: Date | null;
  /**
   * The payee's `users.tag`, or `null` when it could not be read.
   *
   * An identity a person can read out loud, which is what the pay screen shows
   * instead of an address. It is resolved in the same statement as the charge.
   */
  readonly requesterTag: string | null;
}

export interface MarkPayment {
  readonly id: string;
  /** The person paying. Never taken from the charge's own row. */
  readonly paidByUserId: string;
  readonly paidMovementId: string;
  /** The moment of the payment; also the moment the deadline is tested against. */
  readonly paidAt: Date;
}

export interface PaymentRequestStore {
  /**
   * Inserts one charge.
   *
   * `null` when the id is already on file: `ON CONFLICT (id) DO NOTHING` is the
   * deduplication, exactly as Privy retries are deduplicated in
   * `webhookEventStore.pg.ts`. A collision is not a constraint violation to raise
   * at a route — it is a signal to draw another id.
   */
  create(request: NewPaymentRequest): Promise<StoredPaymentRequest | null>;

  /** The charge with that id, or `null`. One statement, and no address in it. */
  findById(id: string): Promise<StoredPaymentRequest | null>;

  /**
   * Moves a `pending`, unexpired charge to `paid` and records who paid, which
   * movement, and when.
   *
   * `null` when there was nothing to move: already paid, cancelled, or past
   * `expires_at`. The caller decides which sentence that is.
   */
  markPaid(payment: MarkPayment): Promise<StoredPaymentRequest | null>;
}
