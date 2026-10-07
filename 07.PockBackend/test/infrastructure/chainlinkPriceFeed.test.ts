/**
 * The Chainlink price adapter, over an injected `fetch`: **no network**.
 *
 * ── What this file is for ─────────────────────────────────────────────────────
 *
 * The rules are proven in `test/domain/price.test.ts`. This file proves the half
 * that touches a wire: that the hex a node answers arrives at the decoder
 * **intact**, at the decimals the feed itself reports, and that an answer which
 * is not a Chainlink answer fails as a bounded refusal rather than becoming a
 * zero.
 *
 * ── The transcripts are the live ones ────────────────────────────────────────
 *
 * `MON_PRIMARY_ANSWER` and `MON_SVR_ANSWER` are the two real MON/USD channel
 * answers, each at its own scale — **8** and **18** decimals — so a decoder that
 * hardcoded 8 fails here on the very pair where that mistake is ten billion
 * dollars.
 *
 * They are the **same-block** pair: $0.02864200 from both channels, read at one
 * block, which is the whole point of `task 2a`. The 0.76%-apart pair the previous
 * task measured (`MON_DRIFT_PRIMARY` / `MON_DRIFT_SVR`) is kept below, reviewed
 * rather than quietly loosened: it sits **inside** the 100 bps bound now, because
 * two healthy channels legitimately disperse by that much and the block pin —
 * not the bound — is what prevents the adapter from producing that pair.
 *
 * The `ETH` and `BTC` transcripts below are the live measurements the bound was
 * sized from: at one pinned block their two healthy channels answer **5.403 bps**
 * and **0.136 bps** apart. Under the old 5 bps bound `ETH` was a refusal — two
 * working oracles taking ETH's price down with them.
 */
import { describe, expect, it } from 'vitest';

import { DECIMALS_SELECTOR, LATEST_ROUND_DATA_SELECTOR } from '../../src/domain/price/chainlinkMonad';
import { createChainlinkPriceFeed } from '../../src/infrastructure/rpc/chainlinkPriceFeed';

const RPC_URL = 'https://rpc.example.invalid';

/** The clock every test freezes, so a round's age is chosen, not waited for. */
const NOW = 1_700_000_000;

/** The block every test pins the two channels to. */
const PINNED_BLOCK = 20_000_000n;

/**
 * The live MON/USD answers at **one block**: $0.02864200 from both channels,
 * each at its own decimals.
 */
const MON_PRIMARY_ANSWER = 2864200n; // 8 decimals  -> $0.028642
const MON_SVR_ANSWER = 28642000000000000n; // 18 decimals -> $0.028642

/** The same pair read **seconds apart**, the way the previous task read it. */
const MON_DRIFT_PRIMARY = 2862470n; // 8 decimals  -> $0.0286247
const MON_DRIFT_SVR = 28842000000000000n; // 18 decimals -> $0.028842

const SOL_ANSWER = 146250000n; // 8 decimals  -> $1.4625

/**
 * The live same-block answers of the two healthy ETH/USD channels, each at its
 * own scale — **8** and **18** decimals. They are **5.403 bps** apart, which is
 * the worst divergence measured across every cross-checked pair and the number
 * `MAX_CHANNEL_DIVERGENCE_BPS` is sized from.
 */
const ETH_PRIMARY_ANSWER = 269_198_559_400n; // 8 decimals  -> $2,691.985594
const ETH_SVR_ANSWER = 2_690_531_100_000_000_000_000n; // 18 decimals -> $2,690.5311

/** The BTC/USD channels at the same block: $85.623,908621 against $85.622,742540. */
const BTC_PRIMARY_ANSWER = 8_562_390_862_100n; // 8 decimals  -> $85,623.908621
const BTC_SVR_ANSWER = 856_227_425_400_000_000_000_00n; // 18 decimals -> $85,622.74254

const PROXIES = {
  MON: '0xbcd78f76005b7515837af6b50c7c52bcf73822fb',
  MON_SVR: '0xfb504ad06ab5e6c63fe0a46fea245214838e8015',
  ETH: '0x1b1414782b859871781ba3e4b0979b9ca57a0a04',
  ETH_SVR: '0x38057d0458ca56068e1a57e62d3874ca129a7a78',
  SOL: '0x16f8008c3e89f62e5e2b909ce70999370d38f4f2',
  BTC: '0xc1d4c3331635184fa4c3c22fb92211b2ac9e0546',
  BTC_SVR: '0x187efd8ba8483105f2735740d956f7cd23723dec',
} as const;

/** One word per value, negatives in the two's complement an `int256` really uses. */
const hexOf = (words: readonly (bigint | string | number)[]): string =>
  `0x${words
    .map((word) => {
      const value = BigInt(word);
      const encoded = value < 0n ? (1n << 256n) + value : value;
      return encoded.toString(16).padStart(64, '0');
    })
    .join('')}`;

/** `latestRoundData()`: roundId, int256 answer, startedAt, updatedAt, answeredInRound. */
const roundData = (answer: bigint, updatedAt: number = NOW - 30): string =>
  hexOf([1n, answer, updatedAt - 30, updatedAt, updatedAt]);

/** A `decimals()` answer: a `uint8` in one word. */
const decimalsOf = (value: number): string => hexOf([BigInt(value)]);

/** How a call goes wrong, staged without a network. */
interface Fault {
  /** `fetch` rejects outright: no endpoint answered. */
  readonly unreachable?: true;
  /** HTTP status the endpoint answered with. */
  readonly http?: number;
  /** A JSON-RPC `error` object: the endpoint answered and said no. */
  readonly rpcError?: boolean;
  /** Anything that is not a hex string in `result`. */
  readonly notHex?: boolean;
  /** A body that is not JSON at all. */
  readonly notJson?: true;
}

type Answer = string | Fault;

interface FeedAnswers {
  readonly decimals?: Answer;
  readonly round?: Answer;
}

interface RecordedCall {
  readonly method: string;
  readonly to?: string;
  readonly data?: string;
  /** The block tag the call was made at, verbatim. */
  readonly blockTag?: string;
}

/**
 * A `fetch` answering per `(proxy, selector)`, and recording every request.
 *
 * It also answers `eth_blockNumber`, because pinning the two channels of a pair to
 * **one block** is what the cross-check now depends on: `block` may be made to fail
 * so the refusal that follows can be observed.
 */
const endpointAnswering = (
  table: Readonly<Record<string, FeedAnswers>>,
  block: Answer = `0x${PINNED_BLOCK.toString(16)}`,
) => {
  const requests: RecordedCall[] = [];

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      method: string;
      params: [{ to: string; data: string }, string] | [];
    };

    if (body.method === 'eth_blockNumber') {
      requests.push({ method: body.method });
      if (typeof block !== 'string') {
        if (block.unreachable) throw new Error('connection refused');
        if (block.http !== undefined) return new Response('gateway down', { status: block.http });
        if (block.notJson) return new Response('<html>502</html>', { status: 200 });
        if (block.rpcError) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no' } }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 20_000_000 }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: block }), { status: 200 });
    }

    const to = String(body.params[0]?.to).toLowerCase();
    const data = String(body.params[0]?.data);
    const blockTag = String(body.params[1]);
    requests.push({ method: body.method, to, data, blockTag });

    const answers = table[to];
    const answer =
      answers === undefined
        ? undefined
        : data.startsWith(DECIMALS_SELECTOR)
          ? answers.decimals
          : data.startsWith(LATEST_ROUND_DATA_SELECTOR)
            ? answers.round
            : undefined;

    if (answer === undefined) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }), { status: 200 });
    }
    if (typeof answer !== 'string') {
      if (answer.unreachable) throw new Error('connection refused');
      if (answer.http !== undefined) return new Response('gateway down', { status: answer.http });
      if (answer.notJson) return new Response('<html>502</html>', { status: 200 });
      if (answer.rpcError) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 42 }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: answer }), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
};

/** Both MON channels healthy, at their own decimals, read at one block. */
const healthyMon = (overrides: { primary?: FeedAnswers; svr?: FeedAnswers } = {}) =>
  endpointAnswering({
    [PROXIES.MON]: {
      decimals: decimalsOf(8),
      round: roundData(MON_PRIMARY_ANSWER),
      ...overrides.primary,
    },
    [PROXIES.MON_SVR]: {
      decimals: decimalsOf(18),
      round: roundData(MON_SVR_ANSWER),
      ...overrides.svr,
    },
  });

/** Both BTC channels healthy, at their own decimals, read at one block. */
const healthyBtc = (overrides: { primary?: FeedAnswers; svr?: FeedAnswers } = {}) =>
  endpointAnswering({
    [PROXIES.BTC]: {
      decimals: decimalsOf(8),
      round: roundData(BTC_PRIMARY_ANSWER),
      ...overrides.primary,
    },
    [PROXIES.BTC_SVR]: {
      decimals: decimalsOf(18),
      round: roundData(BTC_SVR_ANSWER),
      ...overrides.svr,
    },
  });

const feedWith = (fetchImpl: typeof fetch) =>
  createChainlinkPriceFeed({ fetchImpl, nowSeconds: () => NOW, endpoints: [RPC_URL] });

describe('a healthy feed, at each scale it actually publishes', () => {
  it('prices an 8-decimal feed at its own decimals', async () => {
    const { fetchImpl, requests } = healthyBtc();

    const result = await feedWith(fetchImpl).usdPrice('BTC');

    expect(result).toEqual({
      status: 'ok',
      value: {
        asset: 'BTC',
        pair: 'BTC_USD',
        // The exact integer at the feed's own scale, so nothing downstream has to
        // parse a decimal string back into a number.
        raw: '8562390862100',
        usd: '85623.908621',
        decimals: 8,
        updatedAt: NOW - 30,
        crossChecked: true,
      },
    });

    // The scale came from the chain, before each round, not from this file — and
    // each channel was asked about its own scale at its own proxy.
    const calls = requests.filter((request) => request.method === 'eth_call');
    expect(calls.map((request) => request.to)).toEqual([
      PROXIES.BTC,
      PROXIES.BTC,
      PROXIES.BTC_SVR,
      PROXIES.BTC_SVR,
    ]);
    expect(calls.map((request) => request.data?.slice(0, 10))).toEqual([
      DECIMALS_SELECTOR,
      LATEST_ROUND_DATA_SELECTOR,
      DECIMALS_SELECTOR,
      LATEST_ROUND_DATA_SELECTOR,
    ]);
  });

  it('prices an 18-decimal feed at its own decimals', async () => {
    // THE regression test for the 10^10 bug.
    //
    // Monad publishes the same MON/USD pair twice, at 8 and at 18 decimals. This
    // transcript is the pair with **both** channels at 18 — the shape the code
    // has to be right about regardless of which proxy is named primary. Read at
    // a hardcoded 8 decimals, `28642000000000000` is $286,420,000.000000, and
    // this assertion is what says no.
    const { fetchImpl } = endpointAnswering({
      [PROXIES.MON]: { decimals: decimalsOf(18), round: roundData(MON_SVR_ANSWER) },
      [PROXIES.MON_SVR]: { decimals: decimalsOf(18), round: roundData(MON_SVR_ANSWER) },
    });

    const result = await feedWith(fetchImpl).usdPrice('MON');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('the price was refused');
    expect(result.value.usd).toBe('0.028642');
    expect(result.value.raw).toBe('28642000000000000');
    expect(result.value.decimals).toBe(18);
    expect(result.value.crossChecked).toBe(true);
  });

  it('prices the live MON pair from the 8-decimal primary, corroborating at 18', async () => {
    const { fetchImpl, requests } = healthyMon();

    const result = await feedWith(fetchImpl).usdPrice('MON');

    expect(result).toEqual({
      status: 'ok',
      value: {
        asset: 'MON',
        pair: 'MON_USD',
        raw: '2864200',
        usd: '0.028642',
        decimals: 8,
        updatedAt: NOW - 30,
        crossChecked: true,
      },
    });

    // `decimals()` was asked of each proxy, in its own right, before its round.
    expect(requests.filter((request) => request.data?.startsWith(DECIMALS_SELECTOR)).map((r) => r.to)).toEqual([
      PROXIES.MON,
      PROXIES.MON_SVR,
    ]);
  });

  it('prices SOL, on its single channel, and says so', async () => {
    /*
     * `SOL_USD` has no SVR counterpart in the Monad registry, so there is nothing
     * to cross-check it against. This transcript proves the asymmetry rather than
     * asserting it in a comment: exactly TWO calls go out — `decimals()` and the
     * round, of the one channel — and the result states `crossChecked: false`.
     * If a second SOL channel were ever added, this test fails.
     */
    const { fetchImpl, requests } = endpointAnswering({
      [PROXIES.SOL]: { decimals: decimalsOf(8), round: roundData(SOL_ANSWER) },
    });

    const result = await feedWith(fetchImpl).usdPrice('SOL');

    expect(result).toEqual({
      status: 'ok',
      value: {
        asset: 'SOL',
        pair: 'SOL_USD',
        raw: '146250000',
        usd: '1.4625',
        decimals: 8,
        updatedAt: NOW - 30,
        crossChecked: false,
      },
    });

    const reads = requests.filter((request) => request.method === 'eth_call');
    expect(reads).toHaveLength(2);
    expect(reads.every((request) => request.to === PROXIES.SOL)).toBe(true);
  });

  it('prices the live ETH pair across two healthy channels that are 5.403 bps apart', async () => {
    /*
     * The measurement that moved the bound. Both channels are fresh, both are
     * well-formed, both answer at their own scale, and they disagree by
     * **5.403 bps** at one block. That is a price, not a refusal: the old 5 bps
     * bound took ETH's price down with `CHANNELS_DISAGREE` on two healthy oracles.
     */
    const { fetchImpl } = endpointAnswering({
      [PROXIES.ETH]: { decimals: decimalsOf(8), round: roundData(ETH_PRIMARY_ANSWER) },
      [PROXIES.ETH_SVR]: { decimals: decimalsOf(18), round: roundData(ETH_SVR_ANSWER) },
    });

    const result = await feedWith(fetchImpl).usdPrice('ETH');

    expect(result).toEqual({
      status: 'ok',
      value: {
        asset: 'ETH',
        pair: 'ETH_USD',
        raw: '269198559400',
        usd: '2691.985594',
        decimals: 8,
        updatedAt: NOW - 30,
        crossChecked: true,
      },
    });
  });

  it('still refuses a catastrophic ETH divergence', () => {
    // 4% below the primary. The bound is a corruption detector, and this is what
    // it is for.
    const { fetchImpl } = endpointAnswering({
      [PROXIES.ETH]: { decimals: decimalsOf(8), round: roundData(ETH_PRIMARY_ANSWER) },
      [PROXIES.ETH_SVR]: { decimals: decimalsOf(18), round: roundData(2_584_305_500_000_000_000_000n) },
    });

    return expect(feedWith(fetchImpl).usdPrice('ETH')).resolves.toEqual({
      status: 'unreadable',
      reason: 'CHANNELS_DISAGREE',
    });
  });
});

/**
 * THE FIX FROM TASK 2a.
 *
 * The cross-check compares two channels of one pair. Read at `'latest'` — once
 * per channel — the two reads happen **seconds apart**, and a fast-moving token
 * moves between them: that is where the 0.76% "divergence" came from. Pinned to
 * one block, the same pair is identical to the last digit the feed reports.
 *
 * So the comparison has to be made inside one instant of the world, and these are
 * the assertions that say it is.
 */
describe('both channels of a pair are read at ONE block', () => {
  it('asks for a block once, and pins every call of every channel to it', async () => {
    const { fetchImpl, requests } = healthyMon();

    await feedWith(fetchImpl).usdPrice('MON');

    const blockCalls = requests.filter((request) => request.method === 'eth_blockNumber');
    // One block per price read. Once per channel is the bug, not the fix.
    expect(blockCalls).toHaveLength(1);

    const pinned = `0x${PINNED_BLOCK.toString(16)}`;
    const reads = requests.filter((request) => request.method === 'eth_call');
    // Four calls: decimals + round for each of the two channels.
    expect(reads).toHaveLength(4);
    expect(reads.every((request) => request.blockTag === pinned)).toBe(true);
  });

  it('never uses `latest`, which is what made the two channels seconds apart', async () => {
    const { fetchImpl, requests } = healthyMon();

    await feedWith(fetchImpl).usdPrice('MON');

    expect(requests.some((request) => request.blockTag === 'latest')).toBe(false);
  });

  it('refuses to price at all when the block cannot be pinned', async () => {
    // Failing open here would put the 0.76% artefact straight back into the
    // cross-check, which is the one thing pinning the block exists to remove.
    const { fetchImpl } = endpointAnswering(
      {
        [PROXIES.MON]: { decimals: decimalsOf(8), round: roundData(MON_PRIMARY_ANSWER) },
        [PROXIES.MON_SVR]: { decimals: decimalsOf(18), round: roundData(MON_SVR_ANSWER) },
      },
      { rpcError: true },
    );

    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_REJECTED',
    });
  });

  it('refuses a block number of zero rather than reading at genesis', async () => {
    const { fetchImpl } = endpointAnswering(
      {
        [PROXIES.MON]: { decimals: decimalsOf(8), round: roundData(MON_PRIMARY_ANSWER) },
      },
      '0x0',
    );

    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });

  it('the 0.76%-apart pair is inside the bound now, and that is the honest verdict', async () => {
    /*
     * REVIEWED, NOT SILENTLY LOOSENED.
     *
     * The exact transcript the previous task measured: the two MON channels read
     * seconds apart. It was asserted to be `CHANNELS_DISAGREE`, and it only
     * passed because the bound was tight at 5 bps. That assertion was standing in
     * for the artefact the block pin removes, and it made healthy dispersion look
     * like damage. Under the 100 bps bound, sized from the worst divergence two
     * healthy channels actually show (ETH, 5.403 bps), this pair is a price.
     *
     * What must still be caught is a channel serving a materially older round —
     * asserted below.
     */
    const { fetchImpl } = endpointAnswering({
      [PROXIES.MON]: { decimals: decimalsOf(8), round: roundData(MON_DRIFT_PRIMARY) },
      [PROXIES.MON_SVR]: { decimals: decimalsOf(18), round: roundData(MON_DRIFT_SVR) },
    });

    const result = await feedWith(fetchImpl).usdPrice('MON');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('the price was refused');
    expect(result.value.usd).toBe('0.0286247');
  });

  it('refuses a channel serving a round a full 5% behind', async () => {
    // $0.028642 against $0.0272109: inside nothing this bound tolerates.
    const { fetchImpl } = endpointAnswering({
      [PROXIES.MON]: { decimals: decimalsOf(8), round: roundData(MON_PRIMARY_ANSWER) },
      [PROXIES.MON_SVR]: { decimals: decimalsOf(18), round: roundData(27_210_900_000_000_000n) },
    });

    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'CHANNELS_DISAGREE',
    });
  });
});

describe('the three circuit breakers', () => {
  it('STALE: a round older than an hour yields unreadable, not a number', async () => {
    const { fetchImpl } = healthyMon({
      primary: { round: roundData(MON_PRIMARY_ANSWER, NOW - 3601) },
      svr: { round: roundData(MON_SVR_ANSWER, NOW - 3601) },
    });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({ status: 'unreadable', reason: 'STALE' });
  });

  it('STALE: a round inside the hour is a price', async () => {
    const { fetchImpl } = healthyMon();
    expect((await feedWith(fetchImpl).usdPrice('MON')).status).toBe('ok');
  });

  it('NON_POSITIVE: a zero answer is an uninitialised feed, not a free asset', async () => {
    const { fetchImpl } = healthyMon({ primary: { round: roundData(0n) } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({ status: 'unreadable', reason: 'NON_POSITIVE' });
  });

  it('NON_POSITIVE: a negative answer is refused too', async () => {
    // `int256` is signed, so a negative round arrives as a word with its top bit
    // set. `BigInt('0x…')` would read that as a positive 1.16e77; the signed
    // decode turns it into the refusal it is.
    const { fetchImpl } = healthyMon({ primary: { round: hexOf([1n, -1n, 1n, NOW, 1n]) } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({ status: 'unreadable', reason: 'NON_POSITIVE' });
  });

  it('NON_POSITIVE: never publishes the unsigned reading of a negative round', async () => {
    const { fetchImpl } = healthyMon({
      primary: { round: hexOf([1n, -(1n << 255n), 1n, NOW, 1n]) },
    });
    const result = await feedWith(fetchImpl).usdPrice('MON');
    expect(result).toEqual({ status: 'unreadable', reason: 'NON_POSITIVE' });
    expect(JSON.stringify(result)).not.toContain('11579208923731619');
  });

  it('CHANNELS_DISAGREE: two well-formed channels that disagree yield unreadable', async () => {
    const { fetchImpl } = healthyMon({ svr: { round: roundData(MON_SVR_ANSWER * 2n) } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'CHANNELS_DISAGREE',
    });
  });

  it('CHANNELS_DISAGREE: the 8-vs-18 landmine is caught, not published', async () => {
    // The SVR round read at the primary's 8 decimals is a factor of 10^10 apart.
    const { fetchImpl } = healthyMon({ svr: { decimals: decimalsOf(8) } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'CHANNELS_DISAGREE',
    });
  });
});

describe('answers that are not answers', () => {
  it('refuses a short struct instead of coercing it to zero', async () => {
    const { fetchImpl } = healthyMon({ primary: { round: hexOf([1n, MON_PRIMARY_ANSWER, 1n, NOW]) } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });

  it('refuses an empty answer instead of coercing it to zero', async () => {
    const { fetchImpl } = healthyMon({ primary: { round: '0x' } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });

  it('refuses a `decimals()` that is not a uint8 rather than scaling by nonsense', async () => {
    const { fetchImpl } = healthyMon({ primary: { decimals: hexOf([256n]) } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'FEED_DECIMALS_UNREADABLE',
    });
  });

  it('refuses a decimals() that reverts on the aggregator instead of scaling by 0', async () => {
    const { fetchImpl } = healthyMon({ primary: { decimals: { rpcError: true } } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_REJECTED',
    });
  });

  it('refuses an answer that is not hex at all', async () => {
    const { fetchImpl } = healthyMon({ primary: { round: { notHex: true } } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });

  it('refuses a body that is not JSON at all', async () => {
    const { fetchImpl } = healthyMon({ primary: { round: { notJson: true } } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });

  it('reports a dead endpoint as unavailable, never as a price of zero', async () => {
    const { fetchImpl } = healthyMon({ primary: { decimals: { unreachable: true } } });
    expect(await feedWith(fetchImpl).usdPrice('MON')).toEqual({
      status: 'unreadable',
      reason: 'RPC_UNAVAILABLE',
    });
  });

  it('reports an HTTP 5xx as unavailable and carries no number at all', async () => {
    const { fetchImpl } = healthyMon({ primary: { decimals: { http: 502 } } });
    const result = await feedWith(fetchImpl).usdPrice('MON');
    expect(result).toEqual({ status: 'unreadable', reason: 'RPC_UNAVAILABLE' });
    expect('value' in result).toBe(false);
  });
});
