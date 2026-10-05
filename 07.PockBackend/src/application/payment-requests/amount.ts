/**
 * THE AMOUNT OF A CHARGE: a decimal string in whole units, and an integer in the
 * smallest unit of the asset it ends up being paid in.
 *
 * ── Why this is the one place a decimal amount is right ──────────────────────
 *
 * Every other amount in this project is an **integer in the smallest unit** —
 * `amountRaw`, the `transfer` calldata, the movement's `meta.amountRaw` — and it
 * should stay that way. But `payment_requests` has one `amount numeric(20,6)`
 * and **no column for the asset it is denominated in**, because which asset a
 * charge is paid in is chosen when somebody pays it, not when it is created. The
 * scale of the smallest unit is therefore unknowable at creation time, and a
 * screen that guessed it would be deciding how much money moves.
 *
 * So the charge is an amount of **dollars**, written as a decimal string, and the
 * integer is computed here, on the server, once the asset is known. There is no
 * float in this file: `Number('150.25')` is not exact, and the error of a float
 * in a payment amount is a payment of the wrong amount.
 *
 * ── Why the front must not compute this integer ──────────────────────────────
 *
 * Because the front would need the stored amount as a float to shift it, and the
 * whole point of storing it as a string is that it survives the trip. The screen
 * shows the amount and picks the asset; the shift happens here, once, on the side
 * that also decides whether it is representable.
 *
 * ── Why six decimals is the ceiling and not a preference ─────────────────────
 *
 * It is `numeric(20,6)`. An amount with a seventh decimal place is not a number
 * this column can hold, so it is refused at creation with `AMOUNT_INVALID` rather
 * than silently rounded into a charge for a different number of dollars.
 *
 * ── Why a charge that cannot exist in the chosen asset is a refusal ──────────
 *
 * Today every asset in the catalog has six decimals or more, so this branch is
 * unreachable through the catalog — which is exactly why it is written and tested
 * rather than left out: the next asset with four decimals is the day it fires, and
 * on that day it has to refuse instead of rounding. Rounding in the middle of a
 * payment moves money in a direction nobody chose.
 */
import { AMOUNT_NOT_REPRESENTABLE, ChargeAmountInvalid, ChargeAmountNotRepresentable } from './errors';

export { AMOUNT_NOT_REPRESENTABLE, ChargeAmountInvalid, ChargeAmountNotRepresentable };

/**
 * Digits, an optional dot, digits — and nothing else.
 *
 * `1` and `1.5` are amounts. `+1`, `-1`, `.5`, `1.`, `1e3`, `1,5`, `NaN` and
 * `1.2.3` are not, and neither is a `number`: a float that arrived as a JSON
 * number has already lost the digits that distinguish it from its neighbour.
 */
const DECIMAL = /^\d{1,14}(?:\.\d{1,6})?$/;

/**
 * The amount as this project stores and returns it: a canonical decimal string.
 *
 * Canonical means: no trailing zeroes in the fraction, no trailing dot, no
 * exponent. So `'150.250000'` and `'150.25'` are the same charge, and a
 * comparison between two rows does not have to know how either was typed.
 *
 * @throws `ChargeAmountInvalid` when it is not a positive decimal string that
 *         `numeric(20,6)` can hold.
 */
export const canonicalChargeAmount = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new ChargeAmountInvalid(`not a decimal string: ${JSON.stringify(value)}`);
  }

  const text = value.trim();
  if (!DECIMAL.test(text)) {
    throw new ChargeAmountInvalid(`not a positive decimal in whole units: ${JSON.stringify(value)}`);
  }

  const dot = text.indexOf('.');
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? '' : text.slice(dot + 1).replace(/0+$/, '');

  // `0001.5` is `1.5`: the column stores the number, not the padding.
  const canonical = `${whole.replace(/^0+(?=\d)/, '')}${fraction === '' ? '' : `.${fraction}`}`;
  if (!/^\d+(\.\d+)?$/.test(canonical) || canonicalChargeValueIsZero(canonical)) {
    throw new ChargeAmountInvalid(`not a positive amount: ${JSON.stringify(value)}`);
  }
  return canonical;
};

/** `true` when every digit of the amount is a zero. No `Number`, no float. */
const canonicalChargeValueIsZero = (canonical: string): boolean => !/[1-9]/.test(canonical);

/**
 * The amount, validated and canonicalised.
 *
 * @throws `ChargeAmountInvalid` for anything that is not a positive decimal
 *         string in whole units at six decimals or fewer.
 */
export const parseChargeAmount = (value: unknown): string => canonicalChargeAmount(value);

/**
 * The integer in `decimals` places — the shape every transaction in this project
 * is built from.
 *
 * Trailing zeroes past the scale are fine: `'1.123000'` at six decimals is
 * `1123000`, the same number. Digits that are **not** zero past the scale are
 * not representable and are refused, never rounded.
 *
 * @throws `ChargeAmountNotRepresentable` when this amount has no integer at this
 *         scale.
 */
export const chargeAmountToRaw = (amount: string, decimals: number): bigint => {
  const canonical = canonicalChargeAmount(amount);
  const dot = canonical.indexOf('.');
  const whole = dot === -1 ? canonical : canonical.slice(0, dot);
  const fraction = dot === -1 ? '' : canonical.slice(dot + 1);

  if (fraction.length > decimals) {
    throw new ChargeAmountNotRepresentable(
      `${canonical} has ${fraction.length} decimals and this asset has ${decimals}`,
    );
  }

  const padded = fraction.padEnd(decimals, '0');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === '' ? '0' : padded);
};
