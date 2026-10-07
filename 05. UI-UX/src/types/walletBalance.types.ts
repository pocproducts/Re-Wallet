/**
 * The wire shape of `GET /api/wallet-balance`, exactly as the backend sends it.
 *
 * ── Why this is a discriminated union and not optional fields ────────────────
 *
 * Every entry of `pieces` is one of two things, and the two are **not** the same
 * thing with an empty field:
 *
 * | `status` | What it is | What it can carry |
 * |---|---|---|
 * | `ok` | It was read. The value **may be zero** — a real zero | `quantity`, `price`, `value`, `reason: null` |
 * | `unreadable` | It could not be read | `reason`, `quantity` (when known), `price: null`, `value: null` |
 *
 * With `value?: Amount` and `reason?: string` a `0` and a "we do not know" are
 * the same object, and any screen that paints them alike is telling a lie. With
 * the union, TypeScript refuses to read `value` off an unreadable piece, and
 * refuses to read `reason` off a readable one: the most expensive bug this screen
 * could have stops being representable.
 *
 * ── Why the piece can never hold a value and a failure at once ───────────────
 *
 * `readWalletBalance` decides the `status` first. An asset whose balance was read
 * but whose **price** was not is `unreadable` with `value: null`, and keeps its
 * `quantity` because the quantity is true and useful — it is simply never summed,
 * because a quantity without a price has no dollar value.
 *
 * ── Why the totals carry no status of their own ─────────────────────────────
 *
 * Deliberate, on the server side. `total` states "this is what could be read",
 * which is a true statement; if it claimed to be the whole truth it would need a
 * status, and any choice would lie in one direction or the other. Completeness
 * travels **beside** it, in `complete`, which is always present. `false` means
 * the figure is partial, and `pieces` says which piece is missing.
 */

/** An exact amount: the integer the backend read, plus its scale and unit. */
export interface WalletBalanceAmount {
  /** The exact integer at `decimals` scale. Never a float, never rounded. */
  readonly raw: string;
  /** The same value in `unit`, unrounded. `"0"` is a real zero. */
  readonly amount: string;
  readonly decimals: number;
  readonly unit: string;
}

/**
 * How a piece was valued.
 *
 * `source: 'peg'` means **no oracle was consulted**: a dollar-pegged digital
 * dollar is one by definition. `source: 'chainlink'` means the price was read
 * from a feed, and `crossChecked` says whether a second channel of the same pair
 * agreed with it at the same block.
 */
export interface WalletBalancePrice {
  /** The exact USD decimal text of the unit price, at `decimals`. */
  readonly usd: string;
  readonly raw: string;
  /** `0` for a peg: one is exact, so it needs no scale. */
  readonly decimals: number;
  readonly source: 'peg' | 'chainlink';
  /** The Chainlink pair, e.g. `MON_USD`. `null` for a peg. */
  readonly pair: string | null;
  /** Unix seconds of the round. `null` for a peg: there was no round. */
  readonly updatedAt: number | null;
  /** `null` for a peg: there was nothing to corroborate. */
  readonly crossChecked: boolean | null;
}

/** Which pool of the product a piece came from. */
export type WalletBalancePieceSource = 'free_wallet' | 'pool_position';

/** The chains the backend reads today. `null` when the piece is not on-chain. */
export type WalletBalanceChain = 'monad' | 'ethereum' | 'solana';

/** A piece that was read: it always carries a quantity, a price and a value. */
export interface WalletBalancePieceOk {
  /** Stable identity, e.g. `crypto.monad.USDC`. */
  readonly key: string;
  /** Spanish label from the backend: `"USDC en Monad"`. */
  readonly label: string;
  readonly source: WalletBalancePieceSource;
  readonly chain: WalletBalanceChain | null;
  readonly status: 'ok';
  readonly reason: null;
  /** What is held, exact, at the asset's own decimals. */
  readonly quantity: WalletBalanceAmount;
  readonly price: WalletBalancePrice;
  /** The exact USD value at `value.decimals`. */
  readonly value: WalletBalanceAmount;
}

/** A piece that could not be read. `value` is `null`, never a zero. */
export interface WalletBalancePieceUnreadable {
  readonly key: string;
  readonly label: string;
  readonly source: WalletBalancePieceSource;
  readonly chain: WalletBalanceChain | null;
  readonly status: 'unreadable';
  /** Bounded enum from the backend. The screen owns the sentence. */
  readonly reason: string;
  /**
   * What is held, when the quantity could be read but the **price** could not.
   * `null` when even the quantity is unknown.
   */
  readonly quantity: WalletBalanceAmount | null;
  /** Always `null` here: a half-price is the representation this port forbids. */
  readonly price: null;
  readonly value: null;
}

export type WalletBalancePiece = WalletBalancePieceOk | WalletBalancePieceUnreadable;

/** One bucket: free crypto, or pool positions. Each sums in USD on the server. */
export interface WalletBalanceBucketPayload {
  readonly unit: string;
  /** `false` means the bucket total is **partial**. Always present. */
  readonly complete: boolean;
  /** The exact sum of the pieces that could be read. Never a silent zero. */
  readonly total: WalletBalanceAmount;
  readonly pieces: readonly WalletBalancePiece[];
}

/** An exact ratio as the backend publishes it: `numerator / denominator`, both whole. */
export interface WalletBalanceRatioPayload {
  /**
   * The numerator, a decimal **string** of a `bigint`.
   *
   * A string, not a number: at the widest scale this feature works at, the two
   * halves run well past `Number.MAX_SAFE_INTEGER`, so a JSON `number` would
   * arrive already rounded. It is parsed with `BigInt`, never with `Number.parseInt`.
   */
  readonly numerator: string;
  /** The denominator, same contract. Always greater than zero. */
  readonly denominator: string;
}

/** One venue's own annual rate: exact, and as the venue published it. */
export interface WalletBalanceVenueRatePayload {
  /** The exact integer at `decimals` scale, as a decimal string. */
  readonly raw: string;
  readonly decimals: number;
  /**
   * The venue's published figure, **always a fraction of one**: `"0.0412"`.
   *
   * Including for Aave, whose own label upstream is the percentage `"4.1200"`:
   * the backend re-expresses it as a fraction before it travels, so a screen can
   * format every venue with one rule. This file never multiplies by a hundred
   * twice.
   */
  readonly text: string;
}

/**
 * One venue of the combined yield, as the backend sends it.
 *
 * A **union**, for the same reason the pieces are one: "we hold nothing there"
 * and "we could not read it" are different facts, and a screen that can only
 * tell them apart by inspecting a nullable field is a screen one refactor away
 * from drawing them the same. Here `status` decides, and a venue that could not
 * be read can be **typed** as carrying no balance and no rate.
 */
export type WalletBalanceVenuePayload =
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'ok';
      /**
       * Set **only** when the balance is exactly zero: the venue was left out of
       * the weighting. It is its own fact and never drawn as a failure.
       */
      readonly exclusion: 'zero_balance' | null;
      readonly balance: WalletBalanceAmount;
      /** `null` only in the zero-balance case, where no rate is owed. */
      readonly rate: WalletBalanceVenueRatePayload | null;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'unreadable';
      /** Bounded enum from the backend. The screen owns the sentence. */
      readonly reason: string;
      readonly balance: null;
      readonly rate: null;
    };

/**
 * The **one** annual figure for every venue, with the breakdown behind it.
 *
 * `rate` is `null` **exactly** when `complete` is `false`: a weighted mean over
 * the venues that happened to answer is a confident number built from missing
 * data, and the backend refuses to publish one. There is no display string here
 * either — the ratio is exact and the browser rounds it once, at paint.
 */
export interface WalletBalanceYieldPayload {
  readonly complete: boolean;
  readonly rate: WalletBalanceRatioPayload | null;
  readonly venues: readonly WalletBalanceVenuePayload[];
}

/**
 * `investedValue` and nothing else: the only bucket that carries a `yield`.
 *
 * Kept apart from `WalletBalanceBucketPayload` on purpose — a free-wallet bucket
 * that also answered to `yield` would be a shape that has never existed.
 */
export interface WalletBalanceInvestedBucketPayload extends WalletBalanceBucketPayload {
  readonly yield: WalletBalanceYieldPayload;
}

/** The headline, composed by the backend and by nobody else. */
export interface WalletBalanceTotalPayload {
  readonly unit: string;
  /** The conjunction of both buckets: a total is whole only if both halves are. */
  readonly complete: boolean;
  readonly usd: WalletBalanceAmount;
}

export interface WalletBalanceResponse {
  readonly generatedAt: string;
  /** The unit of every amount in the payload: `"USD"`. */
  readonly unit: string;
  /**
   * The free assets that are **not** dollar-pegged: MON, ETH, SOL, BTC.
   *
   * What the "Bitcoin & Crypto" card renders. The backend already left every
   * pegged symbol out of it, so this screen does not filter anything: a USDC
   * filter here would be a second, competing copy of the peg table.
   */
  readonly cryptoValue: WalletBalanceBucketPayload;
  /**
   * Every dollar-pegged piece: free USDC on each chain, plus the pool positions.
   * What the "Dólares digitales" card renders.
   */
  readonly digitalDollarsValue: WalletBalanceBucketPayload;
  /**
   * Pool positions alone — the `digitalDollarsValue` pieces that came from a pool.
   *
   * A **view** inside the bucket above, for the "de dónde sale" drill-down. It is
   * not a third term of `total`, and nothing here adds it to anything.
   */
  readonly investedValue: WalletBalanceInvestedBucketPayload;
  readonly total: WalletBalanceTotalPayload;
}