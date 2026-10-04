/**
 * USE CASE: read the Aave V3 USDC reserve on Monad, and this person's position in
 * it, and answer with numbers a screen can paint.
 *
 * ── The three rules this use case exists to enforce ───────────────────────────
 *
 *   1. **Exact, with the unit stated.** Every amount is the integer the chain
 *      reported plus its decimal text, its decimals and its unit. No float, no
 *      rounding: a position that has been rounded cannot be compared with the
 *      chain afterwards, and a rate that has been rounded is a rate nobody can
 *      reconcile.
 *   2. **Unreadable is not zero.** Each field carries its own state. A reserve
 *      that could not be read says so; a position of zero says zero. They are
 *      different truths and the screen is told which one it has.
 *   3. **The address comes from the database.** The caller contributes a user id
 *      and nothing else, so there is no parameter through which another person's
 *      money could be described.
 *
 * ── Why the supply rate is checked before it is published ──────────────────────
 *
 * A rate that is read from a struct can be one word off, and one word off is a
 * number that looks like a rate: `130.281.299%`. So the response carries
 * `reconciliation`: the supply APR reproduced from the borrow rate, the
 * utilisation and the reserve factor. When the two agree, the number is a rate;
 * when they do not, the screen is told there is a number it should not trust
 * instead of being handed one anyway.
 */
import type { AavePoolReader } from '../../domain/ports/aave-pool-reader';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { WalletStore } from '../../domain/ports/wallet-store';
import { BalanceReadError, type BalanceReadFailure } from '../../domain/portfolio/errors';
import { AAVE_V3_MONAD, A_TOKEN_SYMBOL, ASSET_SYMBOL, MONAD_CHAIN_ID, USDC_DECIMALS } from '../../domain/pool/aaveMonad';
import {
  APR_PERCENT_SCALE,
  ReserveDecodeError,
  aprPercentFromRay,
  aprsReconcile,
  percentLabel,
  reconcileSupplyApr,
  utilisationPercent,
} from '../../domain/pool/reserveData';
import { formatUnits } from '../../domain/portfolio/assets';
import { WalletsUnavailable } from '../portfolio/readPortfolio';

/** Why a field could not be read. Bounded: no provider text crosses this line. */
export type PoolReadFailure = BalanceReadFailure | 'RESERVE_DECODE_FAILED' | 'CONFIG_UNREADABLE';

/** A field, with its own state. The two are not interchangeable. */
export type PoolField<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'unreadable'; readonly reason: PoolReadFailure };

/** An amount, exact, with everything the screen needs to render it. */
export interface PoolAmount {
  /** The integer the chain reported, in the smallest unit. */
  readonly raw: string;
  /** The same value in `unit`, unrounded. `"0"` is a real zero. */
  readonly amount: string;
  readonly decimals: number;
  readonly unit: string;
}

/** A percentage with four decimals, as the text a person reads. */
export type PoolPercent = string;

export interface PoolSnapshot {
  readonly generatedAt: string;
  readonly network: { readonly name: 'monad'; readonly chainId: number; readonly protocol: 'Aave V3' };
  readonly asset: { readonly symbol: string; readonly unit: string; readonly decimals: number };
  readonly reserve: {
    readonly status: 'ok' | 'unreadable';
    readonly reason: PoolReadFailure | null;
  };
  /** The reserve's own scale, read from `getReserveConfigurationData`. */
  readonly reserveDecimals: number;
  readonly apr: {
    readonly supply: PoolField<PoolPercent>;
    readonly borrow: PoolField<PoolPercent>;
  };
  readonly totals: {
    readonly supplied: PoolField<PoolAmount>;
    readonly borrowed: PoolField<PoolAmount>;
    /** What the reserve holds idle: borrowed-from and withdrawable. */
    readonly available: PoolField<PoolAmount>;
    readonly utilisation: PoolField<PoolPercent>;
  };
  readonly lastUpdate: PoolField<{ readonly unix: number; readonly iso: string }>;
  /** The supply APR rebuilt from the borrow rate, the utilisation and the RF. */
  readonly reconciliation: PoolField<{ readonly percent: PoolPercent; readonly agrees: boolean }>;
  readonly position: {
    /** The address the reserve numbers are about. From `rewallet.wallets`, always. */
    readonly address: string;
    /** The receipt token this person holds: `aMonUSDC`, not `aUSDC`. */
    readonly aTokenBalance: PoolField<PoolAmount>;
    /** Free USDC in their wallet: what a deposit would actually move. */
    readonly availableUsdc: PoolField<PoolAmount>;
    /** MON, which is what pays for the gas the deposit needs. */
    readonly gasBalance: PoolField<PoolAmount>;
  };
}

export interface ReadPoolDeps {
  readonly wallets: WalletStore;
  readonly pool: AavePoolReader;
  readonly log?: Logger;
}

export type ReadPool = (userId: string, now?: Date) => Promise<PoolSnapshot>;

const ok = <T>(value: T): PoolField<T> => ({ status: 'ok', value });
const unreadable = <T>(reason: PoolReadFailure): PoolField<T> => ({ status: 'unreadable', reason });

/**
 * The bounded reason for a failure that is not already one.
 *
 * A `ReserveDecodeError` keeps its own name: a reserve that answered and could not
 * be decoded is **ours** to investigate — a struct one word off looks exactly like
 * a struct — and it must never be filed as "the endpoint did not answer".
 */
const reasonOf = (error: unknown): PoolReadFailure => {
  if (error instanceof ReserveDecodeError) return 'RESERVE_DECODE_FAILED';
  return error instanceof BalanceReadError ? error.reason : 'RPC_UNAVAILABLE';
};

const amountOf = (raw: bigint, decimals: number, unit: string): PoolAmount => ({
  raw: raw.toString(),
  amount: formatUnits(raw, decimals),
  decimals,
  unit,
});

/**
 * The person's EVM address, from `rewallet.wallets`.
 *
 * There is one EVM address for every EVM network (see `portfolio/networks.ts`), so
 * the `ethereum` row is the one that signs a deposit on Monad.
 */
const evmAddressFrom = async (wallets: WalletStore, userId: string): Promise<string> => {
  let rows;
  try {
    rows = await wallets.findByUserId(userId);
  } catch (error) {
    throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
  }
  const row = rows.find((candidate) => candidate.chain === 'ethereum');
  if (row === undefined) {
    throw new WalletsUnavailable('this account has no EVM wallet row');
  }
  return row.address;
};

export const readPool = (deps: ReadPoolDeps): ReadPool => {
  const log = deps.log ?? noopLogger;

  return async (userId: string, now: Date = new Date()): Promise<PoolSnapshot> => {
    const address = await evmAddressFrom(deps.wallets, userId);

    /*
     * The reserve and the position are read independently, and neither waits for
     * the other. One of them failing has to leave the other one intact: a screen
     * that cannot show the rate can still show what the person deposited, and a
     * deposit screen must not be disabled because a provider hiccuped.
     */
    const reservePromise = deps.pool.reserveData();
    const configurationPromise = deps.pool.reserveConfiguration().catch((error: unknown) => {
      log.error('pool.configuration_failed', { error, reason: reasonOf(error) });
      return null;
    });
    const aTokenPromise = deps.pool.erc20Balance(AAVE_V3_MONAD.aToken, address);
    const usdcPromise = deps.pool.erc20Balance(AAVE_V3_MONAD.asset, address);
    const gasPromise = deps.pool.nativeBalance(address);

    const [reserveResult, configuration, aTokenResult, usdcResult, gasResult] = await Promise.all([
      reservePromise.then(
        (value) => ({ ok: value } as const),
        (error: unknown) => ({ error } as const),
      ),
      configurationPromise,
      aTokenPromise.then(
        (value) => ({ ok: value } as const),
        (error: unknown) => ({ error } as const),
      ),
      usdcPromise.then(
        (value) => ({ ok: value } as const),
        (error: unknown) => ({ error } as const),
      ),
      gasPromise.then(
        (value) => ({ ok: value } as const),
        (error: unknown) => ({ error } as const),
      ),
    ]);

    /*
     * The decimals come from the reserve when it answers, because "USDC has six"
     * is a fact about the deployment and not about this file. `USDC_DECIMALS` is
     * the fallback for a reserve that could not be read, and it is used to render
     * the position, which is read whatever the reserve does.
     */
    let decimals = USDC_DECIMALS;
    if (configuration !== null && configuration.decimals > 0n && configuration.decimals <= 36n) {
      decimals = Number(configuration.decimals);
    }

    const header = {
      generatedAt: now.toISOString(),
      network: { name: 'monad' as const, chainId: MONAD_CHAIN_ID, protocol: 'Aave V3' as const },
      asset: { symbol: ASSET_SYMBOL, unit: ASSET_SYMBOL, decimals },
    };

    if (!('ok' in reserveResult)) {
      log.error('pool.reserve_failed', { error: reserveResult.error, reason: reasonOf(reserveResult.error) });
      return {
        ...header,
        reserve: { status: 'unreadable', reason: reasonOf(reserveResult.error) },
        reserveDecimals: decimals,
        apr: { supply: unreadable(reasonOf(reserveResult.error)), borrow: unreadable(reasonOf(reserveResult.error)) },
        totals: {
          supplied: unreadable(reasonOf(reserveResult.error)),
          borrowed: unreadable(reasonOf(reserveResult.error)),
          available: unreadable(reasonOf(reserveResult.error)),
          utilisation: unreadable(reasonOf(reserveResult.error)),
        },
        lastUpdate: unreadable(reasonOf(reserveResult.error)),
        reconciliation: unreadable(reasonOf(reserveResult.error)),
        position: {
          address,
          aTokenBalance: 'ok' in aTokenResult ? ok(amountOf(aTokenResult.ok, decimals, A_TOKEN_SYMBOL)) : unreadable(reasonOf(aTokenResult.error)),
          availableUsdc: 'ok' in usdcResult ? ok(amountOf(usdcResult.ok, decimals, ASSET_SYMBOL)) : unreadable(reasonOf(usdcResult.error)),
          gasBalance: 'ok' in gasResult ? ok(amountOf(gasResult.ok, 18, 'MON')) : unreadable(reasonOf(gasResult.error)),
        },
      };
    }

    /*
   * `'ok' in result`, never a truthy check on it: a balance of `0n` is falsy, and
   * a truthy test would report a real zero as a failed read. That is the whole
   * point of this file.
   */
  const reserve = reserveResult.ok;
    const supplyScaled = aprPercentFromRay(reserve.liquidityRate);
    const borrowScaled = aprPercentFromRay(reserve.variableBorrowRate);
    const utilisation =
      utilisationPercent(reserve.totalVariableDebt, reserve.totalAToken) ?? (0n as bigint);
    const utilisationRead = reserve.totalAToken > 0n;

    const available = reserve.totalAToken - reserve.totalStableDebt - reserve.totalVariableDebt;

    const lastUpdateSeconds = Number(reserve.lastUpdateTimestamp);
    const lastUpdate: PoolField<{ readonly unix: number; readonly iso: string }> =
      lastUpdateSeconds > 0 && Number.isSafeInteger(lastUpdateSeconds)
        ? ok<{ readonly unix: number; readonly iso: string }>({
            unix: lastUpdateSeconds,
            iso: new Date(lastUpdateSeconds * 1000).toISOString(),
          })
        : unreadable('RPC_MALFORMED_RESPONSE');

    /*
     * The reconciliation. Without the reserve factor there is nothing to
     * reconcile against, and an unreconcilable rate is reported as such rather
     * than published as a rate.
     */
    const reconciled =
      configuration === null
        ? null
        : reconcileSupplyApr({
            borrowAprScaled: borrowScaled,
            utilisationScaled: utilisation,
            reserveFactorBps: configuration.reserveFactorBps,
          });

    const reconciliation: PoolField<{ percent: PoolPercent; agrees: boolean }> =
      reconciled === null
        ? unreadable('CONFIG_UNREADABLE')
        : ok({
            percent: percentLabel(reconciled),
            agrees: aprsReconcile(supplyScaled, reconciled),
          });

    if (reconciled !== null && !aprsReconcile(supplyScaled, reconciled)) {
      log.error('pool.apr_does_not_reconcile', {
        supply: percentLabel(supplyScaled),
        reconciled: percentLabel(reconciled),
        utilisation: percentLabel(utilisation),
      });
    }

    log.log('pool.read', {
      userId,
      supplyApr: percentLabel(supplyScaled),
      utilisation: percentLabel(utilisation),
    });

    return {
      ...header,
      reserve: { status: 'ok', reason: null },
      reserveDecimals: decimals,
      apr: {
        supply: ok(percentLabel(supplyScaled)),
        borrow: ok(percentLabel(borrowScaled)),
      },
      totals: {
        supplied: ok(amountOf(reserve.totalAToken, decimals, ASSET_SYMBOL)),
        borrowed: ok(amountOf(reserve.totalVariableDebt, decimals, ASSET_SYMBOL)),
        available: ok(amountOf(available, decimals, ASSET_SYMBOL)),
        utilisation: utilisationRead ? ok(percentLabel(utilisation)) : unreadable('RPC_MALFORMED_RESPONSE'),
      },
      lastUpdate,
      reconciliation,
      position: {
        address,
        aTokenBalance: 'ok' in aTokenResult ? ok(amountOf(aTokenResult.ok, decimals, A_TOKEN_SYMBOL)) : unreadable(reasonOf(aTokenResult.error)),
        availableUsdc: 'ok' in usdcResult ? ok(amountOf(usdcResult.ok, decimals, ASSET_SYMBOL)) : unreadable(reasonOf(usdcResult.error)),
        gasBalance: 'ok' in gasResult ? ok(amountOf(gasResult.ok, 18, 'MON')) : unreadable(reasonOf(gasResult.error)),
      },
    };
  };
};

/** The scale every percentage in this response uses: one unit is `0.0001%`. */
export const POOL_PERCENT_SCALE = APR_PERCENT_SCALE;
