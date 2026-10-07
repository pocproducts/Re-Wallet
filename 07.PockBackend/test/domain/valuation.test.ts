/**
 * The exact arithmetic of a dollar value, on its own: **no network, no feed, no
 * database.**
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *  - **A pegged dollar is 1 and costs nothing.** No oracle is even a parameter
 *    of that function.
 *  - **A value is the exact product of an amount and a price, at the sum of their
 *    decimals** — 8-decimal feeds and 18-decimal feeds both, and never rounded.
 *  - **A sum never rounds.** The pieces of a bucket do not share a scale, so the
 *    sum is taken at the widest of them and scaling is **upwards only** —
 *    because scaling down is a division, and a division here is a rounding.
 */
import { describe, expect, it } from 'vitest';

import { isDigitalDollar } from '../../src/domain/price/digitalDollar';
import {
  exactIntegerOf,
  PEG_PRICE,
  peggedValueOf,
  pricedAssetOf,
  sumExact,
  usdValueOf,
  USD_UNIT,
} from '../../src/domain/price/valuation';

describe('a digital dollar is exactly 1, and nothing else', () => {
  it('knows which symbols are pegged', () => {
    expect(isDigitalDollar('USDC')).toBe(true);
    /*
     * USDT is pegged to the dollar by the same definition, on every chain, and
     * today no catalog row declares it — so nothing is read and no feed is
     * asked. The entry exists so that the row, when it is added with its verified
     * mint, is already a dollar and not a symbol routed to an oracle it does not
     * need.
     */
    expect(isDigitalDollar('USDT')).toBe(true);
    // Everything the price port knows about is explicitly **not** pegged.
    expect(isDigitalDollar('MON')).toBe(false);
    expect(isDigitalDollar('ETH')).toBe(false);
    expect(isDigitalDollar('SOL')).toBe(false);
    expect(isDigitalDollar('BTC')).toBe(false);
  });

  it('states a price of 1 with no pair and no timestamp, so no oracle is claimed', () => {
    expect(PEG_PRICE).toEqual({
      usd: '1',
      raw: '1',
      decimals: 0,
      source: 'peg',
      pair: null,
      updatedAt: null,
      crossChecked: null,
    });
  });

  it('values a pegged balance by multiplication, not by a lookup', () => {
    // 1.5 USDC at six decimals is worth 1.5 dollars, at six decimals.
    expect(sumExact([peggedValueOf(1_500_000n, 6)])).toEqual({
      raw: '1500000',
      amount: '1.5',
      decimals: 6,
      unit: USD_UNIT,
    });
  });

  it('keeps a real zero a real zero', () => {
    expect(sumExact([peggedValueOf(0n, 6)])).toEqual({ raw: '0', amount: '0', decimals: 6, unit: USD_UNIT });
  });
});

describe('a non-peg value is the exact product of an amount and a price', () => {
  it('prices an 8-decimal feed exactly, at 18 + 8 decimals', () => {
    // 3 MON at $0.028642 (8 decimals). 3 x 2864200 = 8592600, at 26 decimals.
    const value = usdValueOf(3_000_000_000_000_000_000n, 18, 2_864_200n, 8);

    expect(value.decimals).toBe(26);
    expect(value.raw.toString()).toBe('8592600000000000000000000');
    // 0.085926, and not 0.09: nothing here rounded.
    expect(sumExact([value]).amount).toBe('0.085926');
  });

  it('prices an 18-decimal feed exactly, at 18 + 18 decimals', () => {
    // The same $0.028642, answered by the SVR channel at 18 decimals instead.
    const value = usdValueOf(3_000_000_000_000_000_000n, 18, 28_642_000_000_000_000n, 18);

    expect(value.decimals).toBe(36);
    expect(value.raw.toString()).toBe('85926000000000000000000000000000000');
    // Identical dollar value, from a feed that speaks a different scale.
    expect(sumExact([value]).amount).toBe('0.085926');
  });

  it('is exact past the 17th digit a double would have lost', () => {
    const value = usdValueOf(123_456_789_123_456_789n, 18, 8_556_510_000_000n, 8);
    expect(sumExact([value]).amount).toBe('10563.5925070274924964639');
    // The same figure through a double, for comparison: the tail is gone, and
    // the leading digits are wrong before that even happens.
    expect(String((Number(123_456_789_123_456_789n) * 8_556_510_000_000) / 1e18)).toBe('1056359250702.7493');
  });

  it('refuses a negative amount or a negative price rather than publishing it', () => {
    expect(() => usdValueOf(-1n, 18, 1n, 8)).toThrow(RangeError);
    expect(() => usdValueOf(1n, 18, -1n, 8)).toThrow(RangeError);
  });

  it('maps a chain symbol to a priced asset, or to null — never to a guess', () => {
    expect(pricedAssetOf('MON')).toBe('MON');
    expect(pricedAssetOf('ETH')).toBe('ETH');
    expect(pricedAssetOf('SOL')).toBe('SOL');
    // USDC is a digital dollar, not a priced asset: it never reaches a feed.
    expect(pricedAssetOf('USDC')).toBeNull();
    expect(pricedAssetOf('DOGE')).toBeNull();
  });
});

describe('a sum takes the widest scale and loses nothing', () => {
  it('scales up, never down, so the sum is exact', () => {
    // USDC at 6 decimals and MON at 26. The answer lives at 26.
    const total = sumExact([
      peggedValueOf(1_500_000n, 6),
      usdValueOf(3_000_000_000_000_000_000n, 18, 2_864_200n, 8),
    ]);

    expect(total.decimals).toBe(26);
    // 1.5 + 0.085926, at 26 decimals, exactly.
    expect(total.amount).toBe('1.585926');
    expect(total.raw).toBe('158592600000000000000000000');
  });

  it('is commutative and exact in both directions', () => {
    const dollars = peggedValueOf(1_500_000n, 6);
    const mon = usdValueOf(3_000_000_000_000_000_000n, 18, 2_864_200n, 8);

    expect(sumExact([dollars, mon]).raw).toBe(sumExact([mon, dollars]).raw);
    expect(sumExact([dollars, mon]).amount).toBe('1.585926');
  });

  it('the sum of nothing is a real zero, not a missing answer', () => {
    expect(sumExact([])).toEqual({ raw: '0', amount: '0', decimals: 0, unit: USD_UNIT });
  });

  it('re-reads a chain raw field as an integer, or refuses it', () => {
    expect(exactIntegerOf('1500000')).toBe(1_500_000n);
    expect(exactIntegerOf('0')).toBe(0n);
    expect(exactIntegerOf('1.5')).toBeNull();
    expect(exactIntegerOf('')).toBeNull();
    expect(exactIntegerOf('NaN')).toBeNull();
    expect(exactIntegerOf('-1')).toBeNull();
  });
});
