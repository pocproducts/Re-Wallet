/**
 * USE CASE: **the whole wallet balance**, composed by the backend.
 *
 * > Total wallet balance = (Bitcoin y Crypto, valued at market price)
 * >                      + (Investments, what is in the pools).
 *
 * Two buckets, each summed in USD, and a headline this use case adds up. **The
 * front adds nothing**: if a browser has to add two numbers, it can get them
 * wrong, and the two numbers it was given did not come from the same arithmetic.
 *
 * ── The three buckets, and why they partition the answer ────────────────────
 *
 * | bucket               | what is in it                                          | where each piece is read from |
 * |----------------------|--------------------------------------------------------|-------------------------------|
 * | `cryptoValue`        | the **free, non-pegged** assets (MON, ETH, SOL, BTC)   | `readPortfolio`               |
 * | `digitalDollarsValue`| every **dollar-pegged** piece: free USDC + positions   | `readPortfolio` + `readPool`  |
 * | `investedValue`      | every **pool position**, on its own, for "de dónde sale"| `readPool`                   |
 *
 * ── Why a dollar-pegged asset is not "crypto" ───────────────────────────────
 *
 * The split is the peg table's, not a hardcoded symbol: `isDigitalDollar` in
 * `src/domain/price/digitalDollar.ts` decides, which is the same predicate that
 * decides that a pegged dollar costs no oracle call. One table, two questions,
 * one answer — and a new pegged symbol cannot reach `cryptoValue` without someone
 * editing that table, which is the point.
 *
 * **There is no front filter behind this.** Filtering `cryptoValue` in the
 * browser would put the subtraction back in the client, and this use case exists
 * so the client has nothing to subtract: every number on screen is a sum taken
 * here, in `bigint`.
 *
 * ── Why the three buckets are not three sums ────────────────────────────────
 *
 * `cryptoValue` and `digitalDollarsValue` are **disjoint and exhaustive** of the
 * wallet, and the headline is their sum, taken once:
 *
 *     total = cryptoValue + digitalDollarsValue
 *
 * `investedValue` is a **view** inside `digitalDollarsValue`, not a third term:
 * the Aave position is one piece that is built once and shared, so
 * `digitalDollarsValue.total` and `investedValue.total` can never disagree — they
 * are the same `bigint` seen from two questions. Adding it again would count
 * every deposited dollar twice.
 *
 * "A dollar that is in a pool is not in the wallet" is not a convention here, it
 * is where each number comes from, and it is structural rather than promised:
 *
 *  - the **free** side is the portfolio's `assets[]`, which are exactly what the
 *    wallet address holds, read with `eth_getBalance` / `balanceOf`;
 *  - the **invested** side is exactly one thing: a **position**. A position is a
 *    receipt-token balance — `aTokenBalance` on Aave, the vault's **shares mint**
 *    on Kamino Earn — and each of those is a different contract / mint from the
 *    underlying USDC, so a deposited dollar is not in `assets[]` and the two
 *    lists have no member in common.
 *
 * A venue is **one more piece** in that second list, not a new bucket. The
 * composition below files every venue's position into `investedValue` and into
 * `digitalDollarsValue` as the **same object**, so a second venue cannot change
 * what a bucket means or add a term to the headline: it shows up in the
 * drill-down and in the sum, labelled with its chain and its protocol, and the
 * person still sees one number.
 *
 * The pool read also reports `availableUsdc` — the **same free balance**, read a
 * second time so the deposit screen can say what is spendable. It is
 * deliberately **not** counted in `investedValue`: counting it would be the
 * exact double count this use case exists to prevent. The same applies to the
 * pool's `gasBalance`, which is the very same MON the portfolio already counted.
 *
 * `test/interface/walletBalance.test.ts` asserts the disjointness on a person
 * who holds the same asset on both sides, which is the case where a double count
 * would actually show up.
 *
 * ── The yield: ONE figure, on `investedValue` ───────────────────────────────
 *
 * The person sees one number for what their deposits earn, not one per pool:
 *
 * ```
 *   combined = Σ(balanceᵢ x rateᵢ) / Σ(balanceᵢ)
 * ```
 *
 * A weighted mean, never an average of the rates, and it lives on
 * `investedValue.yield` beside the pieces it describes — together with the
 * per-venue breakdown, so a screen can explain the figure from this object
 * rather than recomputing it in a language whose arithmetic is not `bigint`.
 *
 * Three rules it inherits from the rest of this file:
 *
 *  - **exact**: the ratio travels as two whole integers and is never divided
 *    here; the single rounding happens at paint.
 *  - **unreadable is not zero, and one hole is no answer at all**: a venue whose
 *    balance or rate could not be read makes the whole figure `complete: false`
 *    with `rate: null`. A weighted mean over the venues that answered is a
 *    confident number computed from missing data.
 *  - **Aave's reconciliation keeps applying**: a supply APR that cannot be
 *    reproduced from `borrow x utilisation x (1 - RF)` contributes no rate, so
 *    the combined figure refuses it too instead of publishing it in a place with
 *    no `agrees` flag beside it.
 *
 * ── EL SALDO DE ORIGEN DE CADA VENUE: `depositable`, y por qué no se suma ───
 *
 * El botón de depósito vive en la fila del venue, así que cada fila tiene que
 * decir **cuánto se puede depositar ahí**. Eso es el USDC libre de la cadena del
 * venue: la pieza `dollars.<cadena>.USDC` que el portfolio ya leyó y ya contó del
 * lado libre. `depositable` es por lo tanto una **referencia** a ese número, y
 * entra en la respuesta sin entrar en ninguna suma: no hay un `bucketOf` que lo
 * toque, ni un `sumExact` que lo sume, ni un `complete` que lo considere. Sumarlo
 * sería el doble conteo exacto que este caso de uso existe para volver imposible,
 * y la regla está escrita en los dos archivos donde vive: `aaveVenue` para
 * `availableUsdc` y `gasBalance`, `depositableOf` acá.
 *
 * `depositable` es una unión discriminada igual que el resto: `ok` con el importe
 * exacto — **un cero legítimo es `ok` con `raw: '0'`, no una falla** — o
 * `unreadable` con un motivo acotado. Un saldo de origen ilegible **no habilita el
 * botón**: `0` es una cifra, y publicar una cifra que no se conoce es exactamente
 * el defecto.
 *
 * ── `depositReady`: SI EL VENUE PUEDE RECIBIR EL DEPÓSITO, Y POR QUÉ NO ────
 *
 * `depositable` dice cuánto hay; `depositReady` dice si se puede. El botón de la
 * fila lee los dos, y ninguno de los dos alcanza por sí solo: hay un venue con
 * plata libre y sin mensaje construido, y un venue con mensaje construido y sin
 * plata. Por eso no es un `boolean`: un `false` pelado obliga a la pantalla a
 * inventar la explicación, y una explicación inventada es la forma corta de que
 * alguien firme algo que va a fallar. `not_ready` trae un motivo acotado y **la
 * frase para pintar tal cual**.
 *
 * El valor sale de la MISMA fuente de verdad que dice que `prepareDepositKamino`
 * no ejecuta, y por eso vive acá, al lado de la tabla de venues, y no escrita a
 * mano venue por venue: `KAMINO_DEPOSIT_NOT_EXECUTABLE` es el valor de
 * `completion` para Kamino, y `test/interface/walletBalance.test.ts` ata las dos
 * respuestas para que no puedan contradecirse.
 *
 * Aave no necesita el mismo cuidado porque su depósito **sí** se ejecuta, y esa
 * asimetría es un dato, no una excepción: la tabla dice "listo" para el venue que
 * puede y "no listo, con motivo" para el que no.
 *
 * ── How a piece is valued: a peg, or a feed ─────────────────────────────────
 *
 *  - **A digital dollar is valued at exactly 1, by definition, and no oracle is
 *    consulted for it.** `USDC/USD` on Monad has a measured 2.7-hour heartbeat,
 *    so routing the headline through it would make the app's main number depend
 *    on a feed that is stale by the design of its own asset. The answer carries
 *    `price.source: 'peg'` with no pair and no timestamp, so the absence of an
 *    oracle is visible rather than claimed.
 *  - **Everything else is valued at the Chainlink feed**, read at the feed's own
 *    decimals — 8 or 18, never assumed — and both channels of a pair pinned to
 *    **one block** so the cross-check compares one instant of the world.
 *
 * ── Arithmetic: exact, `bigint`, never rounded ──────────────────────────────
 *
 * A value is the exact product of a raw quantity and a raw price, at the sum of
 * their decimals, and the sum of a bucket is taken at the **largest** scale among
 * its members — scaling up only, because scaling down is a division, and a
 * division is a rounding. `src/domain/price/valuation.ts` owns that, and it has
 * no `Number` and no division in it.
 *
 * ── The honesty rule, extended ──────────────────────────────────────────────
 *
 * `readDigitalDollars` states it: **a total that silently omits what it could
 * not read is a lie**. A wrong number can be checked; a confident omission
 * cannot. So the partial sum is still returned — throwing it away would throw
 * away what we do know — and it is returned **beside** a statement that it is
 * partial, which is always present and cannot be forgotten:
 *
 *  - **per piece**: `status` and a bounded `reason`. Never a `0` where a price or
 *    an amount is missing: `0` means zero, absence is absence.
 *  - **per bucket**: `complete`, `false` when any piece is unreadable.
 *  - **on the total**: `complete`, the conjunction of the two.
 *
 * **Zero is not unreadable.** An empty wallet and an unreadable one are different
 * truths, and it is structural: the piece is a discriminated union, so an `ok`
 * always carries a value and an `unreadable` never carries one that could be
 * mistaken for a zero. A `0n` is also falsy, so this file tests `'ok' in piece`
 * and never truthiness.
 *
 * ── A chain with no wallet contributes nothing, and says so by being absent ──
 *
 * `no_wallet` is **not** an unreadable piece: it is a *known* fact that this
 * person holds nothing on that chain, so there is nothing to read and nothing to
 * omit. Emitting a piece per asset of a chain nobody has a wallet for would make
 * the bucket permanently incomplete for every person without a Solana wallet —
 * "incomplete" would then mean "has no second wallet", and a screen that says
 * "we could not read your Solana balance" would be **false**. Note the
 * difference from `readDigitalDollars`, which files `NO_WALLET` as an unreadable
 * component: there the question was a total of digital dollars the person asked
 * for, and a missing chain was a gap in it. Here the question is what the person
 * holds, and holding nothing is an answer.
 *
 * ── Why nothing in the request is read ─────────────────────────────────────
 *
 * The caller contributes a user id and nothing else. The addresses come from
 * `rewallet.wallets` for the user the cookie proved, exactly as `readPortfolio`
 * and `readPool` resolve them. There is no parameter through which another
 * person's money could be described, and no chain this use case cannot reach.
 *
 * ── Why this composes reads instead of making them ─────────────────────────
 *
 * It calls `readPortfolio` and `readPool` and adds up what they answer. It opens
 * no connection, reads no chain and owns no balance reader: a third set of RPC
 * calls for the same numbers would be a third thing that can disagree with the
 * screens that already show them. The only thing it adds is the **price**, which
 * arrives through an injected port — never a direct feed call — so the whole
 * composition is exercisable with no network, which the README names as the
 * reason the architecture is shaped this way.
 */
import type { ReadPortfolio, PortfolioAsset, PortfolioFailureReason } from './readPortfolio';
import { WalletsUnavailable } from './readPortfolio';
import type { ReadPool, PoolReadFailure } from '../pool/readPool';
import type {
  ReadKaminoEarnPosition,
  KaminoPositionFailure,
} from './readKaminoEarnPosition';
import { ASSETS_BY_CHAIN } from '../../domain/portfolio/assets';
import type { PortfolioChain } from '../../domain/portfolio/networks';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { PricedAsset, PriceFeed, PriceFeedFailure } from '../../domain/ports/price-feed';
import { isDigitalDollar } from '../../domain/price/digitalDollar';
import { APR_PERCENT_SCALE } from '../../domain/pool/reserveData';
import {
  combineYields,
  rateFromFractionText,
  rateFromPercentText,
  type CombinedYield,
  type VenueDepositReadiness,
  type VenueDepositable,
  type YieldRate,
  type YieldVenue,
  type YieldVenueFailure,
} from '../../domain/yield/combinedYield';
import {
  exactIntegerOf,
  PEG_PRICE,
  peggedValueOf,
  pricedAssetOf,
  quantityOf,
  sumExact,
  usdValueOf,
  USD_UNIT,
  type PriceDetail,
  type Quantity,
  type ScaledValue,
  type UsdAmount,
} from '../../domain/price/valuation';

/** The key of the Aave position: the receipt token, valued at the peg. */
export const AAVE_V3_USDC_MONAD_KEY = 'invest.aave_v3_usdc_monad';

/**
 * The key of the Kamino Earn position on Solana.
 *
 * A **second venue**, and the reason the composition above needed no new bucket:
 * `investedValue` was never "the Aave position", it was "every position", and a
 * venue is one more piece in it. The card total does not change in code either —
 * it already sums across chains — so the person still sees one number.
 */
export const KAMINO_EARN_USDC_SOLANA_KEY = 'invest.kamino_earn_usdc_solana';

/**
 * LO QUE KAMINO **NO** PUEDE EJECUTAR TODAVÍA: la fuente de verdad de `not_ready`.
 *
 * ── Por qué esto no es un flag escrito a mano ────────────────────────────────
 *
 * El botón de la fila se dibuja a partir de esto, y el depósito se construye en
 * `prepareDepositKamino`, que publica `completion.executes: false`. Si las dos
 * cosas vivieran separadas, el día que las dos instrucciones del farm se
 * construyeran alguien habilitaría **una** de las dos —y se olvidaría de la
 * otra—, y el resultado sería un botón que dibuja y una transacción que falla en
 * la red principal. Ese es el defecto exacto que este valor existe para volver
 * imposible.
 *
 * ── Cómo se ata sin que sea la misma línea escrita dos veces ─────────────────
 *
 * No se puede leer el `completion` de `prepareDepositKamino` desde acá sin que
 * ese endpoint exponga el estado; lo que se hace, en cambio, es **atarlo con una
 * prueba** que corre el caso de uso de verdad y compara las dos respuestas
 * (`test/interface/walletBalance.test.ts`). Dos banderas de estado en dos
 * archivos, sin ninguna prueba que las cruce, es exactamente lo que no hay acá.
 *
 * `missingSteps` son las dos instrucciones del programa Farms que este
 * repositorio no construye: crear la cuenta de farm y stakear las shares, que
 * es donde rinde. El nombre, el programa y el motivo de cada una los publica
 * `completion.missingSteps`, en el mismo orden y con el mismo número.
 */
export const KAMINO_DEPOSIT_NOT_EXECUTABLE: VenueDepositReadiness = {
  status: 'not_ready',
  reason: 'DEPOSIT_INSTRUCTIONS_UNVERIFIED',
  missingSteps: 2,
  message:
    'Todavía no podés depositar en Kamino: el depósito se arma con las instrucciones que pudimos verificar, ' +
    'pero faltan dos del programa de farms, que es donde las shares rinden. No lo dibujamos porque un botón ' +
    'que falla en la red principal es peor que un botón que todavía no existe.',
};

/**
 * SI UN VENUE PUEDE RECIBIR UN DEPÓSITO, Y POR QUÉ NO SI NO PUEDE.
 *
 * La tabla es **cerrada y con clave de venue**, no un `if` suelto: un `"kamino"`
 * escrito acá al lado de un `"aave"` escrito en otro archivo es la forma de que
 * la respuesta y el depósito se desincronicen sin que nada falle. Acá ambos salen
 * del mismo nombre de venue, y una prueba los compara.
 *
 * Lo que esta función **no** decide: cuánto hay para depositar. Eso es
 * `depositableOf`, y depende de la cadena, no del venue.
 */
const depositReadyOf = (venueKey: string): VenueDepositReadiness => {
  if (venueKey === KAMINO_EARN_USDC_SOLANA_KEY) return KAMINO_DEPOSIT_NOT_EXECUTABLE;

  /*
   * El resto de los venues que este caso de uso conoce puede recibir un
   * depósito: `prepareDeposit` arma approve + deposit y los dos se ejecutan.
   * `ready` no lleva nada más a propósito —un campo extra al lado del estado es
   * un estado más que puede desincronizarse de él—.
   */
  return { status: 'ready' };
};

/**
 * Why a piece of a bucket could not be valued. Bounded: no provider's own words
 * ever cross this line, and a screen can only render a name.
 *
 *  - the price feed's six names, from `price-feed.ts`;
 *  - the pool read's names, from `readPool.ts`;
 *  - the portfolio read's names, from `readPortfolio.ts`;
 *  - `PRICE_UNAVAILABLE` — **ours**: the asset's own catalog lists an asset that
 *    is neither a digital dollar nor one this project can price. A valuation
 *    invented for it would be a fabrication, and a refusal is cheaper than that.
 */
export type BalanceFailure =
  | PriceFeedFailure
  | PoolReadFailure
  | PortfolioFailureReason
  | KaminoPositionFailure
  | 'PRICE_UNAVAILABLE';

/**
 * A price that is **not** a feed price and **not** a peg: what one vault share is
 * worth, as Kamino publishes it.
 *
 * It is a separate member rather than a widened `PriceDetail` because the two
 * things are not the same kind of claim, and a screen should be able to tell them
 * apart at a glance:
 *
 *  - a Chainlink price is a **feed round**, with a pair and a timestamp, and this
 *    repository re-derives it from two channels on one block;
 *  - the peg is a **definition** — one dollar, no round, no pair;
 *  - the share price is **Kamino's own figure**, computed off chain from reserve
 *    state this application cannot see. It is not corroborated and it does not
 *    pretend to be: it says so in `source`, and it is why the vault's position
 *    is labelled with its protocol rather than folded into "crypto".
 *
 * The value is still exact: shares x price, in `bigint`, at the sum of the two
 * scales (`readKaminoEarnPosition`).
 */
export interface VaultSharePrice {
  readonly usd: string;
  readonly raw: string;
  readonly decimals: number;
  readonly source: 'kamino_share_price';
  readonly pair: null;
  readonly updatedAt: null;
  readonly crossChecked: null;
}

/**
 * How any piece of a bucket was valued.
 *
 * `null` is allowed **only** on an `ok` piece whose quantity is exactly zero: no
 * price was consulted because `0 x p = 0` for every price, so a Kamino outage
 * cannot open a hole in the balance of somebody who holds nothing. Every other
 * `ok` carries the price that produced its value.
 */
export type PiecePrice = (PriceDetail | VaultSharePrice) | null;

/**
 * One contributing piece, with the state of its own read.
 *
 * The union is the whole design: `status: 'ok'` always carries a `value` and a
 * `price`, and `status: 'unreadable'` always carries a `value: null`. There is no
 * state in which a piece has a number and a reason, and no way to write the
 * arithmetic that forgets to check.
 */
export type BalancePiece =
  | {
      /** Stable identity of the piece, e.g. `crypto.monad.USDC`. */
      readonly key: string;
      readonly label: string;
      readonly source: 'free_wallet' | 'pool_position';
      /** The chain the piece was read on. `null` for a position, which is one. */
      readonly chain: PortfolioChain | null;
      readonly status: 'ok';
      readonly reason: null;
      /** What is held, exact, at the asset's own decimals. */
      readonly quantity: Quantity;
      /** How it was valued. `source: 'peg'` means no oracle was consulted. */
      readonly price: PiecePrice;
      /** The exact USD value, at `value.decimals`. Never rounded. */
      readonly value: UsdAmount;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly source: 'free_wallet' | 'pool_position';
      readonly chain: PortfolioChain | null;
      readonly status: 'unreadable';
      readonly reason: BalanceFailure;
      /**
       * What is held, when the quantity could be read but its **price** could
       * not. It is kept because it is useful and it is true; it is never summed,
       * because a quantity without a price has no dollar value.
       */
      readonly quantity: Quantity | null;
      /** `null` when the price is what is missing. */
      readonly price: PriceDetail | null;
      readonly value: null;
    };

/**
 * One bucket, with the state of the pieces it is made of.
 *
 * `total` is never `unreadable`-shaped and carries no status flag of its own,
 * for the same reason `readDigitalDollars` does not give its total one: it would
 * have to lie in one direction or the other. What it states is true — *this is
 * what was readable* — and `complete` is the statement of whether that is the
 * whole truth. `complete` is always present.
 */
export interface ValueBucket {
  readonly unit: typeof USD_UNIT;
  readonly complete: boolean;
  /** The exact sum of the pieces that could be read. Never a silent zero. */
  readonly total: UsdAmount;
  readonly pieces: readonly BalancePiece[];
}

/**
 * The headline, **computed here and nowhere else**.
 *
 * It is the exact sum of both buckets, and `complete` is the conjunction of the
 * two: a total is the whole truth only if both halves of it are.
 */
export interface WalletBalanceTotal {
  readonly unit: typeof USD_UNIT;
  readonly complete: boolean;
  readonly usd: UsdAmount;
}

/**
 * `investedValue`: the positions **and the one yield figure they add up to.**
 *
 * The yield is a field of this bucket and not of the response's root, because it
 * describes the positions and nothing else: the same rule that keeps
 * `investedValue` a *view* of `digitalDollarsValue` rather than a third term of
 * the headline keeps a rate out of the headline too. It travels with the
 * breakdown it was computed from, so a screen explains the number out of this
 * object instead of recomputing it — and recomputing a weighted mean in
 * JavaScript is how a venue holding three quarters of the balance ends up
 * contributing one half of the rate.
 *
 * `complete` on the bucket is about the **values**; `yield.complete` is about the
 * **rate**, and the two fail independently on purpose: a Kamino APY this code
 * cannot read leaves the invested total exact and makes the rate incomplete.
 */
export interface InvestedBucket extends ValueBucket {
  readonly yield: CombinedYield;
}

export interface WalletBalance {
  readonly generatedAt: string;
  readonly unit: typeof USD_UNIT;
  /**
   * The free assets that are **not** dollar-pegged: MON, ETH, SOL, BTC.
   *
   * This is what the "Bitcoin & Crypto" card renders, and it is the reason this
   * bucket exists in this shape: USDC is not crypto here, whatever the chain it
   * sits on, so no pegged symbol may ever appear in `pieces`.
   */
  readonly cryptoValue: ValueBucket;
  /**
   * Every dollar-pegged piece: the free USDC of each chain, plus the pool
   * positions. This is what the "Dólares digitales" card renders.
   */
  readonly digitalDollarsValue: ValueBucket;
  /**
   * Pool positions alone: the `digitalDollarsValue` pieces that came from a pool.
   *
   * It is a **view**, not a third term of the total, and it exists for the
   * "de dónde sale" drill-down: it answers "how much of my dollars is deposited?"
   * without re-summing anything the reader already has.
   *
   * `yield` is the **one** annual figure for all of them:
   * `Σ(balance × rate) / Σ(balance)`, exact, with the per-venue breakdown beside
   * it. It is never a mean of the rates.
   */
  readonly investedValue: InvestedBucket;
  readonly total: WalletBalanceTotal;
}

export interface ReadWalletBalanceDeps {
  readonly readPortfolio: ReadPortfolio;
  readonly readPool: ReadPool;
  /**
   * The second venue, on Solana.
   *
   * **Optional**, and that is the whole of the compatibility story: a deployment
   * that does not wire it composes exactly the two buckets it composed before,
   * with the Aave position unchanged. A second venue is a new piece in a bucket
   * that was always "every position", not a new bucket and not a new term in the
   * total.
   */
  readonly readKaminoEarn?: ReadKaminoEarnPosition;
  /** Injected, never reached for directly: the tests run with no network. */
  readonly prices: PriceFeed;
  readonly log?: Logger;
}

export type ReadWalletBalance = (userId: string, now?: Date) => Promise<WalletBalance>;

/** The chain name a screen can read, next to the figure it is about. */
const CHAIN_LABELS: Readonly<Record<PortfolioChain, string>> = {
  monad: 'Monad',
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum One',
  optimism: 'OP Mainnet',
  polygon: 'Polygon',
  solana: 'Solana',
};

const chainLabel = (chain: PortfolioChain): string => CHAIN_LABELS[chain];

/**
 * The key of a free piece, and the first half of it is the bucket it belongs to.
 *
 * `crypto.<chain>.<SYMBOL>` for a non-pegged asset, `dollars.<chain>.<SYMBOL>`
 * for a pegged one. The prefix is not decoration: it is what makes the split
 * checkable, because a test can read the bucket off a key without trusting the
 * arithmetic that produced it.
 */
const freeKey = (chain: PortfolioChain, symbol: string): string =>
  isDigitalDollar(symbol) ? `dollars.${chain}.${symbol}` : `crypto.${chain}.${symbol}`;

/**
 * A free piece together with the symbol it was read for.
 *
 * The symbol is carried alongside because the bucket split is made on it: a
 * `BalancePiece` deliberately says nothing about what asset it holds — its `key`
 * and `label` are for the screen — so without this the split would have to be
 * re-derived by parsing a human label back into an identity.
 */
interface FreePiece {
  readonly symbol: string;
  readonly piece: BalancePiece;
}

export const readWalletBalance = (deps: ReadWalletBalanceDeps): ReadWalletBalance => {
  const log = deps.log ?? noopLogger;

  return async (userId: string, now: Date = new Date()): Promise<WalletBalance> => {
    /*
     * The two reads that already exist, side by side and settled independently.
     * Settling each into `{ok}|{error}` is what lets a failing chain leave the
     * rest of the answer standing, exactly as in `readDigitalDollars`.
     */
    const [portfolioResult, poolResult] = await Promise.all([
      deps.readPortfolio(userId, now).then(
        (value) => ({ ok: value } as const),
        (error: unknown) => ({ error } as const),
      ),
      deps.readPool(userId, now).then(
        (value) => ({ ok: value } as const),
        (error: unknown) => ({ error } as const),
      ),
    ]);

    /*
     * The wallet rows are the door to both reads. Without them there is no address
     * for **any** piece, so there is no partial truth either: a balance of zero
     * here would be a lie about somebody's account, and `WalletsUnavailable` —
     * which the route turns into `502 WALLETS_UNAVAILABLE` — is the honest answer.
     */
    for (const result of [portfolioResult, poolResult]) {
      if (!('ok' in result) && result.error instanceof WalletsUnavailable) throw result.error;
    }
    if (!('ok' in portfolioResult)) throw portfolioResult.error;
    if (!('ok' in poolResult)) throw poolResult.error;

    const portfolio = portfolioResult.ok;
    const snapshot = poolResult.ok;

    /*
     * Which symbols need a price, asked for **once each** before anything is
     * valued: one MON balance and one MON price, whatever the number of pieces.
     *
     * A digital dollar is not in this set — that is the whole point of it, and a
     * test asserts the price port is never called for USDC.
     */
    const wanted = new Set<PricedAsset>();
    for (const chain of portfolio.chains) {
      if (chain.status !== 'ok') continue;
      for (const asset of chain.assets) {
        if (isDigitalDollar(asset.symbol)) continue;
        // An asset with no amount has nothing to value: asking its feed would
        // spend an oracle call on a figure nobody is going to see.
        if (asset.raw === null) continue;
        const priced = pricedAssetOf(asset.symbol);
        if (priced !== null) wanted.add(priced);
      }
    }

    const priceByAsset = new Map<PricedAsset, PriceFeedFailure | PriceDetail>();

    /*
     * The second venue, **started here** and settled at the venue section below.
     *
     * It does not depend on the prices: it reads its own shares on chain and its
     * own share price from Kamino, and the price phase cannot change a single one
     * of its figures. Awaiting it after the prices made a balance page pay for
     * the Kamino position *after* the oracle round trips it never had to wait for,
     * so the two now overlap instead of queueing.
     *
     * Started, not awaited: nothing below reads it, so the only thing this buys
     * is the overlap — the venue is still settled, and still filed, in the same
     * place and with the same rules as before.
     */
    const kaminoRead =
      deps.readKaminoEarn === undefined ? null : kaminoVenue(log, deps.readKaminoEarn, userId, now);

    await Promise.all(
      [...wanted].map(async (asset) => {
        /*
         * Settled, like the other two reads: an adapter that **throws** instead
         * of honouring its own union is a bug in the adapter, and the answer to
         * a bug in one adapter is a refusal for that asset — not a 500 that takes
         * the person's whole balance away because one price could not be had.
         */
        const result = await deps.prices.usdPrice(asset).then(
          (value) => value,
          (error: unknown) => {
            log.error('wallet_balance.price_read_threw', { asset, error });
            return { status: 'unreadable', reason: 'RPC_UNAVAILABLE' } as const;
          },
        );
        /*
         * Projected into this application's own `PriceDetail` rather than passed
         * through: the answer states what was used to value the piece, and the
         * asset's identity is already the piece's key and label.
         */
        priceByAsset.set(
          asset,
          result.status === 'ok'
            ? {
                usd: result.value.usd,
                raw: result.value.raw,
                decimals: result.value.decimals,
                source: 'chainlink',
                pair: result.value.pair,
                updatedAt: result.value.updatedAt,
                crossChecked: result.value.crossChecked,
              }
            : result.reason,
        );
      }),
    );

    /* ── The free balances, read by the portfolio, and then split ─────────── */

    /*
     * Every free piece is built once and then filed under the peg table: a
     * dollar-pegged asset goes to the digital dollars, and everything else — MON,
     * ETH, SOL, BTC — goes to crypto. The classification is the **piece's own
     * symbol**, taken from the catalog that declared it, so a bucket can never
     * claim a piece it does not hold.
     */
    const freePieces: FreePiece[] = [];

    for (const chain of portfolio.chains) {
      /*
       * No wallet on this chain is a **known** zero, not a missing read: the
       * person holds nothing there, so no piece is emitted and the bucket is not
       * made incomplete. See the header for why this differs from
       * `readDigitalDollars`.
       */
      if (chain.status === 'no_wallet') {
        log.log('wallet_balance.no_wallet', { userId, chain: chain.chain });
        continue;
      }

      if (chain.status === 'error') {
        // The chain failed, so **every** asset its own catalog declares failed
        // with it. One piece per declared asset, so the list says what could not
        // be read rather than only that "monad failed".
        for (const spec of ASSETS_BY_CHAIN[chain.chain]) {
          freePieces.push({
            symbol: spec.symbol,
            piece: {
              key: freeKey(chain.chain, spec.symbol),
              label: `${spec.symbol} en ${chainLabel(chain.chain)}`,
              source: 'free_wallet',
              chain: chain.chain,
              status: 'unreadable',
              reason: chain.error.reason,
              quantity: null,
              price: null,
              value: null,
            },
          });
        }
        continue;
      }

      freePieces.push(...valueFreeAssets(log, chain.chain, chain.address, chain.assets, priceByAsset));
    }

    /*
     * THE SPLIT. `cryptoValue` takes what the peg table does not name, and
     * `digitalDollarsValue` takes exactly what it names — so **no USDC, in any
     * form, can appear under "Bitcoin & Crypto"**: not a value, not a quantity,
     * not an unreadable row standing in for one.
     */
    const cryptoPieces = freePieces.filter((entry) => !isDigitalDollar(entry.symbol)).map((entry) => entry.piece);
    const freeDollarPieces = freePieces.filter((entry) => isDigitalDollar(entry.symbol)).map((entry) => entry.piece);

    /*
     * EL SALDO DE ORIGEN, POR CADENA. Un índice sobre las piezas libres que ya
     * se leyeron, para que cada venue halle la suya **sin una segunda lectura**:
     * el mismo `dollars.<cadena>.USDC` que ya está contado del lado libre, usado
     * por el otro lado de la misma respuesta.
     *
     * Se indexa **por cadena y por símbolo**, y no por `venue`: la regla que
     * evita el cruce es que un venue sólo puede ver la plata de su propia cadena,
     * y eso se vuelve imposible de romper cuando el índice se arma por cadena en
     * vez de por destino. Un venue nuevo toma su cadena y no puede tomar la de
     * otro.
     */
    const freeDollarByChain = new Map<string, FreePiece>();
    for (const entry of freePieces) {
      if (entry.piece.chain === null) continue;
      if (freeDollarByChain.has(entry.piece.chain)) continue;
      if (!isDigitalDollar(entry.symbol)) continue;
      freeDollarByChain.set(entry.piece.chain, entry);
    }

    /* ── The invested bucket: the venues, and only those ──────────────────── */

    /*
     * Every position is built **once**, into one list. The same objects are then
     * filed under `investedValue` (the "de dónde sale" view) and under
     * `digitalDollarsValue` (the whole pegged figure), which is what makes those
     * two totals incapable of disagreeing.
     *
     * The list is a **list of venues**, not one venue spelled out: Aave on Monad,
     * and Kamino Earn on Solana. Adding the second one is why nothing below had
     * to change — a bucket that was always "every position" takes another one.
     */
    /*
     * The Kamino venue is read **once** — its pieces and its rate come out of the
     * same read, so a screen cannot show a position from one instant and a yield
     * from another. It was started alongside the price phase above; here it is
     * simply awaited.
     */
    const kamino = kaminoRead === null ? null : await kaminoRead;

    const investedPieces: BalancePiece[] = [
      ...aaveVenue(log, snapshot, priceByAsset),
      ...(kamino === null ? [] : kamino.pieces),
    ];

    /*
     * THE YIELD. One figure for every venue above, and the rates are gathered
     * beside the pieces rather than inside them, because a **rate** is not a
     * value: it never goes into a bucket's total, and a piece that cannot state
     * its rate stays `ok` with its exact value.
     *
     * Aave's rate is gated on its own reconciliation (below); Kamino's is the APY
     * it published. Neither venue is trusted to supply its own rate as part of
     * being priced, and a venue that is not wired contributes no venue at all.
     */
    const rates = new Map<string, VenueRate>();
    rates.set(AAVE_V3_USDC_MONAD_KEY, aaveSupplyRate(snapshot));
    if (kamino !== null && kamino.rate !== null) rates.set(KAMINO_EARN_USDC_SOLANA_KEY, kamino.rate);
    const yieldFigure = combineYields(
      investedPieces.map((piece) =>
        venueOf(piece, rates.get(piece.key), depositableOf(freeDollarByChain, piece.chain)),
      ),
    );

    /*
     * Exactly one thing is read from the pool, and it is the **receipt token**.
     *
     * `availableUsdc` and `gasBalance` are deliberately ignored: both are the
     * *same money* the portfolio already counted on the free side (the wallet's
     * USDC, and the wallet's MON). Counting either here is the double count this
     * bucket exists to be unable to produce. `aaveVenue` is where that choice is
     * written down, and it is the same choice for every venue: only the claim is
     * counted, never the money that claim could be redeemed for.
     */

    const cryptoValue = bucketOf(cryptoPieces);
    const investedValue: InvestedBucket = { ...bucketOf(investedPieces), yield: yieldFigure };
    /*
     * The digital dollars: the free pegged balances plus the position. The
     * position is the **same piece** already in `investedPieces`, not a second
     * read of it, so this is a partition of the two lists above and never an
     * addition of them.
     */
    const digitalDollarsValue = bucketOf([...freeDollarPieces, ...investedPieces]);

    /*
     * The headline. `cryptoValue + digitalDollarsValue`, in `bigint`, at the
     * widest scale of all of them — one addition, no rounding, and **here**, on
     * the server. `investedValue` is deliberately absent: its pieces are already
     * in `digitalDollarsValue`, and counting them again would inflate the total
     * by exactly what the person deposited.
     */
    const total = sumExact([
      ...readableValues(cryptoPieces),
      ...readableValues(freeDollarPieces),
      ...readableValues(investedPieces),
    ]);
    const complete = cryptoValue.complete && digitalDollarsValue.complete;

    log.log('wallet_balance.read', {
      userId,
      cryptoPieces: cryptoPieces.length,
      digitalDollarPieces: digitalDollarsValue.pieces.length,
      investedPieces: investedPieces.length,
      complete,
      yieldComplete: yieldFigure.complete,
      total: total.raw,
      totalDecimals: total.decimals,
    });
    if (!complete) {
      log.error('wallet_balance.incomplete', {
        userId,
        missing: [...cryptoPieces, ...digitalDollarsValue.pieces]
          .filter((piece) => piece.status === 'unreadable')
          .map((piece) => ({ key: piece.key, reason: piece.reason })),
        partialTotal: total.raw,
      });
    }

    return {
      generatedAt: now.toISOString(),
      unit: USD_UNIT,
      cryptoValue,
      digitalDollarsValue,
      investedValue,
      total: { unit: USD_UNIT, complete, usd: total },
    };
  };
};

/**
 * VENUE: **Aave V3 · USDC on Monad.** The receipt token, valued at the peg.
 *
 * `availableUsdc` and `gasBalance` are ignored here, and that is the venue's
 * contract: only the **claim** on deposited dollars is counted, never the money
 * that claim could be redeemed for. Counting either would be the double count
 * this bucket exists to be unable to produce.
 *
 * `0n` is a real position of zero and travels as `ok` — the truthiness trap is
 * why the branch tests `'ok' in position` and not `position.value`.
 */
const aaveVenue = (
  log: Logger,
  snapshot: Awaited<ReturnType<ReadPool>>,
  priceByAsset: ReadonlyMap<PricedAsset, PriceFeedFailure | PriceDetail>,
): BalancePiece[] => {
  const identity = {
    key: AAVE_V3_USDC_MONAD_KEY,
    label: 'Aave V3 · USDC en Monad',
    source: 'pool_position' as const,
    chain: 'monad' as const,
  };

  const position = snapshot.position.aTokenBalance;
  if (position.status === 'unreadable') {
    return [{ ...identity, status: 'unreadable', reason: position.reason, quantity: null, price: null, value: null }];
  }

  return [
    valuePosition(log, {
      ...identity,
      // The reserve's own symbol, read by `readPool` from the deployment — never
      // a symbol typed in here.
      symbol: snapshot.asset.symbol,
      raw: exactIntegerOf(position.value.raw),
      decimals: position.value.decimals,
      unit: position.value.unit,
      priceByAsset,
    }),
  ];
};

/**
 * A venue's rate, or the bounded reason it does not exist.
 *
 * `rate` and `reason` are mutually exclusive by construction: a venue either
 * states the rate it is being weighted by, or it states why there is none. There
 * is no third state in which a venue contributes an unstated `0`.
 */
export interface VenueRate {
  readonly rate: YieldRate | null;
  readonly reason: YieldVenueFailure | null;
}

/**
 * The scale every percentage `readPool` publishes uses, as a digit count.
 *
 * `APR_PERCENT_SCALE` is `10 000` — one unit is `0.0001 %` — so it is four
 * fractional digits. It is **derived from the constant** rather than typed in, so
 * the day the pool changes its percentage scale this conversion follows it instead
 * of quietly reporting every rate a hundred times too large.
 */
const AAVE_PERCENT_DIGITS = APR_PERCENT_SCALE.toString().length - 1;

/**
 * Aave's supply APR, as a fraction — but **only** if it reconciles.
 *
 * `readPool` already refuses to publish a rate that cannot be reproduced from
 * `borrow x utilisation x (1 - RF)`: a supply APR read one word off a
 * misaligned struct looks exactly like a rate, and it is `130.281.299%` when it
 * is wrong. That discipline is **inherited, not relaxed**: the combined yield is
 * a second consumer of the same number, and a consumer that ignores the check
 * would publish the misaligned figure in a place with no `agrees` flag beside it.
 *
 * So a supply APR that does not reconcile contributes no rate at all, and its
 * venue is `unreadable` with `APR_NOT_RECONCILED` — which makes the combined
 * figure incomplete rather than confidently wrong.
 */
const aaveSupplyRate = (snapshot: Awaited<ReturnType<ReadPool>>): VenueRate => {
  if (snapshot.apr.supply.status === 'unreadable') {
    return { rate: null, reason: snapshot.apr.supply.reason };
  }

  /*
   * Without the reserve factor there is nothing to reconcile against, so the rate
   * cannot be trusted in the same way a reconciled one is — and `CONFIG_UNREADABLE`
   * is already the pool's own name for that state.
   */
  if (snapshot.reconciliation.status === 'unreadable') {
    return { rate: null, reason: snapshot.reconciliation.reason };
  }

  if (!snapshot.reconciliation.value.agrees) {
    return { rate: null, reason: 'APR_NOT_RECONCILED' };
  }

  const rate = rateFromPercentText(snapshot.apr.supply.value, AAVE_PERCENT_DIGITS);
  if (rate === null) {
    // The reserve answered with a percentage this code cannot read exactly.
    return { rate: null, reason: 'RPC_MALFORMED_RESPONSE' };
  }

  return { rate, reason: null };
};

/**
 * EL SALDO DE ORIGEN DE UN VENUE: el USDC libre de **su** cadena.
 *
 * ── El defecto que evita: un venue que muestra la plata de otro ─────────────
 *
 * Un modal de depósito que dice "tenés $40 para depositar" y manda una
 * autorización sobre una cadena donde no hay un centavo es la forma más barata
 * de perder la confianza de alguien. El cruce no se evita "recordándolo": se
 * evita porque la función **no puede** ver otro saldo — recibe el índice de
 * cadenas y toma `piece.chain`, la cadena del propio venue. No hay un parámetro
 * por el cual un venue pueda pedir la plata de otro, y por lo tanto no hay un
 * estado en que la pida.
 *
 * ── El otro defecto: un `0` donde no se pudo leer ──────────────────────────
 *
 * Un saldo de origen ilegible **no habilita el botón**. Un `0` sí se publicaría
 * como `ok` si el USDC libre de esa cadena es legítimamente cero, porque una
 * persona sin USDC libre es un hecho y el botón puede existir con tope cero; pero
 * una cadena que no se pudo leer no es un cero, es una incógnita, y vestida de
 * cero se convierte en "no tenés nada" — que es falso, y además es la cifra sobre
 * la que alguien firmaría.
 *
 * ── Sin segunda lectura ────────────────────────────────────────────────────
 *
 * Se resuelve sobre `freeDollarByChain`, que se armó desde las piezas libres que
 * ya se leyeron para el lado libre del balance. Ningún venue vuelve a preguntarle
 * a la cadena lo que el portfolio ya sabe: una segunda lectura es una segunda
 * fuente que puede discrepar de la cifra que la persona está mirando al lado.
 */
const depositableOf = (
  freeDollarByChain: ReadonlyMap<string, FreePiece>,
  chain: PortfolioChain | null,
): VenueDepositable => {
  if (chain === null) return { status: 'unreadable', reason: 'FREE_BALANCE_ABSENT' };

  const entry = freeDollarByChain.get(chain);
  if (entry === undefined) return { status: 'unreadable', reason: 'FREE_BALANCE_ABSENT' };
  if (entry.piece.status === 'unreadable') return { status: 'unreadable', reason: entry.piece.reason };

  /*
   * `piece.quantity` no es opcional en un `ok`, y no se toca el `raw`: el importe
   * publicado es el entero exacto que la cadena reportó, con sus decimales y su
   * unidad. Un saldo de cero sale acá como `raw: '0'` — `ok`, no `unreadable`.
   */
  return { status: 'ok', amount: entry.piece.quantity };
};

/**
 * One invested piece as a venue of the combined yield.
 *
 * Two facts decide the outcome, and they are kept apart on purpose:
 *
 *  - **the balance could not be read** ⇒ the venue is `unreadable`, and no rate
 *    can rescue it: a rate without an amount cannot be weighted by anything.
 *  - **the balance is exactly zero** ⇒ the venue is excluded, because `0 x p = 0`
 *    for every finite `p` and a zero position cannot move a weighted mean. That
 *    is an **exclusion**, and it is stated as one: it is a different fact from
 *    "we could not read it", and the screen is told which it is. Note that the
 *    rate is not even required here — a zero venue is excluded whether or not its
 *    rate could be read.
 *  - **anything else** ⇒ the venue needs its rate, and a venue without one is
 *    `unreadable` for the rate's own reason.
 *
 * `depositable` se transporta en los tres casos y **no participa de ninguno de
 * ellos**: un venue cuya posición no se pudo leer igual puede tener plata libre
 * para depositar, y `combineYields` lo publica sin usarlo en la media ponderada.
 *
 * `chain` y `depositReady` viajan por el mismo motivo y con la misma regla: son
 * hechos **de la fila**, no del número. `chain` porque una fila que no dice en qué
 * red está obliga a la pantalla a deducirlo del nombre —y deducir una red de una
 * cadena de texto es como se llega a mandar plata a la red equivocada—, y
 * `depositReady` porque un venue puede tener plata libre y no poder recibir el
 * depósito todavía. Que el mismo `venueOf` los arme para los tres estados es lo
 * que hace que no exista un estado de fila en el que uno de los dos falte.
 */
const venueOf = (
  piece: BalancePiece,
  venueRate: VenueRate | undefined,
  depositable: VenueDepositable,
): YieldVenue => {
  if (piece.status === 'unreadable') {
    return {
      key: piece.key,
      label: piece.label,
      status: 'unreadable',
      reason: piece.reason,
      chain: piece.chain,
      balance: null,
      rate: null,
      depositable,
      depositReady: depositReadyOf(piece.key),
    };
  }

  /*
   * `BigInt(raw) === 0n`, never a truthiness test on the raw string: this is the
   * position of `0n`, and a venue that holds nothing must come out as `ok` with a
   * zero rather than as a hole.
   */
  if (BigInt(piece.value.raw) === 0n) {
    return {
      key: piece.key,
      label: piece.label,
      status: 'ok',
      exclusion: 'zero_balance',
      chain: piece.chain,
      balance: piece.value,
      rate: venueRate?.rate ?? null,
      depositable,
      depositReady: depositReadyOf(piece.key),
    };
  }

  if (venueRate?.rate == null) {
    return {
      key: piece.key,
      label: piece.label,
      status: 'unreadable',
      reason: venueRate?.reason ?? 'RPC_UNAVAILABLE',
      chain: piece.chain,
      balance: null,
      rate: null,
      depositable,
      depositReady: depositReadyOf(piece.key),
    };
  }

  return {
    key: piece.key,
    label: piece.label,
    status: 'ok',
    exclusion: null,
    chain: piece.chain,
    balance: piece.value,
    rate: venueRate.rate,
    depositable,
    depositReady: depositReadyOf(piece.key),
  };
};

/**
 * VENUE: **Kamino Earn · USDC on Solana.** The vault's shares, at the share price
 * Kamino publishes.
 *
 * ── Why this venue is not valued by the peg table ──────────────────────────
 *
 * Its quantity is **not** USDC: it is the vault's share count, which is a claim
 * on USDC and not USDC itself. Multiplying it by one would report somebody's
 * deposit at its face value and silently discard every unit of accrued interest,
 * so this piece carries its own price — the one Kamino publishes — and its value
 * is `shares x price`, taken in `bigint` at the sum of the two scales.
 *
 * ── What a venue may and may not decide ───────────────────────────────────
 *
 * It may not decide what a failure means. Each of the three states below carries
 * the reason the read gave, and the composition only ever files it: `no_wallet` is
 * **no piece at all** (this person holds nothing on Solana, which is a fact and
 * not a hole — the same rule the chains themselves follow), and every other state
 * is one piece that is `ok` with a value or `unreadable` without one.
 *
 * ── What comes back besides the pieces: the venue's rate ───────────────────
 *
 * The APY Kamino publishes rides alongside the position, because both come out
 * of one read and a screen must not be able to show a position from one instant
 * and a yield from another. `rate` is `null` for a person with no Solana wallet —
 * there is no venue at all — and for a position whose APY could not be read, which
 * is `reason`. It is never `0`: an unreadable rate is not a rate of nothing.
 */
const kaminoVenue = async (
  log: Logger,
  read: ReadKaminoEarnPosition,
  userId: string,
  now: Date,
): Promise<{ readonly pieces: BalancePiece[]; readonly rate: VenueRate | null }> => {
  const identity = {
    key: KAMINO_EARN_USDC_SOLANA_KEY,
    // Labelled with its chain **and** its protocol, which is what makes the
    // drill-down honest: this is USDC on Solana, in a Kamino Earn vault, and it
    // is worth what Kamino says a share is worth.
    label: 'Kamino Earn · USDC en Solana',
    source: 'pool_position' as const,
    chain: 'solana' as const,
  };

  const position = await read(userId, now).then(
    (value) => ({ ok: value } as const),
    // An adapter that throws instead of honouring its own union is a bug in the
    // adapter, and the answer to that is a refusal for this venue — not a 500
    // that takes somebody's whole balance away because one venue hiccuped.
    (error: unknown) => {
      log.error('wallet_balance.kamino_threw', { userId, error });
      return { error } as const;
    },
  );

  if (!('ok' in position)) {
    return {
      pieces: [
        { ...identity, status: 'unreadable', reason: 'RPC_UNAVAILABLE', quantity: null, price: null, value: null },
      ],
      rate: { rate: null, reason: 'RPC_UNAVAILABLE' },
    };
  }

  // A known absence is not a venue: no piece, and no rate to weigh.
  if (position.ok.status === 'no_wallet') return { pieces: [], rate: null };

  if (position.ok.status === 'unreadable') {
    const unread = position.ok.shares;
    return {
      pieces: [
        {
          ...identity,
          status: 'unreadable',
          reason: position.ok.reason,
          // The share count is kept when it was read: it is true and useful. It is
          // never summed, because a quantity without a price has no dollar value.
          quantity: unread === null ? null : quantityOf(unread.raw, unread.decimals, unread.symbol),
          price: null,
          value: null,
        },
      ],
      rate: { rate: null, reason: position.ok.reason },
    };
  }

  /*
   * The venue's rate: the APY exactly as Kamino published it, re-read off its own
   * digits rather than carried across from the feed's `bigint`. A published
   * decimal string is what the screen prints, and re-deriving the scale from the
   * text is what keeps this the same figure the adapter read.
   */
  const rate: VenueRate =
    position.ok.apyReason !== null
      ? { rate: null, reason: position.ok.apyReason }
      : {
          rate:
            position.ok.apy === null
              ? null
              : rateFromFractionText(position.ok.apy.text) ?? {
                  // The adapter already parsed these digits exactly, so reaching
                  // here means the two parsers disagree — which is ours to
                  // investigate, and not a rate of zero.
                  raw: position.ok.apy.raw,
                  decimals: position.ok.apy.decimals,
                  text: position.ok.apy.text,
                },
          reason: position.ok.apyReason,
        };

  // `status: 'ok'` — the share count is never absent here: zero is a count.
  const { shares, price, value } = position.ok;
  const held = quantityOf(shares.raw, shares.decimals, shares.symbol);
  return {
    pieces: [
      {
        ...identity,
        status: 'ok',
        reason: null,
        quantity: held,
        price:
          price === null
            ? null
            : {
                usd: price.usd,
                raw: price.raw.toString(),
                decimals: price.decimals,
                source: 'kamino_share_price',
                pair: null,
                updatedAt: null,
                crossChecked: null,
              },
        value,
      },
    ],
    rate,
  };
};

/** The exact values of the pieces that could be read. The others contribute absence. */
const readableValues = (pieces: readonly BalancePiece[]): ScaledValue[] =>
  pieces.filter((piece) => piece.status === 'ok').map((piece) => scaledOf(piece.value));

/** A `UsdAmount` back into the `bigint` shape the sum works on. Exact. */
const scaledOf = (value: UsdAmount): ScaledValue => ({ raw: BigInt(value.raw), decimals: value.decimals });

/** The bucket around a list of pieces: its exact sum, and whether it is whole. */
const bucketOf = (pieces: readonly BalancePiece[]): ValueBucket => ({
  unit: USD_UNIT,
  complete: pieces.every((piece) => piece.status === 'ok'),
  total: sumExact(readableValues(pieces)),
  pieces,
});

/**
 * One free asset from the portfolio, valued.
 *
 * A digital dollar takes the peg; anything else takes the feed, and an unreadable
 * price produces an unreadable piece with the reason attached — never a zero, and
 * never the quantity dressed up as a dollar value.
 *
 * An asset the portfolio itself could not read is a hole of the same kind, and it
 * keeps the **portfolio's own** reason rather than one of ours: the chain named
 * which read failed, and inventing a second reason for the same fact would give
 * two answers to one question.
 */
const valueFreeAssets = (
  log: Logger,
  chain: PortfolioChain,
  address: string,
  assets: readonly PortfolioAsset[],
  priceByAsset: ReadonlyMap<PricedAsset, PriceFeedFailure | PriceDetail>,
): FreePiece[] =>
  assets.map((asset) => {
    const key = freeKey(chain, asset.symbol);
    const label = `${asset.symbol} en ${chainLabel(chain)}`;

    if (asset.raw === null) {
      const reason = asset.error?.reason ?? 'RPC_MALFORMED_RESPONSE';
      log.error('wallet_balance.asset_unreadable', { chain, address, symbol: asset.symbol, reason });
      return {
        symbol: asset.symbol,
        piece: {
          key,
          label,
          source: 'free_wallet' as const,
          chain,
          status: 'unreadable' as const,
          reason,
          quantity: null,
          price: null,
          value: null,
        },
      };
    }

    const raw = exactIntegerOf(asset.raw);

    if (raw === null) {
      // The chain answered something that is not an integer. Ours to investigate.
      log.error('wallet_balance.raw_not_an_integer', { chain, address, symbol: asset.symbol });
      return {
        symbol: asset.symbol,
        piece: {
          key,
          label,
          source: 'free_wallet' as const,
          chain,
          status: 'unreadable' as const,
          reason: 'RPC_MALFORMED_RESPONSE' as const,
          quantity: null,
          price: null,
          value: null,
        },
      };
    }

    return {
      symbol: asset.symbol,
      piece: valuePosition(log, {
        key,
        label,
        source: 'free_wallet',
        chain,
        symbol: asset.symbol,
        raw,
        decimals: asset.decimals,
        unit: asset.unit,
        priceByAsset,
      }),
    };
  });

/**
 * The shared body of both buckets: a quantity, and what it is worth.
 *
 * Everything that decides a price happens here, so the free side and the
 * invested side cannot drift apart in how they are valued — the pool position is
 * a digital dollar valued exactly the way the free USDC balance is, by
 * definition and not by an oracle.
 */
const valuePosition = (log: Logger, input: {
  readonly key: string;
  readonly label: string;
  readonly source: 'free_wallet' | 'pool_position';
  readonly chain: PortfolioChain;
  readonly symbol: string;
  /** `null` when what the chain reported was not an integer at all. */
  readonly raw: bigint | null;
  readonly decimals: number;
  readonly unit: string;
  readonly priceByAsset: ReadonlyMap<PricedAsset, PriceFeedFailure | PriceDetail>;
}): BalancePiece => {
  const identity = { key: input.key, label: input.label, source: input.source, chain: input.chain };

  if (input.raw === null) {
    /*
     * The chain answered something that is not an integer. Ours to investigate,
     * and it is never read as a zero: `0` means the person holds nothing, and
     * this means we do not know what they hold.
     */
    log.error('wallet_balance.raw_not_an_integer', { chain: input.chain, symbol: input.symbol, unit: input.unit });
    return { ...identity, status: 'unreadable', reason: 'RPC_MALFORMED_RESPONSE', quantity: null, price: null, value: null };
  }

  const quantity = quantityOf(input.raw, input.decimals, input.unit);

  if (isDigitalDollar(input.symbol)) {
    // No oracle. Not "an oracle that happened to agree": none is asked.
    return {
      ...identity,
      status: 'ok',
      reason: null,
      quantity,
      price: PEG_PRICE,
      value: sumExact([peggedValueOf(input.raw, input.decimals)]),
    };
  }

  const asset = pricedAssetOf(input.symbol);
  if (asset === null) {
    return { ...identity, status: 'unreadable', reason: 'PRICE_UNAVAILABLE', quantity, price: null, value: null };
  }

  const price = input.priceByAsset.get(asset);
  if (price === undefined || typeof price === 'string') {
    return {
      ...identity,
      status: 'unreadable',
      reason: price ?? 'RPC_UNAVAILABLE',
      quantity,
      // The price existed as a claim but not as a value, so it is not published:
      // half a price is the representation this port exists to prevent.
      price: null,
      value: null,
    };
  }

  return {
    ...identity,
    status: 'ok',
    reason: null,
    quantity,
    price,
    value: sumExact([usdValueOf(input.raw, input.decimals, BigInt(price.raw), price.decimals)]),
  };
};
