/**
 * USE CASE: this person's position in one Kamino Earn vault on Solana.
 *
 * ── The hybrid, and why it is split this way ────────────────────────────────
 *
 * **We read the shares ourselves, on chain. We ask Kamino only for the price.**
 *
 * | question | who answers it | how |
 * |---|---|---|
 * | *how much* — how many shares | **this code**, on chain | the vault's `sharesMint` token accounts + the farm's staked state |
 * | *what it is worth* | **Kamino**, off chain | `GET /kvaults/vaults/{vault}/stats` → `sharePrice` |
 *
 * The split is the design, not a shortcut:
 *
 *  - the shares are an **ordinary SPL mint**, so they are layout-light and exactly
 *    verifiable with standard JSON-RPC — no indexer, no provider in the middle;
 *  - the share price **cannot** be computed here. It is `netAUM / sharesIssued`, and
 *    ~99.5 % of this vault's assets sit in klend cTokens rather than in the vault's
 *    own token account, so anything derived from that account alone is out by
 *    roughly 200×. Kamino's own docs add that a figure derived from reserve state
 *    that can lag "can only over-estimate". So it is asked for, never
 *    reimplemented.
 *
 * **"How much" is ours and verifiable. "What it is worth" is Kamino's and
 * unverifiable by us.** Everything below follows from those two sentences.
 *
 * ── The trap this use case is built around ───────────────────────────────────
 *
 * > "If the vault has a farm attached, shares are automatically staked in the farm
 * > and **are not visible in the user's wallet**." — Kamino Earn docs
 *
 * So the shares are read from the **shares mint**, which exists either way, and
 * the farm is read **as well**. A farm that cannot be read does not make the
 * position smaller — it makes it **incomplete**, which is a different and honest
 * answer, and the reason it is a different answer is in the last section.
 *
 * ── The arithmetic: exact, `bigint`, one multiplication, never rounded ──────
 *
 * ```
 *   value = sharesRaw x sharePriceRaw     (at sharesDecimals + sharePriceDecimals)
 * ```
 *
 * `usdValueOf` is that multiplication and nothing else: two integers at two known
 * scales produce an integer at the sum of the scales. There is no division in
 * this path, so there is nothing to round — the exact figure travels to the
 * response and the screen is the one place rounding is allowed.
 *
 * The price's own exponent is **never assumed**: Kamino publishes `sharePrice` as
 * a decimal string (`Decimal = string` in its OpenAPI document) with no declared
 * exponent, so the scale is the number of fractional digits the answer carries
 * (nineteen today), and it travels with the price.
 *
 * The value is a USD figure because the vault's token is Solana USDC, which this
 * project values at exactly one dollar **by definition** and never asks an oracle
 * about.
 *
 * ── Zero shares is `ok` with a zero, and it is not a special case ────────────
 *
 * A holder of nothing is a fact, not a failed read, and a `0n` is falsy in
 * JavaScript, so every branch below tests the **sign** of the shares rather than
 * their truthiness. And when the shares are zero the price cannot change the
 * answer: `0 x p = 0` for every finite `p`. So a zero position is reported as
 * `ok` with a zero even when Kamino's API is down, and the price that could not
 * be read is not turned into a hole in somebody's balance.
 *
 * ── Every other failure is `unreadable` with a bounded reason ───────────────
 *
 * No provider's words cross the boundary. An unreadable share read, an
 * undecodable vault, a farm state that cannot be read, an API that is down and an
 * API that answered nonsense are five different facts and they keep five different
 * names, because they call for five different investigations — and **none of them
 * is ever a zero, and none of them is ever a smaller position**.
 *
 * ── The vault's rate rides along, and is never allowed to hurt the balance ────
 *
 * `apy` is the annual yield Kamino publishes for this vault, read through the
 * **same injected port** as the share price and with the same scale discipline:
 * a decimal string whose exponent is the count of its own fractional digits.
 *
 * It is **decided** after the shares, and it is reported **separately** from them,
 * because a rate this code cannot read is not a balance it cannot read. The two
 * Kamino GETs are *started* at the same moment — they fetch the same document, so
 * there is no reason to wait for one to ask for the other — but the rate's answer
 * is only read once the balance is settled. A vault
 * publishing nonsense where its yield should be must not turn a position of
 * $1,000 into a position of zero, so `status` still says `ok` and the value is
 * still exact; what becomes `unreadable` is `apy`, and the composition decides
 * what that means for the *combined* yield — which is a different question about
 * a different number, answered in `readWalletBalance`.
 */
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import type { WalletStore } from '../../domain/ports/wallet-store';
import { FarmStateUnreadableError } from '../../domain/ports/kamino-earn-vault-reader';
import type { KaminoEarnVaultReader } from '../../domain/ports/kamino-earn-vault-reader';
import type {
  KaminoApy,
  KaminoApyFailure,
  KaminoSharePrice,
  KaminoSharePriceFailure,
  KaminoSharePriceFeed,
} from '../../domain/ports/kamino-share-price-feed';
import { BalanceReadError, type BalanceReadFailure } from '../../domain/portfolio/errors';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import {
  KAMINO_EARN_SHARES_SYMBOL,
  KAMINO_EARN_VAULT_ADDRESS,
  KAMINO_EARN_VAULT_FARM_ADDRESS,
} from '../../domain/yield/kaminoEarnVault';
import { sumExact, usdValueOf, type ScaledValue, type UsdAmount } from '../../domain/price/valuation';
import { WalletsUnavailable } from './readPortfolio';

/** The shares held, exact, at the shares mint's own decimals. */
export interface KaminoEarnShares {
  /** The exact integer, unstaked + staked. At the shares mint's decimals. */
  readonly raw: bigint;
  readonly decimals: number;
  /** The shares mint's own symbol. A label, never an input to arithmetic. */
  readonly symbol: string;
  /** What part of it is staked in the farm, for the screen. Same scale. */
  readonly staked: bigint;
}

/**
 * Why this position could not be read. Bounded, and each name is a different
 * investigation:
 *
 *  - `VAULT_LAYOUT_UNREADABLE` — the vault account answered and this repository
 *    cannot decode it. **Ours.**
 *  - `FARM_STATE_UNREADABLE` — a farm exists and the staked shares inside it
 *    cannot be read. The position is **incomplete**, never smaller.
 *  - the three `BalanceReadFailure` names — the chain did not answer, refused, or
 *    answered nonsense.
 *  - the three `KaminoSharePriceFailure` names — Kamino's API did not answer,
 *    answered nonsense, or published a price of nothing.
 */
export type KaminoPositionFailure =
  | BalanceReadFailure
  | KaminoSharePriceFailure
  | KaminoApyFailure
  | 'VAULT_LAYOUT_UNREADABLE'
  | 'FARM_STATE_UNREADABLE';

/**
 * The position, with its own state.
 *
 * `no_wallet` is separate from `unreadable` for the same reason it is in
 * `readWalletBalance`: "this person holds nothing on this chain" is a **known**
 * fact, so emitting an unreadable piece for it would make the bucket permanently
 * incomplete for everyone without a Solana wallet — and "incomplete" would then
 * mean "has no second wallet", which is false.
 */
export type KaminoEarnPositionRead =
  | { readonly status: 'no_wallet' }
  | {
      readonly status: 'unreadable';
      readonly reason: KaminoPositionFailure;
      /**
       * The shares, when they could be read and the price could not. Kept because
       * it is true and useful; never summed, because a quantity without a price
       * has no dollar value.
       */
      readonly shares: KaminoEarnShares | null;
    }
  | {
      readonly status: 'ok';
      readonly address: string;
      readonly shares: KaminoEarnShares;
      /**
       * The share price that was used, or `null` for an **exactly zero**
       * position, where no price was needed because `0 x p = 0` for every price.
       * Not a hole: the piece still carries a value, and that value is exact.
       */
      readonly price: KaminoSharePrice | null;
      /**
       * The vault's annual yield as Kamino publishes it — a **fraction** of one,
       * exact, at the scale of its own digits — or `null` when it could not be
       * read and `apyReason` says why.
       *
       * It is a separate member rather than part of the position's state: an
       * unreadable rate leaves the balance `ok` and exact.
       */
      readonly apy: KaminoApy | null;
      /** The bounded reason the rate does not exist, or `null` when it does. */
      readonly apyReason: KaminoApyFailure | null;
      readonly value: UsdAmount;
    };

export interface ReadKaminoEarnPositionDeps {
  readonly wallets: WalletStore;
  readonly vaults: KaminoEarnVaultReader;
  /** The ordinary SPL reader: the shares are a token account like any other. */
  readonly solana: SolanaBalanceReader;
  readonly prices: KaminoSharePriceFeed;
  /** Overridable so a test can pin another vault. Defaults to the live one. */
  readonly vaultAddress?: string;
  readonly log?: Logger;
}

export type ReadKaminoEarnPosition = (userId: string, now?: Date) => Promise<KaminoEarnPositionRead>;

const reasonOf = (error: unknown): KaminoPositionFailure => {
  if (error instanceof FarmStateUnreadableError) return 'FARM_STATE_UNREADABLE';
  return error instanceof BalanceReadError ? error.reason : 'RPC_UNAVAILABLE';
};

/**
 * A read that either answered or said why it did not.
 *
 * Settling instead of throwing is what makes several reads startable together
 * without one of them owning the fate of the others: the verdict is taken by the
 * code below, in the order it has always been taken in.
 */
const settled = <T>(read: Promise<T>): Promise<{ readonly ok: T } | { readonly error: unknown }> =>
  read.then(
    (value) => ({ ok: value }) as const,
    (error: unknown) => ({ error }) as const,
  );

export const readKaminoEarnPosition = (deps: ReadKaminoEarnPositionDeps): ReadKaminoEarnPosition => {
  const log = deps.log ?? noopLogger;
  const vaultAddress = deps.vaultAddress ?? KAMINO_EARN_VAULT_ADDRESS;

  return async (userId: string, now: Date = new Date()): Promise<KaminoEarnPositionRead> => {
    /*
     * The address comes from `rewallet.wallets`, exactly as every other read
     * resolves it. The caller contributes a user id and nothing else, so there is
     * no parameter through which another person's money could be described.
     */
    let rows;
    try {
      rows = await deps.wallets.findByUserId(userId);
    } catch (error) {
      throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
    }
    const row = rows.find((candidate) => candidate.chain === 'solana');
    if (row === undefined) {
      log.log('kamino_earn.no_wallet', { userId });
      return { status: 'no_wallet' };
    }
    const address = row.address;

    /* ── 1. Everything independent, asked at once ────────────────────────── */

    /*
     * Four questions, three of which cannot wait for the fourth:
     *
     *  - the **vault account** names the shares mint, so the share read below does
     *    wait for it. Nothing else needs the vault account.
     *  - the **farm** state is addressed by a constant farm address and this
     *    person's wallet, both known before the first request leaves.
     *  - the **share price** and the **APY** are Kamino's own figures about a
     *    vault address this file already holds.
     *
     * They are therefore all started here and settled below, which turns five
     * serial round trips into two: one hop for everything that is independent,
     * plus the one hop that genuinely depends on the shares mint.
     *
     * ── The two Kamino GETs are concurrent, not one fetch ──────────────────
     *
     * `/stats` carries both fields, so a single fetch could answer both, and that
     * is **deliberately not done**: the adapter keeps the two GETs as the price
     * of keeping the two answers independent — a rate this code cannot parse must
     * not make somebody's share price unreadable. Coupling them would put a hole
     * in a balance because of a yield field. So they run concurrently instead and
     * the independence is kept.
     *
     * Each is settled into `{ok}|{error}` as it is started, so a rejection is a
     * state this function decides on and not an unhandled rejection in a request
     * nobody awaits.
     */
    const vaultRead = settled(deps.vaults.vault());
    const stakedRead = settled(deps.vaults.stakedShares(KAMINO_EARN_VAULT_FARM_ADDRESS, address));
    const priceRead = settled(deps.prices.sharePrice(vaultAddress));
    const rateRead = settled(deps.prices.apy(vaultAddress));

    /* ── 2. The vault's own account: which mint, and which farm ────────────── */

    const vaultAnswer = await vaultRead;
    if (!('ok' in vaultAnswer)) {
      log.error('kamino_earn.vault_failed', {
        error: vaultAnswer.error,
        reason: reasonOf(vaultAnswer.error),
        detail: String(vaultAnswer.error),
      });
      return { status: 'unreadable', reason: 'VAULT_LAYOUT_UNREADABLE', shares: null };
    }
    const vault = vaultAnswer.ok;

    /*
     * ── 2. The shares, from the **shares mint** — not from the wallet ────────
     *
     * `mintBalance` is filtered by mint inside the RPC, so this is "every token
     * account this owner holds of the vault's shares mint, summed" and nothing
     * else. The person's other tokens cannot enter it: the question is asked
     * about one mint, and the mint is read out of the vault account rather than
     * assumed to be the token mint.
     *
     * This is the **one** read that waits, because it cannot be asked until the
     * vault account has said which mint the shares live in.
     */
    const unstaked = await settled(deps.solana.mintBalance(address, vault.sharesMint));
    if (!('ok' in unstaked)) {
      log.error('kamino_earn.shares_unreadable', {
        error: unstaked.error,
        reason: reasonOf(unstaked.error),
        detail: String(unstaked.error),
      });
      return { status: 'unreadable', reason: reasonOf(unstaked.error), shares: null };
    }

    /* ── 3. The shares staked in the farm, which the wallet cannot show ────── */

    const staked = await stakedRead;
    if (!('ok' in staked)) {
      /*
       * The farm exists and its user state could not be read. The shares in the
       * wallet are still true, and they are still kept — but the position is
       * **incomplete**, because reporting them alone would be a position smaller
       * than the person holds, silently, which is the exact failure Kamino's
       * documentation warns about.
       */
      log.error('kamino_earn.farm_unreadable', { error: staked.error, reason: reasonOf(staked.error) });
      return {
        status: 'unreadable',
        reason: reasonOf(staked.error),
        shares: {
          raw: unstaked.ok,
          decimals: vault.sharesMintDecimals,
          symbol: KAMINO_EARN_SHARES_SYMBOL,
          staked: 0n,
        },
      };
    }

    const shares: KaminoEarnShares = {
      raw: unstaked.ok + staked.ok,
      decimals: vault.sharesMintDecimals,
      symbol: KAMINO_EARN_SHARES_SYMBOL,
      staked: staked.ok,
    };

    /* ── 4. What one share is worth — asked for, never computed ────────────── */

    const answered = await priceRead;

    /** The price, or `null`. Never a throw: the union already carries a reason. */
    const price: KaminoSharePrice | null =
      'ok' in answered && answered.ok.status === 'ok' ? answered.ok.value : null;

    /** The bounded reason the price does not exist, or `null` when it does. */
    const failure: KaminoPositionFailure | null = !('ok' in answered)
      ? reasonOf(answered.error)
      : answered.ok.status === 'unreadable'
        ? answered.ok.reason
        : null;

    /*
     * `'0n'` and not a truthiness test: `0n` is falsy, and a truthy test here
     * would report a holder of nothing as a failed read — the one thing this
     * whole file refuses to do.
     *
     * A zero position is `ok` with a zero, **and it is zero whether or not Kamino
     * answered**: `0 x p = 0` for every finite price, so an outage cannot change
     * this person's balance. The failure is logged, not laundered into a hole.
     */
    if (shares.raw === 0n) {
      log.log('kamino_earn.zero_position', { userId, at: now.toISOString(), priced: price !== null });
      return {
        status: 'ok',
        address,
        shares,
        price,
        apy: null,
        apyReason: null,
        value: sumExact([]),
      };
    }

    const priceProblem = failure;
    if (priceProblem !== null) {
      log.error('kamino_earn.price_unreadable', {
        reason: priceProblem,
        detail: 'error' in answered ? String(answered.error) : priceProblem,
      });
      return { status: 'unreadable', reason: priceProblem, shares };
    }

    if (price === null) {
      throw new Error('a share price either exists or carries a reason: neither is optional here');
    }

    /* ── 5. The vault's rate — asked for on the same port, and separately ──── */

    /*
     * Asked in the same breath as the price above, and **decided** here, after
     * the balance has already been settled: a rate this code cannot read is a
     * hole in the *yield*, not in somebody's money, and the concurrency does not
     * change that, because nothing about this answer reaches `shares` or `value`.
     * Both answers can be right or wrong on their own.
     */
    const rateAnswered = await rateRead;

    const apy: KaminoApy | null =
      'ok' in rateAnswered && rateAnswered.ok.status === 'ok' ? rateAnswered.ok.value : null;
    /*
     * A feed that **throws** rather than honouring its own union is a bug in the
     * adapter, and the rate's own name for "we do not have it" is the right
     * answer for it — the chain's `RPC_*` vocabulary describes a chain read, and
     * this was not one.
     */
    const apyReason: KaminoApyFailure | null =
      !('ok' in rateAnswered)
        ? 'KAMINO_UNAVAILABLE'
        : rateAnswered.ok.status === 'unreadable'
          ? rateAnswered.ok.reason
          : null;

    if (apyReason !== null) {
      // Logged, not swallowed: the position is still `ok` and still exact.
      log.error('kamino_earn.apy_unreadable', {
        reason: apyReason,
        detail: 'error' in rateAnswered ? String(rateAnswered.error) : apyReason,
      });
    }

    /* ── 6. The value: one exact multiplication ────────────────────────────── */

    const value: ScaledValue = usdValueOf(shares.raw, shares.decimals, price.raw, price.decimals);

    log.log('kamino_earn.read', {
      userId,
      vault: vaultAddress,
      shares: shares.raw.toString(),
      staked: shares.staked.toString(),
      sharePrice: price.usd,
      apy: apy === null ? null : apy.text,
      valueRaw: value.raw.toString(),
      valueDecimals: value.decimals,
    });

    return {
      status: 'ok',
      address,
      shares,
      price: { raw: price.raw, decimals: price.decimals, usd: price.usd },
      // The sum of one exact value is that value: no rounding, no re-scaling.
      apy,
      apyReason,
      value: sumExact([value]),
    };
  };
};

/** The exact USD value of a share price times a share count. Exported for tests. */
export const valueOfShares = (shares: KaminoEarnShares, price: KaminoSharePrice): UsdAmount =>
  sumExact([usdValueOf(shares.raw, shares.decimals, price.raw, price.decimals)]);