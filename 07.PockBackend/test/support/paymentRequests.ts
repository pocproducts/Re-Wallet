/**
 * An in-memory `PaymentRequestStore` that behaves like the real table.
 *
 * ── Why a fake table and not a stub ───────────────────────────────────────────
 *
 * The rules under test **are** the table's rules: `payment_requests_id_format`
 * (`^[A-Za-z0-9_-]{10,32}$`), `payment_requests_amount_positive` (`amount > 0`),
 * `payment_requests_status_valid`, and the three CHECKs about what a charge names
 * (`sql/0005`). A stub that returns whatever the test told it to would pass a
 * test the live table cannot pass — and the rules that matter most for this
 * feature are enforced *by the table*, not by code:
 *
 *   - the id format, which is the whole reason the table's CHECK exists, and
 *   - "paid" being a state a row reaches **once**, which here is the conditional
 *     UPDATE `WHERE status = 'pending' AND expires_at > $paidAt`.
 *
 * The second one is modelled rather than trusted: `markPaid` returns `null` when
 * the row is not `pending` or is already past its expiry, exactly as the
 * statement's `RETURNING` returns no row. A test that pays twice therefore
 * exercises the real rule instead of a mock's opinion about it.
 */
import type {
  NewPaymentRequest,
  PaymentRequestStore,
  StoredPaymentRequest,
} from '../../src/domain/ports/payment-request-store';
import { PAYMENT_REQUEST_ID_PATTERN } from '../../src/application/payment-requests/id';

export const AMOUNT_POSITIVE = 'payment_requests_amount_positive';
export const ID_FORMAT = 'payment_requests_id_format';
export const STATUS_VALID = 'payment_requests_status_valid';
export const ID_PRIMARY_KEY = 'payment_requests_pkey';
export const CHAIN_FORMAT = 'payment_requests_chain_format';
export const ASSET_SYMBOL_FORMAT = 'payment_requests_asset_symbol_format';
export const ASSET_DECIMALS_RANGE = 'payment_requests_asset_decimals_range';

/** The table's CHECKs about what a charge names, as failures a caller can see. */
export const CHAIN_PATTERN = /^[a-z0-9_]{2,32}$/;
export const ASSET_SYMBOL_PATTERN = /^[A-Z0-9]{1,16}$/;

export interface InMemoryPaymentRequests {
  readonly store: PaymentRequestStore;
  /** The rows as they stand now — what the next read would see. */
  readonly rows: () => readonly StoredPaymentRequest[];
  /** Every `markPaid` that moved a row, in order. */
  readonly payments: readonly { id: string; paidByUserId: string; movementId: string; paidAt: Date }[];
  /** Set to make the next `create` fail the way a dead connection would. */
  failing: boolean;
}

export interface SeedPaymentRequest {
  readonly id: string;
  readonly userId: string;
  readonly amount: string;
  /** Defaults to `monad`, so a seed that predates the columns is still usable. */
  readonly chain?: string;
  /** Defaults to `USDC`, at the catalog's six decimals. */
  readonly assetSymbol?: string;
  readonly assetDecimals?: number;
  readonly note?: string | null;
  readonly status?: StoredPaymentRequest['status'];
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly requesterTag?: string | null;
  readonly paidByUserId?: string | null;
  readonly paidAt?: Date | null;
}

export const seedPaymentRequest = (overrides: SeedPaymentRequest): StoredPaymentRequest => ({
  id: overrides.id,
  userId: overrides.userId,
  amount: overrides.amount,
  chain: overrides.chain ?? 'monad',
  assetSymbol: overrides.assetSymbol ?? 'USDC',
  assetDecimals: overrides.assetDecimals ?? 6,
  note: overrides.note ?? null,
  status: overrides.status ?? 'pending',
  createdAt: overrides.createdAt,
  expiresAt: overrides.expiresAt,
  paidByUserId: overrides.paidByUserId ?? null,
  paidAt: overrides.paidAt ?? null,
  requesterTag: overrides.requesterTag ?? null,
});

export const inMemoryPaymentRequests = (
  seed: readonly SeedPaymentRequest[] = [],
): InMemoryPaymentRequests => {
  const rows: StoredPaymentRequest[] = seed.map(seedPaymentRequest);
  const payments: { id: string; paidByUserId: string; movementId: string; paidAt: Date }[] = [];
  const fake: InMemoryPaymentRequests = {
    failing: false,

    rows: () => rows.map((row) => ({ ...row })),

    payments,

    store: {
      async create(request: NewPaymentRequest) {
        if (fake.failing) throw new Error('connection reset');
        // The table's own CHECKs, as failures a caller can see.
        if (!PAYMENT_REQUEST_ID_PATTERN.test(request.id)) throw new Error(ID_FORMAT);
        if (!CHAIN_PATTERN.test(request.chain)) throw new Error(CHAIN_FORMAT);
        if (!ASSET_SYMBOL_PATTERN.test(request.assetSymbol)) throw new Error(ASSET_SYMBOL_FORMAT);
        if (request.assetDecimals < 0 || request.assetDecimals > 18) throw new Error(ASSET_DECIMALS_RANGE);
        if (Number(request.amount) <= 0) throw new Error(AMOUNT_POSITIVE);
        if (rows.some((row) => row.id === request.id)) return null; // ON CONFLICT DO NOTHING
        const stored: StoredPaymentRequest = {
          id: request.id,
          userId: request.userId,
          amount: request.amount,
          chain: request.chain,
          assetSymbol: request.assetSymbol,
          assetDecimals: request.assetDecimals,
          note: request.note,
          status: 'pending',
          createdAt: request.createdAt,
          expiresAt: request.expiresAt,
          paidByUserId: null,
          paidAt: null,
          requesterTag: null,
        };
        rows.push(stored);
        return { ...stored };
      },

      async findById(id: string) {
        if (fake.failing) throw new Error('connection reset');
        const row = rows.find((candidate) => candidate.id === id);
        return row === undefined ? null : { ...row };
      },

      async markPaid({ id, paidByUserId, paidMovementId, paidAt }) {
        if (fake.failing) throw new Error('connection reset');
        const index = rows.findIndex((candidate) => candidate.id === id);
        const row = rows[index];
        // No row returned: the statement found nothing to move.
        if (row === undefined || row.status !== 'pending' || row.expiresAt.getTime() <= paidAt.getTime()) {
          return null;
        }
        const next: StoredPaymentRequest = {
          ...row,
          status: 'paid',
          paidByUserId,
          paidAt,
          // `paid_movement_id` is not carried on the read shape: nothing reads it
          // back, and the movement is what `paid_by_user_id` points at anyway.
        };
        rows[index] = next;
        payments.push({ id, paidByUserId, movementId: paidMovementId, paidAt });
        return { ...next };
      },
    },
  };

  return fake;
};
