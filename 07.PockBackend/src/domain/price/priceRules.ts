/**
 * The circuit breakers a Chainlink price has to pass, and the exact arithmetic
 * that decides them.
 *
 * ── Why these three and not "return what the feed said" ──────────────────────
 *
 * A feed answer is a struct read from a contract, and every one of these three
 * shapes is a real answer that must not become a balance on a screen:
 *
 *  1. **A well-formed answer from an old round.** Nothing about it is malformed.
 *     It is simply a number from last Tuesday, and a number that old is not a
 *     price — it is a history. (The probe behind this task caught exactly this:
 *     Monad's `USDC/USD` feed had a **2.7-hour** heartbeat while every other
 *     feed on the network was under two minutes old.)
 *  2. **A non-positive answer.** A feed nobody has initialised answers `0`, and
 *     `0` dollars would render as a worthless asset rather than as an unreadable
 *     one. A zero price is never a fact about an asset.
 *  3. **Two channels that disagree.** `MON/USD`, `ETH/USD` and `BTC/USD` each
 *     exist on Monad twice — the primary feed and its SVR counterpart, at
 *     **different decimals**. Two independent channels that disagree mean at
 *     least one is wrong, and nothing in the answer says which. Refusing is the
 *     only honest answer.
 *
 * ── Why a threshold nobody can justify is worse than none ────────────────────
 *
 * Each bound below carries the observation it came from. A constant that is
 * merely "a number someone typed" is a constant waiting to be wrong in a
 * direction nobody is watching.
 *
 * ── Why the whole file is `bigint` ───────────────────────────────────────────
 *
 * The answers are `int256` at 8 or 18 decimals. `Number` is already wrong past
 * 53 bits, and every quantity here sits inside that range, so a single float
 * would decide a divergence test on numbers it cannot represent exactly. There
 * is no float in this file, and the only division of a price by a power of ten
 * is string surgery.
 */

/**
 * The bound that decides whether two channels corroborate each other, in basis
 * points: **100 bps = 1%.**
 *
 * ── What it was for, and what it was wrong about ────────────────────────────
 *
 * The bound has been 200 bps, then 5 bps. Both numbers came from the same
 * defective observation: **one pair, read once.** `MON/USD` was the only pair on
 * Monad that had two channels at the time, so `MON` was the whole evidence base,
 * and at one block it answered $0.028642 from both — a divergence of 0 bps. A
 * bound sized to "0 bps plus a little" is 5 bps, and that is where 5 came from.
 *
 * Measured live at **one pinned block (111127200)** across every pair that has
 * two channels, two healthy feeds of the same pair diverge legitimately:
 *
 * | pair     | primary (8 dec)   | SVR (18 dec)         | divergence |
 * |----------|-------------------|----------------------|------------|
 * | `MON_USD`  | $0.02864200      | $0.02864200     | **0 bps**     |
 * | `ETH_USD`  | $2,691.985594    | $2,690.531100   | **5.403 bps** |
 * | `BTC_USD`  | $85,623.908621   | $85,622.742540  | **0.136 bps** |
 *
 * **5 bps is below the worst of those, and the worst of those is healthy.**
 * `ETH`'s two channels were both fresh and both well-formed; they simply did not
 * publish on the same schedule. Pinning the block removes drift in *time* — it
 * does not make two independent oracles agree to the eighth decimal. The
 * residual risk the 5 bps justification named ("if the SVR channel ever serves a
 * round computed appreciably before the primary's, 5 bps fires") was therefore
 * not a hypothetical: it was **already the normal case for ETH**, whose price was
 * going `complete: false` on two working feeds disagreeing by a fifth of a
 * percent. A bound that reads ordinary dispersion as damage will eventually
 * refuse a correct price, and a correct price refused is not a safety property.
 *
 * ── Why 100 bps, from that evidence and not from taste ─────────────────────
 *
 *  - **About 18× above the worst divergence two healthy channels have shown.**
 *    100 / 5.403 ≈ 18.5. The allowance is measured from the worst case observed
 *    across every cross-checked pair, not from the one pair that happened to
 *    agree.
 *  - **Far above the quantisation floor, so it can never fire on the same
 *    number reported twice.** An 8-decimal channel cannot say anything finer
 *    than $1e-8. On the cheapest asset priced here — MON at ~$0.0286 — that is
 *    **~0.0035 bps**, so 100 bps is roughly 29,000× the floor: two channels
 *    reporting the identical price, rounded differently at 8 and 18 decimals,
 *    are accepted with a margin of five orders of magnitude. That is the
 *    smallest honest difference two feeds at different decimals can have, and it
 *    must not be a refusal.
 *  - **And still far below everything this check exists for.** The 8-vs-18
 *    decimals landmine is a factor of **10^10** (1,000,000,000 bps) and a
 *    channel pointed at the wrong pair is a factor of tens of thousands — each
 *    four or more orders of magnitude outside 100 bps, so neither can hide inside
 *    it. A channel serving a **materially** older round is the honest limit of
 *    this bound: a feed a few percent behind is refused, a feed a few tenths of a
 *    percent behind is not, and that is the deliberate trade stated below rather
 *    than an oversight. A bound wide enough to catch every stale round would
 *    have to sit above real dispersion, which is the 5 bps mistake again.
 *
 * **So this bound is a corruption detector, not a consensus meter.** It answers
 * one question: *is one of these two numbers insane?* It deliberately does not
 * answer "are these two numbers the same number", because two independent
 * healthy oracles on a volatile asset are not the same number and pretending
 * otherwise means refusing correct prices at random.
 *
 * **The residual risk, stated plainly:** a wrong price that happens to land
 * within 1% of a right one is not caught. That is the cost of an honest bound,
 * and it is small — 1% of a balance screen's price is a visible imprecision,
 * while a cross-check that fires on healthy feeds is an outage. The old 5 bps
 * bound traded a 1% risk for a routine outage; this one does the reverse.
 *
 * The comparison is relative to the **larger** of the two answers, so a channel
 * reporting a smaller number cannot excuse itself by being the bigger one.
 */
export const MAX_CHANNEL_DIVERGENCE_BPS = 100n;

/** `1e4`. The denominator of a percentage expressed in basis points. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * One 32-byte word read as the **`int256`** that Chainlink declares the answer to
 * be.
 *
 * `BigInt('0x…')` does **not** interpret a 64-hex-digit string as two's
 * complement: `BigInt('0x' + 'f'.repeat(64))` is `115792089237316195423570985008687907853269984665640564039457584007913129639935`,
 * a positive number near `1.16e77`. `AggregatorV3Interface.latestRoundData()`
 * declares `int256 answer`, so a word with its top bit set is a **negative**
 * round, and reading it unsigned publishes a price of 10^77 dollars — which is
 * this file's loudest version of the rule the whole breaker set exists to
 * enforce: a price that does not exist is not a number.
 *
 * The other four words of the struct are unsigned by ABI, so they are read with
 * `BigInt` as usual.
 */
export const toSignedInt256 = (word: string): bigint => {
  const magnitude = BigInt(`0x${word}`);
  const negative = (magnitude >> 255n) === 1n;
  return negative ? magnitude - (1n << 256n) : magnitude;
};

/**
 * The bound that decides whether a round is still a price: **3600 seconds.**
 *
 * Why one hour, from the heartbeat this task measured on Monad mainnet:
 *
 *  | feed        | age at the probe |
 *  |-------------|-------------------|
 *  | BTC/USD     | 17 s             |
 *  | ETH/USD     | 78 s             |
 *  | MON/USD     | 26 s             |
 *  | USDC/USD    | 9 837 s (2.7 h)  |
 *
 * Every non-peg feed on the network was **under two minutes** old. One hour is
 * therefore roughly thirty to a hundred heartbeat periods of slack: loose enough
 * that a network hiccup, a missed report or a slow `eth_call` does not take a
 * price away, and tight enough that an hour-old number never reaches a balance
 * screen.
 *
 * It is also the bound the task spec names: *"An hour-old price is not a
 * price."* The measurement above is why an hour is defensible rather than
 * arbitrary — it sits an order of magnitude above this network's actual
 * heartbeat and below the horizon at which a crypto price is a different
 * number.
 *
 * Note what this bound does to a slow feed by design: `USDC/USD` would be
 * refused at 2.7 hours, which is why digital dollars are **not** priced from an
 * oracle at all — a dollar-pegged unit is valued at 1 by definition, and no
 * feed belongs in that path.
 */
export const MAX_PRICE_AGE_SECONDS = 3600;

/** One round of one channel, as read: the answer and the scale it was read at. */
export interface PriceChannel {
  readonly pair: string;
  /** `int256` at `decimals`. Signed on purpose: a negative round is a refusal. */
  readonly answer: bigint;
  readonly decimals: number;
  /** Unix seconds, from `latestRoundData`'s `updatedAt`. */
  readonly updatedAt: number;
}

/**
 * Whether this round is too old to price anything.
 *
 * `updatedAt <= 0` counts as stale, and that is not an extra rule: a round that
 * never reported a timestamp cannot be fresh, so it fails the *same* question.
 * A future `updatedAt` is left alone deliberately — the node's clock and the
 * feed's are not required to agree to the second, and inventing a clock-skew
 * bound here would be a threshold nobody could justify either.
 */
export const isStale = (updatedAt: number, nowSeconds: number): boolean =>
  updatedAt <= 0 || nowSeconds - updatedAt > MAX_PRICE_AGE_SECONDS;

/**
 * Whether an answer is a price or an uninitialised feed.
 *
 * `int256` is signed, so a negative answer parses as a negative `bigint` and is
 * caught here rather than being rejected as malformed upstream. Either way it is
 * refused, because a round that answers zero or less is not telling us the asset
 * is free — it is telling us this feed has never reported.
 */
export const isNonPositive = (answer: bigint): boolean => answer <= 0n;

/** Rescales an answer read at `from` decimals to `to` decimals. `to >= from`. */
const rescale = (answer: bigint, from: number, to: number): bigint =>
  answer * 10n ** BigInt(to - from);

/**
 * Whether two channels of the same pair disagree beyond the declared bound.
 *
 * The two answers are compared at **their own decimals, rescaled to a common
 * scale first**. Comparing the raw integers instead would compare `286247…`
 * with `28842000000000000` — which is the 10^10 error, arriving through the
 * cross-check instead of through the price, and being reported as a divergence
 * rather than as a billion dollars.
 *
 * Exact throughout: `|a - b| x 10_000 <= bps x max(a, b)`, in `bigint`.
 */
export const channelsDisagree = (a: PriceChannel, b: PriceChannel): boolean => {
  const scale = Math.max(a.decimals, b.decimals);
  const left = rescale(a.answer, a.decimals, scale);
  const right = rescale(b.answer, b.decimals, scale);
  const gap = left > right ? left - right : right - left;
  const larger = left > right ? left : right;

  if (larger === 0n) return true; // both zero: caught earlier as non-positive
  return gap * BPS_DENOMINATOR > MAX_CHANNEL_DIVERGENCE_BPS * larger;
};

/**
 * The exact USD decimal string for an answer read at `decimals`.
 *
 * String surgery on the `bigint`, reusing the same function the portfolio uses
 * for balances — so "how does a raw integer become a human number" has exactly
 * one answer in this codebase. No division, no `Number`, no rounding: the figure
 * on a balance screen is this number multiplied by a `bigint` quantity, and
 * rounding before that multiplication is rounding somebody's money.
 *
 * Trailing zeros in the fraction are dropped by `formatUnits`, so a feed at 8
 * decimals answering `28624700` is `"0.0286247"` and not `"0.02862470"`.
 */
export { formatUnits } from '../portfolio/assets';
