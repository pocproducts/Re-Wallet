/**
 * PORT: what the application needs to know about the price of an asset, in our
 * own words.
 *
 * ── Why a price and a failure are one union and never one field ──────────────
 *
 * A price that could not be read has no value. Not zero, not `null`, not the
 * last price it happened to see: **no value at all**. Every representation that
 * carries both — `{ usd: string, error?: string }` — is one refactor away from
 * `usd: "0"`, and a zero balance renders as an empty wallet, which is the exact
 * failure this repository already wrote a README about. So the two states are
 * mutually exclusive by construction: to read `value` the caller must first
 * prove it is looking at an `ok`, and there is no code path that produces an
 * `ok` without a price.
 *
 * The consequence is deliberate and is the point of the port: **the caller
 * cannot write arithmetic that forgets to check.** The money path is `bigint`
 * at feed decimals until the very last step, and the last step is the one place
 * a decimal string is produced.
 *
 * ── Why `PriceFeed` is injected and never reached for directly ────────────────
 *
 * The repository README is explicit that the test suite runs with **no network
 * and no database**, and that this is *the reason the architecture is shaped
 * this way*. A use case that called a feed directly would be a test that only
 * runs on the day the public Monad RPC is up. So this is a port, the adapter
 * holds the addresses, and T2 wires it into a use case that takes it as an
 * argument.
 *
 * ── Why the asset is a name and not an address or a pair string ───────────────
 *
 * "MON", "ETH", "SOL", "BTC" are the assets a wallet can hold. Which contract
 * answers for MON is a fact about Monad's registry, not a parameter of a call,
 * and a port that took a proxy address would be a port that could be pointed at
 * whatever a caller passed. The registry lives in `domain/price`, one file.
 */

/** The assets this application can price. Anything else is not priced at all. */
export type PricedAsset = 'MON' | 'ETH' | 'SOL' | 'BTC';

/**
 * Every way a price can fail to exist, as a bounded name.
 *
 * These are six distinct facts and none of them is another's synonym:
 *
 *  - `RPC_UNAVAILABLE` — no endpoint answered. Somebody else's problem.
 *  - `RPC_REJECTED` — an endpoint answered and said no. Somebody else's problem.
 *  - `RPC_MALFORMED_RESPONSE` — an endpoint answered with something that is not a
 *    Chainlink answer. **Ours** to investigate, and the case that must never be
 *    mistaken for a zero.
 *  - `FEED_DECIMALS_UNREADABLE` — the answer is a struct but its scale could not
 *    be read, so no amount of arithmetic with it is trustworthy.
 *  - `STALE` — a well-formed answer from a round nobody should trade on.
 *  - `NON_POSITIVE` — a feed that has never been initialised answers zero, and
 *    zero dollars is not the price of anything.
 *  - `CHANNELS_DISAGREE` — two independent channels for the same pair disagree
 *    beyond the declared bound, so at least one of them is wrong and there is no
 *    way to tell which.
 *
 * A provider's own error message never crosses this boundary: it is a sentence,
 * sometimes an HTML page from a proxy, and it goes to the log.
 */
export type PriceFeedFailure =
  | 'RPC_UNAVAILABLE'
  | 'RPC_REJECTED'
  | 'RPC_MALFORMED_RESPONSE'
  | 'FEED_DECIMALS_UNREADABLE'
  | 'STALE'
  | 'NON_POSITIVE'
  | 'CHANNELS_DISAGREE';

/**
 * A price that exists, with everything needed to trust it and to reproduce it.
 *
 * `usd` is an **exact decimal string** at the feed's own `decimals` — never a
 * double, and never rounded. The figure on a balance screen is this number
 * multiplied by a `bigint` quantity, and rounding it before display is
 * rounding somebody's money before it is shown.
 */
export interface UsdPrice {
  readonly asset: PricedAsset;
  /** The Chainlink pair this was read from, e.g. `MON_USD`. */
  readonly pair: string;
  /** Exact USD value as a decimal string, e.g. `"0.02862470"`. */
  readonly usd: string;
  /**
   * The **exact integer** the feed answered, at `decimals`: `"0.0286247"` at 8
   * decimals is `"2862470"` here.
   *
   * It travels beside `usd` rather than replacing it on purpose. `usd` is what a
   * screen prints; `raw` is what arithmetic multiplies. A caller that had to turn
   * one into the other would be parsing a decimal string by hand — and the only
   * exact way to parse one is by hand. So the port does it once, at the edge,
   * and the money path stays `bigint` from the first multiply to the last.
   */
  readonly raw: string;
  /** The decimals the feed answered at. Stated, so nothing downstream assumes. */
  readonly decimals: number;
  /** Unix seconds, from `latestRoundData`'s `updatedAt`. The freshness claim. */
  readonly updatedAt: number;
  /**
   * Whether a second Chainlink channel for this pair was read at its own
   * decimals and agreed. `false` means the pair has only one channel on this
   * network, and the price is that channel's assertion rather than a corroborated
   * fact. It travels with the price so the caller can say so.
   */
  readonly crossChecked: boolean;
}

/** Either an exact price with its freshness, or a bounded reason. Never both. */
export type PriceResult =
  | { readonly status: 'ok'; readonly value: UsdPrice }
  | { readonly status: 'unreadable'; readonly reason: PriceFeedFailure };

export interface PriceFeed {
  /** The USD price of `asset`, or the bounded reason there is none. */
  usdPrice(asset: PricedAsset): Promise<PriceResult>;
}
