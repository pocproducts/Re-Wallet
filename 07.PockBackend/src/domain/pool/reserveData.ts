/**
 * The reserve of Aave V3, decoded, and the arithmetic that turns it into numbers
 * a person can read.
 *
 * ── Twelve outputs, in this order, and nothing else ───────────────────────────
 *
 * ```
 * getReserveData(address asset) view returns (
 *   uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken,
 *   uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate,
 *   uint256 variableBorrowRate, uint256 stableBorrowRate,
 *   uint256 averageStableBorrowRate, uint256 liquidityIndex,
 *   uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)
 * ```
 *
 * Verbatim from `@aave/core-v3/contracts/misc/AaveProtocolDataProvider.sol`.
 * Declaring fewer, or in another order, does not throw: everything after the
 * missing word lands one slot early, and the result is a reserve that *looks*
 * legible — a `lastUpdateTimestamp` of `4e25` (the year 4921) and a supply APR
 * of `130.281.299%`. So the decoder refuses an answer that does not have twelve
 * words instead of filling the tail with whatever it found.
 *
 * ── The rate is ANNUAL, in RAY ────────────────────────────────────────────────
 *
 * `RAY = 1e27` and the stored rate is per **year**. Reading it as per second
 * produces the same `130.281.299%`. The only defence is arithmetic that is wrong
 * on purpose — dividing by RAY once, multiplying by 100 once — plus the check at
 * the bottom of this file, which reproduces the supply rate from the borrow
 * rate, the utilisation and the reserve factor. A misaligned decode cannot
 * satisfy that identity.
 *
 * ── Why `bigint` from end to end ──────────────────────────────────────────────
 *
 * A rate in RAY is 27 significant digits. `Number` loses it long before the
 * decimal point, and a percentage is the one number on a money screen that must
 * not be "approximately right". Every quantity here is an integer, and a
 * percentage only becomes text at the very end, by string surgery.
 */
import {
  APPROVE_SELECTOR,
  DEPOSIT_SELECTOR,
  GET_RESERVE_DATA_SELECTOR,
} from './aaveMonad';

/** `1e27`. Aave's ray unit. */
export const RAY = 10n ** 27n;

/** `1e4`. Aave's percentage unit, one hundredth of a point. */
const BPS = 10_000n;

/** A percent is a ratio times one hundred: `91.8470%` is the ratio `0.91847`. */
const RATIO_PERCENT = 100n;

/**
 * `1e6`. The multiplier that turns a fraction of one into a percentage with four
 * decimals: `rate x 1e6` is the rate in units of `0.0001%`.
 */
const PERCENT_FOUR_DECIMALS = BPS * RATIO_PERCENT;


/**
 * The scale of every percentage in this codebase: one unit is **0.0001%**.
 *
 * `aprPercentFromRay` returns the integer at this scale and `percentLabel` is the
 * only function that turns it into text, so "what is the unit of this number" has
 * exactly one answer in the project.
 */
export const APR_PERCENT_SCALE = 10_000n;

/** The reserve, as the twelve words of the official ABI, each in a name. */
export interface ReserveData {
  readonly unbacked: bigint;
  readonly accruedToTreasuryScaled: bigint;
  readonly totalAToken: bigint;
  readonly totalStableDebt: bigint;
  readonly totalVariableDebt: bigint;
  /** Annual supply rate, in RAY. */
  readonly liquidityRate: bigint;
  /** Annual variable borrow rate, in RAY. */
  readonly variableBorrowRate: bigint;
  readonly stableBorrowRate: bigint;
  readonly averageStableBorrowRate: bigint;
  readonly liquidityIndex: bigint;
  readonly variableBorrowIndex: bigint;
  /** Unix seconds. `uint40` in the ABI, so it never exceeds this safely. */
  readonly lastUpdateTimestamp: bigint;
}

/**
 * A decode that cannot be trusted.
 *
 * It exists so a short, empty or non-hex answer fails loudly at the boundary,
 * where an operator can see it, instead of producing a reserve that reads like
 * data.
 */
export class ReserveDecodeError extends Error {
  constructor(detail: string) {
    super(`Aave reserve could not be decoded: ${detail}`);
    this.name = 'ReserveDecodeError';
  }
}

/** The twelve fields, in the exact order of the official ABI. */
const FIELD_ORDER = [
  'unbacked',
  'accruedToTreasuryScaled',
  'totalAToken',
  'totalStableDebt',
  'totalVariableDebt',
  'liquidityRate',
  'variableBorrowRate',
  'stableBorrowRate',
  'averageStableBorrowRate',
  'liquidityIndex',
  'variableBorrowIndex',
  'lastUpdateTimestamp',
] as const;

/** One 32-byte ABI word of a return value. */
const WORD_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * The twelve words of an `eth_call` answer, as `bigint`.
 *
 * Refuses anything that is not exactly twelve words of hex. That refusal is the
 * point: it is the difference between "this call did not answer" and "here is a
 * reserve with a timestamp of `4e25`".
 */
export const decodeReserveWords = (data: string): bigint[] => {
  const body = data.startsWith('0x') ? data.slice(2) : data;

  if (body.length === 0 || body.length % 64 !== 0) {
    throw new ReserveDecodeError(`expected twelve 32-byte words, got ${body.length / 64} word(s)`);
  }
  if (body.length / 64 !== FIELD_ORDER.length) {
    throw new ReserveDecodeError(
      `the ABI declares ${FIELD_ORDER.length} outputs, the answer carries ${body.length / 64}`,
    );
  }

  return Array.from({ length: FIELD_ORDER.length }, (_, index) => {
    const word = body.slice(index * 64, index * 64 + 64);
    if (!WORD_PATTERN.test(word)) throw new ReserveDecodeError(`word ${index} is not hex`);
    return BigInt(`0x${word}`);
  });
};

/** The twelve words, by name. */
export const decodeReserveData = (data: string): ReserveData => {
  const words = decodeReserveWords(data);
  const named: Record<string, bigint> = {};
  FIELD_ORDER.forEach((field, index) => {
    named[field] = words[index] as bigint;
  });
  return named as unknown as ReserveData;
};

/**
 * An annual rate in RAY as a percentage with **four decimals**, as an integer at
 * `APR_PERCENT_SCALE`.
 *
 * `rate * 1e6 / RAY`: the `100` of "percent" and the `1e4` of the four decimals,
 * in one multiplication, in integers.
 */
export const aprPercentFromRay = (rateRay: bigint): bigint => (rateRay * PERCENT_FOUR_DECIMALS) / RAY;

/** An integer at `APR_PERCENT_SCALE` as the text a person reads: `41206` → `4.1206`. */
export const percentLabel = (scaled: bigint): string => {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const whole = magnitude / APR_PERCENT_SCALE;
  const fraction = (magnitude % APR_PERCENT_SCALE).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

/** The same as `percentLabel`, for a scaled value produced by `aprPercentFromRay`. */
export const aprLabel = (rateRay: bigint): string => percentLabel(aprPercentFromRay(rateRay));

/**
 * Utilisation: borrowed over total, as a percentage with four decimals.
 *
 * `borrowed / (borrowed + available)` where available is what the reserve holds
 * idle — which for this deployment is `totalAToken - totalVariableDebt`, because
 * its stable debt token is the zero address and its stable debt is `0`.
 *
 * `null` when there is nothing deposited: an empty reserve has no utilisation,
 * and reporting `0.0000%` for "nobody deposited" would be a different claim from
 * "nobody borrowed and everybody is paid nothing" — the first is true of a new
 * pool, the second is not.
 */
export const utilisationPercent = (borrowed: bigint, total: bigint): bigint | null => {
  if (total <= 0n) return null;
  return (borrowed * PERCENT_FOUR_DECIMALS) / total;
};

/**
 * Reproduce the supply APR from the borrow rate, the utilisation and the reserve
 * factor: `borrowAPR x utilisation x (1 - reserveFactor)`, at `APR_PERCENT_SCALE`.
 *
 * This is the check that a decode has to pass before a rate is worth showing. The
 * interest rate strategy adds a spread the provider does not hand over, so the
 * identity holds to within a few hundredths of a point — not exactly. See
 * `aprsReconcile` for how close is close enough.
 *
 * @param reserveFactorBps The reserve factor in `BPS` (`1000` = 10%).
 */
export const reconcileSupplyApr = (input: {
  readonly borrowAprScaled: bigint;
  readonly utilisationScaled: bigint;
  readonly reserveFactorBps: bigint;
}): bigint | null => {
  if (input.reserveFactorBps < 0n || input.reserveFactorBps >= BPS) return null;
  if (input.borrowAprScaled < 0n || input.utilisationScaled < 0n) return null;

  /*
   * Both inputs are at `APR_PERCENT_SCALE`, and `(1 - rf)` is `BPS` based:
   *
   *   borrow%          = borrowAprScaled / APR_PERCENT_SCALE
   *   utilisationRatio = utilisationScaled / (APR_PERCENT_SCALE x 100)   [percent -> ratio]
   *   1 - rf           = (BPS - reserveFactorBps) / BPS
   *   supplyPercent    = the product of the three
   *
   * so `supplyScaled = borrowAprScaled x utilisationScaled x (BPS - rf)` divided
   * by `APR_PERCENT_SCALE x 100 x BPS`, which puts the result back on the scale.
   */
  const divisor = APR_PERCENT_SCALE * RATIO_PERCENT * BPS;
  return (input.borrowAprScaled * input.utilisationScaled * (BPS - input.reserveFactorBps)) / divisor;
};

/**
 * Whether a reconciled supply rate is close enough to the reported one to ship.
 *
 * Half a point. The spread of the interest rate strategy lives in that gap; a
 * discrepancy larger than it means the numbers do not belong to the same
 * reserve, and the honest answer then is not a rate at all.
 */
export const aprsReconcile = (supplyScaled: bigint, reconciledScaled: bigint): boolean => {
  const tolerance = APR_PERCENT_SCALE / 2n; // 0.5 percentage points
  const distance =
    supplyScaled > reconciledScaled ? supplyScaled - reconciledScaled : reconciledScaled - supplyScaled;
  return distance <= tolerance;
};

/* ── Calldata ──────────────────────────────────────────────────────────────── */

/** A 32-byte ABI word holding a `uint256`. */
const word = (value: bigint): string => value.toString(16).padStart(64, '0');

/** A 32-byte ABI word holding an `address`. */
const addressWord = (address: string): string => {
  const bare = address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(bare)) {
    throw new RangeError(`not an EVM address: ${address}`);
  }
  return bare.toLowerCase().padStart(64, '0');
};

/** A `uint256` amount that has to be non-negative. */
const amountWord = (amount: bigint): string => {
  if (amount < 0n) throw new RangeError(`a signed amount cannot be encoded: ${amount}`);
  return word(amount);
};

/**
 * `approve(spender, amount)` on the USDC contract.
 *
 * The amount is **exactly** what was asked for, never `2^256 - 1`. An infinite
 * approval is a standing permission that outlives the deposit, and nobody in this
 * flow asked for one.
 */
export const encodeApprove = (spender: string, amount: bigint): string =>
  `${APPROVE_SELECTOR}${addressWord(spender)}${amountWord(amount)}`;

/**
 * `deposit(asset, amount, onBehalfOf, referralCode)` on the pool.
 *
 * `onBehalfOf` is the address out of the database. `referralCode` is `0`: this
 * app has no referral programme, and inventing a code here would be taking a cut
 * nobody agreed to.
 */
export const encodeDeposit = (asset: string, amount: bigint, onBehalfOf: string): string =>
  `${DEPOSIT_SELECTOR}${addressWord(asset)}${amountWord(amount)}${addressWord(onBehalfOf)}${word(0n)}`;

/** The `eth_call` data for the reserve read. */
export const reserveDataCall = (asset: string): string =>
  `${GET_RESERVE_DATA_SELECTOR}${addressWord(asset)}`;
