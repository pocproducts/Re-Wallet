/**
 * Turning a balance into dollars: the exact arithmetic, and nothing else.
 *
 * ── The rule this file exists to enforce: exact, or absent ──────────────────
 *
 * A dollar value here is the **exact product** of an amount and a price:
 *
 * ```
 *   value = quantityRaw x priceRaw      (at quantityDecimals + priceDecimals)
 * ```
 *
 * Two raw integers multiplied. No `Number` anywhere — `Number` is already wrong
 * past 53 bits and an 18-decimal balance goes past it — and no division: the
 * scale of the product is known from the two scales, so there is nothing to
 * compute and therefore nothing to round.
 *
 * **Never silently round a value.** The exact integer is carried to the response
 * together with the `decimals` it is expressed at, and the decimal string is
 * produced by the same string surgery every other amount in this repository uses
 * (`formatUnits`). Display formatting is the screen's business; it is the one
 * place rounding is allowed to happen, and it is not here.
 *
 * ── Why adding two values never rounds either ───────────────────────────────
 *
 * The pieces of a bucket do not share a scale: MON's value is at 18 + 8 = 26
 * decimals, USDC's at 6 + 0 = 6. Adding them means bringing them to a common
 * scale, and the **only safe direction is up**: multiplying an integer by a power
 * of ten appends zeros and loses nothing.
 *
 * So the sum is taken at the **largest scale among its members**, every member
 * is scaled up to it exactly, and `decimals` on the answer says which scale it is
 * at. There is no code path in this file that can round, because there is no
 * division in it at all.
 */
import { formatUnits } from '../portfolio/assets';
import type { PricedAsset } from '../ports/price-feed';

/** The unit every value in a wallet balance is denominated in. */
export const USD_UNIT = 'USD';

/** The symbols that get a Chainlink price, keyed by the symbol a chain reports. */
const PRICED_ASSET_BY_SYMBOL: Readonly<Record<string, PricedAsset>> = {
  MON: 'MON',
  ETH: 'ETH',
  SOL: 'SOL',
  BTC: 'BTC',
};

/**
 * The priced asset a chain symbol names, or `null` when it names none.
 *
 * `null` is a real answer and not a silent zero: a catalog entry that is neither
 * a digital dollar nor a priced asset has no valuation, and the composition
 * reports the piece unreadable instead of guessing a rate for it.
 */
export const pricedAssetOf = (symbol: string): PricedAsset | null => PRICED_ASSET_BY_SYMBOL[symbol] ?? null;

/** A quantity of something, exact, with the unit that names it. */
export interface Quantity {
  /** The exact integer the chain reported, in the smallest unit. */
  readonly raw: string;
  /** The same value in `unit`, unrounded. */
  readonly amount: string;
  readonly decimals: number;
  readonly unit: string;
}

/**
 * How a value was arrived at, stated in the answer.
 *
 * `source: 'peg'` with every other field `null` is the visible proof that **no
 * oracle was consulted** for that piece. A screen does not have to trust it: the
 * absence of a pair and of a timestamp is the claim.
 */
export interface PriceDetail {
  /** The exact USD decimal text of the unit price, at `decimals`. */
  readonly usd: string;
  /**
   * The same price as the **exact integer** at `decimals`. `"0.028642"` at 8 is
   * `"2864200"` here.
   *
   * It travels beside `usd` so that nothing has to turn a decimal string back
   * into a number in order to multiply it by somebody's balance.
   */
  readonly raw: string;
  /** The scale the price was read at. **0 for a peg**, because 1 is exact. */
  readonly decimals: number;
  readonly source: 'peg' | 'chainlink';
  /** The Chainlink pair, e.g. `MON_USD`. `null` for a peg: there was no feed. */
  readonly pair: string | null;
  /** Unix seconds of the round. `null` for a peg: there was no round. */
  readonly updatedAt: number | null;
  /** Whether a second channel corroborated it. `null` for a peg. */
  readonly crossChecked: boolean | null;
}

/** The price of a digital dollar: exactly 1, at zero decimals, with no feed. */
export const PEG_PRICE: PriceDetail = {
  usd: '1',
  raw: '1',
  decimals: 0,
  source: 'peg',
  pair: null,
  updatedAt: null,
  crossChecked: null,
};

/** An exact dollar figure: the integer at `decimals`, plus its decimal text. */
export interface UsdAmount {
  readonly raw: string;
  readonly amount: string;
  readonly decimals: number;
  readonly unit: typeof USD_UNIT;
}

/** A value before it has been summed: a `bigint` and the scale it is at. */
export interface ScaledValue {
  readonly raw: bigint;
  readonly decimals: number;
}

/** The scale of the product of a quantity and a price. `quantity + price`. */
export const valueScale = (quantityDecimals: number, priceDecimals: number): number =>
  quantityDecimals + priceDecimals;

/**
 * The exact USD value of `quantityRaw` at `priceRaw`.
 *
 * The multiplication is the whole computation: two integers at two known scales
 * produce an integer at the sum of the scales. Nothing is divided, so nothing is
 * lost, and `decimals` is the sum rather than a choice.
 *
 * A negative price or amount is a programming error, not a value: this function
 * throws rather than publishing a negative balance.
 */
export const usdValueOf = (
  quantityRaw: bigint,
  quantityDecimals: number,
  priceRaw: bigint,
  priceDecimals: number,
): ScaledValue => {
  if (quantityRaw < 0n) throw new RangeError('a quantity cannot be negative');
  if (priceRaw < 0n) throw new RangeError('a price cannot be negative');
  return { raw: quantityRaw * priceRaw, decimals: valueScale(quantityDecimals, priceDecimals) };
};

/** The value of a digital dollar: the quantity itself, at the quantity's scale. */
export const peggedValueOf = (quantityRaw: bigint, quantityDecimals: number): ScaledValue => ({
  raw: quantityRaw * BigInt(PEG_PRICE.usd),
  decimals: valueScale(quantityDecimals, PEG_PRICE.decimals),
});

/**
 * The exact sum of `values`, at the **largest** scale among them.
 *
 * Scaling up is multiplication by a power of ten: exact, always. Scaling down
 * would be a division, and a division here is a rounding — so this function never
 * does one, and `decimals` on the answer states the scale the sum is at.
 *
 * The sum of nothing is a real zero at zero decimals. An empty list is not an
 * error, and it is not a missing answer either.
 */
export const sumExact = (values: readonly ScaledValue[]): UsdAmount => {
  const scale = values.reduce((widest, value) => (value.decimals > widest ? value.decimals : widest), 0);
  let sum = 0n;
  for (const value of values) sum += value.raw * 10n ** BigInt(scale - value.decimals);

  return { raw: sum.toString(), amount: formatUnits(sum, scale), decimals: scale, unit: USD_UNIT };
};

/** A `Quantity` built from an exact integer. One shape for every amount here. */
export const quantityOf = (raw: bigint, decimals: number, unit: string): Quantity => ({
  raw: raw.toString(),
  amount: formatUnits(raw, decimals),
  decimals,
  unit,
});

/**
 * An exact integer out of a decimal string, or `null` when it is not one.
 *
 * Used to re-read a chain's own `raw` field, so that a chain answering
 * something that is not an integer produces a refusal rather than `NaN`. There is
 * no `parseFloat` anywhere near money: this is `BigInt` on the digits, after the
 * sign has been checked.
 */
export const exactIntegerOf = (raw: string): bigint | null => {
  if (!/^-?\d+$/.test(raw)) return null;
  const value = BigInt(raw);
  return value < 0n ? null : value;
};
