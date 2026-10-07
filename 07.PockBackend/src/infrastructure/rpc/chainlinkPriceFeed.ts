/**
 * ADAPTER: the Chainlink price feeds on Monad mainnet, over raw JSON-RPC.
 *
 * ── Why raw JSON-RPC and not `viem` ──────────────────────────────────────────
 *
 * `viem` is a **devDependency** in this project, on purpose: a Cloudflare
 * Worker bundle has to fit, and the only hashing this codebase needs is keccak
 * for the EIP-55 checksum in `domain/send`. This adapter therefore speaks the
 * same JSON-RPC dialect as `jsonRpcAavePoolReader` — one `eth_call`, the hex
 * answer kept as a string, the decoding done by hand — and the two failures the
 * node can produce stay apart (`RPC_UNAVAILABLE` for silence, `RPC_REJECTED` for
 * an error object, `RPC_MALFORMED_RESPONSE` for an answer that is not hex).
 *
 * ── Why decimals are read through the proxy, every time, per feed ────────────
 *
 * `decimals()` reverts on the aggregator and answers on the proxy. The two
 * channels of `MON/USD` answer at **8** and **18** decimals, so a single
 * hardcoded exponent is a 10^10 error. The scale of every feed is read from the
 * feed itself, before its round, and travels out with the price.
 *
 * ── Why every call of a price read is pinned to ONE block ────────────────────
 *
 * The cross-check compares **two channels of the same pair**. Read at `'latest'`
 * — once per channel, as this adapter used to do — the two reads land **seconds
 * apart**, and a token that moves moves between them. That is not a small
 * technicality: it is where the 0.76% "divergence" of the two MON channels came
 * from. Pinned to one block, the same two feeds answer **$0.02864200 — identical
 * to the cent**.
 *
 * So the price read asks for a block number once and sends every `eth_call` of
 * every channel of that pair at that block. The comparison is then between two
 * views of **one instant of the world**, which is the only thing it was ever
 * supposed to compare.
 *
 * If the block cannot be pinned the whole price is refused. Failing open would
 * put the artefact straight back into the cross-check, which is the one thing
 * the pin exists to remove: the honest answer when two instants cannot be
 * compared is that they were not compared.
 *
 * ── Why `latestRoundData` is refused unless it has exactly five words ─────────
 *
 * The ABI is five words — `roundId, int256 answer, uint256 startedAt, uint256
 * updatedAt, uint80 answeredInRound` — and every one of them is positional. A
 * struct decoded with fewer declared outputs does not throw: everything after
 * the missing word slides one slot early and the result *looks* like a price.
 * This repository already lost sessions to exactly that shape of bug on
 * `getReserveData`. So the decoder counts the words and refuses anything else,
 * rather than filling the tail with whatever it found.
 *
 * ── Why this adapter is not injected into a test through a use case ──────────
 *
 * It takes a `fetch`. Every test in `test/infrastructure/chainlinkPriceFeed.test.ts`
 * is a transcript of what a node answered, so the whole suite keeps running with
 * **no network**, which the README names as the reason the architecture is
 * shaped this way.
 */
import { PriceFeedError } from '../../domain/price/priceFeedError';
import {
  CHAINLINK_FEEDS_ON_MONAD,
  DEFAULT_MONAD_RPC_URL,
  DECIMALS_SELECTOR,
  LATEST_ROUND_DATA_SELECTOR,
} from '../../domain/price/chainlinkMonad';
import {
  channelsDisagree,
  formatUnits,
  isNonPositive,
  isStale,
  toSignedInt256,
  type PriceChannel,
} from '../../domain/price/priceRules';
import type { PricedAsset, PriceFeed, PriceFeedFailure, PriceResult } from '../../domain/ports/price-feed';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from './httpDeadline';
export interface ChainlinkPriceFeedOptions {
  /**
   * Candidate endpoints, tried in order. A public endpoint rate-limiting is not
   * an exception, it is Tuesday: the last failure of the list is the one
   * reported, and a reader with no working endpoint reports `RPC_UNAVAILABLE`
   * rather than a price of zero.
   */
  readonly endpoints?: readonly string[];
  /** Injected so this adapter is testable with no network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Injected clock, in Unix **seconds**. Freshness is decided against this and
   * against nothing else: a test has to be able to make a round one hour old
   * without waiting an hour.
   */
  readonly nowSeconds?: () => number;
  /**
   * How long a successful price read may be **reused** for, in seconds.
   *
   * Defaults to {@link PRICE_CACHE_TTL_SECONDS}. It is an option and not an
   * environment variable on purpose: the bound is a property of the staleness
   * rule below it, and a deployment that disagreed with it would be able to
   * serve a price this adapter would have refused.
   */
  readonly cacheTtlSeconds?: number;
  /**
   * How long one request to one price-feed endpoint may take. Defaults to
   * {@link PRICE_FEED_REQUEST_TIMEOUT_MS}; tests replace the schedule to drive
   * the deadline by hand instead of waiting for it.
   */
  readonly deadline?: DeadlinePolicy;
}

/**
 * How long one request to one price-feed endpoint is given, and why 4 s.
 *
 * A price read is several requests: one `eth_blockNumber`, then a `decimals()`
 * and a `latestRoundData()` per channel of the pair, all at the pinned block.
 * They are `eth_call`s into small proxy contracts on public Monad endpoints, so
 * a healthy node answers each in a fraction of this — but the read pays it up to
 * five times, and a node that is slow rather than down would spend the whole
 * price read inside the first two of them.
 *
 * Four seconds is the same bound the Aave pool reader uses, and deliberately so:
 * both are a handful of state-only `eth_call`s against the same kind of public
 * Monad endpoint. It is a second wider than the plain balance read because a
 * price is composed of more calls than a balance, and it is not wider than that
 * because the person watching a loading price is watching the same clock as the
 * person watching a loading balance.
 *
 * Per **request**, not per price read: a price read that has already pinned a
 * block and read one channel is not made more correct by waiting five seconds
 * for the next one, and an endpoint that is not answering is not going to start.
 */
export const PRICE_FEED_REQUEST_TIMEOUT_MS = 4_000;

/**
 * How long a successful Chainlink read is reused, and why that is short enough.
 *
 * Ten seconds, against the staleness limit this adapter already applies
 * `MAX_PRICE_AGE_SECONDS`, 3600, from `domain/price/priceRules.ts`). The cache
 * can therefore add at most ten seconds to the age of the worst price it will
 * serve — under 0.3 % of the limit it is already refused at — and it buys the
 * thing the balance page was missing: `/api/wallet-balance` and any other route in the same Worker isolate
 * stop re-reading the same pair, on the same block, from the same nodes.
 *
 * It is also far below the rate at which the underlying answer can change
 * meaning: the rounds themselves refresh on the feed's own heartbeat, and the
 * cross-check compares two channels of **one** pinned block, so re-reading sooner
 * mostly re-reads the same instant.
 */
export const PRICE_CACHE_TTL_SECONDS = 10;

/**
 * The most entries kept at once, and why the bound is redundant.
 *
 * `PricedAsset` is a closed union of four symbols, so the cache cannot grow past
 * four entries by construction. The cap is stated anyway because "it cannot grow"
 * is a claim about today's type and not a property anyone would notice breaking:
 * a new asset would raise this number rather than start an unbounded `Map` in an
 * isolate that never restarts.
 */
const MAX_CACHED_PRICES = 8;

export const DEFAULT_PRICE_FEED_ENDPOINTS: readonly string[] = [DEFAULT_MONAD_RPC_URL];

/** `uint8` cannot exceed this, so any larger answer is not a decimals call. */
const UINT8_MAX = 255n;

/** The successful member of the port's union, and the only thing ever cached. */
type OkPriceResult = Extract<PriceResult, { readonly status: 'ok' }>;

/** One `eth_call`, answered as the hex string the node sent. */
export const createChainlinkPriceFeed = (
  options: ChainlinkPriceFeedOptions = {},
): PriceFeed => {
  const endpoints = options.endpoints ?? DEFAULT_PRICE_FEED_ENDPOINTS;
  /*
   * Bound once. Every call below — the block tag and each channel's `decimals()`
   * and round — goes out through this, so no read of this adapter can reach a
   * node without a deadline, and none of them can pin the in-flight entry below
   * for as long as the endpoint feels like.
   */
  const send = withDeadline(options.fetchImpl ?? fetch, {
    timeoutMs: PRICE_FEED_REQUEST_TIMEOUT_MS,
    ...options.deadline,
  });
  const nowSeconds = options.nowSeconds ?? ((): number => Math.floor(Date.now() / 1000));
  const ttlSeconds = options.cacheTtlSeconds ?? PRICE_CACHE_TTL_SECONDS;

  /**
   * One JSON-RPC method, answered as the hex string the node sent, or the reason
   * there is none. Every endpoint is tried before the price is refused.
   */
  const rpc = async (method: string, params: readonly unknown[]): Promise<string> => {
    const failures: string[] = [];
    let firstReason: PriceFeedFailure | undefined;

    for (const url of endpoints) {
      try {
        return await callOnce(url, method, params, send);
      } catch (error) {
        if (firstReason === undefined && error instanceof PriceFeedError) firstReason = error.reason;
        failures.push(error instanceof Error ? error.message.slice(0, 160) : 'unknown failure');
      }
    }

    throw new PriceFeedError(
      firstReason ?? 'RPC_UNAVAILABLE',
      `chainlink on Monad failed on all ${failures.length} endpoint(s): ${failures.join(' | ')}`,
    );
  };

  /** `eth_call` at an explicit block tag. Never at `'latest'`. */
  const call = (to: string, data: string, blockTag: string): Promise<string> =>
    rpc('eth_call', [{ to, data }, blockTag]);

  const callOnce = async (
    url: string,
    method: string,
    params: readonly unknown[],
    send: typeof fetch,
  ): Promise<string> => {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (error) {
      throw new PriceFeedError('RPC_UNAVAILABLE', `the price feed endpoint ${transportDetail(error, 'did not answer')}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new PriceFeedError('RPC_UNAVAILABLE', `the price feed endpoint answered HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      /*
       * A round that stopped mid-answer is our deadline, not a bad round. From
       * here the two are indistinguishable, and the difference is the whole
       * vocabulary: `RPC_MALFORMED_RESPONSE` is a statement about this adapter,
       * and filing a node that stopped talking as one would turn a provider
       * outage into a bug report against the cross-check.
       */
      if (isDeadlineExceeded(error)) {
        throw new PriceFeedError('RPC_UNAVAILABLE', `the price feed endpoint ${error.message}`, { cause: error });
      }
      throw new PriceFeedError('RPC_MALFORMED_RESPONSE', 'the price feed endpoint answered with no JSON', {
        cause: error,
      });
    }

    const payload = body as { error?: unknown; result?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new PriceFeedError('RPC_MALFORMED_RESPONSE', 'the price feed endpoint answered with no JSON object');
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new PriceFeedError('RPC_REJECTED', `the ${method} call was rejected by the endpoint`);
    }
    if (typeof payload.result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(payload.result)) {
      throw new PriceFeedError('RPC_MALFORMED_RESPONSE', `the ${method} call answered with no hex string`);
    }

    return payload.result;
  };

  /** The hex body, or a refusal that says how many words were there. */
  const bodyOf = (hex: string, expectedWords: number, what: string): string => {
    const body = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (body.length !== expectedWords * 64) {
      throw new PriceFeedError(
        'RPC_MALFORMED_RESPONSE',
        `${what} declares ${expectedWords} words, the answer carries ${body.length / 64}`,
      );
    }
    return body;
  };

  /**
   * `decimals()`, through the proxy. An answer that cannot be a `uint8` is not a
   * decimals call — it is an uninitialised proxy answering zeros, and taking 0
   * as a scale is how a price becomes 10^18 times too big.
   */
  const readDecimals = async (proxy: string, blockTag: string): Promise<number> => {
    const body = bodyOf(await call(proxy, DECIMALS_SELECTOR, blockTag), 1, 'decimals()');
    const value = BigInt(`0x${body}`);
    if (value > UINT8_MAX) {
      throw new PriceFeedError('FEED_DECIMALS_UNREADABLE', `decimals() answered ${value}, which is not a uint8`);
    }
    return Number(value);
  };

  /** `latestRoundData()`: five words, of which only the answer and `updatedAt` are used. */
  const readChannel = async (proxy: string, pair: string, blockTag: string): Promise<PriceChannel> => {
    const decimals = await readDecimals(proxy, blockTag);
    const body = bodyOf(await call(proxy, LATEST_ROUND_DATA_SELECTOR, blockTag), 5, 'latestRoundData()');
    const word = (index: number): string => body.slice(index * 64, index * 64 + 64);
    // The answer is the struct's only `int256`; the four other words are unsigned.
    return {
      pair,
      answer: toSignedInt256(word(1)),
      decimals,
      updatedAt: Number(BigInt(`0x${word(3)}`)),
    };
  };

  const unreadable = (reason: PriceFeedFailure): PriceResult => ({ status: 'unreadable', reason });

  /**
   * The block every channel of this price read is pinned to.
   *
   * Asked **once per price read**, before any feed is touched. A block of zero is
   * refused rather than used: genesis is not a state of any of these feeds, and a
   * node that answers `0x0` is answering something other than a block number.
   */
  const readBlockTag = async (): Promise<string> => {
    const hex = await rpc('eth_blockNumber', []);
    let height: bigint;
    try {
      height = BigInt(hex);
    } catch (error) {
      throw new PriceFeedError('RPC_MALFORMED_RESPONSE', 'eth_blockNumber answered with no integer', {
        cause: error,
      });
    }
    if (height <= 0n) {
      throw new PriceFeedError('RPC_MALFORMED_RESPONSE', `eth_blockNumber answered ${height}`);
    }
    return `0x${height.toString(16)}`;
  };

  /**
   * Every breaker, in the order they are cheap, and every one of them a refusal.
   *
   * The order is: **every channel must be readable**, then **no channel may
   * answer zero or less**, then **no channel may be old**, then **the channels
   * must agree**.
   *
   * A configured channel that cannot be read takes the whole price with it, and
   * that is a deliberate cost: where a second channel exists on the pair, its
   * corroboration is the reason the first one may be believed at all, so if it
   * cannot be read, what is left is a single channel asserting a number — which
   * is exactly the state the cross-check exists to refuse. Failing closed costs
   * a price; failing open costs a balance.
   */
  const priceOf = async (asset: PricedAsset): Promise<PriceResult> => {
    const feeds = CHAINLINK_FEEDS_ON_MONAD[asset];
    const channels: PriceChannel[] = [];

    /*
     * The block first, and only once. Every channel below — its `decimals()` and
     * its round — is read at this tag, so a cross-check compares one instant of
     * the world and not two. If the tag cannot be pinned there is no honest
     * comparison to make, and the price is refused before any feed is touched.
     */
    let blockTag: string;
    try {
      blockTag = await readBlockTag();
    } catch (error) {
      return unreadable(error instanceof PriceFeedError ? error.reason : 'RPC_UNAVAILABLE');
    }

    for (const feed of feeds) {
      try {
        channels.push(await readChannel(feed.proxy, feed.pair, blockTag));
      } catch (error) {
        return unreadable(error instanceof PriceFeedError ? error.reason : 'RPC_UNAVAILABLE');
      }
    }

    for (const channel of channels) {
      if (isNonPositive(channel.answer)) return unreadable('NON_POSITIVE');
    }

    const now = nowSeconds();
    for (const channel of channels) {
      if (isStale(channel.updatedAt, now)) return unreadable('STALE');
    }

    const primary = channels[0] as PriceChannel;
    for (const other of channels.slice(1)) {
      if (channelsDisagree(primary, other)) return unreadable('CHANNELS_DISAGREE');
    }

    return {
      status: 'ok',
      value: {
        asset,
        pair: primary.pair,
        // The exact integer the feed answered, at the feed's own scale. It travels
        // next to `usd` so that multiplying it by a `bigint` balance needs no
        // decimal parsing: `parseFloat` on the string would already be wrong.
        raw: primary.answer.toString(),
        usd: formatUnits(primary.answer, primary.decimals),
        decimals: primary.decimals,
        updatedAt: primary.updatedAt,
        crossChecked: channels.length > 1,
      },
    };
  };

  /* ── The edge cache: same reads, fewer of them ──────────────────────────── */

  /*
   * A Chainlink round is **global**. It is the same number for every person, on
   * every request, and nothing about it depends on who asked — so reading it once
   * per request was reading the same block twice for the same page load, once for
   * `/api/pool` and once for `/api/wallet-balance`.
   *
   * The entry carries the **age it had when it was cached** in two parts, and
   * both matter on a hit:
   *
   *  - `cachedAtSeconds` — how long ago *this* adapter fetched it, which is what
   *    the TTL is measured against.
   *  - `value.updatedAt` — the round's own timestamp from `latestRoundData`, which
   *    is what the staleness rule is really about.
   *
   * So a hit is served only if it is **younger than the TTL** *and* the round it
   * carries is still fresh under `isStale` against the current clock. An entry
   * whose round has aged past the adapter's own limit is dropped and read through
   * instead: the cache can only ever hand back a price this adapter would have
   * published, never one it would have refused.
   *
   * A refusal is **not** cached. An `unreadable` answer is a statement about a
   * moment in time, and repeating it for ten seconds would turn a blip into an
   * outage; the next request reads through and gets a real answer.
   */
  const cache = new Map<PricedAsset, { readonly result: OkPriceResult; readonly cachedAtSeconds: number }>();

  /**
   * The reads currently in flight, so a burst of concurrent misses costs **one**
   * set of RPC calls rather than one per caller. This is a Worker isolate:
   * every request a warm isolate serves runs here at once.
   *
   * Entries are removed the moment the read settles, so this map holds at most
   * one entry per asset and cannot accumulate.
   */
  const inFlight = new Map<PricedAsset, Promise<PriceResult>>();

  const cachedPriceOf = (asset: PricedAsset): Promise<PriceResult> => {
    const now = nowSeconds();
    const entry = cache.get(asset);

    if (entry !== undefined) {
      if (now - entry.cachedAtSeconds < ttlSeconds && !isStale(entry.result.value.updatedAt, now)) {
        return Promise.resolve(entry.result);
      }
      // Expired by the TTL or by the adapter's own freshness rule: dropped, so a
      // stale entry cannot be served by a later request either.
      cache.delete(asset);
    }

    const pending = inFlight.get(asset);
    if (pending !== undefined) return pending;

    const flight: Promise<PriceResult> = priceOf(asset).then(
      (result) => {
        inFlight.delete(asset);
        if (result.status === 'ok') {
          // Insertion-ordered eviction: the oldest key goes first. Bounded by
          // construction and by `MAX_CACHED_PRICES`; see the note on it.
          while (cache.size >= MAX_CACHED_PRICES) {
            const oldest = cache.keys().next();
            if (oldest.done === true) break;
            cache.delete(oldest.value);
          }
          cache.set(asset, { result, cachedAtSeconds: nowSeconds() });
        }
        return result;
      },
      (error: unknown) => {
        // A cache that cannot store is not a read that failed: the rejection is
        // passed straight through, exactly as an uncached `priceOf` would.
        inFlight.delete(asset);
        throw error;
      },
    );

    inFlight.set(asset, flight);
    return flight;
  };

  return {
    usdPrice: cachedPriceOf,
  };
};
