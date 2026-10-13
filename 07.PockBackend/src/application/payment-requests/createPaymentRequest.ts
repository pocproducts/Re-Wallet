/**
 * USE CASE: create a charge and answer with the link that opens it.
 *
 * ── What this writes, and what it refuses ────────────────────────────────────
 *
 * One row in `rewallet.payment_requests`, and nothing else. There is no funds
 * movement and no reserve: `contrato-dinero.md` is explicit that an unpaid charge
 * *"solo existe al cobrar"* — it is an intention, not a transaction. So creating
 * one does not read a balance, does not touch a chain and does not move anything.
 *
 * The three refusals are the three things a caller can get wrong that this server
 * cannot decide for them:
 *
 * ```
 *  1. AMOUNT_INVALID        a positive decimal in whole units, at eighteen decimals
 *  2. NOTE_INVALID          text, or nothing, at most 280 characters
 *  3. EXPIRY_OUT_OF_RANGE   between one minute and thirty days
 * ```
 *
 * And then the id, which is not a refusal but a check: a draw that the table
 * would reject is refused here rather than becoming a `CHECK` violation in a log,
 * because a charge whose id cannot be stored is a link that leads nowhere.
 *
 * ── What the body says, and what it deliberately does not ───────────────────
 *
 * ```
 * { "amount": "10", "chain": "monad", "asset": { "symbol": "USDC" } }
 * ```
 *
 * Chain and symbol, and **no decimals**. The decimals come from the catalog,
 * because they are a fact about the token and not about the request: a client
 * that could send them could send `decimals: 0` and have the server build a
 * transfer of `10` wei instead of `10` USDC. This is the same rule
 * `prepareSend` applies to a recipient's `decimals`, and it is applied one level
 * earlier — at the moment the charge is made, which is where the question first
 * has an answer.
 *
 * The catalog is also what decides **whether the charge can exist**:
 *
 * ```
 *  5. CHAIN_UNKNOWN            the chain is not one this app has
 *  6. ASSET_NOT_ON_CHAIN       the symbol is not one of that chain's assets
 *  7. AMOUNT_NOT_REPRESENTABLE the amount has no integer in that asset's scale
 * ```
 *
 * All three are refusals at **creation**, not at payment. A charge for something
 * this app cannot move is not a charge, and the person who can fix it is the one
 * who asked for it — the payer cannot change the asset, so discovering the
 * problem at the payment screen would turn a wrong request into somebody else's
 * dead end.
 *
 * ── Who is asking ────────────────────────────────────────────────────────────
 *
 * The session's user id, and there is no second source. A `userId` in the body is
 * not looked at, so there is no code path that files somebody else's charge
 * against their name — the same rule as `prepareSend` and its sender.
 *
 * ── Why expiry is a number of milliseconds and not a date ────────────────────
 *
 * Because a **date** in the body is a clock the client owns: two timezones, a
 * device with the wrong time, and a charge that expires an hour early. What the
 * person actually decides is "how long is this link good for", and that is
 * answered by the server's clock and its `created_at`. The absolute instant is
 * still returned, as `expiresAt`, so a screen can say "vence a las 18:20" — it
 * just does not get to decide when that is.
 */
import { newPaymentRequestId, PAYMENT_REQUEST_ID_PATTERN } from './id';
import { ChargeAmountInvalid, ChargeAmountNotRepresentable, canonicalChargeAmount, chargeAmountToRaw } from './amount';
import {
  ASSET_NOT_ON_CHAIN,
  CHAIN_UNKNOWN,
  PaymentRequestRejected,
  PaymentRequestUnavailable,
} from './errors';
import {
  DEFAULT_PAYMENT_REQUEST_TTL_MS,
  MAX_PAYMENT_REQUEST_NOTE_LENGTH,
  MAX_PAYMENT_REQUEST_TTL_MS,
  MIN_PAYMENT_REQUEST_TTL_MS,
} from './expiry';
import { toPaymentRequestView, type PaymentRequestView } from './view';
import { DEPOSIT_NETWORKS, type DepositAssetSpec, type DepositChain } from '../../domain/deposit/catalog';
import type { PaymentRequestStore, StoredPaymentRequest } from '../../domain/ports/payment-request-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

/** How many ids are drawn before giving up on a collision. */
export const MAX_PAYMENT_REQUEST_ID_ATTEMPTS = 5;

/** The body, read field by field and never cast. */
export interface CreatePaymentRequestBody {
  readonly amount?: unknown;
  readonly chain?: unknown;
  readonly asset?: { readonly symbol?: unknown } | null;
  readonly note?: unknown;
  readonly expiresInMs?: unknown;
}

/** A chain and the asset on it, both resolved from the catalog. */
export interface ChargeAsset {
  readonly chain: DepositChain;
  readonly symbol: string;
  /** The catalog's decimals. Never the body's — the body has no such field. */
  readonly decimals: number;
}

export interface CreatePaymentRequestDeps {
  readonly requests: PaymentRequestStore;
  readonly now?: () => Date;
  /** The id source. Injectable so a test can pin a collision. Never a client. */
  readonly newId?: () => string;
  readonly ttlMs?: number;
  readonly log?: Logger;
}

export type CreatePaymentRequest = (
  userId: string,
  body: CreatePaymentRequestBody,
) => Promise<PaymentRequestView>;

/**
 * The note, or nothing.
 *
 * `null` and `undefined` mean "no note" — an absent note is a normal charge, not
 * a broken one. Anything that is not a string is `NOTE_INVALID`, and the length is
 * bounded at 280 because that is a sentence and not a document: a note is shown on
 * the pay screen, and a screen that has to scroll a paragraph is a screen nobody
 * reads.
 */
const parseNote = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new PaymentRequestRejected('NOTE_INVALID', `a note is text or nothing: ${JSON.stringify(value)}`);
  }

  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > MAX_PAYMENT_REQUEST_NOTE_LENGTH) {
    throw new PaymentRequestRejected('NOTE_INVALID', `a note is ${text.length} characters long`);
  }
  return text;
};

/**
 * How long this charge lives, as an offset from now.
 *
 * A `number` and a `bigint` are both accepted because a JSON body carries a
 * double and there is nothing to convert in either — but a non-integer, a
 * negative one and a string are all refused, because a duration of `'86400000'`
 * means somebody is guessing at the unit.
 */
const parseExpiry = (value: unknown, defaultMs: number): number => {
  if (value === undefined || value === null) return defaultMs;

  let ms: number;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    ms = value;
  } else if (typeof value === 'bigint') {
    if (value < 0n) throw new PaymentRequestRejected('EXPIRY_OUT_OF_RANGE', `a negative duration: ${value}`);
    ms = Number(value);
  } else {
    throw new PaymentRequestRejected('EXPIRY_OUT_OF_RANGE', `not a whole number of milliseconds: ${JSON.stringify(value)}`);
  }

  if (!Number.isSafeInteger(ms) || ms < MIN_PAYMENT_REQUEST_TTL_MS || ms > MAX_PAYMENT_REQUEST_TTL_MS) {
    throw new PaymentRequestRejected(
      'EXPIRY_OUT_OF_RANGE',
      `${ms} ms is outside [${MIN_PAYMENT_REQUEST_TTL_MS}, ${MAX_PAYMENT_REQUEST_TTL_MS}]`,
    );
  }
  return ms;
};

const isDepositChain = (value: unknown): value is DepositChain =>
  typeof value === 'string' && DEPOSIT_NETWORKS.some((network) => network.chain === value);

/**
 * What the charge is for: the chain, the asset, and the asset's own scale.
 *
 * `DEPOSIT_NETWORKS` is the **same** catalog that deposit and send read, and that
 * is the point: a charge may only name what the app can actually receive. If
 * this had its own list, a charge could be created for a token no address exists
 * for, and the discovery would land on the person paying.
 *
 * The decimals come out of here and never out of the body, and that is not a
 * convenience: `decimals` decides how the stored decimal string becomes the
 * integer that moves, so a body that carried them would be a body carrying the
 * size of the transfer.
 *
 * `AMOUNT_NOT_REPRESENTABLE` — the amount has no integer in this asset — is
 * raised by the caller through `chargeAmountToRaw`, and is the reason the asset
 * is resolved **before** anything is written rather than at payment time.
 */
export const resolveChargeAsset = (chain: unknown, symbol: unknown): ChargeAsset => {
  if (!isDepositChain(chain)) {
    throw new PaymentRequestRejected(
      CHAIN_UNKNOWN,
      `no tenemos esa cadena: ${JSON.stringify(chain)}`,
    );
  }
  const network = DEPOSIT_NETWORKS.find((candidate) => candidate.chain === chain);
  const asset: DepositAssetSpec | undefined =
    typeof symbol === 'string' ? network?.assets.find((candidate) => candidate.symbol === symbol) : undefined;

  if (asset === undefined) {
    // The message has to survive being read by somebody who does not know what a
    // symbol is: it says what was asked for, where it was looked for, and what
    // *is* there instead.
    const available = network?.assets.map((candidate) => candidate.symbol).join(', ') ?? '';
    throw new PaymentRequestRejected(
      ASSET_NOT_ON_CHAIN,
      `no encontramos el activo ${JSON.stringify(symbol)} en la cadena "${chain}". ` +
        `En esa cadena sí hay: ${available || 'ninguno'}.`,
    );
  }

  return { chain, symbol: asset.symbol, decimals: asset.decimals };
};

export const createPaymentRequest = (deps: CreatePaymentRequestDeps): CreatePaymentRequest => {
  const log = deps.log ?? noopLogger;
  const defaultTtl = deps.ttlMs ?? DEFAULT_PAYMENT_REQUEST_TTL_MS;
  const drawId = deps.newId ?? newPaymentRequestId;

  return async (userId: string, body: CreatePaymentRequestBody): Promise<PaymentRequestView> => {
    /*
     * 1. The amount. `numeric(38,18)`, so the string either fits or is refused —
     *    and it is a string, because a float that arrived as a JSON number has
     *    already lost the digits that make it a different amount.
     */
    let amount: string;
    try {
      amount = canonicalChargeAmount(body?.amount);
    } catch (error) {
      if (error instanceof ChargeAmountInvalid) {
        throw new PaymentRequestRejected('AMOUNT_INVALID', error.message);
      }
      throw error;
    }

    /*
     * 2. What it is a charge for.
     *
     *    Resolved here, from the catalog, and refused here if it does not exist.
     *    Two refusals with a sentence that names what was not found, because a
     *    charge in something this app cannot move is not a charge — and the
     *    person who asked for it is the one who can fix it.
     */
    const asset = resolveChargeAsset(body?.chain, body?.asset?.symbol);

    /*
     * 3. The amount at THIS asset's scale.
     *
     *    The column holds 18 decimals, but an asset with 6 does not: a charge of
     *    `1.123456` USDC has no integer that means it, and rounding it would move
     *    money in a direction nobody chose. So this is refused at creation, where
     *    the answer is still "change the amount", and never at payment, where the
     *    only answer left would be "you cannot pay".
     */
    try {
      chargeAmountToRaw(amount, asset.decimals);
    } catch (error) {
      if (error instanceof ChargeAmountNotRepresentable) {
        throw new PaymentRequestRejected('AMOUNT_NOT_REPRESENTABLE', error.message);
      }
      throw error;
    }

    /* 4. The note, and 5. the deadline. Both are cheap and both are refusable. */
    const note = parseNote(body?.note);
    const ttl = parseExpiry(body?.expiresInMs, defaultTtl);

    const createdAt = deps.now?.() ?? new Date();
    const expiresAt = new Date(createdAt.getTime() + ttl);

    /*
     * 6. The id.
     *
     *    A collision on a 192-bit id is not a security event — it is a birthday
     *    paradox that will not happen — but it has to have an answer, and "draw
     *    again" is the only honest one. `ON CONFLICT (id) DO NOTHING` returns no
     *    row, which is how the adapter says it, and five draws is more than any
     *    real run will ever spend.
     */
    let row: StoredPaymentRequest | null = null;
    for (let attempt = 0; attempt < MAX_PAYMENT_REQUEST_ID_ATTEMPTS; attempt += 1) {
      const id = drawId();

      /*
       * The generator and the table's CHECK have to agree. They are asserted to
       * agree in `test/application/paymentRequests.test.ts`; this is the runtime
       * half of the same contract, so a change to one without the other is a 400
       * with a code instead of a `CHECK` violation in a log.
       */
      if (!PAYMENT_REQUEST_ID_PATTERN.test(id)) {
        throw new PaymentRequestRejected('ID_UNUSABLE', `the id source produced ${JSON.stringify(id)}`);
      }

      try {
        row = await deps.requests.create({
          id,
          userId,
          amount,
          chain: asset.chain,
          assetSymbol: asset.symbol,
          assetDecimals: asset.decimals,
          note,
          createdAt,
          expiresAt,
        });
      } catch (error) {
        log.error('charge.rows_unavailable', { userId, error });
        // Not a refusal of the person: the rows could not be written. 502, and a
        // different sentence from "your amount is wrong".
        throw new PaymentRequestUnavailable('the charge could not be written', { cause: error });
      }

      if (row !== null) {
        log.log('charge.created', {
          userId,
          id,
          amount,
          chain: asset.chain,
          symbol: asset.symbol,
          decimals: asset.decimals,
          expiresAt: expiresAt.toISOString(),
        });
        return toPaymentRequestView(row, createdAt);
      }

      log.log('charge.id_collision', { userId, attempt });
    }

    log.error('charge.id_collision_exhausted', { userId });
    throw new PaymentRequestUnavailable(
      `${MAX_PAYMENT_REQUEST_ID_ATTEMPTS} ids were already on file`,
    );
  };
};
