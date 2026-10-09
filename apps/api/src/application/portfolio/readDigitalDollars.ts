/**
 * USE CASE: this person's **total digital dollars** — every USDC-denominated piece
 * they hold, summed exactly, each piece carrying its own read state.
 *
 * ── What this is now, relative to the three buckets ────────────────────────
 *
 * **This use case spans two buckets, so it is neither of them.**
 *
 * The pieces summed here are the **free USDC** (which `readWalletBalance` files
 * under `digitalDollarsValue`) and the **Aave position** (also under
 * `digitalDollarsValue`, and separately visible as the `investedValue` view), so
 * this total is exactly that one bucket:
 *
 * - it is **not** `cryptoValue` — it leaves out MON, ETH and SOL entirely, and
 *   `cryptoValue` by construction holds no pegged symbol at all;
 * - it is **not** `investedValue` — it includes money that is not in a pool;
 * - it is **not** `total` — adding it to the rest of the wallet would be
 *   composing on the client, which is what `readWalletBalance` now does on the
 *   server.
 *
 * **`/api/wallet-balance` serves this number on its own response and this app
 * does not call this route.** The "Dólares digitales" card paints
 * `digitalDollarsValue` out of that single response: one fetch, one composition,
 * one figure. Calling both would put the same number in two responses that a
 * later change could let disagree, which is the duplicate source of truth this
 * project is trying not to have. The route is left mounted — removing an
 * endpoint underneath another consumer is a breaking change nobody asked for.
 *
 * ── The decision that makes this possible ─────────────────────────────────────
 *
 * Every component summed here is a dollar peg:
 *
 *   - free `USDC` on each chain the portfolio reads, and
 *   - the Aave `aMonUSDC` balance, which is USDC **principal plus accrued
 *     interest** because the aToken rebases.
 *
 * Same unit, same decimals, so they add with no price between them. There is no
 * price feed in this project and none is invented here: `MON`, `ETH` and `SOL`
 * are not digital dollars, valuing them is a separate task, and a hardcoded rate
 * would be a worse lie than their absence.
 *
 * ── The rule this use case exists to enforce ──────────────────────────────────
 *
 * **A total that silently omits what it could not read is a lie**, and it is the
 * most dangerous thing this product could ship — more dangerous than a wrong
 * number, because a wrong number can be checked. So the total is never a number
 * alone: it is a number **plus** a completeness statement. If any component is
 * unreadable the partial sum is still returned — throwing it away would throw
 * away what we do know — and `complete` is `false`. It never rounds down to a
 * confident lie.
 *
 * **Zero is not unreadable.** An empty wallet and an unreadable one are different
 * truths, and the screen is told which one it has. That is the same distinction
 * `readPool` and `readPortfolio` already draw, and it is structural here: the
 * component type is a union, so `status: 'ok'` always carries a value and
 * `unreadable` never carries one that could be mistaken for a zero.
 *
 * ── Why nothing in the request is read ───────────────────────────────────────
 *
 * The caller contributes a user id and nothing else. The addresses come from
 * `rewallet.wallets` for that user, exactly as `readPortfolio` and `readPool`
 * resolve them, so there is no parameter through which another person's money
 * could be described. "We ignored the parameter you sent" is a much better
 * property than "we validated the parameter you sent".
 *
 * ── Why this composes reads instead of making them ───────────────────────────
 *
 * It calls `readPortfolio` and `readPool` and adds up what they answer. It opens
 * no connection, reads no chain and owns no balance reader: a third set of RPC
 * calls for the same two numbers would be a third thing that can disagree with
 * the two screens that already show them.
 */
import type { ReadPortfolio, PortfolioFailureReason } from './readPortfolio';
import { WalletsUnavailable } from './readPortfolio';
import type { ReadPool, PoolAmount, PoolReadFailure } from '../pool/readPool';
import { ASSETS_BY_CHAIN } from '../../domain/portfolio/assets';
import type { PortfolioChain } from '../../domain/portfolio/networks';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import { USDC_DECIMALS } from '../../domain/pool/aaveMonad';

/**
 * The unit of the total.
 *
 * Free USDC and `aMonUSDC` are the same unit — the aToken rebases into its
 * underlying — so one symbol names the whole answer.
 */
export const DIGITAL_DOLLAR_UNIT = 'USDC';

/** The scale of that unit. Six, for both the underlying and the receipt token. */
export const DIGITAL_DOLLARS_DECIMALS = USDC_DECIMALS;

/** Why a component is `unreadable`. Bounded: no provider text crosses this line. */
export type DigitalDollarFailure =
  | PoolReadFailure
  /**
   * The portfolio could not read this chain's own USDC. Its reason is carried
   * through as it is: the read failed once, and every layer above reports the
   * same fact rather than translating it into a second, vaguer one.
   */
  | PortfolioFailureReason
  /** The wallet rows said this person has no address for that component. */
  | 'NO_WALLET'
  /** The piece is not exactly expressible in the total's unit. Never rounded. */
  | 'UNIT_MISMATCH'
  /** The portfolio answered without the asset its own catalog declares. Ours. */
  | 'WALLETS_UNAVAILABLE';

/** One contributing piece, with the state of its own read. */
export type DigitalDollarComponent =
  | {
      readonly key: string;
      readonly label: string;
      readonly source: 'free_wallet' | 'yield';
      readonly status: 'ok';
      readonly reason: null;
      readonly value: PoolAmount;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly source: 'free_wallet' | 'yield';
      readonly status: 'unreadable';
      readonly reason: DigitalDollarFailure;
      readonly value: null;
    };

export interface DigitalDollars {
  readonly generatedAt: string;
  /** The unit every amount and the total are denominated in. */
  readonly unit: string;
  /**
   * The exact sum of the components that **could** be read, in the smallest unit.
   *
   * It is never `unreadable`-shaped and never carries its own status flag: what it
   * states is true — "this is what was readable" — and whether that is the whole
   * truth is the next field, which is always present and cannot be forgotten.
   */
  readonly total: PoolAmount;
  /**
   * Whether every component was read.
   *
   * `false` means this total is **partial** and the screen must say which part is
   * missing. It is never omitted, and it is never absent because everything
   * failed: an all-unreadable answer is still a complete answer about what is
   * known, with a total of `0` that carries `complete: false`.
   */
  readonly complete: boolean;
  /** Every contributing piece, in a fixed order, each with its own read state. */
  readonly components: readonly DigitalDollarComponent[];
}

export interface ReadDigitalDollarsDeps {
  readonly readPortfolio: ReadPortfolio;
  readonly readPool: ReadPool;
  readonly log?: Logger;
}

export type ReadDigitalDollars = (userId: string, now?: Date) => Promise<DigitalDollars>;

const ok = (key: string, label: string, source: 'free_wallet' | 'yield', raw: bigint): DigitalDollarComponent => ({
  key,
  label,
  source,
  status: 'ok',
  reason: null,
  value: { raw: raw.toString(), amount: formatUnitsInTotalScale(raw), decimals: DIGITAL_DOLLARS_DECIMALS, unit: DIGITAL_DOLLAR_UNIT },
});

const unreadable = (
  key: string,
  label: string,
  source: 'free_wallet' | 'yield',
  reason: DigitalDollarFailure,
): DigitalDollarComponent => ({ key, label, source, status: 'unreadable', reason, value: null });

/**
 * The decimal text of `raw` at the total's scale.
 *
 * String surgery on a `bigint`, the same way `formatUnits` does it: a `number`
 * division loses digits past the 17th significant figure, and a total that has
 * lost digits cannot be checked against the two screens that already show the
 * parts.
 */
function formatUnitsInTotalScale(raw: bigint): string {
  const digits = raw.toString().padStart(DIGITAL_DOLLARS_DECIMALS + 1, '0');
  const integer = digits.slice(0, digits.length - DIGITAL_DOLLARS_DECIMALS);
  const fraction = digits
    .slice(digits.length - DIGITAL_DOLLARS_DECIMALS)
    .replace(/0+$/, '');
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

/**
 * `raw` re-expressed at `to` decimals, or `null` when that would lose value.
 *
 * Adding two integers of different scales means rescaling one of them, and a
 * rescale that has to round is a rescale that invents a number. When it cannot be
 * done exactly the piece is reported unreadable instead — a component we cannot
 * add honestly is a component we do not have.
 */
const alignToTotalScale = (raw: bigint, from: number): bigint | null => {
  if (from === DIGITAL_DOLLARS_DECIMALS) return raw;
  if (from > DIGITAL_DOLLARS_DECIMALS) {
    const factor = 10n ** BigInt(from - DIGITAL_DOLLARS_DECIMALS);
    const exact = raw / factor;
    return exact * factor === raw ? exact : null;
  }
  return raw * 10n ** BigInt(DIGITAL_DOLLARS_DECIMALS - from);
};

/** A raw amount that is not an integer string is not an amount. */
const rawOf = (raw: string): bigint | null => {
  try {
    const value = BigInt(raw);
    return value < 0n ? null : value;
  } catch {
    return null;
  }
};

export const readDigitalDollars = (deps: ReadDigitalDollarsDeps): ReadDigitalDollars => {
  const log = deps.log ?? noopLogger;

  return async (userId: string, now: Date = new Date()): Promise<DigitalDollars> => {
    /*
     * The two reads that already exist, side by side and settled independently.
     *
     * `Promise.all` on the raw promises would let one rejection destroy the other
     * one's answer; settling each into `{ok}|{error}` is what lets a failing
     * chain leave the rest of the total standing.
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
     * The wallet rows are the door to both reads. If either could not open it
     * there is no address for **any** component, so there is not even a partial
     * truth to report: a total of zero here would be a lie about somebody's
     * account, and `502 WALLETS_UNAVAILABLE` is the honest answer. Same rule, and
     * same error, as `/api/portfolio` and `/api/pool`.
     */
    for (const result of [portfolioResult, poolResult]) {
      if (!('ok' in result) && result.error instanceof WalletsUnavailable) throw result.error;
    }
    if (!('ok' in portfolioResult)) throw portfolioResult.error;
    if (!('ok' in poolResult)) throw poolResult.error;

    const portfolio = portfolioResult.ok;
    const snapshot = poolResult.ok;
    const components: DigitalDollarComponent[] = [];

    /*
     * The free balances, one component per chain the portfolio reads **in USDC**.
     *
     * A chain whose catalog does not declare USDC contributes no component at
     * all — that is the unit rule, not a silent omission: a piece that is not
     * denominated in dollars is not a piece of this total.
     *
     * A chain whose USDC **could not be read** contributes an unreadable
     * component with the reason the portfolio gave, which is the same hole at
     * the next level up: the USDC is there and the figure is not.
     */
    for (const chain of portfolio.chains) {
      const catalog = ASSETS_BY_CHAIN[chain.chain];
      if (!catalog.some((spec) => spec.symbol === DIGITAL_DOLLAR_UNIT)) continue;

      const key = `free_usdc_${chain.chain}`;
      const label = `USDC en ${chainLabel(chain.chain)}`;

      if (chain.status === 'no_wallet') {
        components.push(unreadable(key, label, 'free_wallet', 'NO_WALLET'));
        continue;
      }
      if (chain.status === 'error') {
        components.push(unreadable(key, label, 'free_wallet', chain.error.reason));
        continue;
      }

      const asset = chain.assets.find((candidate) => candidate.symbol === DIGITAL_DOLLAR_UNIT);
      if (asset === undefined) {
        log.error('digital_dollars.usdc_asset_missing', { chain: chain.chain, address: chain.address });
        components.push(unreadable(key, label, 'free_wallet', 'RPC_MALFORMED_RESPONSE'));
        continue;
      }

      const raw = asset.raw === null ? null : rawOf(asset.raw);
      const aligned = raw === null ? null : alignToTotalScale(raw, asset.decimals);
      components.push(
        raw === null || aligned === null
          ? unreadable(
              key,
              label,
              'free_wallet',
              // The portfolio's own reason when the read itself failed: one
              // fact, one reason, however many layers report it.
              asset.raw === null ? asset.error.reason : aligned === null ? 'UNIT_MISMATCH' : 'RPC_MALFORMED_RESPONSE',
            )
          : ok(key, label, 'free_wallet', aligned),
      );
    }

    /*
     * The yield position. The aToken rebases, so its balance is already USDC
     * principal plus accrued interest — it is added at face value, never at a
     * price, and never at a "share of the reserve".
     */
    const aToken = snapshot.position.aTokenBalance;
    if (aToken.status === 'unreadable') {
      components.push(unreadable('aave_v3_usdc_monad', 'Aave V3 · USDC en Monad', 'yield', aToken.reason));
    } else {
      const raw = rawOf(aToken.value.raw);
      const aligned = raw === null ? null : alignToTotalScale(raw, aToken.value.decimals);
      components.push(
        raw === null || aligned === null
          ? unreadable('aave_v3_usdc_monad', 'Aave V3 · USDC en Monad', 'yield', aligned === null ? 'UNIT_MISMATCH' : 'RPC_MALFORMED_RESPONSE')
          : ok('aave_v3_usdc_monad', 'Aave V3 · USDC en Monad', 'yield', aligned),
      );
    }

    /*
     * The sum, in `bigint`, of **only what was read**. An unreadable component
     * contributes nothing and is not counted as a zero: it contributes its
     * absence, which is what `complete: false` says out loud.
     *
     * The component union makes this total safe to compute: `'ok' in component`
     * is what is tested, never the truthiness of a value, because `0n` is falsy
     * and a truthy test would report a real zero balance as a missing one.
     */
    let sum = 0n;
    for (const component of components) {
      if (component.status === 'ok') sum += BigInt(component.value.raw);
    }

    const complete = components.length > 0 && components.every((component) => component.status === 'ok');
    const missing = components.filter((component) => component.status === 'unreadable');

    log.log('digital_dollars.read', {
      userId,
      components: components.length,
      missing: missing.length,
      complete,
      total: sum.toString(),
    });
    if (!complete) {
      log.error('digital_dollars.incomplete', {
        userId,
        missing: missing.map((component) => ({ key: component.key, reason: component.reason })),
        partialTotal: sum.toString(),
      });
    }

    return {
      generatedAt: now.toISOString(),
      unit: DIGITAL_DOLLAR_UNIT,
      total: {
        raw: sum.toString(),
        amount: formatUnitsInTotalScale(sum),
        decimals: DIGITAL_DOLLARS_DECIMALS,
        unit: DIGITAL_DOLLAR_UNIT,
      },
      complete,
      components,
    };
  };
};

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
