/**
 * The combined yield, on its own: `Σ(balance x rate) / Σ(balance)`, exact.
 *
 * ── What this file is for ───────────────────────────────────────────────────
 *
 * Three things a money screen cannot get wrong, and each has a test here:
 *
 *  1. it is a **weighted mean**, not an average of the rates. The test case is
 *     chosen so the two answers differ in the second decimal place, and both are
 *     asserted — a weighted mean that quietly degenerated into an average would
 *     still look right at one venue;
 *  2. it is **exact**. `numerator` and `denominator` are `bigint`s and the
 *     published ratio is checked against digits computed by hand, including a
 *     case where the division does not terminate — which is the case a float or
 *     a scale-truncating implementation gets wrong;
 *  3. **one unreadable venue means no number at all.** Not a weighted mean over
 *     the venues that answered, which would be a confident figure computed from
 *     missing data.
 *
 * The zero cases are tested **separately** from the unreadable ones, because
 * "excluded because it holds nothing" and "excluded because we could not read it"
 * are different facts and only one of them is a hole in the answer.
 */
import { describe, expect, it } from 'vitest';

import {
  combineYields,
  percentLabelOfRatio,
  rateFromFractionText,
  rateFromPercentText,
  type ExactRatio,
  type YieldVenue,
} from '../../src/domain/yield/combinedYield';
import type { UsdAmount } from '../../src/domain/price/valuation';
import type { YieldRate } from '../../src/domain/yield/combinedYield';

/** A rate this test asked for and the parser must have produced. */
const must = (value: YieldRate | null): YieldRate => {
  if (value === null) throw new Error('the fixture is not a decimal this code can read');
  return value;
};

const usd = (raw: bigint, decimals = 6): UsdAmount => ({
  raw: raw.toString(),
  amount: (raw / 10n ** BigInt(decimals)).toString(),
  decimals,
  unit: 'USD',
});

/** A venue that takes part in the weighting, typed as that member exactly. */
type WeightedVenue = Extract<YieldVenue, { readonly exclusion: null }>;

/** A venue as the composition files it: $60 at 4.12 %, exactly. */
const aave60 = (): WeightedVenue => ({
  key: 'invest.aave_v3_usdc_monad',
  label: 'Aave V3 · USDC en Monad',
  status: 'ok',
  exclusion: null,
  balance: usd(60_000_000n),
  rate: must(rateFromPercentText('4.1200', 4)),
});

/** And $40 at 4.18 %, the second venue on another chain and another scale. */
const kamino40 = (): WeightedVenue => ({
  key: 'invest.kamino_earn_usdc_solana',
  label: 'Kamino Earn · USDC en Solana',
  status: 'ok',
  exclusion: null,
  balance: usd(40_000_000n),
  rate: must(rateFromFractionText('0.0418')),
});

describe('the combined yield is a weighted mean, not an average', () => {
  it('weighs each rate by the balance behind it', () => {
    const combined = combineYields([aave60(), kamino40()]);

    // (60 x 4.1200% + 40 x 4.1800%) / 100 = 4.1440%.
    expect(combined.complete).toBe(true);
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).toBe('4.1440');
  });

  it('would give a different answer as a plain average, which is the point', () => {
    const combined = combineYields([aave60(), kamino40()]);

    // The unweighted mean of the two rates is 4.15 %, and it is **wrong** in a
    // way a person would not see: 60 % of the money earns the first rate, not
    // half of it. This is the assertion that fails first if the formula is ever
    // "improved" into `mean(rates)`.
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).not.toBe('4.1500');
    expect(percentLabelOfRatio(combined.rate as ExactRatio, 2)).toBe('4.14');
  });

  it('moves the answer with the balance, which is what an average cannot do', () => {
    // The same two rates, with $400 behind the first and $40 behind the second.
    const lopsided = combineYields([
      { ...aave60(), balance: usd(400_000_000n) },
      kamino40(),
    ]);

    // (400 x 4.1200 % + 40 x 4.1800 %) / 440 = 4.125454… %: the answer is
    // pulled most of the way to whichever rate holds the most money.
    expect(percentLabelOfRatio(lopsided.rate as ExactRatio)).toBe('4.1255');
    // The plain average of the two rates is still 4.15 % — unchanged, and useless.
    expect(percentLabelOfRatio(lopsided.rate as ExactRatio)).not.toBe('4.1500');
  });

  it('a single venue is its own combined figure', () => {
    const only = combineYields([aave60()]);

    expect(only.complete).toBe(true);
    // Exactly 4.12 %, with nothing invented on either side of it.
    expect(percentLabelOfRatio(only.rate as ExactRatio)).toBe('4.1200');
  });
});

describe('the combination is exact, and the scale of each rate is read, never assumed', () => {
  it('carries the numerator and the denominator whole', () => {
    const combined = combineYields([aave60(), kamino40()]);

    /*
     * By hand, at the widest scale of each kind (balances at 6, rates at 6 after
     * the 4.18 % fraction is scaled **up** to six digits):
     *
     *   numerator   = 60_000_000 x 41_200 + 40_000_000 x 41_800
     *               = 2_472_000_000_000 + 1_672_000_000_000
     *   denominator = (60_000_000 + 40_000_000) x 10^6
     */
    expect(combined.rate).toEqual({
      numerator: '4144000000000',
      denominator: '100000000000000',
    });
  });

  it('adds rates published at different scales only after rescaling them up', () => {
    /*
     * The same second rate written with eighteen digits instead of four. The
     * answer is identical — and it could not have been computed at all by adding
     * `41200` to `4180000000000000000`, which is the mistake this repository has
     * already made twice.
     */
    const fine = combineYields([
      aave60(),
      { ...kamino40(), rate: rateFromFractionText('0.041800000000000000') as never },
    ]);

    const coarse = combineYields([aave60(), kamino40()]);

    // The same figure to every decimal place a screen will paint...
    expect(percentLabelOfRatio(fine.rate as ExactRatio, 4)).toBe(
      percentLabelOfRatio(coarse.rate as ExactRatio, 4),
    );
    // ...carried at the **wider** of the two scales, so no digit was lost to fit
    // the narrower one: the combined rate scale is now 24, not 6.
    expect(fine.rate).not.toEqual(coarse.rate);
    expect((BigInt(fine.rate!.numerator) * 10n ** 4n) / BigInt(fine.rate!.denominator)).toBe(
      (BigInt(coarse.rate!.numerator) * 10n ** 4n) / BigInt(coarse.rate!.denominator),
    );
  });

  it('does not lose digits when the division does not terminate', () => {
    // 1 share of a balance against 3: the third never ends.
    const thirds = combineYields([
      { ...aave60(), balance: usd(1n), rate: must(rateFromPercentText('1.0000', 4)) },
      { ...kamino40(), balance: usd(2n), rate: must(rateFromPercentText('2.0000', 4)) },
    ]);

    // (1 + 4) / 3 % = 1.6666…% : a truncated implementation would report 1.6666
    // and a `Number` would report a figure nobody could reproduce.
    const ratio = thirds.rate as ExactRatio;
    expect(ratio.numerator).toBe('50000');
    expect(ratio.denominator).toBe('3000000');
    expect(percentLabelOfRatio(ratio, 4)).toBe('1.6667');
    // The exact figure is recoverable from the two halves, at any precision.
    expect((BigInt(ratio.numerator) * 100n * 10n ** 4n) / BigInt(ratio.denominator)).toBe(16666n);
  });

  it('reads a percentage as a fraction by adding two places, never by dividing', () => {
    const rate = rateFromPercentText('4.1196', 4);

    expect(rate).toEqual({ raw: 41196n, decimals: 6, text: '0.041196' });
    // The same integer, two more fractional places. Nothing was divided.
    expect(rateFromFractionText('0.041196')).toEqual({ raw: 41196n, decimals: 6, text: '0.041196' });
  });

  it('refuses a rate it cannot read exactly, rather than rounding one', () => {
    // An exponent, a sign, or a string that is not a decimal at all.
    expect(rateFromFractionText('4.18e-2')).toBeNull();
    expect(rateFromFractionText('-0.0418')).toBeNull();
    expect(rateFromFractionText('abc')).toBeNull();
  });
});

describe('one unreadable venue means there is no combined number', () => {
  it('publishes no rate at all when a rate could not be read, and says so', () => {
    const combined = combineYields([
      aave60(),
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'unreadable',
        reason: 'APY_NON_POSITIVE',
        balance: null,
        rate: null,
      },
    ]);

    /*
     * **No number.** A weighted mean over the venue that happened to answer would
     * be 4.1200 % — a confident figure computed from a missing term, and it would
     * look entirely ordinary on the screen.
     */
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();

    // The breakdown is still there, so the screen can say *which* venue is
    // missing rather than just that something is.
    expect(combined.venues).toHaveLength(2);
    expect(combined.venues[1]).toEqual({
      key: 'invest.kamino_earn_usdc_solana',
      label: 'Kamino Earn · USDC en Solana',
      status: 'unreadable',
      reason: 'APY_NON_POSITIVE',
      balance: null,
      rate: null,
    });
    // The venue that did answer is still described exactly.
    expect(combined.venues[0]).toMatchObject({ status: 'ok', exclusion: null });
  });

  it('publishes no rate when a venue balance could not be read either', () => {
    const combined = combineYields([
      aave60(),
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'unreadable',
        reason: 'RPC_UNAVAILABLE',
        balance: null,
        rate: null,
      },
    ]);

    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();
  });

  it('inherits a refusal it did not produce: Aave refusing its own rate', () => {
    const combined = combineYields([
      {
        key: 'invest.aave_v3_usdc_monad',
        label: 'Aave V3 · USDC en Monad',
        status: 'unreadable',
        reason: 'APR_NOT_RECONCILED',
        balance: null,
        rate: null,
      },
      kamino40(),
    ]);

    // The reconciliation is Aave's discipline and it is not relaxed here: a rate
    // that cannot be reproduced from the rest of the reserve is not published,
    // in this combination or in any other.
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();
    expect(combined.venues[0]).toMatchObject({ status: 'unreadable', reason: 'APR_NOT_RECONCILED' });
  });
});

describe('a venue holding exactly zero is excluded — a different fact from unreadable', () => {
  it('drops a zero venue from the weighting and says that is why', () => {
    const combined = combineYields([
      aave60(),
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'ok',
        exclusion: 'zero_balance',
        balance: usd(0n),
        // Its rate could not be read, and that does not matter: a venue holding
        // nothing cannot move a weighted mean, so the figure is still complete.
        rate: null,
      } satisfies YieldVenue,
    ]);

    expect(combined.complete).toBe(true);
    // Exactly Aave's rate: 4.12 %, uncontaminated by a venue with no balance.
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).toBe('4.1200');

    // And the exclusion is **stated**, so nobody can mistake it for a hole.
    expect(combined.venues[1]).toMatchObject({ status: 'ok', exclusion: 'zero_balance', rate: null });
  });

  it('is a real zero when every venue holds zero, and it is still complete', () => {
    const combined = combineYields([
      {
        key: 'invest.aave_v3_usdc_monad',
        label: 'Aave V3 · USDC en Monad',
        status: 'ok',
        exclusion: 'zero_balance',
        balance: usd(0n),
        rate: must(rateFromPercentText('4.1200', 4)),
      },
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'ok',
        exclusion: 'zero_balance',
        balance: usd(0n),
        rate: must(rateFromFractionText('0.0418')),
      },
    ]);

    // Nothing failed: a person with nothing deposited earns nothing, and that is
    // a complete answer. `0/0` is not a ratio, so the zero is carried as `0/1`.
    expect(combined.complete).toBe(true);
    expect(combined.rate).toEqual({ numerator: '0', denominator: '1' });
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).toBe('0.0000');
  });

  it('is not the same as an unreadable venue, which produces no number at all', () => {
    const zero = combineYields([
      aave60(),
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'ok',
        exclusion: 'zero_balance',
        balance: usd(0n),
        rate: null,
      },
    ]);
    const unreadable = combineYields([
      aave60(),
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'unreadable',
        reason: 'KAMINO_UNAVAILABLE',
        balance: null,
        rate: null,
      },
    ]);

    expect(zero.complete).toBe(true);
    expect(zero.rate).not.toBeNull();
    expect(unreadable.complete).toBe(false);
    expect(unreadable.rate).toBeNull();
  });
});

describe('rounding happens once, at paint', () => {
  it('rounds half-up to the precision the caller asks for, and only there', () => {
    const thirds: ExactRatio = { numerator: '1', denominator: '3' }; // 33.3333… %

    expect(percentLabelOfRatio(thirds, 0)).toBe('33');
    expect(percentLabelOfRatio(thirds, 1)).toBe('33.3');
    expect(percentLabelOfRatio(thirds, 4)).toBe('33.3333');
    expect(percentLabelOfRatio(thirds, 6)).toBe('33.333333');

    // Half-up, not half-even: 0.05 % at one place is `0.1`.
    expect(percentLabelOfRatio({ numerator: '1', denominator: '2000' }, 1)).toBe('0.1');
  });

  it('refuses to paint a figure with no denominator', () => {
    expect(() => percentLabelOfRatio({ numerator: '1', denominator: '0' })).toThrow(RangeError);
  });
});
