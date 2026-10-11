/**
 * USE CASE: pay a charge, by preparing the transfer that pays it.
 *
 * ── Why this exists at all, instead of the front calling `prepareSend` ───────
 *
 * Because `prepareSend` takes the recipient **in the body**, and the whole point of
 * this feature is that the front never has one. `contrato-dinero.md:26` is
 * unambiguous: the recipient is *"un dato que la persona no ve"*, and the payee's
 * address is the one that must not exist on the other side of a payment request.
 *
 * So the direction of the call is inverted: **this use case calls `prepareSend`**,
 * with the payee's address it resolved itself, from `rewallet.wallets`. The
 * browser's request carries the charge's id and nothing else that describes the
 * transfer — and no address, because there is no field for one. If somebody later
 * adds a `recipient` to this body, it will be a field nothing reads, and that is
 * the point: the feature has no path by which a browser can name a destination.
 *
 * ── The body does not say what to pay, in either field ───────────────────────
 *
 * The chain and the asset are **the charge's**, not the body's. The browser sends
 * an id; `chain`, `asset_symbol` and `asset_decimals` come off the row. That is
 * the decision in `odd/tasks/cobro-con-cadena-y-activo.md`: a payer pays what the
 * charge asks for or does not pay, so there is nothing here to choose and nothing
 * that a tampered request could redirect. A `/cobrar/{id}` link that said "10 USDC
 * on Monad" and then paid whatever the browser asked for would be a charge that
 * describes one thing and does another.
 *
 * The only thing the browser can still contradict is nothing — which is why
 * `INVALID_AMOUNT`'s old trigger (a body whose `decimals` disagreed with the
 * catalog) is gone from this path. `prepareSend` still owns that code, and it can
 * still arrive through `SendRejected`, but the payer cannot cause it any more.
 *
 * The one place the catalog is consulted is where it always was: the asset is
 * re-resolved from `(chain, symbol)` before the transfer is built, because that
 * is what fixes the **scale** the stored decimal string is converted at. The row
 * carries the decimals as of creation, and the catalog is what the chain actually
 * has today; when those two disagree the catalog wins and the drift is logged,
 * because building a transfer at a scale the token does not have is the one
 * outcome this path must not produce.
 *
 * ── Everything else is the send flow, unchanged ──────────────────────────────
 *
 * Balance, gas, the catalog's decimals, the chain check, the transaction, the
 * idempotency claim and the pending movement all belong to `prepareSend`, and none
 * of it is reimplemented here. That is not a shortcut: it is what makes a payment
 * of a charge and an ordinary send the **same** operation with the same refusals,
 * so a screen learns one vocabulary (`SEND_FAILURE_TEXT` on the front) for both.
 *
 * ── Why the policy applies here too, and through the same door ──────────────
 *
 * A payment of a charge **is** a send: it moves money out of the payer's wallet
 * into somebody else's, and step 8 is `prepareSend`. So the three spending rules
 * are enforced by that same call, with the charge's own amount and the payee's
 * address — the payer never gets to name a destination, and a policy that only
 * guarded the hand-typed send would be a policy that a link could walk around.
 *
 * The one thing this path adds is the **gesture**: a `confirm` verdict needs
 * `policyConfirmed` in the pay body, and it is forwarded to `prepareSend`
 * unchanged. What counts as a gesture is that use case's decision and only its
 * decision; a second opinion here would be a second place to be wrong.
 *
 * ── The order of the checks ──────────────────────────────────────────────────
 *
 * ```
 *  1. id                 REQUEST_NOT_FOUND — same answer for a malformed one
 *  2. ALREADY_PAID       this link is over, and it will not come back
 *  3. REQUEST_EXPIRED    past `expires_at`
 *  4. SELF_PAYMENT_REFUSED   the payee does not pay their own charge
 *  5. CHAIN_UNKNOWN / ASSET_NOT_ON_CHAIN   the catalog, against the row
 *  6. AMOUNT_NOT_REPRESENTABLE    no integer means this amount in this asset
 *  7. PAYEE_WALLET_UNAVAILABLE     no wallet row of theirs on this chain
 *  8. prepareSend        every refusal of a send —the spending policy included—
 *                        plus the movement it writes
 *  9. markPaid           paid_by_user_id, paid_movement_id, paid_at
 * ```
 *
 * Cheap and deterministic before expensive: steps 1–7 read one row and no chain.
 * Step 8 is the first thing that talks to a chain, and step 9 is the only write
 * that changes the charge.
 *
 * ── Why step 8 is not step 9 ─────────────────────────────────────────────────
 *
 * Order matters here and the order is deliberate: the transfer is prepared first
 * and the charge is marked paid second. Preparing is idempotent — it is claimed,
 * and a retry replays it — so a failure between the two leaves a `pending`
 * movement and a `pending` charge, which is exactly the truth: nobody has paid.
 * Marking first would leave a charge that says "paid" with nothing behind it, which
 * is the one outcome a charge must never have.
 *
 * ── Why the double payment is stopped twice, and which one counts ────────────
 *
 * Step 2 answers the ordinary second tap, before any chain work. It is not the
 * guarantee: two taps a millisecond apart both read `pending`, and the derived
 * status cannot help there — it is a read-time answer, not a lock. The guarantee is
 * step 9's conditional `UPDATE … WHERE status = 'pending' AND expires_at > $paidAt`,
 * which returns **no row** to the loser. Whoever gets nothing back re-reads and is
 * told `ALREADY_PAID` or `REQUEST_EXPIRED`, which are different sentences.
 *
 * And the transfer itself is protected by the same `requestId` on every attempt by
 * the same payer (`paymentSendRequestId`), so even two calls that both got past
 * step 2 prepare **one** transfer: the second replays the first's preparation.
 *
 * ── What this answer is, and what it deliberately does not say ───────────────
 *
 * It is a send preparation — the same shape, the same fields, the same meaning —
 * with `paymentRequest` added. `address` is the **payer's own** wallet, the one
 * they must sign for, exactly as `POST /api/send/prepare` names it.
 *
 * The payee is not in it: not their address, not their `userId`, not their chain
 * row. Their address went into `prepareSend` and came out of it inside the signed
 * transaction's calldata, which is a hash of it and not the string. A screen that
 * renders this response has no address to render, so the prohibition holds by
 * construction instead of by discipline.
 */
import { WalletsUnavailable } from '../portfolio/readPortfolio';
import {
  SendInFlight,
  SendRejected,
  SendReplay,
  type PrepareSend,
  type SendPreparation,
} from '../send/prepareSend';
import {
  PaymentAlreadyPaid,
  PaymentRequestExpired,
  PaymentRequestNotFound,
  PaymentRequestUnavailable,
} from './errors';
import { ChargeAmountNotRepresentable, chargeAmountToRaw } from './amount';
import { hasExpired } from './expiry';
import { PAYMENT_REQUEST_ID_PATTERN } from './id';
import { DEPOSIT_NETWORKS, type DepositAssetSpec, type DepositChain } from '../../domain/deposit/catalog';
import { WALLET_CHAIN_FOR } from '../../domain/portfolio/networks';
import type { PaymentRequestStore } from '../../domain/ports/payment-request-store';
import type { WalletStore } from '../../domain/ports/wallet-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

/** The endpoint whose idempotency keys this path shares with `prepareSend`. */
export const PAYMENT_REQUEST_ENDPOINT = '/api/payment-requests/pay';

/**
 * The `requestId` a payment of `paymentRequestId` is prepared under.
 *
 * Derived, not generated, and that is the whole point: every attempt by the same
 * payer to settle the same charge carries the **same** id, so the second one
 * replays the first one's preparation instead of building a second transfer to the
 * same person for the same amount. The key is already scoped by user id inside
 * `idempotencyKeyFor`, so two different payers do not collide with each other.
 *
 * `prepareSend` accepts `[A-Za-z0-9_-]{8,128}` and this is a fixed prefix plus a
 * 32-character id, so it is always inside that range.
 */
export const paymentSendRequestId = (paymentRequestId: string): string => `pr-${paymentRequestId}`;

/**
 * The body of a payment, read field by field and never cast.
 *
 * One field, and it is not about the money: it says that a person looked at what
 * the spending rules asked and said yes. The charge's amount, chain, asset and
 * payee all come from the row, so there is nothing here that could redirect the
 * payment — which is why adding a field to this body is a decision and not a
 * convenience.
 */
export interface PayPaymentRequestBody {
  /**
   * The explicit gesture, forwarded to `prepareSend` exactly as it arrived.
   *
   * `unknown` and not `boolean` on purpose: the body is read, never cast, and
   * what counts as a gesture is `prepareSend`'s call to make. A `"true"` string
   * that some client improvises arrives, travels, and is answered with
   * `POLICY_CONFIRM_REQUIRED` — which is the correct answer, because it is not a
   * gesture.
   */
  readonly policyConfirmed?: unknown;
}

/** What the charge is now. Small on purpose: an id, a state and a moment. */
export interface PaidPaymentRequest {
  readonly id: string;
  readonly status: 'paid';
  readonly paidAt: string;
}

/**
 * A send preparation, plus the charge it settles.
 *
 * It is the send shape on purpose: the browser signs it with the same code that
 * signs an ordinary send, and a second shape would be a second signing path to keep
 * honest.
 */
export type PayPaymentRequestResult = SendPreparation & {
  readonly paymentRequest: PaidPaymentRequest;
};

/**
 * The refusal codes this path adds on top of the send's own.
 *
 * The send codes are re-exported in the list because they travel through here: a
 * payer whose balance is short gets `AMOUNT_EXCEEDS_BALANCE`, the same word the
 * send screen already knows.
 */
export type PayPaymentRequestCode =
  | 'CHAIN_UNKNOWN'
  | 'ASSET_NOT_ON_CHAIN'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_NOT_REPRESENTABLE'
  | 'SELF_PAYMENT_REFUSED'
  | 'PAYEE_WALLET_UNAVAILABLE'
  | 'IDEMPOTENT_REPLAY'
  | 'IDEMPOTENT_IN_FLIGHT'
  | 'PREPARATION_FAILED'
  /**
   * Unreachable with the derived `requestId`: `paymentSendRequestId` always
   * produces `pr-` plus a legal id. It is in the list because it is a code this
   * path can carry, and a list that only holds the codes that happen to be
   * reachable is a list that is wrong the day one of them is not.
   */
  | 'REQUEST_ID_INVALID'
  /**
   * The send's own balance and gas rules, reused verbatim.
   *
   * A payer with too little money gets `AMOUNT_EXCEEDS_BALANCE`, the same word and
   * the same sentence as somebody sending by hand — one vocabulary for one fact,
   * whichever door the money came through.
   */
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'BALANCE_UNREADABLE'
  | 'NO_GAS'
  /**
   * The payee's own stored address failed `prepareSend`'s own validation.
   *
   * Reachable only through bad data — the destination came from a row, not from
   * the request — and it is still the send's code rather than a new one: it is the
   * same fact (a destination that is not valid on this chain) and a screen that
   * already handles it handles this.
   */
  | 'INVALID_RECIPIENT'
  /**
   * The send's own reachability refusals, unreachable from here.
   *
   * This path resolves the payee's address itself, in step 7, and hands
   * `prepareSend` an address — never a handle. So the two codes the send adds
   * for a destination named as a `@tag` cannot come back through here, and this
   * list still carries them: a list that only holds the codes that happen to be
   * reachable is a list that is wrong the day one of them is not, and the
   * `PaymentRefused(error.code)` above is a compile-time check that it stays true.
   */
  | 'RECIPIENT_NOT_FOUND'
  | 'RECIPIENT_NO_WALLET_ON_CHAIN'
  /**
   * The spending rules refused this payment. A wall: no field of the body and no
   * retry lifts it.
   */
  | 'POLICY_DENIED'
  /**
   * A rule asked a question and the pay body carried no explicit gesture.
   *
   * Same code as the send's, for the same reason: a payment of a charge goes
   * through `prepareSend`, and the screen that already knows one knows both.
   */
  | 'POLICY_CONFIRM_REQUIRED';

export class PaymentRefused extends Error {
  readonly code: PayPaymentRequestCode;

  constructor(code: PayPaymentRequestCode, detail: string) {
    super(`Charge payment refused (${code}): ${detail}`);
    this.name = 'PaymentRefused';
    this.code = code;
  }
}

export interface PayPaymentRequestDeps {
  readonly requests: PaymentRequestStore;
  readonly wallets: WalletStore;
  /**
   * The send flow, called from here.
   *
   * Injected rather than constructed: `prepareSend` needs the balance readers, the
   * Solana preparer, the movement store and the idempotency store, and this use
   * case must not become the place where a dependency list is invented twice.
   */
  readonly prepareSend: PrepareSend;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export type PayPaymentRequest = (
  payerUserId: string,
  id: unknown,
  /**
   * The pay body, read field by field and never cast. Optional because the only
   * field this path ever looked at is the policy gesture, and a payment without
   * one is still a payment.
   */
  body?: PayPaymentRequestBody,
) => Promise<PayPaymentRequestResult>;

/**
 * The charge's own asset, resolved against the catalog — the same ten lines
 * `prepareSend` has, repeated for the same reason: it is not that task's function
 * to change, and two copies that disagree would show up as an asset one route can
 * send and the other cannot.
 *
 * What is different is the **source**. `prepareSend` reads the symbol and the
 * decimals out of a body; this reads them out of the row, so the caller of this
 * function has no say in either. The decimals that come back are the catalog's,
 * not the row's, and `INVALID_AMOUNT` is not a refusal here any more: there is no
 * longer a declared scale for a client to contradict.
 *
 * Both refusals are still reachable, and only from our own rows: a charge written
 * when the catalog had a chain or an asset that it no longer has. That is bad
 * data, and it is refused with the same two codes the send would use so a screen
 * handles one vocabulary.
 */
const selectChargeAsset = (
  chargeChain: string,
  chargeSymbol: string,
): { readonly chain: DepositChain; readonly asset: DepositAssetSpec } => {
  const chain = DEPOSIT_NETWORKS.find((network) => network.chain === chargeChain)?.chain;

  if (chain === undefined) {
    throw new PaymentRefused(
      'CHAIN_UNKNOWN',
      `this charge names a chain this app no longer has: ${JSON.stringify(chargeChain)}`,
    );
  }
  const asset = DEPOSIT_NETWORKS.find((network) => network.chain === chain)?.assets.find(
    (candidate) => candidate.symbol === chargeSymbol,
  );

  if (asset === undefined) {
    throw new PaymentRefused(
      'ASSET_NOT_ON_CHAIN',
      `${chargeSymbol} is not in the catalog on ${chain}, which is what this charge asks for`,
    );
  }
  return { chain, asset };
};

export const payPaymentRequest = (deps: PayPaymentRequestDeps): PayPaymentRequest => {
  const log = deps.log ?? noopLogger;

  return async (
    payerUserId: string,
    id: unknown,
    body?: PayPaymentRequestBody,
  ): Promise<PayPaymentRequestResult> => {
    const now = deps.now?.() ?? new Date();

    /* 1. The id, before anything else. Same answer for a malformed one. */
    if (typeof id !== 'string' || !PAYMENT_REQUEST_ID_PATTERN.test(id)) {
      throw new PaymentRequestNotFound(id);
    }

    /* 2–3. The charge, and where it stands. */
    let row;
    try {
      row = await deps.requests.findById(id);
    } catch (error) {
      log.error('charge.rows_unavailable', { error });
      throw new PaymentRequestUnavailable('the charge could not be read', { cause: error });
    }
    if (row === null) throw new PaymentRequestNotFound(id);

    if (row.status === 'paid') throw new PaymentAlreadyPaid(id);
    if (row.status === 'cancelled') {
      // A cancellation is somebody's decision about this link, and it is not a
      // "not found" and not an expiry: the charge existed and was withdrawn.
      throw new PaymentRequestExpired(id);
    }
    if (row.status === 'expired' || hasExpired(row.expiresAt, now)) {
      throw new PaymentRequestExpired(id);
    }

    /* 4. The payee does not pay their own charge. */
    if (row.userId === payerUserId) {
      throw new PaymentRefused('SELF_PAYMENT_REFUSED', 'the person who created this charge is paying it');
    }

    /*
     * 5. The catalog, against the charge: what can exist, and at which scale.
     *
     *    Both come off the row. There is no body here to contradict them, and no
     *    field to add one in without changing what this feature means.
     */
    const { chain, asset } = selectChargeAsset(row.chain, row.assetSymbol);
    if (row.assetDecimals !== asset.decimals) {
      // The catalog moved since the charge was made. Not a refusal — the catalog
      // is what the token actually has, so its scale is the one the transfer is
      // built at — but a line in the log, because a charge that pays at a
      // different scale than the one it was shown is a thing an operator wants
      // to know happened.
      log.log('charge.asset_scale_drift', {
        id,
        stored: row.assetDecimals,
        catalog: asset.decimals,
        chain,
        symbol: asset.symbol,
      });
    }

    /*
     * 6. The amount, as the integer of THIS asset.
     *
     *    The charge names its asset, so the scale is no longer a guess: it is
     *    the catalog's decimals for the (chain, symbol) the row holds. The shift
     *    happens here, in integers, because a float in a payment amount is a
     *    payment of a different amount.
     */
    let amountRaw: bigint;
    try {
      amountRaw = chargeAmountToRaw(row.amount, asset.decimals);
    } catch (error) {
      if (error instanceof ChargeAmountNotRepresentable) {
        throw new PaymentRefused('AMOUNT_NOT_REPRESENTABLE', error.message);
      }
      // A charge on file that this parser cannot read is our row, not the
      // person's request. Bounded and retryable, not a 500.
      log.error('charge.amount_unreadable', { id, error });
      throw new PaymentRefused('PREPARATION_FAILED', 'the stored amount could not be read');
    }

    /*
     * 7. The payee's address on this chain, from their wallet row.
     *
     *    `monad` and `ethereum` resolve to the same EVM row, exactly as everywhere
     *    else in this project (`../portfolio/networks.ts`). The address goes
     *    straight into `prepareSend` and comes out of this function nowhere.
     */
    const walletChain = WALLET_CHAIN_FOR[chain];
    let recipient: string;
    try {
      const wallets = await deps.wallets.findByUserId(row.userId);
      const payee = wallets.find((candidate) => candidate.chain === walletChain);
      if (payee === undefined) {
        throw new PaymentRefused(
          'PAYEE_WALLET_UNAVAILABLE',
          `the person who asked for this has no ${walletChain} wallet row`,
        );
      }
      recipient = payee.address;
    } catch (error) {
      if (error instanceof PaymentRefused) throw error;
      log.error('charge.payee_wallets_unavailable', { id, error });
      throw new PaymentRequestUnavailable("the payee's wallet rows could not be read", { cause: error });
    }

    /*
     * 8. The transfer. Every send rule applies — the spending policy included,
     *    enforced inside `prepareSend` against the charge's amount and the payee's
     *    address — with an id that is the same on every attempt by the same
     *    payer.
     */
    const requestId = paymentSendRequestId(id);
    let preparation: SendPreparation;
    try {
      preparation = await deps.prepareSend(payerUserId, {
        requestId,
        chain,
        asset: { symbol: asset.symbol, decimals: asset.decimals },
        recipient,
        amountRaw: amountRaw.toString(),
        // The gesture, untouched: whether a value is a gesture is decided once,
        // in the use case that enforces the rule.
        policyConfirmed: body?.policyConfirmed,
      });
    } catch (error) {
      if (error instanceof SendRejected) {
        // The send's own vocabulary, unchanged: a payer with too little money sees
        // the same code and the same sentence as somebody sending by hand.
        throw new PaymentRefused(error.code, error.message);
      }
      if (error instanceof SendReplay) {
        // Same payer, same charge, already prepared: one transfer, replayed.
        throw new PaymentRefused('IDEMPOTENT_REPLAY', `requestId ${requestId} already prepared this payment`);
      }
      if (error instanceof SendInFlight) {
        throw new PaymentRefused('IDEMPOTENT_IN_FLIGHT', `requestId ${requestId} is still being prepared`);
      }
      if (error instanceof WalletsUnavailable) {
        throw error;
      }
      log.error('charge.preparation_failed', { id, error });
      throw new PaymentRefused('PREPARATION_FAILED', 'the payment could not be prepared');
    }

    /*
     * 9. The charge, marked paid.
     *
     *    The condition is the guarantee: `pending` and not past its deadline. A
     *    second payment, or one that raced the deadline, gets no row back and is
     *    told which of the two it was.
     */
    let paid;
    try {
      paid = await deps.requests.markPaid({
        id,
        paidByUserId: payerUserId,
        paidMovementId: preparation.movement.id,
        paidAt: now,
      });
    } catch (error) {
      log.error('charge.rows_unavailable', { id, error });
      throw new PaymentRequestUnavailable('the charge could not be marked as paid', { cause: error });
    }

    if (paid === null) {
      const after = await deps.requests.findById(id).catch(() => null);
      if (after !== null && (after.status === 'paid' || after.paidByUserId !== null)) {
        throw new PaymentAlreadyPaid(id);
      }
      if (after === null || after.status === 'pending' || hasExpired(after.expiresAt, now)) {
        throw new PaymentRequestExpired(id);
      }
      throw new PaymentRequestUnavailable('the charge was neither paid nor payable');
    }

    log.log('charge.paid', {
      id,
      payerUserId,
      amountRaw: amountRaw.toString(),
      chain,
      symbol: asset.symbol,
    });

    /*
     * The answer is the send preparation, plus the charge's new state. `address` in
     * it is the **payer's** wallet — the one they sign for — and the payee is in no
     * field of it, including as text.
     */
    return {
      ...preparation,
      paymentRequest: { id, status: 'paid', paidAt: paid.paidAt?.toISOString() ?? now.toISOString() },
    };
  };
};
