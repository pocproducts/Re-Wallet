/**
 * USE CASE: read a charge by its id, for the person who has the link.
 *
 * ── Who may read it ──────────────────────────────────────────────────────────
 *
 * Anyone with a session **and** the id. That is the whole access control of this
 * route, and it is deliberate: the person who pays is by definition not the person
 * who created the charge, so "only the owner" would make the feature unusable. The
 * id is the bearer secret — a link in a chat is a link anybody can forward — which
 * is exactly why it is 192 bits wide and why nothing else is needed.
 *
 * The alternative would be a second factor: an account list, a "contacts only"
 * toggle, a second person approving. `contrato-dinero.md` describes none of them,
 * and the moment a charge is sharable by link is the moment its id becomes the
 * password.
 *
 * ── Why there is no "mine" flag in the answer ────────────────────────────────
 *
 * Because a response that says "this is yours" is a response that can be wrong in
 * the other direction, and it is a question nobody asked. What the pay screen needs
 * is the amount, the note and the state. Whether the reader is the payee is the
 * server's business — it is what decides that the payee cannot pay their own
 * charge — and it is not the screen's.
 *
 * ── Why the same code answers for a bad id and a missing one ─────────────────
 *
 * See `errors.ts`: an answer that distinguishes them is an oracle, and measuring
 * how many ids are real is the cheap first step of enumerating charges. So both
 * are `PaymentRequestNotFound`, and neither the log nor the body says which it was.
 *
 * ── Why a failure to read is a 502 and not an empty charge ───────────────────
 *
 * An empty response here is a claim: "there is no charge, or there is nothing to
 * see". A failed read is not that claim, and answering 200 would render an outage
 * as "this link is not real" — which sends a person away from a charge they are
 * owed.
 */
import { PaymentRequestNotFound, PaymentRequestUnavailable } from './errors';
import { toPaymentRequestView, type PaymentRequestView } from './view';
import { PAYMENT_REQUEST_ID_PATTERN } from './id';
import type { PaymentRequestStore } from '../../domain/ports/payment-request-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

export interface ReadPaymentRequestDeps {
  readonly requests: PaymentRequestStore;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export type ReadPaymentRequest = (id: unknown) => Promise<PaymentRequestView>;

export const readPaymentRequest = (deps: ReadPaymentRequestDeps): ReadPaymentRequest => {
  const log = deps.log ?? noopLogger;

  return async (id: unknown): Promise<PaymentRequestView> => {
    const now = deps.now?.() ?? new Date();

    /*
     * 1. The id has to be shaped like one before it reaches the database.
     *
     *    Not for injection — the adapter binds it as a parameter and Postgres does
     *    not concatenate — but so that a hand-typed path answers in the same time
     *    as a well-formed one, with the same code, and so that the store is only
     *    ever asked about ids its own table could contain.
     */
    if (typeof id !== 'string' || !PAYMENT_REQUEST_ID_PATTERN.test(id)) {
      log.log('charge.read.malformed_id');
      throw new PaymentRequestNotFound(id);
    }

    /* 2. The row, or the same refusal as above. */
    let row;
    try {
      row = await deps.requests.findById(id);
    } catch (error) {
      log.error('charge.rows_unavailable', { error });
      throw new PaymentRequestUnavailable('the charge could not be read', { cause: error });
    }

    if (row === null) {
      log.log('charge.read.not_found');
      throw new PaymentRequestNotFound(id);
    }

    /*
     * 3. The status is **derived**, so the row's own `pending` past its deadline
     *    is reported as `expired` without a single write. See `./expiry.ts` for
     *    why this project never sweeps.
     */
    return toPaymentRequestView(row, now);
  };
};
