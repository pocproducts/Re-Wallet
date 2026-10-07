/**
 * USE CASE: read one person's real balances, per chain and per asset.
 *
 * ── The three rules this use case exists to enforce ───────────────────────────
 *
 *   1. **Unrounded, with the unit stated.** The amount is a decimal string
 *      produced from the exact integer the chain reported, never a `number`
 *      rounded to cents. The screen decides how to render it; the app needs the
 *      whole value to build a transaction, and a rounded one cannot be undone.
 *   2. **One chain failing does not empty the portfolio.** Each chain is read
 *      independently and each carries its own state. A network that is down or
 *      rate-limiting produces an explicit error for *that* chain. A zero would
 *      be a lie: it reads as an empty wallet.
 *   3. **The address comes from the database, always.** The caller contributes
 *      nothing but a user id. There is no parameter through which an address
 *      could arrive, so there is no code path that reads somebody else's money.
 *
 * ── Why a missing wallet row is not a zero balance ────────────────────────────
 *
 * "This person has no wallet on this chain" and "this person's wallet is empty"
 * are different facts, and the difference is exactly what a support conversation
 * turns on. They are different states here: `no_wallet` and `ok` with `0`.
 */
import type { EvmBalanceReader } from '../../domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import type { WalletStore } from '../../domain/ports/wallet-store';
import { ASSETS_BY_CHAIN, toAsset, toUnreadableAsset } from '../../domain/portfolio/assets';
import { BalanceReadError, type BalanceReadFailure } from '../../domain/portfolio/errors';
import { PORTFOLIO_CHAINS, WALLET_CHAIN_FOR, type PortfolioChain } from '../../domain/portfolio/networks';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

/** One asset, exact, with the unit the screen has to divide by. */
interface PortfolioAssetOk {
  readonly symbol: string;
  readonly unit: string;
  readonly decimals: number;
  /** The exact integer the chain reported, in the smallest unit. */
  readonly raw: string;
  /** The same value in `unit`, unrounded. Equal to `raw` when `decimals` is 0. */
  readonly amount: string;
}

/**
 * One asset whose own read failed.
 *
 * The second member of the union, and it carries **no amount**: `raw` and
 * `amount` are `null` rather than `'0'`, because a member of this union cannot
 * be mistaken for a balance. Nothing downstream has to remember to check a flag
 * before treating a figure as money, because the figure is not there.
 */
interface PortfolioAssetUnreadable {
  readonly symbol: string;
  readonly unit: string;
  readonly decimals: number;
  readonly raw: null;
  readonly amount: null;
  readonly error: { readonly code: 'ASSET_READ_FAILED'; readonly reason: PortfolioFailureReason };
}

/**
 * One asset of a chain, with the state of **its own** read.
 *
 * Before the SPL read, this was one shape and the chain carried all of it. It is a
 * union now because one chain can hold several assets and one of them can fail
 * while the others do not: with SOL and USDC on Solana, a mint that cannot be
 * read says nothing about the lamports, and reporting the whole chain as failed
 * would throw away a balance we did read.
 */
export type PortfolioAsset = PortfolioAssetOk | PortfolioAssetUnreadable;

/** Why a chain is `error`. Bounded, so a browser can render it and nothing else. */
export type PortfolioFailureReason = BalanceReadFailure | 'WALLETS_UNAVAILABLE';

export interface PortfolioChainOk {
  readonly chain: PortfolioChain;
  readonly status: 'ok';
  /** The address that was read. It came from `rewallet.wallets`. */
  readonly address: string;
  readonly assets: readonly PortfolioAsset[];
}

export interface PortfolioChainFailed {
  readonly chain: PortfolioChain;
  readonly status: 'error';
  readonly error: { readonly code: 'CHAIN_READ_FAILED'; readonly reason: PortfolioFailureReason };
}

export interface PortfolioChainNoWallet {
  readonly chain: PortfolioChain;
  readonly status: 'no_wallet';
}

export type PortfolioChainState = PortfolioChainOk | PortfolioChainFailed | PortfolioChainNoWallet;

export interface Portfolio {
  readonly userId: string;
  /** Every chain, in a fixed order. A chain that failed is still present. */
  readonly chains: readonly PortfolioChainState[];
}

export interface ReadPortfolioDeps {
  readonly wallets: WalletStore;
  readonly evm: EvmBalanceReader;
  readonly solana: SolanaBalanceReader;
  readonly log?: Logger;
}

export interface ReadPortfolio {
  (userId: string, now?: Date): Promise<Portfolio>;
}

/**
 * Raised when the wallet rows themselves cannot be read.
 *
 * A different failure from a chain read: without the rows there is no address to
 * read *any* chain with, so there is no per-chain truth to report and the honest
 * answer is that the request did not succeed.
 */
export class WalletsUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Wallets could not be read: ${reason}`, options);
    this.name = 'WalletsUnavailable';
  }
}

/**
 * A read that failed for a reason this code cannot classify is `RPC_UNAVAILABLE`,
 * never a silent zero. When in doubt the honest answer is "we could not read it".
 */
/**
 * El mensaje del error, recortado y reducido a caracteres que pueden romper una
 * linea de log. Es lo unico que dice que endpoint fallo y que respondio.
 */
const messageOf = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return raw.replace(/[^a-zA-Z0-9_:.,/()\- ]/g, '').slice(0, 500);
};

const reasonOf = (error: unknown): PortfolioFailureReason =>
  error instanceof BalanceReadError ? error.reason : 'RPC_UNAVAILABLE';

export const readPortfolio = (deps: ReadPortfolioDeps): ReadPortfolio => {
  const log = deps.log ?? noopLogger;

  /**
   * One chain, start to finish, inside a `try`.
   *
   * The `catch` is the whole design: a chain that could not be read becomes a
   * state, and the loop continues. Not `0`, never: a zero renders as an empty
   * wallet, and an empty wallet is the answer that costs a person their money.
   *
   * ── The coin decides the chain; a mint decides only itself ────────────────
   *
   * The chain's own coin is read first, **outside** the per-asset `try`: if it
   * cannot be read, the chain could not be reached, and that is the per-chain
   * error this use case has always answered.
   *
   * On Solana the catalogued mints are separate reads of separate account spaces,
   * and one of them failing says nothing about the others: a mint that cannot be
   * read becomes an **asset** that is unreadable, with its own bounded reason, and
   * the lamports next to it keep their figure.
   *
   * The EVM chains keep the chain-level behaviour they have always had, and this
   * is deliberately **not** widened to them: the per-asset hole is new state on
   * the wire for `chains[].assets[]`, and one chain family adopting it is enough
   * for it to be a real shape. Extending it to EVM is a separate decision, with
   * its own tests, and not one this change should make quietly.
   */
  const readChain = async (chain: PortfolioChain, address: string): Promise<PortfolioChainState> => {
    const specs = ASSETS_BY_CHAIN[chain];
    const assets: PortfolioAsset[] = [];
    // No `token` on a spec means it is the chain's own coin.
    const native = specs.find((spec) => spec.token === undefined);
    // Pairs the spec with its address, so nothing downstream needs a cast and
    // the mint a read is asked for is the mint the catalog declared.
    const tokens = specs.flatMap((spec) => (spec.token === undefined ? [] : [{ spec, token: spec.token }]));

    if (native !== undefined) {
      const raw =
        chain === 'solana' ? await deps.solana.lamports(address) : await deps.evm.nativeBalance(chain, address);
      assets.push(toAsset(native, raw));
    }

    for (const { spec, token } of tokens) {
      try {
        const raw =
          chain === 'solana'
            ? await deps.solana.mintBalance(address, token)
            : await deps.evm.erc20Balance(chain, token, address);
        assets.push(toAsset(spec, raw));
      } catch (error) {
        if (chain !== 'solana') throw error;

        /*
         * The provider's own words go to the log; the response carries the code.
         * The coin read on this same wallet stays standing next to it.
         */
        log.error(`portfolio.asset_read_failed:${chain}`, {
          chain,
          address,
          symbol: spec.symbol,
          error,
          reason: reasonOf(error),
          detail: messageOf(error),
        });
        assets.push(toUnreadableAsset(spec, reasonOf(error)));
      }
    }

    log.log('portfolio.chain_read', { chain, address, assets: assets.length });
    return { chain, status: 'ok', address, assets };
  };

  return async (userId: string, now: Date = new Date()): Promise<Portfolio> => {
    /*
     * The rows first, and alone. Every address in this response comes from here:
     * there is no other source, and no parameter through which one could arrive.
     */
    let rows;
    try {
      rows = await deps.wallets.findByUserId(userId);
    } catch (error) {
      log.error('portfolio.wallets_unavailable', { userId, error });
      throw new WalletsUnavailable('the wallet rows for this user could not be read', { cause: error });
    }

    // One row per wallet chain. Two rows for one chain cannot happen (a UNIQUE
    // constraint says so) and, if it ever did, the first row is the one shown.
    const addressByWalletChain = new Map(rows.map((row) => [row.chain, row.address]));
    log.log('portfolio.start', { userId, at: now.toISOString(), rows: rows.length });

    const chains: PortfolioChainState[] = [];

    for (const chain of PORTFOLIO_CHAINS) {
      // `monad` and `ethereum` both resolve to the `ethereum` row: one EVM address,
      // read on two networks. There is no second EVM wallet to look for.
      const address = addressByWalletChain.get(WALLET_CHAIN_FOR[chain]);

      if (address === undefined) {
        log.log('portfolio.no_wallet', { userId, chain });
        chains.push({ chain, status: 'no_wallet' });
        continue;
      }

      try {
        chains.push(await readChain(chain, address));
      } catch (error) {
        /*
         * The provider's own words go to the log. The response carries the code.
         *
         * `error` alone prints `{ reason, name }` and **not** the message, which is
         * where the endpoint and what it answered live. A log that omits the
         * message is a log that cannot tell anyone why a chain is unreadable: two
         * rounds of diagnosis were spent on that.
         */
        log.error(`portfolio.chain_failed:${chain}`, {
          userId,
          chain,
          error,
          reason: reasonOf(error),
          detail: messageOf(error),
        });
        chains.push({ chain, status: 'error', error: { code: 'CHAIN_READ_FAILED', reason: reasonOf(error) } });
      }
    }

    return { userId, chains };
  };
};