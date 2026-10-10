/**
 * `POST /api/payment-requests`, `GET /api/payment-requests/:id` and
 * `POST /api/payment-requests/:id/pay` — a charge, the link that opens it, and
 * the payment that closes it.
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 *
 * ```json
 * POST /api/payment-requests
 * { "amount": "150.25", "chain": "monad", "asset": { "symbol": "USDC" },
 *   "note": "la vuelta", "expiresInMs": 86400000 }
 *
 * 201 { "id": "kQ3v7pZ2mR8tY5wB1nF4hJ6sLdC9xGa", "amount": "150.25",
 *       "chain": "monad", "asset": { "symbol": "USDC", "decimals": 6 },
 *       "note": "la vuelta", "status": "pending", "requesterTag": "ana.abcd",
 *       "createdAt": "…", "expiresAt": "…" }
 *
 * GET /api/payment-requests/:id          → the same shape
 * POST /api/payment-requests/:id/pay     → no body: the charge says what to pay
 *
 * 200 { "requestId": "pr-kQ3v…", "chain": "monad", "address": "0x…payer's own…",
 *       "network": "eip155:143", "transactions": [ … ],
 *       "movement": { "id": "…", "status": "pending" },
 *       "paymentRequest": { "id": "kQ3v…", "status": "paid", "paidAt": "…" } }
 * ```
 *
 * ── The create body names the chain and the symbol, never the decimals ────────
 *
 * `asset` is `{ "symbol": "USDC" }` and nothing else. The decimals are a fact
 * about the token and the server reads them from `DEPOSIT_NETWORKS`; a client
 * that could send them could send `decimals: 0` and pick the size of the
 * transfer. So there is no field for it, and the two refusals that matter for
 * this — `CHAIN_UNKNOWN` and `ASSET_NOT_ON_CHAIN` — arrive **here**, where the
 * person who can fix them is the one asking.
 *
 * ── The pay body is empty, and that is the design ────────────────────────────
 *
 * `POST /:id/pay` takes no chain and no asset: those are the charge's, and the
 * charge says them. What is left of the request is the id and the session. It
 * used to be `{ "chain": "monad", "asset": { "symbol": "USDC", "decimals": 6 } }`,
 * and the payer was choosing; now the link describes the transfer and the payer
 * either has it or is told they do not.
 *
 * ── There is no `recipient` field, and that is the design ─────────────────────
 *
 * `contrato-dinero.md:26` — *"nadie escribe una dirección ni la ve"*. The payee's
 * address is resolved inside `payPaymentRequest`, from `rewallet.wallets`, and
 * goes straight into `prepareSend`. No field of this surface accepts one and no
 * field of any answer carries one, so the prohibition is a property of the types
 * rather than a rule somebody has to remember while writing the next screen.
 *
 * `address` in the pay answer is the **payer's own** wallet — the one the browser
 * has to sign for, exactly as `POST /api/send/prepare` names it.
 *
 * ── The same door as every other route ───────────────────────────────────────
 *
 * Same cookie, same codec, same 401. There is no cookie, no query parameter and no
 * header anywhere in these three verbs that could name somebody else: the payer's
 * id comes from the claims and the payee's comes from the row.
 *
 * ── Why a wrong id is 404 and never a 500 ────────────────────────────────────
 *
 * `REQUEST_NOT_FOUND` answers for a malformed id, an id that is not on file and a
 * row that vanished between the check and the read. One code, one status, one body.
 * An answer that told those three apart would be an oracle for measuring how many
 * ids are real, which is the cheap first step of enumerating outstanding charges —
 * and there is nothing the person needs that a real id does not already give them.
 *
 * ── The statuses, and what each one has to be for a person ───────────────────
 *
 * | Status | Code                | What happened                                              |
 * |--------|---------------------|------------------------------------------------------------|
 * | 201    | —                   | one charge, one id                                          |
 * | 200    | —                   | the charge as it stands, or the transfer that pays it      |
 * | 400    | `AMOUNT_INVALID` …  | refused, one bounded code per distinct wrong thing          |
 * | 400    | `CHAIN_UNKNOWN`, `ASSET_NOT_ON_CHAIN` | the charge names something this app cannot move |
 * | 401    | `UNAUTHENTICATED`   | no cookie; nothing read and nothing written                 |
 * | 404    | `REQUEST_NOT_FOUND` | no such charge, or not an id — deliberately indistinguishable |
 * | 409    | `ALREADY_PAID`      | the link is over: one link is one payment                  |
 * | 409    | `IDEMPOTENT_REPLAY` | this payer already prepared this payment                    |
 * | 410    | `REQUEST_EXPIRED`   | past `expires_at`; the link is over                         |
 * | 502    | `PAYMENT_REQUESTS_UNAVAILABLE` / `WALLETS_UNAVAILABLE` | the rows could not be read; nothing written |
 *
 * 404 and 409 and 410 are three different facts about a **real** charge, and only
 * 404 is vague on purpose.
 *
 * ── What no error body carries ───────────────────────────────────────────────
 *
 * A code, and nothing else: no amount, no address, no date, no row, no reason.
 * `docs/contrato-dinero.md` — *"Sin jerga, sin códigos, sin errores técnicos"* —
 * and the operational detail that would help an attacker (which id exists, whose
 * wallet is missing) goes to the log, where it is read by the operator and shipped
 * nowhere.
 */
import { Hono, type Context } from 'hono';

import type { CreatePaymentRequest } from '../../../application/payment-requests/createPaymentRequest';
import {
  PaymentRequestRejected,
} from '../../../application/payment-requests/errors';
import type { ReadPaymentRequest } from '../../../application/payment-requests/readPaymentRequest';
import {
  PaymentAlreadyPaid,
  PaymentRequestExpired,
  PaymentRequestNotFound,
  PaymentRequestUnavailable,
} from '../../../application/payment-requests/errors';
import type { PayPaymentRequest } from '../../../application/payment-requests/payPaymentRequest';
import { PaymentRefused } from '../../../application/payment-requests/payPaymentRequest';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import { WALLETS_UNAVAILABLE_BODY } from './portfolio';

/**
 * The 502 this route produces when its own rows cannot be read.
 *
 * The reason stays in the log. A charge that cannot be read is **not** an empty
 * charge, and answering 200 would tell a person that a link they were sent is not
 * real.
 */
export const PAYMENT_REQUESTS_UNAVAILABLE_BODY = {
  error: { code: 'PAYMENT_REQUESTS_UNAVAILABLE' },
} as const;

/** The one 404. Same body for a malformed id, an unknown one and a vanished row. */
export const PAYMENT_REQUEST_NOT_FOUND_BODY = { error: { code: 'REQUEST_NOT_FOUND' } } as const;

/**
 * The codes that mean "somebody already tried this", not "you did it wrong".
 *
 * They are 409 rather than 400 because no amount of retrying fixes them, and a
 * screen should say so differently: `ALREADY_PAID` ends the flow, and
 * `IDEMPOTENT_IN_FLIGHT` is the only one worth retrying.
 */
const CONFLICT_CODES: ReadonlySet<string> = new Set(['ALREADY_PAID', 'IDEMPOTENT_REPLAY', 'IDEMPOTENT_IN_FLIGHT']);

export interface PaymentRequestsDeps {
  readonly sessions: SessionCodec;
  readonly createPaymentRequest: CreatePaymentRequest;
  readonly readPaymentRequest: ReadPaymentRequest;
  readonly payPaymentRequest: PayPaymentRequest;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createPaymentRequestsRoutes = (deps: PaymentRequestsDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  /** The same door, the same codec, the same 401 as every other route. */
  const authenticate = async (c: Context) => {
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return null;
    return deps.sessions.read(presented, clock());
  };

  app.post('/', async (c) => {
    const claims = await authenticate(c);
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    /*
     * A body that is not JSON is not a charge request. It is refused as an
     * unusable request rather than becoming a 500: nothing about it was read.
     */
    const body = await c.req.json().catch(() => null);

    try {
      const charge = await deps.createPaymentRequest(claims.userId, (body ?? {}) as Record<string, never>);
      // 201 and not 200: a charge was created, and its id is new.
      return c.json(charge, 201);
    } catch (error) {
      if (error instanceof PaymentRequestRejected) {
        log.log(`POST /payment-requests refused: ${error.code}`);
        return c.json({ error: { code: error.code } }, 400);
      }
      if (error instanceof PaymentRequestUnavailable) {
        log.error('POST /payment-requests could not write the charge', error);
        return c.json(PAYMENT_REQUESTS_UNAVAILABLE_BODY, 502);
      }
      throw error;
    }
  });

  app.get('/:id', async (c) => {
    const claims = await authenticate(c);
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    // The path segment, and nothing else: there is no query parameter and no
    // header that could name a different charge.
    const id = c.req.param('id');

    try {
      return c.json(await deps.readPaymentRequest(id), 200);
    } catch (error) {
      if (error instanceof PaymentRequestNotFound) {
        // Deliberately identical for a malformed id and an unknown one.
        log.log('GET /payment-requests/:id — no such charge');
        return c.json(PAYMENT_REQUEST_NOT_FOUND_BODY, 404);
      }
      if (error instanceof PaymentRequestUnavailable) {
        log.error('GET /payment-requests/:id could not read the charge', error);
        return c.json(PAYMENT_REQUESTS_UNAVAILABLE_BODY, 502);
      }
      throw error;
    }
  });

  app.post('/:id/pay', async (c) => {
    const claims = await authenticate(c);
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const id = c.req.param('id');

    try {
      // The payer is the session. The charge says what to pay in what chain, the
      // payee comes from the row, and the destination address is resolved inside
      // the use case — there is no field in this surface that could carry one.
      //
      // The request body is deliberately not read: nothing in it can redirect the
      // payment, so there is nothing to read it for.
      return c.json(await deps.payPaymentRequest(claims.userId, id), 200);
    } catch (error) {
      if (error instanceof PaymentRequestNotFound) {
        log.log('POST /payment-requests/:id/pay — no such charge');
        return c.json(PAYMENT_REQUEST_NOT_FOUND_BODY, 404);
      }
      if (error instanceof PaymentAlreadyPaid) {
        log.log('POST /payment-requests/:id/pay — already paid');
        return c.json({ error: { code: 'ALREADY_PAID' } }, 409);
      }
      if (error instanceof PaymentRequestExpired) {
        log.log('POST /payment-requests/:id/pay — past its deadline');
        return c.json({ error: { code: 'REQUEST_EXPIRED' } }, 410);
      }
      if (error instanceof PaymentRefused) {
        log.error(`POST /payment-requests/:id/pay refused: ${error.code}`, error);
        return c.json({ error: { code: error.code } }, CONFLICT_CODES.has(error.code) ? 409 : 400);
      }
      if (error instanceof WalletsUnavailable) {
        // The payer's own rows: no address to send from, nothing written.
        log.error('POST /payment-requests/:id/pay could not read the payer wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      if (error instanceof PaymentRequestUnavailable) {
        log.error('POST /payment-requests/:id/pay could not read the charge rows', error);
        return c.json(PAYMENT_REQUESTS_UNAVAILABLE_BODY, 502);
      }
      throw error;
    }
  });

  return app;
};
