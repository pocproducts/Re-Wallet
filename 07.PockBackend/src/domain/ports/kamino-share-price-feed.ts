/**
 * PORT: what one Kamino Earn share is worth, and what the vault earns, as
 * Kamino publishes both.
 *
 * ── Why this exists at all, instead of the price being read on chain ────────
 *
 * The share price is `netAUM / sharesIssued`, and ~99.5 % of this vault's assets
 * sit in klend cTokens rather than in the vault's own token account. Anything
 * computed from that account alone is out by roughly 200×, which is the kind of
 * error a balance screen cannot show. On top of that, Kamino's own docs say a
 * figure derived from reserve state that can lag "can only over-estimate".
 *
 * So the price is **asked for** and never reimplemented. This port is the whole
 * trust allocation in one signature: **how much** is ours and verifiable on
 * chain, **what it is worth** is Kamino's and unverifiable by us. That is a
 * deliberate split, not a missing feature, and the reason is written down in
 * `domain/yield/kaminoEarnVault.ts` too.
 *
 * ── Why the scale travels with the price and is not a constant ──────────────
 *
 * Kamino publishes `sharePrice` as a decimal **string** whose OpenAPI type is
 * `Decimal = string`. Nothing states how many fractional digits a given answer
 * carries — the live figure has nineteen — so a port that answered `raw` at a
 * fixed exponent would be inventing a scale on every call. The exact integer and
 * **its own** exponent travel together, and the multiplication downstream adds
 * the two scales rather than assuming one.
 *
 * ── The APY rides on the same feed, as a second question ───────────────────
 *
 * The same document publishes `apy.total` next to `sharePrice`, so the vault's
 * **rate** is asked for from the same place and through the same port rather than
 * through a second HTTP client with its own idea of the endpoint. It is the same
 * scale discipline exactly: a decimal string with no declared exponent, so the
 * scale is the count of the answer's own fractional digits, an exponent form is
 * refused, and an absent, malformed or non-positive rate is `unreadable` with a
 * bounded reason — **never a zero**, because a vault publishing `0` is a figure
 * this code cannot interpret as an annual yield.
 *
 * It is a **separate method**, not a second field on one answer, and the reason
 * is a failure that must stay a failure of its own: an APY that cannot be parsed
 * must not make the *share price* unreadable. Merging them would let a broken
 * rate put a hole in somebody's balance, which is a strictly worse outcome than
 * "we know what you hold and we cannot say what it earns".
 */
import type { ExactDecimal } from '../yield/kaminoEarnVault';

/**
 * Why a share price does not exist, as a bounded name.
 *
 *  - `KAMINO_UNAVAILABLE` — Kamino's API did not answer. Somebody else's problem.
 *  - `KAMINO_MALFORMED_RESPONSE` — it answered with something that is not a vault
 *    answer, or with a `sharePrice` this code cannot read exactly. **Ours** to
 *    investigate, and the case that must never be mistaken for a zero.
 *  - `SHARE_PRICE_NON_POSITIVE` — a vault that has never been initialised answers
 *    zero, and zero dollars is not the price of anything.
 *
 * A provider's own words never cross this boundary. Its error page is sometimes
 * HTML from a proxy, and a screen can only render a name.
 */
export type KaminoSharePriceFailure =
  | 'KAMINO_UNAVAILABLE'
  | 'KAMINO_MALFORMED_RESPONSE'
  | 'SHARE_PRICE_NON_POSITIVE';

export interface KaminoSharePrice extends ExactDecimal {
  /** The exact decimal text Kamino published. What a screen prints. */
  readonly usd: string;
}

export type KaminoSharePriceResult =
  | { readonly status: 'ok'; readonly value: KaminoSharePrice }
  | { readonly status: 'unreadable'; readonly reason: KaminoSharePriceFailure };

/**
 * Why an APY does not exist, as a bounded name.
 *
 *  - `KAMINO_UNAVAILABLE` — Kamino's API did not answer. Somebody else's problem.
 *  - `KAMINO_MALFORMED_RESPONSE` — it answered without `apy.total`, or with a
 *    rate this code cannot read exactly (an exponent, a sign, a non-string).
 *    **Ours** to investigate, and the case that must never be mistaken for a zero.
 *  - `APY_NON_POSITIVE` — `0` is not an annual yield; it is a vault publishing
 *    something this code will not read as a rate.
 *
 * The two shares of the names are deliberately the same names the price uses,
 * because they are the same two failures; only the rate's own zero has its own
 * name, for the same reason `SHARE_PRICE_NON_POSITIVE` has one.
 */
export type KaminoApyFailure =
  | 'KAMINO_UNAVAILABLE'
  | 'KAMINO_MALFORMED_RESPONSE'
  | 'APY_NON_POSITIVE';

/**
 * The annual yield of a vault, as Kamino publishes it: a **fraction** of one
 * (`0.041808723945949255` is 4.18 %), exact, at the scale its own digits state.
 */
export interface KaminoApy extends ExactDecimal {
  /** The exact decimal text Kamino published. What a screen prints. */
  readonly text: string;
}

export type KaminoApyResult =
  | { readonly status: 'ok'; readonly value: KaminoApy }
  | { readonly status: 'unreadable'; readonly reason: KaminoApyFailure };

export interface KaminoSharePriceFeed {
  /** The USD price of one share of `vault`, or the bounded reason there is none. */
  sharePrice(vault: string): Promise<KaminoSharePriceResult>;
  /**
   * The annual yield of `vault`, or the bounded reason there is none.
   *
   * Asked separately from the price so that each of the two answers can be right
   * or wrong **on its own**: a missing rate never removes a balance.
   */
  apy(vault: string): Promise<KaminoApyResult>;
}