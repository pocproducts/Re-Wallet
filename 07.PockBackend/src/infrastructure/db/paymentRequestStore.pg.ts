/**
 * ADAPTER: the `rewallet.payment_requests` rows.
 *
 * ── The table, and the three columns that say what a charge is for ───────────
 *
 * `id text PRIMARY KEY`, `user_id uuid`, `amount numeric(38,18)`, `note text`,
 * `status text`, `paid_by_user_id uuid`, `paid_movement_id uuid`, `created_at`,
 * `paid_at`, `expires_at`, plus `chain`, `asset_symbol` and `asset_decimals`
 * since `sql/0005`. The three indexes the table ships with are what these
 * statements use: `idx_payment_requests_user`, `idx_payment_requests_status`
 * and `idx_payment_requests_expires`.
 *
 * The three new columns are written on the insert and selected on both reads, in
 * the same statements as everything else: a charge that is written without them
 * cannot be read back, and one round trip that returns an incomplete row is worse
 * than two that each return the whole of it. `asset_decimals` is the one that
 * matters most to keep in step — it is the scale the stored amount is converted
 * at, and it was resolved by the server from the catalog, never from a body.
 *
 * ── The insert: `ON CONFLICT (id) DO NOTHING` ────────────────────────────────
 *
 * The primary key is the deduplication. A 192-bit id that is already on file
 * returns no row, and the adapter reports `null` — which the use case reads as
 * "draw another one", not as a constraint violation to raise at a route. This is
 * the same shape as `webhookEventStore.pg.ts`'s treatment of a Privy retry: a
 * delivery we already honoured is not an error.
 *
 * `status` is written as the literal `'pending'` rather than left to the column's
 * DEFAULT, because a row's state is a statement this adapter makes and not a
 * default nobody reads. It is the same reasoning as `signature_valid = true` in
 * the webhook adapter.
 *
 * ── Why `paid_movement_id` is not read back ──────────────────────────────────
 *
 * It is written on every row that becomes `paid` and never selected afterwards:
 * what a charge needs once it is paid is *who* and *when*, both of which are on
 * the read shape, and the movement is reachable from `rewallet.movements` itself.
 * Selecting it would put a second identity in every answer for no reader.
 *
 * ── Why the payee's tag comes back with the charge ───────────────────────────
 *
 * `JOIN rewallet.users u ON u.id = p.user_id` and `u.tag` — one statement, one
 * round trip. The alternative is a port method for the tag followed by a second
 * query, which is a round trip to join a fact this statement already has both
 * sides of.
 *
 * It is a **tag and not an address** on purpose. `u.tag` is the `@tag` the
 * contract already uses to find a person by name, so it is an identity a person can
 * read out loud and check with the person who is asking for the money. Nothing in
 * this adapter reads `rewallet.wallets`: the payee's address is resolved inside
 * `payPaymentRequest.ts`, at the moment of payment, and never travels through a
 * read shape.
 *
 * ── The one conditional UPDATE ───────────────────────────────────────────────
 *
 * ```sql
 * UPDATE … SET status = 'paid', paid_by_user_id = $2, paid_movement_id = $3, paid_at = $4
 *  WHERE id = $1 AND status = 'pending' AND expires_at > $4
 * ```
 *
 * Both halves of that predicate are load-bearing and neither is decoration:
 *
 *   - `status = 'pending'` is what makes a link **single use**. Remove it and a
 *     second tap overwrites the payer of the first, and a charge ends up paid by
 *     two people with one movement attached.
 *   - `expires_at > $4` is what makes an expired charge **unpayable**. The status
 *     is derived at read time (`../payment-requests/expiry.ts`), and a derived
 *     status is an answer, not a lock: two payments arriving together would both
 *     read `pending`. This comparison, evaluated by the database on the row it is
 *     about to change, is the actual gate.
 *
 * `<=` in the read and `>` here are the same boundary stated from both sides, and
 * the same `$4` is used for the write and the test, so the instant a payment is
 * stamped with is the instant it is judged against.
 *
 * `RETURNING` returning no row is how "there was nothing to move" is reported, and
 * the caller re-reads to tell `ALREADY_PAID` from `REQUEST_EXPIRED`.
 */
import type {
  MarkPayment,
  NewPaymentRequest,
  PaymentRequestStatus,
  PaymentRequestStore,
  StoredPaymentRequest,
} from '../../domain/ports/payment-request-store';
import type { Database } from './client';

/**
 * The three columns that say what the charge is a charge for, selected by every
 * statement that reads the row.
 *
 * `chain` and `asset_symbol` are plain text: the table's CHECKs assert their
 * shape, not their membership in the catalog, so a row can only be trusted about
 * the shape here. `asset_decimals` is an `INTEGER` the server resolved from the
 * catalog when the charge was created.
 */
const CHARGE_ASSET_COLUMNS = 'p.chain, p.asset_symbol, p.asset_decimals';

interface PaymentRequestRow {
  readonly id: string;
  readonly user_id: string;
  /** `numeric` arrives as a string: it is never a float, by construction. */
  readonly amount: string;
  readonly note: string | null;
  readonly status: string;
  readonly chain?: string;
  readonly asset_symbol?: string;
  readonly asset_decimals?: number | string;
  readonly created_at: string | Date;
  readonly expires_at: string | Date;
  readonly paid_by_user_id?: string | null;
  readonly paid_at?: string | Date | null;
  readonly requester_tag?: string | null;
}

/**
 * The tag of the payee, resolved inside the statement that reads the charge.
 *
 * A scalar subquery in `RETURNING` rather than a second query, for the same reason
 * `webhookEventStore.pg.ts` resolves wallet ids in its `SELECT`: the fact is joined
 * on the row already being written, and a second round trip to fetch it is a round
 * trip to join something this statement already has both sides of.
 */
const REQUESTER_TAG = `(SELECT u.tag FROM rewallet.users u WHERE u.id = payment_requests.user_id) AS requester_tag`;

const asDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

/**
 * The read shape, from one row.
 *
 * `Number(asset_decimals)` and not `row.asset_decimals as number`: the column is
 * `INTEGER`, and a driver is free to hand it back as a string, so the conversion
 * is stated rather than assumed. It is the only float in this adapter and it is
 * exact — `asset_decimals` is between 0 and 18 by the table's own CHECK.
 */
const toStored = (row: PaymentRequestRow): StoredPaymentRequest => ({
  id: row.id,
  userId: row.user_id,
  amount: row.amount,
  chain: row.chain ?? '',
  assetSymbol: row.asset_symbol ?? '',
  assetDecimals: Number(row.asset_decimals ?? 0),
  note: row.note,
  status: row.status as PaymentRequestStatus,
  createdAt: asDate(row.created_at),
  expiresAt: asDate(row.expires_at),
  paidByUserId: row.paid_by_user_id ?? null,
  paidAt: row.paid_at == null ? null : asDate(row.paid_at),
  requesterTag: row.requester_tag ?? null,
});

export const createPostgresPaymentRequestStore = (db: Database): PaymentRequestStore => ({
  async create(request: NewPaymentRequest) {
    const rows = (await db.query(
      `
        INSERT INTO rewallet.payment_requests
          (id, user_id, amount, note, status, chain, asset_symbol, asset_decimals, created_at, expires_at)
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
        RETURNING id, user_id, amount, note, status, created_at, expires_at,
                  chain, asset_symbol, asset_decimals,
                  ${REQUESTER_TAG}
      `,
      [
        request.id,
        request.userId,
        request.amount,
        request.note,
        request.chain,
        request.assetSymbol,
        request.assetDecimals,
        request.createdAt.toISOString(),
        request.expiresAt.toISOString(),
      ],
    )) as unknown as PaymentRequestRow[];

    const row = rows[0];
    // No row: this id is already on file. `null`, so the caller draws another one.
    return row === undefined ? null : toStored(row);
  },

  async findById(id: string) {
    const rows = (await db.query(
      `
        SELECT p.id, p.user_id, p.amount, p.note, p.status,
               p.created_at, p.expires_at, p.paid_by_user_id, p.paid_at,
               ${CHARGE_ASSET_COLUMNS},
               u.tag AS requester_tag
          FROM rewallet.payment_requests p
          JOIN rewallet.users u ON u.id = p.user_id
         WHERE p.id = $1
      `,
      [id],
    )) as unknown as PaymentRequestRow[];

    const row = rows[0];
    return row === undefined ? null : toStored(row);
  },

  async markPaid({ id, paidByUserId, paidMovementId, paidAt }: MarkPayment) {
    const rows = (await db.query(
      `
        UPDATE rewallet.payment_requests
           SET status = 'paid',
               paid_by_user_id = $2,
               paid_movement_id = $3,
               paid_at = $4
         WHERE id = $1
           AND status = 'pending'
           AND expires_at > $4
        RETURNING id, user_id, amount, note, status, created_at, expires_at,
                  paid_by_user_id, paid_at,
                  chain, asset_symbol, asset_decimals,
                  ${REQUESTER_TAG}
      `,
      [id, paidByUserId, paidMovementId, paidAt.toISOString()],
    )) as unknown as PaymentRequestRow[];

    const row = rows[0];
    // No row: nothing to move. Already paid, cancelled, or past the deadline.
    return row === undefined ? null : toStored(row);
  },
});
