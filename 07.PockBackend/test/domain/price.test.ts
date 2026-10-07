/**
 * The price rules: the selectors, the scales, and the three circuit breakers.
 *
 * ── What this file is for ─────────────────────────────────────────────────────
 *
 * Two things are proven here that no amount of reading would catch:
 *
 *  - **The selectors are the right ones.** `viem` is a devDependency — a Worker
 *    cannot ship it — so it is used exactly here, to re-derive both constants
 *    from their signatures. This repository already paid for a remembered
 *    selector once (`getReserveData` V2 `0x026b1d5f` against a V3 pool, which
 *    reverts), so the selectors are derived, not trusted.
 *  - **The 8-vs-18 landmine is closed.** `MON_USD` answers at 8 decimals and
 *    `MON_USD_SVR` at 18, from the *same pair*. Reading one with the other's
 *    scale is a 10^10 error, and the cross-check is exactly where that error
 *    would hide if the comparison were written on raw integers instead of on
 *    rescaled ones. Both cases are asserted here.
 *  - **The divergence bound is drawn where the measurements put it.** The bound
 *    used to be 5 bps, sized from a single pair (`MON`, the only cross-checkable
 *    one at the time) that happened to agree to the digit. `ETH`'s two healthy
 *    channels diverge by **5.403 bps** at one block, so that bound refused
 *    correct prices. The bound, the evidence and the registry asymmetry
 *    (`ETH`/`BTC` cross-checked, `SOL` not) are all asserted here.
 */
import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';

import {
  CHAINLINK_FEEDS_ON_MONAD,
  DECIMALS_SELECTOR,
  LATEST_ROUND_DATA_SELECTOR,
} from '../../src/domain/price/chainlinkMonad';
import {
  BPS_DENOMINATOR,
  channelsDisagree,
  formatUnits,
  isNonPositive,
  isStale,
  MAX_CHANNEL_DIVERGENCE_BPS,
  MAX_PRICE_AGE_SECONDS,
} from '../../src/domain/price/priceRules';

const selectorOf = (signature: string): string => keccak256(toBytes(signature)).slice(0, 10);

describe('the two selectors are derived, not remembered', () => {
  it('latestRoundData() is 0xfeaf968c', () => {
    expect(selectorOf('latestRoundData()')).toBe(LATEST_ROUND_DATA_SELECTOR);
  });

  it('decimals() is 0x313ce567', () => {
    expect(selectorOf('decimals()')).toBe(DECIMALS_SELECTOR);
  });
});

describe('the registry states a scale nowhere', () => {
  it('carries proxy addresses only, and MON has two channels', () => {
    for (const [asset, feeds] of Object.entries(CHAINLINK_FEEDS_ON_MONAD)) {
      expect(feeds.length, `${asset} has no feed`).toBeGreaterThan(0);
      for (const feed of feeds) {
        expect(feed.proxy).toMatch(/^0x[0-9a-fA-F]{40}$/);
        // No `decimals` field exists on a feed at all: the scale is a property of
        // the contract, read through the proxy, and writing it down here is the
        // 10^10 mistake waiting for a feed nobody re-checked.
        expect(Object.keys(feed)).not.toContain('decimals');
      }
    }
    expect(CHAINLINK_FEEDS_ON_MONAD.MON.map((feed) => feed.pair)).toEqual(['MON_USD', 'MON_USD_SVR']);
    expect(CHAINLINK_FEEDS_ON_MONAD.ETH.map((feed) => feed.pair)).toEqual(['ETH_USD', 'ETH_USD_SVR']);
    expect(CHAINLINK_FEEDS_ON_MONAD.BTC.map((feed) => feed.pair)).toEqual(['BTC_USD', 'BTC_USD_SVR']);
  });

  it('cross-checks ETH and BTC, and does not pretend to cross-check SOL', () => {
    /*
     * The asymmetry is pinned by a test, not by a comment.
     *
     * `SOL_USD` has ONE channel because the Monad registry declares no SVR feed
     * for it — there is nothing to cross-check it against. `ETH_USD` and
     * `BTC_USD` each have a second SVR channel at 18 decimals, added from that
     * same registry. If a future registry change adds or drops one of these, the
     * correct outcome is that THIS test fails and somebody re-reads the registry;
     * silently drifting in either direction is what it exists to prevent.
     */
    const channelCount = (asset: 'MON' | 'ETH' | 'SOL' | 'BTC'): number =>
      CHAINLINK_FEEDS_ON_MONAD[asset].length;

    expect(channelCount('ETH')).toBe(2);
    expect(channelCount('BTC')).toBe(2);
    // Deliberate, documented, and not an oversight: the registry publishes no
    // SVR feed for SOL, so its price travels with `crossChecked: false`.
    expect(channelCount('SOL')).toBe(1);
  });
});

describe('the 8-vs-18 landmine', () => {
  /*
   * The same block, the same pair, each channel at ITS OWN decimals.
   *
   * These are the two answers a live probe on Monad mainnet got from
   * `MON_USD_Proxy` and `MON_USD_SVR_Proxy` **pinned to one block**:
   * $0.02864200 from both. The 0.76%-apart pair below is the same pair read
   * seconds apart, which is what the adapter used to do.
   */
  const primary = { pair: 'MON_USD', answer: 2864200n, decimals: 8, updatedAt: 1_700_000_000 };
  const svr = { pair: 'MON_USD_SVR', answer: 28642000000000000n, decimals: 18, updatedAt: 1_700_000_000 };

  it('renders an 8-decimal feed as dollars', () => {
    expect(formatUnits(primary.answer, primary.decimals)).toBe('0.028642');
  });

  it('renders the very same price at 18 decimals as dollars', () => {
    expect(formatUnits(svr.answer, svr.decimals)).toBe('0.028642');
  });

  it('compares the two channels after rescaling, not as raw integers', () => {
    // One instant of the world: identical to the last digit each feed reports.
    expect(channelsDisagree(primary, svr)).toBe(false);
  });

  it('still calls a real disagreement a disagreement at 18 decimals', () => {
    const wrongSvr = { ...svr, answer: svr.answer * 2n };
    expect(channelsDisagree(primary, wrongSvr)).toBe(true);
  });

  it('treats the decimals landmine itself as a disagreement', () => {
    // Exactly the bug: the SVR round read at 8 decimals instead of 18.
    expect(channelsDisagree(primary, { ...svr, decimals: 8 })).toBe(true);
  });

  it('no longer reads the 0.76% drift pair as damage, because it is not damage', () => {
    /*
     * REVIEWED, NOT SILENTLY LOOSENED — read this before changing the number.
     *
     * The transcript the previous task was handed: the same two channels read
     * seconds apart, at `'latest'`, once per channel. $0.0286247 against
     * $0.028842 is **75.4 bps** — the price moving between two reads. Under the
     * old 5 bps bound this pair was asserted to be a refusal, and it only passed
     * because the bound was tight. That was the wrong kind of evidence: it made
     * a *healthy* dispersion look like the artefact it was standing in for.
     *
     * Under the 100 bps bound it is inside the line, which is the honest
     * verdict — pinning the block is what stops the adapter from ever producing
     * this pair, and the bound is not a second, weaker copy of that guarantee.
     * What still has to be caught is a channel serving a materially older round;
     * that is the test immediately below.
     */
    const driftedPrimary = { ...primary, answer: 2862470n };
    const driftedSvr = { ...svr, answer: 28842000000000000n };

    expect(formatUnits(driftedPrimary.answer, driftedPrimary.decimals)).toBe('0.0286247');
    expect(formatUnits(driftedSvr.answer, driftedSvr.decimals)).toBe('0.028842');
    expect(channelsDisagree(driftedPrimary, driftedSvr)).toBe(false);

    // And a channel a full 5% behind is not dispersion — that is a stale feed.
    const staleChannel = { ...svr, answer: 27_292_900_000_000_000n }; // $0.0272929
    expect(channelsDisagree(primary, staleChannel)).toBe(true);
  });

  it('accepts the ETH-sized divergence two healthy ETH channels actually show', () => {
    /*
     * THE MEASUREMENT THE BOUND COMES FROM.
     *
     * Read live at one pinned block (111127200), Monad's two ETH/USD channels
     * answered these two numbers. Both were fresh, both were well-formed, and
     * they are **5.403 bps** apart. Under the 5 bps bound this was a refusal and
     * ETH's price went `complete: false` on two working oracles. Under 100 bps
     * it is what two independent healthy feeds are.
     */
    const ethPrimary = { pair: 'ETH_USD', answer: 269_198_559_400n, decimals: 8, updatedAt: 1_700_000_000 };
    const ethSvr = {
      pair: 'ETH_USD_SVR',
      answer: 2_690_531_100_000_000_000_000n,
      decimals: 18,
      updatedAt: 1_700_000_000,
    };

    expect(formatUnits(ethPrimary.answer, ethPrimary.decimals)).toBe('2691.985594');
    expect(formatUnits(ethSvr.answer, ethSvr.decimals)).toBe('2690.5311');
    expect(channelsDisagree(ethPrimary, ethSvr)).toBe(false);

    // The BTC pair, at the same block, for the same reason.
    const btcPrimary = { pair: 'BTC_USD', answer: 8_562_390_862_100n, decimals: 8, updatedAt: 1_700_000_000 };
    const btcSvr = { pair: 'BTC_USD_SVR', answer: 856_227_425_400_000_000_000_00n, decimals: 18, updatedAt: 1_700_000_000 };
    expect(channelsDisagree(btcPrimary, btcSvr)).toBe(false);
  });

  it('still refuses a catastrophic divergence, which is what the bound is for', () => {
    const ethPrimary = { pair: 'ETH_USD', answer: 269_198_559_400n, decimals: 8, updatedAt: 1_700_000_000 };
    // 4% below the primary: a healthy feed pair never looks like this.
    const badlyOff = { pair: 'ETH_USD_SVR', answer: 2_584_305_500_000_000_000_000n, decimals: 18, updatedAt: 1_700_000_000 };
    expect(channelsDisagree(ethPrimary, badlyOff)).toBe(true);
  });
});

describe('the declared bounds, and what they do', () => {
  it('declares one hour of freshness', () => {
    expect(MAX_PRICE_AGE_SECONDS).toBe(3600);
  });

  it('refuses a round older than an hour and accepts one inside it', () => {
    const now = 1_700_000_000;
    expect(isStale(now - 3600, now)).toBe(false);
    expect(isStale(now - 3601, now)).toBe(true);
    // The measured heartbeat of Monad's non-peg feeds was under two minutes.
    expect(isStale(now - 26, now)).toBe(false);
    expect(isStale(now - 78, now)).toBe(false);
  });

  it('refuses a round that never reported a timestamp', () => {
    expect(isStale(0, 1_700_000_000)).toBe(true);
    expect(isStale(-1, 1_700_000_000)).toBe(true);
  });

  it('declares 100 bps — 1% — of divergence', () => {
    expect(MAX_CHANNEL_DIVERGENCE_BPS).toBe(100n);
    expect(BPS_DENOMINATOR).toBe(10_000n);
  });

  it('draws the divergence line exactly at the new bound', () => {
    const base = { pair: 'a', decimals: 8, updatedAt: 1 };
    // Exactly 1%: accepted. One unit more in the last place: refused.
    expect(channelsDisagree({ ...base, answer: 100_000n }, { ...base, answer: 99_000n })).toBe(false);
    expect(channelsDisagree({ ...base, answer: 100_000n }, { ...base, answer: 98_999n })).toBe(true);
  });

  it('accepts an ETH-sized 5.403 bps divergence and refuses a catastrophic one', () => {
    const primary = { pair: 'ETH_USD', answer: 269_198_559_400n, decimals: 8, updatedAt: 1 };
    const atEighteen = (usd: bigint) => ({ pair: 'ETH_USD_SVR', answer: usd * 10n ** 10n, decimals: 18, updatedAt: 1 });

    // 5.403 bps: what Monad's two healthy ETH channels really answered. Accepted.
    expect(channelsDisagree(primary, atEighteen(269_053_110_000n))).toBe(false);
    // 4%: a stale or corrupted channel. Still refused, by two orders of magnitude
    // more than the ETH case needed.
    expect(channelsDisagree(primary, atEighteen(258_430_550_000n))).toBe(true);
  });

  it('accepts the quantisation floor of an 8-decimal channel on a $0.03 asset', () => {
    // One unit in the last place of an 8-decimal answer for MON is $1e-8 on a
    // ~$0.028 asset: 0.0035 bps. The bound has to sit well above it, and does —
    // 100 bps is ~29,000× the floor, so two channels reporting the *same*
    // number cannot be refused for rounding differently.
    const floor = { pair: 'MON_USD', decimals: 8, updatedAt: 1 };
    const oneUnitApart = { pair: 'MON_USD_SVR', decimals: 18, updatedAt: 1 };
    expect(channelsDisagree({ ...floor, answer: 2_864_200n }, { ...oneUnitApart, answer: 28_642_000_000_000_001n })).toBe(
      false,
    );
  });

  it('refuses an answer of zero or less, and only those', () => {
    expect(isNonPositive(0n)).toBe(true);
    expect(isNonPositive(-1n)).toBe(true);
    expect(isNonPositive(1n)).toBe(false);
  });

  it('does not let a zero pair sneak past the comparison as agreement', () => {
    const zero = { pair: 'a', answer: 0n, decimals: 8, updatedAt: 1 };
    expect(channelsDisagree(zero, { ...zero, pair: 'b' })).toBe(true);
  });
});

describe('the exact decimal string', () => {
  it('keeps every digit the feed reported', () => {
    expect(formatUnits(8556510000000n, 8)).toBe('85565.1');
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001');
    expect(formatUnits(268939000000n, 8)).toBe('2689.39');
  });
});
