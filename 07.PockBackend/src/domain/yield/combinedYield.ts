/**
 * THE COMBINED YIELD: one figure for every venue a person's dollars sit in.
 *
 * ── The formula, and why a plain average is the wrong answer ────────────────
 *
 * ```
 *   combined = Σ(balanceᵢ x rateᵢ) / Σ(balanceᵢ)
 * ```
 *
 * A weighted mean, not an average of the rates. With $60 at 4.12 % and $40 at
 * 4.18 % the answer is **4.144 %**, not the 4.15 % an unweighted average gives:
 * the average ignores how much money sits behind each rate, and a person with
 * one cent in the second venue is owed the first venue's rate. A venue holding
 * three quarters of the balance moves the answer three quarters of the way.
 *
 * ── Exactness, and the one division that cannot be avoided ─────────────────
 *
 * Everything in this repository that turns a quantity into a value is a
 * **multiplication** (`usdValueOf`): two integers at two known scales produce an
 * integer at the sum of the scales, and there is nothing to round. A weighted
 * mean is a **division**, and a division of integers does not in general have an
 * integer answer. So this module does not try to force one:
 *
 * ```
 *   B = the widest scale among the balances      E = the widest scale among the rates
 *   numerator   = Σ( balanceᵢ·10^(B-bᵢ) x rateᵢ·10^(E-eᵢ) )     at scale B + E
 *   denominator = ( Σ balanceᵢ·10^(B-bᵢ) ) x 10^E
 *
 *   combined = numerator / denominator          ← exactly, both halves carried whole
 * ```
 *
 * `numerator` and `denominator` are `bigint`s end to end and are published as
 * decimal **strings**, so the answer crosses HTTP as text and can be turned into
 * a decimal by a caller that is *choosing* a precision — `percentLabelOfRatio`,
 * the one rounding in this feature, and it is called by the painter, not here.
 * Nothing inside the combination divides, truncates or rounds.
 *
 * ── Why each rate is rescaled before it is multiplied ──────────────────────
 *
 * Aave's supply APR arrives as a percentage label at four decimals; Kamino's
 * APY arrives as a decimal **fraction** with whatever number of digits Kamino
 * published it with (nineteen today). Adding `41196` (at 4) to `41808723945949255255` (at 19)
 * is the mistake this repository has already paid for twice: two `raw` values at
 * different scales are two different numbers. So every rate is multiplied up to
 * `E`, the widest scale among them — scaling **up** is multiplication by a power
 * of ten, which loses nothing — and every balance is scaled up to `B` the same
 * way. Only after that is anything added.
 *
 * ── The honesty rule: one venue unreadable means no combined number ─────────
 *
 * A weighted mean over the venues that happened to answer is a **confident
 * number computed from missing data**. If Aave's rate could not be read, then
 * `Σ(balance x rate)` is missing its largest term, and the division that follows
 * would divide a smaller numerator by the *same* denominator — which is a
 * systematically **too low** figure that looks entirely ordinary. That is the
 * failure mode this codebase exists to prevent, so:
 *
 *  - any unreadable venue ⇒ `complete: false` and `rate: null`. **No** partial
 *    weighted mean is published, and none can be.
 *  - the per-venue breakdown is published either way, so a screen can say *which*
 *    venue is missing rather than just that something is.
 *  - **zero is not unreadable.** A venue holding exactly zero is excluded from
 *    the weighting, and that exclusion is its own fact (`exclusion: 'zero_balance'`)
 *    rather than a silent absence — "excluded because it is zero" and "excluded
 *    because we could not read it" are different claims and a screen is told
 *    which one it is.
 *  - every venue holding zero is a real zero: `complete: true` with a zero rate,
 *    because nothing failed.
 */
import { formatUnits } from '../portfolio/assets';
import type { UsdAmount } from '../price/valuation';
import { parseExactDecimal } from './kaminoEarnVault';

/**
 * Why one venue's **rate** or **balance** could not be read, as a bounded name.
 *
 * Every member is a name another file in this repository already uses: the pool
 * read's, the Kamino position's, and the one this feature adds (`APR_NOT_RECONCILED`,
 * which is Aave's own reconciliation refusing its supply rate). No provider's
 * words cross this boundary, and a screen can only render a name.
 */
export type YieldVenueFailure =
  | 'RPC_UNAVAILABLE'
  | 'RPC_REJECTED'
  | 'RPC_MALFORMED_RESPONSE'
  | 'RESERVE_DECODE_FAILED'
  | 'CONFIG_UNREADABLE'
  | 'APR_NOT_RECONCILED'
  | 'VAULT_LAYOUT_UNREADABLE'
  | 'FARM_STATE_UNREADABLE'
  | 'KAMINO_UNAVAILABLE'
  | 'KAMINO_MALFORMED_RESPONSE'
  | 'SHARE_PRICE_NON_POSITIVE'
  | 'APY_NON_POSITIVE'
  | 'WALLETS_UNAVAILABLE'
  | 'PRICE_UNAVAILABLE'
  | 'FEED_DECIMALS_UNREADABLE'
  | 'STALE'
  | 'NON_POSITIVE'
  | 'CHANNELS_DISAGREE';

/**
 * An annual rate, exact, as a **fraction of one** — `0.041196` is `4.1196 %`.
 *
 * `raw` is the exact integer at `decimals`, and both travel together, exactly as
 * `sharePrice`'s do: a rate whose scale this code guessed is a rate off by a
 * factor of ten million. `text` is the decimal Kamino or the pool published, kept
 * so a screen can print the venue's own figure without re-deriving it.
 */
export interface YieldRate {
  readonly raw: bigint;
  readonly decimals: number;
  readonly text: string;
}

/**
 * A rate read off a **percentage label** — Aave's `"4.1196"`.
 *
 * A percentage is a fraction times one hundred, so the fraction is the same
 * integer with **two more** fractional digits: `41196` at 4 becomes `41196` at 6,
 * which is `0.041196`. That is a change of scale and not an arithmetic operation,
 * so nothing is divided and nothing is lost.
 *
 * `null` when the text is not a decimal this code can read exactly (see
 * `parseExactDecimal`), which is a refusal and never a zero.
 */
export const rateFromPercentText = (text: string, percentDigits: number): YieldRate | null => {
  const exact = parseExactDecimal(text);
  if (exact === null) return null;
  const decimals = exact.decimals + 2;
  return { raw: exact.raw, decimals, text: formatUnits(exact.raw, decimals) };
};

/** A rate read off a published **fraction** — Kamino's `"0.041808723945949255"`. */
export const rateFromFractionText = (text: string): YieldRate | null => {
  const exact = parseExactDecimal(text);
  if (exact === null) return null;
  return { raw: exact.raw, decimals: exact.decimals, text: formatUnits(exact.raw, exact.decimals) };
};

/**
 * One venue's contribution, with its own state.
 *
 * The union is the design. An `ok` venue always carries a balance; it carries a
 * rate **unless it holds exactly zero**, and that case says so explicitly instead
 * of hiding behind a `null`. An `unreadable` venue never carries a balance at all,
 * so there is no state in which a missing read could be summed as a zero.
 */
export type YieldVenue =
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'ok';
      readonly exclusion: null;
      readonly balance: UsdAmount;
      readonly rate: YieldRate;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'ok';
      /** Set **only** when the balance is exactly zero. See the header. */
      readonly exclusion: 'zero_balance';
      readonly balance: UsdAmount;
      readonly rate: YieldRate | null;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'unreadable';
      readonly reason: YieldVenueFailure;
      readonly balance: null;
      readonly rate: null;
    };

/**
 * An exact ratio: `numerator / denominator`, verbatim.
 *
 * No `decimals`, because a ratio has no scale of its own and inventing one would
 * be the rounding this module exists to avoid. Both halves are decimal strings of
 * `bigint`s, so they survive JSON without a float touching them.
 */
export interface ExactRatio {
  readonly numerator: string;
  readonly denominator: string;
}

/** Why a venue is excluded from the weighting. Never used for anything else. */
export type YieldVenueExclusion = 'zero_balance';

/** A venue as the screen sees it: what it holds, at what rate, and its state. */
export type YieldVenueContribution =
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'ok';
      readonly exclusion: YieldVenueExclusion | null;
      readonly balance: UsdAmount;
      readonly rate: { readonly raw: string; readonly decimals: number; readonly text: string } | null;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'unreadable';
      readonly reason: YieldVenueFailure;
      readonly balance: null;
      readonly rate: null;
    };

/**
 * The combined figure, and everything a screen needs to explain it.
 *
 * `rate` is `null` **iff** `complete` is `false`. There is no shape in which a
 * partial weighted mean is published, and no shape in which a complete figure is
 * withheld.
 */
export interface CombinedYield {
  readonly complete: boolean;
  readonly rate: ExactRatio | null;
  readonly venues: readonly YieldVenueContribution[];
}

/**
 * The zero ratio, for the case where nothing failed and nothing is deposited.
 *
 * `0/1` rather than `0/0`: nobody holds zero dollars, so the weighting has no
 * denominator, and `0/0` is not a ratio that can be rounded into a figure. The
 * answer is still a real zero, and it is still `complete`.
 */
const ZERO_RATIO: ExactRatio = { numerator: '0', denominator: '1' };

const contributionOf = (venue: YieldVenue): YieldVenueContribution =>
  venue.status === 'unreadable'
    ? { key: venue.key, label: venue.label, status: 'unreadable', reason: venue.reason, balance: null, rate: null }
    : {
        key: venue.key,
        label: venue.label,
        status: 'ok',
        exclusion: venue.exclusion,
        balance: venue.balance,
        rate:
          venue.rate === null
            ? null
            : { raw: venue.rate.raw.toString(), decimals: venue.rate.decimals, text: venue.rate.text },
      };

/**
 * The one rounding in this feature, and it is **not** called by the combination.
 *
 * A caller that is painting chooses how many decimal places a person reads, and
 * this rounds once, half-up, at that precision. Everything upstream of here is
 * exact; if a screen shows `4.1440 %`, that string is one rounding away from
 * `numerator / denominator` and nothing else in between.
 */
export const percentLabelOfRatio = (ratio: ExactRatio, places = 4): string => {
  if (places < 0) throw new RangeError(`places must not be negative: ${places}`);
  const numerator = BigInt(ratio.numerator) * 100n * 10n ** BigInt(places);
  const denominator = BigInt(ratio.denominator);
  if (denominator <= 0n) throw new RangeError('a rate over a non-positive balance is not a figure');
  // Half-up, with the remainder handled by adding half the divisor: one rounding.
  const scaled = (2n * numerator + denominator) / (2n * denominator);
  return fixedDecimal(scaled, places);
};

/** Fixed-places text: `4.1440`, never `4.144`, and never `NaN`. */
const fixedDecimal = (value: bigint, places: number): string => {
  const digits = value.toString().padStart(places + 1, '0');
  if (places === 0) return digits;
  return `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
};

/**
 * The combined yield across every venue.
 *
 * Every venue is either in the weighting or excluded **because it holds exactly
 * zero**; a venue that could not be read makes the whole answer incomplete, and
 * no number is published at all.
 */
export const combineYields = (venues: readonly YieldVenue[]): CombinedYield => {
  const contributions = venues.map(contributionOf);
  const complete = contributions.every((venue) => venue.status === 'ok');

  /*
   * No venues at all, and everybody present holds zero, are the same arithmetic:
   * nothing is deposited, so nothing earns. `complete` is still the conjunction
   * of the reads, and it is `true` here because a zero is not a hole.
   */
  if (!complete) return { complete, rate: null, venues: contributions };
  if (!contributions.some((venue) => venue.status === 'ok' && venue.exclusion === null)) {
    return { complete: true, rate: ZERO_RATIO, venues: contributions };
  }

  const weighted = contributions.filter(
    (venue): venue is Extract<YieldVenueContribution, { status: 'ok' }> =>
      venue.status === 'ok' && venue.exclusion === null,
  );
  if (weighted.some((venue) => venue.rate === null)) {
    // An `ok` venue that is being weighted always carries a rate: the type says
    // so, and this is the guard against a future field being added to it.
    throw new Error('a venue being weighted must carry the rate it was weighted by');
  }

  /*
   * The two common scales. Widening only, exactly as `sumExact` does: scaling a
   * rate or a balance **up** multiplies by a power of ten and loses nothing, and
   * this is what makes adding two `raw` values from two different sources
   * meaningful at all.
   */
  const balanceScale = weighted.reduce((widest, venue) => Math.max(widest, venue.balance.decimals), 0);
  const rateScale = weighted.reduce((widest, venue) => Math.max(widest, venue.rate?.decimals ?? 0), 0);

  let numerator = 0n;
  let totalBalance = 0n;
  for (const venue of weighted) {
    const rate = venue.rate as { readonly raw: string; readonly decimals: number; readonly text: string };
    const balance = BigInt(venue.balance.raw) * 10n ** BigInt(balanceScale - venue.balance.decimals);
    const scaledRate = BigInt(rate.raw) * 10n ** BigInt(rateScale - rate.decimals);
    totalBalance += balance;
    numerator += balance * scaledRate;
  }

  return {
    complete: true,
    // Σ(bᵢ·rᵢ) over Σ(bᵢ), with the rate scale folded into the denominator so
    // the ratio is the fraction of one and needs no exponent of its own.
    rate: {
      numerator: numerator.toString(),
      denominator: (totalBalance * 10n ** BigInt(rateScale)).toString(),
    },
    venues: contributions,
  };
};
