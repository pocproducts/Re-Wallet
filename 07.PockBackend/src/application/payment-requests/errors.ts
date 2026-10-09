/**
 * The refusals this feature can produce, in one file.
 *
 * ── Why every refusal is a class and not a string ────────────────────────────
 *
 * Because a route has to tell them apart and a string comparison does not
 * survive a typo: `error.code === 'ALREADY_PAID'` is a claim about the world
 * that the compiler cannot check, while `error instanceof PaymentAlreadyPaid`
 * fails to compile when the class is renamed. Each one of these carries the
 * bounded code the browser receives, and the human detail that stays in the log.
 *
 * ── Why the detail is never in the answer ────────────────────────────────────
 *
 * `docs/contrato-dinero.md`: *"la persona ve un loader y el resultado. Sin jerga,
 * sin códigos, sin errores técnicos."* So the message of every error here exists
 * for the operator's log, and the route writes `error.code` and nothing else.
 *
 * ── Why "not found" is one class and not two ─────────────────────────────────
 *
 * A malformed id and an id that is not on file answer **the same way**, with the
 * same code and the same status. A route that answered "that is not an id" for one
 * and "no such charge" for the other would be an oracle: it would let an attacker
 * measure how many ids are real without ever opening one, which is the cheapest
 * possible first step of enumerating outstanding charges. Telling them apart buys
 * a sentence nobody needs and costs the id its only protection.
 */

/** `amount` is not a positive decimal string in whole units at six decimals or fewer. */
export class ChargeAmountInvalid extends Error {
  static readonly code = 'AMOUNT_INVALID';

  constructor(detail: string) {
    super(`Charge amount refused: ${detail}`);
    this.name = 'ChargeAmountInvalid';
  }
}

/** This amount has no integer at the chosen asset's scale, and is not rounded. */
export const AMOUNT_NOT_REPRESENTABLE = 'AMOUNT_NOT_REPRESENTABLE';

export class ChargeAmountNotRepresentable extends Error {
  readonly code = AMOUNT_NOT_REPRESENTABLE;

  constructor(detail: string) {
    super(`Charge amount refused (${AMOUNT_NOT_REPRESENTABLE}): ${detail}`);
    this.name = 'ChargeAmountNotRepresentable';
  }
}

/** The whole create surface's bounded codes, one per distinct wrong thing. */
export type CreatePaymentRequestCode =
  | 'AMOUNT_INVALID'
  | 'NOTE_INVALID'
  | 'EXPIRY_OUT_OF_RANGE'
  | 'ID_UNUSABLE';

/** A create that the server refuses to write. 400. */
export class PaymentRequestRejected extends Error {
  static readonly codes: readonly CreatePaymentRequestCode[] = [
    'AMOUNT_INVALID',
    'NOTE_INVALID',
    'EXPIRY_OUT_OF_RANGE',
    'ID_UNUSABLE',
  ];

  readonly code: CreatePaymentRequestCode;

  constructor(code: CreatePaymentRequestCode, detail: string) {
    super(`Charge creation refused (${code}): ${detail}`);
    this.name = 'PaymentRequestRejected';
    this.code = code;
  }
}

/**
 * The rows could not be read or written. 502.
 *
 * Deliberately not a refusal: a charge that answers "your amount is wrong" when
 * the database is down would send a person to fix something that is not broken.
 */
export class PaymentRequestUnavailable extends Error {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`Charge rows unavailable: ${detail}`, options);
    this.name = 'PaymentRequestUnavailable';
  }
}

/** There is no charge with that id. 404, and the same answer for a malformed one. */
export class PaymentRequestNotFound extends Error {
  constructor(readonly id: unknown) {
    super('No charge with that id.');
    this.name = 'PaymentRequestNotFound';
  }
}

/** The charge is already paid. 409: this is not going to get better on its own. */
export class PaymentAlreadyPaid extends Error {
  constructor(readonly id: string) {
    super(`Charge ${id} is already paid.`);
    this.name = 'PaymentAlreadyPaid';
  }
}

/** The charge is past its deadline. 410: the link is over. */
export class PaymentRequestExpired extends Error {
  constructor(readonly id: string) {
    super(`Charge ${id} expired before it was paid.`);
    this.name = 'PaymentRequestExpired';
  }
}
