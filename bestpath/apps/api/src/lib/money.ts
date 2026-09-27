/**
 * Money helpers.
 *
 * Amounts are `numeric(20,6)` in Postgres and strings in the domain layer. They
 * are manipulated as integer MINOR UNITS (6 decimals for USDC) and only
 * serialised at the boundary. A float is never involved: 0.1 + 0.2 !== 0.3 is
 * not an acceptable property for someone's balance.
 */

export const USDC_DECIMALS = 6;
export const MINOR_UNIT = 10 ** USDC_DECIMALS;

/** "1234.567890" -> 1234567890n. Throws on anything that is not a valid amount. */
export function toMinorUnits(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`Invalid money amount: ${amount}`);
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return BigInt(whole) * BigInt(MINOR_UNIT) + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
}

/** 1234567890n -> "1234.567890" */
export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / BigInt(MINOR_UNIT);
  const fraction = (abs % BigInt(MINOR_UNIT)).toString().padStart(USDC_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export const add = (a: string, b: string): string => fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));

export const sub = (a: string, b: string): string => fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));

/** Multiply by a rate in basis points, rounding half-up. */
export function applyBps(amount: string, bps: number): string {
  const scaled = toMinorUnits(amount) * BigInt(Math.round(bps));
  return fromMinorUnits((scaled + 5_000n) / 10_000n);
}

export const isPositive = (amount: string): boolean => toMinorUnits(amount) > 0n;

export const gte = (a: string, b: string): boolean => toMinorUnits(a) >= toMinorUnits(b);

/** Basis points -> human percent string, e.g. 565 -> "5.65%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
