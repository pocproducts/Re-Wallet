/**
 * `GET /api/wallet-balance`, over HTTP, with injected ports only: **no network,
 * no database, no RPC.**
 *
 * ── What this file is for ────────────────────────────────────────────────────
 *
 * The product model is one line:
 *
 * > Total wallet balance = (Bitcoin y Crypto, valued at market price)
 * >                      + (Investments, what is in the pools).
 *
 * and it fails in one specific way: **a dollar counted twice**. One in the free
 * wallet, one in the pool, and the headline is inflated by exactly what was
 * deposited — which looks like a good week. So these tests are mostly about the
 * buckets being *disjoint*, and about the total being the backend's arithmetic and
 * not the browser's.
 *
 * The other rules are carried over from `digitalDollars.test.ts` and they are the
 * same rules: **zero is not unreadable**, a partial answer says `complete:
 * false`, and nothing in the request is read.
 */
import { describe, expect, it } from 'vitest';

import { readPortfolio } from '../../src/application/portfolio/readPortfolio';
import { readDigitalDollars } from '../../src/application/portfolio/readDigitalDollars';
import { readWalletBalance } from '../../src/application/portfolio/readWalletBalance';
import { readKaminoEarnPosition } from '../../src/application/portfolio/readKaminoEarnPosition';
import { DIGITAL_DOLLAR_SYMBOLS } from '../../src/domain/price/digitalDollar';
import { readPool } from '../../src/application/pool/readPool';
import { prepareDeposit } from '../../src/application/pool/prepareDeposit';
import { prepareDepositKamino } from '../../src/application/pool/prepareDepositKamino';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import type { AavePoolReader } from '../../src/domain/ports/aave-pool-reader';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { KaminoEarnVaultReader } from '../../src/domain/ports/kamino-earn-vault-reader';
import type {
  KaminoAccountToCreate,
  KaminoDepositAccounts,
  KaminoDepositPreparer,
} from '../../src/domain/ports/kamino-earn-vault-reader';
import type {
  KaminoApyResult,
  KaminoSharePriceFeed,
  KaminoSharePriceResult,
} from '../../src/domain/ports/kamino-share-price-feed';
import type { PricedAsset, PriceFeed, PriceFeedFailure, PriceResult } from '../../src/domain/ports/price-feed';
import type { ReserveData } from '../../src/domain/pool/reserveData';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import type { KaminoKVaultState } from '../../src/domain/yield/kaminoEarnVault';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import {
  percentLabelOfRatio,
  type ExactRatio,
} from '../../src/domain/yield/combinedYield';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;
const NOW = '2026-10-04T05:00:00.000Z';
const PRICE_UPDATED_AT = 1_700_000_000;

const MONAD_USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const A_USDC = '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042';
/** The mint of USDC on Solana, as the deposit catalog declares it. */
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const RESERVE: ReserveData = {
  unbacked: 0n,
  accruedToTreasuryScaled: 138625857678n,
  totalAToken: 173874477777314n,
  totalStableDebt: 0n,
  totalVariableDebt: 159699152138313n,
  liquidityRate: 41196389349252103065387833n,
  variableBorrowRate: 49876895160470413431331597n,
  stableBorrowRate: 0n,
  averageStableBorrowRate: 0n,
  liquidityIndex: 1009859695804839225116566637n,
  variableBorrowIndex: 1012201287234727256155333993n,
  lastUpdateTimestamp: 1791088293n,
};

const acceptingCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
  read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: DID } : null),
});

const twoWalletRows: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

const failingWalletStore: WalletStore = {
  findByUserId: async () => {
    throw new Error('connection terminated unexpectedly');
  },
  save: async () => {},
};

/** The live prices of the probe, at each scale each feed actually publishes. */
const MON_AT_8 = { raw: '2864200', usd: '0.028642', decimals: 8, pair: 'MON_USD' };
const ETH_AT_8 = { raw: '268939000000', usd: '2689.39', decimals: 8, pair: 'ETH_USD' };
const SOL_AT_18 = { raw: '1462500000000000000', usd: '1.4625', decimals: 18, pair: 'SOL_USD' };

/**
 * A price feed with a fixed answer per asset, and a record of every call.
 *
 * `asked` is the assertion that carries the peg rule: a digital dollar must never
 * appear in it, because no oracle is consulted for one.
 */
const priceFeed = (
  answers: Partial<Record<PricedAsset, PriceFeedFailure | { raw: string; usd: string; decimals: number; pair: string }>>,
) => {
  const asked: PricedAsset[] = [];
  const feed: PriceFeed & { readonly asked: PricedAsset[] } = {
    asked,
    usdPrice: async (asset) => {
      asked.push(asset);
      const answer = answers[asset];
      if (answer === undefined) return { status: 'unreadable', reason: 'RPC_UNAVAILABLE' } satisfies PriceResult;
      if (typeof answer === 'string') return { status: 'unreadable', reason: answer } satisfies PriceResult;
      return {
        status: 'ok',
        value: {
          asset,
          pair: answer.pair,
          raw: answer.raw,
          usd: answer.usd,
          decimals: answer.decimals,
          updatedAt: PRICE_UPDATED_AT,
          crossChecked: asset === 'MON',
        },
      } satisfies PriceResult;
    },
  };
  return feed;
};

/** A feed that fails everything. Used to prove a pegged dollar never needs one. */
const deadPriceFeed = (): PriceFeed & { readonly asked: PricedAsset[] } => {
  const asked: PricedAsset[] = [];
  return {
    asked,
    usdPrice: async (asset) => {
      asked.push(asset);
      throw new Error('this feed must not be reached for a digital dollar');
    },
  };
};

const evmReader = (
  erc20: Record<string, string>,
  native: Record<string, string> = {},
): EvmBalanceReader & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    nativeBalance: async (network, address) => {
      asked.push(`native:${network}:${address}`);
      return BigInt(native[`${network}:${address}`] ?? '0');
    },
    erc20Balance: async (network, token, address) => {
      asked.push(`erc20:${network}:${token}:${address}`);
      if (!(`${network}:${token}:${address}` in erc20)) {
        throw new BalanceReadError('RPC_UNAVAILABLE', 'the endpoint did not answer');
      }
      return BigInt(erc20[`${network}:${token}:${address}`] ?? '0');
    },
  };
};

/**
 * The Solana port over injected values, and a record of what it was asked for.
 *
 * `mints` is the per-mint answer: a raw integer, or the failure the endpoint
 * produced for that mint. A mint that is not listed answers `0n`, which is what an
 * empty wallet is.
 */
const solanaReader = (
  lamports: Record<string, string>,
  mints: Record<string, bigint | BalanceReadError> = {},
): SolanaBalanceReader & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    lamports: async (address) => {
      asked.push(address);
      return BigInt(lamports[address] ?? '0');
    },
    tokenAmount: async () => 0n,
    mintBalance: async (_owner, mint) => {
      const answer = mints[mint];
      if (answer === undefined) return 0n;
      if (answer instanceof BalanceReadError) throw answer;
      return answer;
    },
  };
};

interface FakePoolOptions {
  readonly aTokenBalance?: bigint;
  readonly failAaveToken?: boolean;
  /** Another reserve: the reconciliation fixture has to be swappable. */
  readonly reserve?: ReserveData;
}

/**
 * A reserve whose supply APR reconciles and reads as exactly 4.1200 %.
 *
 * `aprPercentFromRay` is `rate x 1e6 / RAY` in integers, so 4.12 % is exactly
 * `4.12e25` RAY — and the reconciliation (`4.9876 x 0.918473 x 0.9 = 4.1228 %`)
 * is inside the half-point tolerance, so this rate is publishable.
 */
const RESERVE_AT_4_12: ReserveData = { ...RESERVE, liquidityRate: 41_200_000_000_000_000_000_000_000n };

/** A supply APR that cannot be reproduced from the rest of the reserve. */
const RESERVE_UNRECONCILED: ReserveData = {
  ...RESERVE_AT_4_12,
  liquidityRate: 1_302_812_990_000_000_000_000_000_000n,
};

const fakePool = (options: FakePoolOptions = {}) => {
  const asked: string[] = [];
  const reader: AavePoolReader & { readonly asked: string[] } = {
    asked,
    reserveData: async () => options.reserve ?? RESERVE,
    reserveConfiguration: async () => ({
      decimals: 6n,
      ltv: 7500n,
      liquidationThreshold: 7800n,
      reserveFactorBps: 1000n,
      isActive: true,
      isFrozen: false,
    }),
    erc20Balance: async (token, address) => {
      asked.push(`balanceOf:${token}:${address}`);
      if (token === A_USDC) {
        if (options.failAaveToken === true) throw new BalanceReadError('RPC_REJECTED', 'the node rejected it');
        return options.aTokenBalance ?? 820428n;
      }
      // The same free USDC the portfolio already counted, read a second time.
      return 1_500_000n;
    },
    allowance: async () => 0n,
    nativeBalance: async () => 3_000_000_000_000_000_000n,
  };
  return reader;
};

interface HarnessOptions {
  readonly wallets?: WalletStore;
  readonly evm?: EvmBalanceReader & { readonly asked: string[] };
  readonly solana?: SolanaBalanceReader & { readonly asked: string[] };
  readonly pool?: AavePoolReader & { readonly asked: string[] };
  readonly prices?: PriceFeed & { readonly asked: PricedAsset[] };
  /** Mount the app without the composition use case, to prove the route is absent. */
  readonly withoutBalance?: boolean;
  readonly withDigitalDollars?: boolean;
  /** Wire the second venue (Kamino Earn on Solana) with injected values. */
  readonly kamino?: {
    readonly shares: bigint | BalanceReadError;
    readonly apy?: KaminoApyResult;
    readonly sharePrice?: KaminoSharePriceResult;
  };
}

/** The pinned vault, as its own account decodes it. */
const KAMINO_VAULT: KaminoKVaultState = {
  address: 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E',
  vaultAuthority: '9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF',
  baseVaultAuthority: 'AyY6VCkHfTWdFs7SqBbu6AnCqLUhgzVHBzW3WcJu5Jc8',
  tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  tokenMintDecimals: 6,
  tokenVault: 'CKTEDx5z19CntAB9B66AxuS98S1NuCgMvfpsew7TQwi',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  sharesMint: '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS',
  sharesMintDecimals: 6,
  tokenAvailable: 79_951_135_232n,
  sharesIssued: 17_887_740_793_751n,
};

/** The vault reader, with no farm on chain — the state this vault is in today. */
const fakeVault = (): KaminoEarnVaultReader => ({
  vault: async () => KAMINO_VAULT,
  stakedShares: async () => 0n,
});

/** The share price / APY feed, with both answers injected. */
const kaminoPrices = (options: {
  readonly sharePrice?: KaminoSharePriceResult;
  readonly apy?: KaminoApyResult;
}): KaminoSharePriceFeed => ({
  sharePrice: async () => options.sharePrice ?? { status: 'ok', value: { raw: 1n, decimals: 0, usd: '1' } },
  apy: async () => options.apy ?? { status: 'ok', value: { raw: 418n, decimals: 4, text: '0.0418' } },
});

/** The **real** use cases over fake readers. Not stubs. */
const harness = (options: HarnessOptions = {}) => {
  const wallets = options.wallets ?? twoWalletRows;
  const evm = options.evm ?? evmReader({});
  const solana = options.solana ?? solanaReader({});
  const pool = options.pool ?? fakePool();
  const prices = options.prices ?? priceFeed({ MON: MON_AT_8, ETH: ETH_AT_8, SOL: SOL_AT_18 });
  const log = recordingLogger();

  const portfolio = readPortfolio({ wallets, evm, solana, log });
  const readPoolOf = readPool({ wallets, pool, log });

  /*
   * The second venue, wired only when a test asks for it: the same real use case
   * over the same injected readers, so the HTTP answer is this composition's and
   * not a stub's.
   */
  const kamino =
    options.kamino === undefined
      ? undefined
      : readKaminoEarnPosition({
          wallets,
          vaults: fakeVault(),
          solana: solanaReader({}, { [KAMINO_VAULT.sharesMint]: options.kamino.shares }),
          prices: kaminoPrices({ sharePrice: options.kamino.sharePrice, apy: options.kamino.apy }),
          log,
        });

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
    sessions: acceptingCodec(),
    readPortfolio: portfolio,
    readPool: readPoolOf,
    prepareDeposit: prepareDeposit({ wallets, pool, log }),
    readDigitalDollars:
      options.withDigitalDollars === true
        ? readDigitalDollars({ readPortfolio: portfolio, readPool: readPoolOf, log })
        : undefined,
    readWalletBalance:
      options.withoutBalance === true
        ? undefined
        : readWalletBalance({ readPortfolio: portfolio, readPool: readPoolOf, readKaminoEarn: kamino, prices, log }),
    log,
    now: () => new Date(NOW),
  });

  return { app, evm, solana, pool, prices, log };
};

const get = (app: ReturnType<typeof harness>['app'], query = '') =>
  app.request('/api/wallet-balance' + query, { headers: { cookie: SESSION_COOKIE } });

interface Usd {
  raw: string;
  amount: string;
  decimals: number;
  unit: string;
}

interface Piece {
  key: string;
  label: string;
  source: string;
  chain: string | null;
  status: string;
  reason: string | null;
  quantity: { raw: string; amount: string; decimals: number; unit: string } | null;
  price: {
    usd: string;
    raw: string;
    decimals: number;
    source: string;
    pair: string | null;
    updatedAt: number | null;
    crossChecked: boolean | null;
  } | null;
  value: Usd | null;
}

interface BalanceBody {
  generatedAt: string;
  unit: string;
  cryptoValue: { unit: string; complete: boolean; total: Usd; pieces: Piece[] };
  digitalDollarsValue: { unit: string; complete: boolean; total: Usd; pieces: Piece[] };
  investedValue: {
    unit: string;
    complete: boolean;
    total: Usd;
    pieces: Piece[];
    yield: {
      complete: boolean;
      rate: { numerator: string; denominator: string } | null;
      venues: {
        key: string;
        label: string;
        status: string;
        exclusion: string | null;
        chain: string | null;
        reason?: string;
        balance: Usd | null;
        rate: { raw: string; decimals: number; text: string } | null;
        depositable:
          | { status: 'ok'; amount: { raw: string; amount: string; decimals: number; unit: string } }
          | { status: 'unreadable'; reason: string };
        depositReady:
          | { status: 'ready' }
          | { status: 'not_ready'; reason: string; missingSteps: number; message: string };
      }[];
    };
  };
  total: { unit: string; complete: boolean; usd: Usd };
}

const pieceOf = (bucket: { pieces: Piece[] }, key: string): Piece => {
  const found = bucket.pieces.find((piece) => piece.key === key);
  if (found === undefined) throw new Error(`no piece ${key}`);
  return found;
};

/** $1.50 of free USDC on Monad, $0.50 on Ethereum, and 3 MON. */
const holdings = {
  [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '1500000',
  [`ethereum:${ETHEREUM_USDC}:${EVM_ADDRESS}`]: '500000',
  // The new chains answer zero: the fixture reader would refuse an unknown key.
  [`base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913:${EVM_ADDRESS}`]: '0',
  [`base:0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2:${EVM_ADDRESS}`]: '0',
  [`arbitrum:0xaf88d065e77c8cC2239327C5EDb3A432268e5831:${EVM_ADDRESS}`]: '0',
  [`arbitrum:0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9:${EVM_ADDRESS}`]: '0',
  [`optimism:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85:${EVM_ADDRESS}`]: '0',
  [`optimism:0x94b008aA00579c1307B0EF2c499aD98a8ce58e58:${EVM_ADDRESS}`]: '0',
  [`polygon:0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359:${EVM_ADDRESS}`]: '0',
  [`polygon:0xc2132D05D31c914a87C6611C10748AEb04B58e8F:${EVM_ADDRESS}`]: '0',
};
const threeMon: Record<string, string> = { [`monad:${EVM_ADDRESS}`]: '3000000000000000000' };

describe('GET /api/wallet-balance — the buckets and the headline', () => {
  it('composes free crypto, digital dollars and pool positions, and adds them up itself', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1234567890' }),
      pool: fakePool({ aTokenBalance: 820428n }),
    });

    const response = await get(app);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BalanceBody;

    expect(body.generatedAt).toBe(NOW);
    expect(body.unit).toBe('USD');

    /*
     * The crypto bucket: **no** USDC in it. Only the non-pegged assets:
     *   MON   3 x $0.028642 = $0.085926, at 18 + 8 = 26 decimals
     *   SOL   1.23456789 x $1.4625 = $1.805555539125, at 9 + 18 = 27 decimals
     */
    // `cryptoValue.complete` is false on purpose: POL has no verified Chainlink
    // feed, so its piece is PRICE_UNAVAILABLE and says so honestly.
    expect(body.cryptoValue.complete).toBe(false);
    expect(pieceOf(body.cryptoValue, 'crypto.polygon.POL')).toMatchObject({ status: 'unreadable', reason: 'PRICE_UNAVAILABLE' });
    expect(body.cryptoValue.total.decimals).toBe(27);
    expect(body.cryptoValue.total.amount).toBe('1.891481539125');

    /*
     * The digital dollars: free USDC on Monad and on Ethereum, plus the
     * position, every piece at the peg.
     */
    expect(body.digitalDollarsValue.complete).toBe(true);
    expect(body.digitalDollarsValue.total).toEqual({
      raw: '2820428',
      amount: '2.820428',
      decimals: 6,
      unit: 'USD',
    });

    // The invested view: the receipt token, one dollar per unit.
    expect(body.investedValue.complete).toBe(true);
    expect(body.investedValue.total).toEqual({ raw: '820428', amount: '0.820428', decimals: 6, unit: 'USD' });

    // And the headline is the sum, at the widest scale of any of them — but
    // `complete` is false because the POL piece has no verified price feed.
    expect(body.total.complete).toBe(false);
    expect(body.total.usd.decimals).toBe(27);
    expect(body.total.usd.amount).toBe('4.711909539125');
  });

  it('computes total as exactly cryptoValue + digitalDollarsValue, in bigint', async () => {
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    const scale = body.cryptoValue.total.decimals;
    const crypto = BigInt(body.cryptoValue.total.raw);
    const dollars = BigInt(body.digitalDollarsValue.total.raw) * 10n ** BigInt(scale - body.digitalDollarsValue.total.decimals);

    expect(BigInt(body.total.usd.raw)).toBe(crypto + dollars);
    // Not a coincidence of this fixture: it is the definition of the answer.
    expect(body.total.usd.amount).toBe('2.906354');
  });

  it('does not add investedValue to the total: its pieces are already inside', async () => {
    // `investedValue` is a **view** into `digitalDollarsValue`, not a third term.
    // If it were summed as well, every deposited dollar would be counted twice.
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    const scale = body.total.usd.decimals;
    const triple =
      BigInt(body.cryptoValue.total.raw) +
      BigInt(body.digitalDollarsValue.total.raw) * 10n ** BigInt(scale - body.digitalDollarsValue.total.decimals) +
      BigInt(body.investedValue.total.raw) * 10n ** BigInt(scale - body.investedValue.total.decimals);

    expect(BigInt(body.total.usd.raw)).not.toBe(triple);
    expect(body.investedValue.total.raw).toBe('820428');
  });

  it('prices a feed at 8 decimals and a feed at 18 decimals, both exactly', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1000000000' }),
      prices: priceFeed({ MON: MON_AT_8, SOL: SOL_AT_18 }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    // 3 MON at an **8-decimal** feed: 18 + 8 = 26 decimals.
    const mon = pieceOf(body.cryptoValue, 'crypto.monad.MON');
    expect(mon.status).toBe('ok');

    /*
     * The piece key is a **wire contract with the front**, not an internal
     * label: `CryptoAssetsListView` matches a row to its piece by this exact
     * string. It read `crypto.${holding.id}` while `PortfolioHolding.id` is
     * `${chain}:${symbol}` — two colons — so every lookup missed, `part` was
     * `null` on every row, and each asset silently fell back to showing only a
     * quantity with no dollar value.
     *
     * The front has no test runner, so this test is the only place the format
     * can be pinned. It asserts the three separators explicitly so a change to
     * any of them is a failing test rather than a silently empty column.
     */
    expect(mon.key).toBe('crypto.monad.MON');
    expect(body.cryptoValue.pieces.map((p: { key: string }) => p.key)).toEqual(
      expect.arrayContaining(['crypto.monad.MON', 'crypto.solana.SOL']),
    );
    for (const piece of body.cryptoValue.pieces) {
      expect(piece.key).toMatch(/^crypto\.[a-z]+\.[A-Z0-9]+$/);
      expect(piece.key.split('.')).toHaveLength(3);
      expect(piece.key).not.toContain(':');
    }
    expect(mon.price).toEqual({
      usd: '0.028642',
      raw: '2864200',
      decimals: 8,
      source: 'chainlink',
      pair: 'MON_USD',
      updatedAt: PRICE_UPDATED_AT,
      crossChecked: true,
    });
    expect(mon.value).toEqual({
      raw: '8592600000000000000000000',
      amount: '0.085926',
      decimals: 26,
      unit: 'USD',
    });

    // 1 SOL at an **18-decimal** feed: 9 + 18 = 27 decimals.
    const sol = pieceOf(body.cryptoValue, 'crypto.solana.SOL');
    expect(sol.status).toBe('ok');
    expect(sol.price?.decimals).toBe(18);
    expect(sol.price?.raw).toBe('1462500000000000000');
    expect(sol.value).toEqual({
      raw: '1462500000000000000000000000',
      amount: '1.4625',
      decimals: 27,
      unit: 'USD',
    });
  });

  it('never rounds a value: it keeps every digit the feed reported', async () => {
    // A price whose dollar figure needs more places than a screen would ever show.
    const { app } = harness({
      evm: evmReader(holdings, { [`monad:${EVM_ADDRESS}`]: '123456789123456789' }),
      prices: priceFeed({ MON: MON_AT_8 }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.cryptoValue, 'crypto.monad.MON').value?.amount).toBe('0.003536049354074049350538');
  });
});

describe('a digital dollar is valued at exactly 1, with NO oracle consulted', () => {
  it('never asks the price feed about USDC, however much of it there is', async () => {
    const { app, prices } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool() });

    const body = (await (await get(app)).json()) as BalanceBody;

    // Four USDC pieces are in that answer — three free, one deposited — and the
    // feed was asked about the non-peg assets only. `USDC` is not even a member
    // of `PricedAsset`: a digital dollar has no oracle to ask.
    expect(prices.asked).toEqual(['MON', 'ETH', 'SOL']);
    expect(prices.asked).not.toContain('USDC' as PricedAsset);
    expect(body.cryptoValue.pieces.filter((piece) => piece.key.endsWith('USDC'))).toHaveLength(0);
    // Solana is a free USDC piece now: its mint is catalogued and read, so the
    // third chain's dollar is no longer money the app reports as zero.
    expect(body.digitalDollarsValue.pieces.map((piece) => piece.key)).toEqual([
      'dollars.monad.USDC',
      'dollars.ethereum.USDC',
      'dollars.base.USDC',
      'dollars.base.USDT',
      'dollars.arbitrum.USDC',
      'dollars.arbitrum.USDT',
      'dollars.optimism.USDC',
      'dollars.optimism.USDT',
      'dollars.polygon.USDC',
      'dollars.polygon.USDT',
      'dollars.solana.USDC',
      'invest.aave_v3_usdc_monad',
    ]);
  });

  it('values Solana USDC at exactly 1, and never asks a feed about it', async () => {
    /*
     * The whole rule in one test, on the chain where it used to be missing: a
     * USDC deposited to Solana is read, pegged, worth one dollar, and the oracle
     * is not consulted for it — a `deadPriceFeed` would throw if it were.
     */
    const { app, prices } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1234567890' }, { [SOLANA_USDC_MINT]: 2_500_000n }),
      prices: deadPriceFeed(),
      pool: fakePool({ aTokenBalance: 820428n }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.digitalDollarsValue, 'dollars.solana.USDC')).toMatchObject({
      status: 'ok',
      source: 'free_wallet',
      chain: 'solana',
      quantity: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USDC' },
      price: { usd: '1', raw: '1', decimals: 0, source: 'peg', pair: null, updatedAt: null, crossChecked: null },
      value: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USD' },
    });
    // No oracle for it, on this chain any more than on the other two.
    expect(prices.asked).not.toContain('USDC' as PricedAsset);
  });

  it('reports a Solana mint that cannot be read as unreadable, and the bucket with it', async () => {
    /*
     * The two truths the portfolio is built on, on the one asset that used to be
     * silently zero: a failed mint is a hole with a reason, never a zero, and it
     * makes the bucket say it is not whole.
     */
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader(
        { [SOLANA_ADDRESS]: '1234567890' },
        { [SOLANA_USDC_MINT]: new BalanceReadError('RPC_UNAVAILABLE', 'the endpoint did not answer') },
      ),
      pool: fakePool({ aTokenBalance: 820428n }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.digitalDollarsValue, 'dollars.solana.USDC')).toMatchObject({
      status: 'unreadable',
      reason: 'RPC_UNAVAILABLE',
      quantity: null,
      price: null,
      value: null,
    });
    expect(body.digitalDollarsValue.complete).toBe(false);
    // The coin of the same wallet is untouched by the failure of one mint.
    expect(pieceOf(body.cryptoValue, 'crypto.solana.SOL').status).toBe('ok');
  });

  it('values them at 1 with a dead feed, which is the strongest form of the claim', async () => {
    // If any pegged piece depended on the oracle, this request would not answer.
    const { app } = harness({ evm: evmReader(holdings, threeMon), prices: deadPriceFeed() });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.digitalDollarsValue, 'dollars.monad.USDC')).toMatchObject({
      status: 'ok',
      reason: null,
      price: { usd: '1', decimals: 0, source: 'peg', pair: null, updatedAt: null, crossChecked: null },
      value: { raw: '1500000', amount: '1.5', decimals: 6, unit: 'USD' },
    });
    expect(pieceOf(body.investedValue, 'invest.aave_v3_usdc_monad')).toMatchObject({
      status: 'ok',
      price: { source: 'peg', pair: null },
      value: { amount: '0.820428', decimals: 6 },
    });

    // The non-peg asset, with the same dead feed, is unreadable — and says so.
    expect(pieceOf(body.cryptoValue, 'crypto.monad.MON').status).toBe('unreadable');
  });

  it('calls the feed once per asset, not once per piece', async () => {
    // One call per non-peg asset, whatever the number of pieces. A feed read per
    // piece would be a third set of RPC calls for a number two pieces already
    // agree on — and with the pair pinned to a block, a second read of the same
    // pair is a second *block*.
    const { app, prices } = harness({ evm: evmReader(holdings, threeMon) });
    await get(app);
    expect(prices.asked).toEqual(['MON', 'ETH', 'SOL']);
  });
});

describe('THE BUCKETS ARE DISJOINT — a dollar in a pool is not in the wallet', () => {
  it('a free asset and its pool position are counted once each', async () => {
    // The case where a double count would actually show: the person holds USDC
    // free on two chains AND has the same asset deposited in the pool.
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    // Free: 1.5 + 0.5. Deposited: 0.820428. Never 1.5 + 0.5 + 0.820428 + 1.5.
    expect(body.cryptoValue.total.amount).toBe('0.085926');
    expect(body.digitalDollarsValue.total.amount).toBe('2.820428');
    expect(body.investedValue.total.amount).toBe('0.820428');
    expect(body.total.usd.amount).toBe('2.906354');
  });

  it('no amount appears in both buckets', async () => {
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    const cryptoKeys = body.cryptoValue.pieces.map((piece) => piece.key);
    const investedKeys = body.investedValue.pieces.map((piece) => piece.key);
    // The key sets cannot meet...
    expect(cryptoKeys.filter((key) => investedKeys.includes(key))).toEqual([]);
    // ...and neither can the quantities behind them. Zeros are excluded on
    // purpose: eight new chains report 0 native and 0 USDC/USDT, and a shared
    // zero is four zeros meeting at a point, not a double count.
    const quantities = (pieces: Piece[]) =>
      pieces.filter((piece) => piece.status === 'ok' && piece.quantity?.raw !== '0').map((piece) => piece.quantity?.raw);
    const shared = quantities(body.cryptoValue.pieces).filter((raw) =>
      quantities(body.investedValue.pieces).includes(raw ?? ''),
    );
    expect(shared).toEqual([]);
  });

  it('the pool reads only the receipt token: not the free USDC, not the gas', async () => {
    // `readPool` also answers `availableUsdc` (1.5) and `gasBalance` (3 MON) —
    // the *same* money the portfolio already counted. If either were summed into
    // `investedValue`, that total would be 3.32 instead of 0.820428.
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(body.investedValue.pieces.map((piece) => piece.key)).toEqual(['invest.aave_v3_usdc_monad']);
    expect(body.investedValue.pieces[0]?.quantity?.unit).toBe('aMonUSDC');
    expect(body.investedValue.total.raw).toBe('820428');
  });

  it('splits crypto from digital dollars, and the two never share a piece', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      // Non-zero on both Solana assets, so a shared quantity here can only mean a
      // piece filed in two buckets — not two zeroes that happen to be equal.
      solana: solanaReader({ [SOLANA_ADDRESS]: '1000000000' }, { [SOLANA_USDC_MINT]: 1_000_000n }),
      pool: fakePool({ aTokenBalance: 820428n }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    // The new split: free and non-pegged on one side, every pegged piece on the
    // other. `investedValue` is a view *inside* the second, so it is compared here
    // only for membership — a key in both is the same object counted once.
    const cryptoKeys = body.cryptoValue.pieces.map((piece) => piece.key);
    const dollarKeys = body.digitalDollarsValue.pieces.map((piece) => piece.key);
    expect(cryptoKeys.filter((key) => dollarKeys.includes(key))).toEqual([]);
    expect(dollarKeys).toEqual([
      'dollars.monad.USDC',
      'dollars.ethereum.USDC',
      'dollars.base.USDC',
      'dollars.base.USDT',
      'dollars.arbitrum.USDC',
      'dollars.arbitrum.USDT',
      'dollars.optimism.USDC',
      'dollars.optimism.USDT',
      'dollars.polygon.USDC',
      'dollars.polygon.USDT',
      'dollars.solana.USDC',
      'invest.aave_v3_usdc_monad',
    ]);

    // And neither can the quantities behind them. Zeros are excluded on
    // purpose: eight new chains report 0 native and 0 USDC/USDT, and a shared
    // zero is four zeros meeting at a point, not a double count.
    const quantities = (pieces: Piece[]) =>
      pieces.filter((piece) => piece.status === 'ok' && piece.quantity?.raw !== '0').map((piece) => piece.quantity?.raw);
    const shared = quantities(body.cryptoValue.pieces).filter((raw) =>
      quantities(body.digitalDollarsValue.pieces).includes(raw ?? ''),
    );
    expect(shared).toEqual([]);
  });
});

describe('NO USDC REACHES "Bitcoin & Crypto" — the bucket guarantee', () => {
  /*
   * The owner's rule, stated as a test: USDC on Monad and USDC on Ethereum are
   * dollar-pegged, so they are **not** crypto, and they belong under the "Dólares
   * digitales" card, which is where the product discriminates them.
   *
   * The split is taken by the backend, on the peg table, so there is nothing for a
   * browser to subtract. These tests read the bucket, not the arithmetic.
   */

  it('holds no dollar-pegged asset, checked against every symbol in the peg table', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1234567890' }),
      pool: fakePool({ aTokenBalance: 820428n }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    // The table is read from the domain, so a new pegged symbol cannot slip in
    // here without failing this test.
    expect(DIGITAL_DOLLAR_SYMBOLS.length).toBeGreaterThan(0);

    for (const symbol of DIGITAL_DOLLAR_SYMBOLS) {
      expect(body.cryptoValue.pieces.filter((piece) => piece.key.endsWith(`.${symbol}`))).toEqual([]);
    }
  });

  it('shows no USDC at all under "Bitcoin & Crypto": not a key, a label, a quantity or a price', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1234567890' }),
      pool: fakePool({ aTokenBalance: 820428n }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    // The exact assertion: nothing in the crypto bucket mentions USDC, in any
    // field the front could paint from. The amounts are held too, so a
    // zero-or-unreadable row standing in for a USDC one is caught as well.
    expect(JSON.stringify(body.cryptoValue)).not.toContain('USDC');
    expect(JSON.stringify(body.cryptoValue.pieces.map((piece) => piece.key))).not.toContain('dollars.');
  });

  it('puts every free USDC balance and the position under "Dólares digitales", once each', async () => {
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    const dollars = body.digitalDollarsValue;
    // Three free pieces now, one per chain that has a USDC the app can read.
    expect(dollars.pieces.map((piece) => piece.key)).toEqual([
      'dollars.monad.USDC',
      'dollars.ethereum.USDC',
      'dollars.base.USDC',
      'dollars.base.USDT',
      'dollars.arbitrum.USDC',
      'dollars.arbitrum.USDT',
      'dollars.optimism.USDC',
      'dollars.optimism.USDT',
      'dollars.polygon.USDC',
      'dollars.polygon.USDT',
      'dollars.solana.USDC',
      'invest.aave_v3_usdc_monad',
    ]);
    // $1.50 on Monad and $0.50 on Ethereum, counted once each...
    expect(pieceOf(dollars, 'dollars.monad.USDC').value).toEqual({
      raw: '1500000',
      amount: '1.5',
      decimals: 6,
      unit: 'USD',
    });
    expect(pieceOf(dollars, 'dollars.ethereum.USDC').value).toEqual({
      raw: '500000',
      amount: '0.5',
      decimals: 6,
      unit: 'USD',
    });
    // ...plus the position: 1.5 + 0.5 + 0.820428.
    expect(dollars.total.amount).toBe('2.820428');
  });

  it('agrees with /api/digital-dollars exactly, so the card has one source and not two', async () => {
    // The card is served by `digitalDollarsValue`, out of the response the screen
    // already has. The other use case is still mounted and must not drift: the
    // same figure, to the last unit.
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      pool: fakePool({ aTokenBalance: 820428n }),
      withDigitalDollars: true,
    });

    const balance = (await (await get(app)).json()) as BalanceBody;
    const dollars = (await (
      await app.request('/api/digital-dollars', { headers: { cookie: SESSION_COOKIE } })
    ).json()) as { total: Usd; complete: boolean };

    expect(dollars.total.raw).toBe(balance.digitalDollarsValue.total.raw);
    // And it is not the crypto bucket, nor the whole wallet.
    expect(dollars.total.raw).not.toBe(balance.cryptoValue.total.raw);
    expect(dollars.total.raw).not.toBe(balance.total.usd.raw);
  });

  it('keeps the peg at exactly 1 with no oracle, on both chains and in the position', async () => {
    const { app, prices } = harness({
      evm: evmReader(holdings, threeMon),
      prices: deadPriceFeed(),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    for (const key of ['dollars.monad.USDC', 'dollars.ethereum.USDC', 'invest.aave_v3_usdc_monad']) {
      expect(pieceOf(body.digitalDollarsValue, key)).toMatchObject({
        status: 'ok',
        price: { usd: '1', raw: '1', decimals: 0, source: 'peg', pair: null, updatedAt: null, crossChecked: null },
      });
    }
    // A pegged piece is never sent to the oracle, on either chain nor in the
    // position. The non-pegged ones are asked for as usual — and the dead feed
    // above proves they are what fails.
    expect(prices.asked).toEqual(['MON', 'ETH', 'SOL']);
    expect(prices.asked).not.toContain('USDC' as PricedAsset);
  });

  it('marks the pegged bucket, not the crypto one, when a pegged read fails', async () => {
    // The chain that carries both Ethereum USDC and ETH is unreadable: the pegged
    // side must go incomplete even though a peg costs no oracle.
    const { app } = harness({ evm: evmReader({ [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '1500000' }, threeMon) });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(body.digitalDollarsValue.complete).toBe(false);
    // 1.5 free on Monad, plus the position; not a cent of Ethereum.
    expect(body.digitalDollarsValue.total.amount).toBe('2.320428');
    expect(body.cryptoValue.complete).toBe(false); // ETH is unreadable too.
    expect(body.cryptoValue.total.amount).toBe('0.085926');
    expect(body.total.usd.amount).toBe('2.406354');
  });
});

describe('an unreadable price makes its bucket incomplete, and is visible', () => {
  it('marks the crypto bucket incomplete and the total with it, without smoothing', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      pool: fakePool({ aTokenBalance: 820428n }),
      prices: priceFeed({ ETH: ETH_AT_8, SOL: SOL_AT_18, MON: 'STALE' }),
    });

    const response = await get(app);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BalanceBody;

    const mon = pieceOf(body.cryptoValue, 'crypto.monad.MON');
    expect(mon.status).toBe('unreadable');
    expect(mon.reason).toBe('STALE');
    expect(mon.value).toBeNull();
    // The quantity is still there and still true: it is the price that is missing.
    expect(mon.quantity).toEqual({
      raw: '3000000000000000000',
      amount: '3',
      decimals: 18,
      unit: 'MON',
    });

    expect(body.cryptoValue.complete).toBe(false);
    expect(body.investedValue.complete).toBe(true);
    expect(body.digitalDollarsValue.complete).toBe(true);
    expect(body.total.complete).toBe(false);

    // What we do know is still returned: the pegged 2.0 plus the position, and
    // not one cent of MON or ETH.
    expect(body.digitalDollarsValue.total.amount).toBe('2.820428');
    expect(body.total.usd.amount).toBe('2.820428');
    // The crypto bucket has nothing *valuatable*, and it says so with
    // `complete: false` rather than by pretending it is a real U$0,00.
    expect(body.cryptoValue.complete).toBe(false);
  });

  it('one unreadable price does not take the others down', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1000000000' }),
      prices: priceFeed({ MON: MON_AT_8, SOL: 'CHANNELS_DISAGREE', ETH: ETH_AT_8 }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.cryptoValue, 'crypto.solana.SOL').reason).toBe('CHANNELS_DISAGREE');
    expect(pieceOf(body.cryptoValue, 'crypto.monad.MON').status).toBe('ok');
    expect(pieceOf(body.digitalDollarsValue, 'dollars.ethereum.USDC').status).toBe('ok');
    expect(body.cryptoValue.complete).toBe(false);
  });

  it('an unreadable chain marks every asset it declares, and keeps the total honest', async () => {
    // `evmReader` fails any erc20 read it was not given: Ethereum's USDC is the
    // missing key, so the Ethereum chain fails and both its assets are marked.
    const { app } = harness({ evm: evmReader({ [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '1500000' }, threeMon) });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.digitalDollarsValue, 'dollars.ethereum.USDC')).toMatchObject({
      status: 'unreadable',
      reason: 'RPC_UNAVAILABLE',
      quantity: null,
      price: null,
      value: null,
    });
    expect(pieceOf(body.cryptoValue, 'crypto.ethereum.ETH').status).toBe('unreadable');
    expect(body.cryptoValue.complete).toBe(false);
    // The pegged side is incomplete too: the same failed chain took its USDC.
    expect(body.digitalDollarsValue.complete).toBe(false);
    // 1.5 free USDC + 0.820428 of position + 0.085926 of MON, and not a cent of
    // Ethereum.
    expect(body.digitalDollarsValue.total.amount).toBe('2.320428');
    expect(body.cryptoValue.total.amount).toBe('0.085926');
    expect(body.total.usd.amount).toBe('2.406354');
    expect(body.total.complete).toBe(false);
  });

  it('an unreadable position marks the invested bucket, not the crypto one', async () => {
    const { app } = harness({ evm: evmReader(holdings, threeMon), pool: fakePool({ failAaveToken: true }) });
    const body = (await (await get(app)).json()) as BalanceBody;

    expect(pieceOf(body.investedValue, 'invest.aave_v3_usdc_monad')).toMatchObject({
      status: 'unreadable',
      reason: 'RPC_REJECTED',
      value: null,
    });
    expect(body.investedValue.complete).toBe(false);
    expect(body.investedValue.total.raw).toBe('0');
    // The free side is untouched: a deposit nobody could read is not a wallet
    // nobody could read. The pegged free balance still sums to a real 2.0.
    // POL has no verified feed, so the crypto bucket carries one unreadable
    // piece and is incomplete even though the free side was read fine.
    expect(body.cryptoValue.complete).toBe(false);
    expect(body.cryptoValue.total.amount).toBe('0.085926');
    expect(body.digitalDollarsValue.total.amount).toBe('2');
    expect(body.digitalDollarsValue.complete).toBe(false);
    expect(body.total.complete).toBe(false);
  });

  it('carries a bounded reason, never the provider message', async () => {
    const { app, log } = harness({
      evm: evmReader(holdings, threeMon),
      prices: priceFeed({ MON: 'RPC_MALFORMED_RESPONSE' }),
    });

    const text = await (await get(app)).text();
    expect(text).not.toContain('the node rejected it');
    expect(text).not.toContain('PriceFeedError');
    expect(JSON.stringify(log.lines)).toContain('wallet_balance.incomplete');
  });

  it('reports a zero balance as ok, never as unreadable', async () => {
    const { app } = harness({
      evm: evmReader(
        {
          [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '0',
          [`ethereum:${ETHEREUM_USDC}:${EVM_ADDRESS}`]: '0',
        },
        { [`monad:${EVM_ADDRESS}`]: '0' },
      ),
      solana: solanaReader({ [SOLANA_ADDRESS]: '0' }),
      pool: fakePool({ aTokenBalance: 0n }),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    // Zero is a truth. Nothing failed, so the answer is the whole truth.
    expect(pieceOf(body.cryptoValue, 'crypto.monad.MON').status).toBe('ok');
    expect(pieceOf(body.digitalDollarsValue, 'dollars.monad.USDC').status).toBe('ok');
    expect(pieceOf(body.digitalDollarsValue, 'dollars.ethereum.USDC').status).toBe('ok');
    expect(pieceOf(body.investedValue, 'invest.aave_v3_usdc_monad').status).toBe('ok');
    expect(body.cryptoValue.total.raw).toBe('0');
    expect(body.digitalDollarsValue.total.raw).toBe('0');
    expect(body.total.usd.amount).toBe('0');
    // POL sin feed de precio verificado: la pieza es unreadable y el bucket incompleto.
    expect(pieceOf(body.cryptoValue, 'crypto.polygon.POL')).toMatchObject({ status: 'unreadable' });
    expect(body.cryptoValue.complete).toBe(false);
    expect(body.total.complete).toBe(false);
  });

  it('a chain with no wallet is a known zero, not an incomplete bucket', async () => {
    const { app } = harness({
      wallets: {
        findByUserId: async () => [
          { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
        ],
        save: async () => {},
      },
      evm: evmReader(holdings, threeMon),
    });
    const body = (await (await get(app)).json()) as BalanceBody;

    // Holding nothing on Solana is an answer, not a missing read. Emitting an
    // unreadable piece per unheld asset would make "incomplete" mean "has one
    // wallet", and the screen would say we could not read what does not exist.
    expect(body.cryptoValue.pieces.map((piece) => piece.key)).not.toContain('crypto.solana.SOL');
    // POL declara la billetera igual: piece unreadable porque no hay feed de POL.
    expect(body.cryptoValue.complete).toBe(false);
    expect(body.cryptoValue.total.amount).toBe('0.085926');
    // Holding nothing on Solana is still nothing: the pegged side is whole too.
    expect(body.digitalDollarsValue.complete).toBe(true);
    expect(body.digitalDollarsValue.total.amount).toBe('2.820428');
  });
});

describe('the one combined yield, in the response', () => {
  /** $60 on Aave at 4.1200 %, $40 on Kamino at 4.1800 %. */
  const twoVenues = () => ({
    evm: evmReader(holdings, threeMon),
    pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_AT_4_12 }),
    kamino: { shares: 40_000_000n },
  });

  it('sits on investedValue, and is a weighted mean rather than an average', async () => {
    const { app } = harness(twoVenues());

    const response = await get(app);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BalanceBody;

    const combined = body.investedValue.yield;
    expect(combined.complete).toBe(true);
    // (60 x 4.1200 + 40 x 4.1800) / 100 = 4.1440 %, not the 4.1500 % an
    // unweighted average of the two rates would give.
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).toBe('4.1440');
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).not.toBe('4.1500');

    // Exact: two whole integers, never a rounded decimal with a lost tail.
    expect(combined.rate).toEqual({ numerator: '4144000000000', denominator: '100000000000000' });
  });

  it('carries the per-venue breakdown, so a screen explains the figure', async () => {
    const { app } = harness(twoVenues());
    const body = (await (await get(app)).json()) as BalanceBody;

    // Each venue's own rate and its own balance, at the scales they were read at.
    // And each venue's own **chain's free USDC**: Aave's is the $1.50 free on
    // Monad, Kamino's is the $0 free on Solana, because this fixture's Solana
    // reader was not told about any mint. Not one venue's balance on the other.
    expect(body.investedValue.yield.venues).toEqual([
      {
        key: 'invest.aave_v3_usdc_monad',
        label: 'Aave V3 · USDC en Monad',
        status: 'ok',
        exclusion: null,
        chain: 'monad',
        balance: { raw: '60000000', amount: '60', decimals: 6, unit: 'USD' },
        rate: { raw: '41200', decimals: 6, text: '0.0412' },
        depositable: { status: 'ok', amount: { raw: '1500000', amount: '1.5', decimals: 6, unit: 'USDC' } },
        depositReady: { status: 'ready' },
      },
      {
        key: 'invest.kamino_earn_usdc_solana',
        label: 'Kamino Earn · USDC en Solana',
        status: 'ok',
        exclusion: null,
        chain: 'solana',
        balance: { raw: '40000000', amount: '40', decimals: 6, unit: 'USD' },
        rate: { raw: '418', decimals: 4, text: '0.0418' },
        // A zero here is a **real zero**: this person simply holds no free USDC on
        // Solana. It is an `ok`, so a row with a zero can still draw a button with
        // a zero ceiling. An unreadable chain would say `unreadable` instead.
        depositable: { status: 'ok', amount: { raw: '0', amount: '0', decimals: 6, unit: 'USDC' } },
        // Y el otro hecho, que es independiente del saldo: a este venue todavía
        // no se le puede depositar. Los dos viajan juntos y ninguno implica al otro.
        depositReady: {
          status: 'not_ready',
          reason: 'DEPOSIT_INSTRUCTIONS_UNVERIFIED',
          missingSteps: 2,
          message: expect.any(String),
        },
      },
    ]);

    // And it is a field of the invested bucket, not a fourth term of the headline:
    // the total is exactly what it was without the yield — 0.085926 of MON plus
    // 2.00 of free USDC plus the 100.00 deposited.
    expect(body.total.usd.amount).toBe('102.085926');
    expect(body.investedValue.total.amount).toBe('100');
  });

  it('answers no combined number when one venue cannot be read', async () => {
    const { app } = harness({
      ...twoVenues(),
      kamino: {
        shares: 40_000_000n,
        apy: { status: 'unreadable', reason: 'APY_NON_POSITIVE' },
      },
    });

    const response = await get(app);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BalanceBody;

    const combined = body.investedValue.yield;
    // `rate: null` inside a 200: the incompleteness is visible, and there is no
    // weighted mean over the venue that happened to answer.
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();
    expect(combined.venues[1]).toMatchObject({ status: 'unreadable', reason: 'APY_NON_POSITIVE' });
    // The money is unaffected: a missing rate is not a missing balance.
    expect(body.investedValue.complete).toBe(true);
    expect(body.investedValue.total.amount).toBe('100');
  });

  it('excludes a venue holding zero, and states that is why', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_AT_4_12 }),
      kamino: { shares: 0n, apy: { status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' } },
    });

    const body = (await (await get(app)).json()) as BalanceBody;
    const combined = body.investedValue.yield;

    // Complete, because a venue holding nothing cannot move a weighted mean — and
    // the exclusion is stated, so it can never be mistaken for a hole.
    expect(combined.complete).toBe(true);
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).toBe('4.1200');
    expect(combined.venues[1]).toMatchObject({ status: 'ok', exclusion: 'zero_balance' });
  });

  it('reports a real zero when nothing is deposited, and it is complete', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      pool: fakePool({ aTokenBalance: 0n, reserve: RESERVE_AT_4_12 }),
      kamino: { shares: 0n },
    });

    const body = (await (await get(app)).json()) as BalanceBody;

    expect(body.investedValue.yield.complete).toBe(true);
    expect(body.investedValue.yield.rate).toEqual({ numerator: '0', denominator: '1' });
  });

  it('publishes no combined number when Aave\'s own reconciliation refuses its rate', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_UNRECONCILED }),
      kamino: { shares: 40_000_000n },
    });

    const response = await get(app);
    const body = (await response.json()) as BalanceBody;

    // `readPool` still answers, and still publishes the position: the rate is what
    // is refused, and the combined figure inherits that refusal instead of
    // papering over it with a rate nobody can reproduce.
    const combined = body.investedValue.yield;
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();
    expect(combined.venues[0]).toMatchObject({ status: 'unreadable', reason: 'APR_NOT_RECONCILED' });
    expect(body.investedValue.complete).toBe(true);
  });

  it('publishes Aave\'s rate alone when the second venue is not wired', async () => {
    const { app } = harness({
      evm: evmReader(holdings, threeMon),
      pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_AT_4_12 }),
    });

    const body = (await (await get(app)).json()) as BalanceBody;
    const combined = body.investedValue.yield;

    expect(combined.complete).toBe(true);
    expect(percentLabelOfRatio(combined.rate as ExactRatio)).toBe('4.1200');
    expect(combined.venues).toHaveLength(1);
  });
});

/**
 * `depositable`: el saldo de origen de cada venue.
 *
 * El botón de depósito vive en la fila del venue, así que la fila tiene que
 * decir **cuánto se puede depositar ahí**. Los tests de acá describen los dos
 * defectos que ese número puede tener:
 *
 *  1. **el cruce de cadenas** — el modal de Kamino mostrando el USDC libre de
 *     Monad, que es plata de otra red y que no se puede mandar a ningún lado;
 *  2. **el cero inventado** — una cadena que no se pudo leída vestida de `0`,
 *     que es la cifra sobre la que alguien firmaría una autorización.
 *
 * Y el tercero, que es el que este archivo entero existe para que no pase: que
 * publicar el saldo de origen lo sume en algún lado.
 */
describe('el saldo de origen de cada venue: `depositable`', () => {
  /** La fila de un venue por su key, o el test revienta en vez de en `undefined`. */
  const rowOf = (body: BalanceBody, key: string) => {
    const found = body.investedValue.yield.venues.find((venue) => venue.key === key);
    if (found === undefined) throw new Error(`no venue ${key}`);
    return found;
  };
  /** A $60 on Aave / $40 on Kamino, with free USDC of its own on each chain. */
  const twoChains = (solanaFreeUsdc: bigint, monadFreeUsdc = '1500000') => ({
    evm: evmReader({ [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: monadFreeUsdc }, threeMon),
    solana: solanaReader({}, { [SOLANA_USDC_MINT]: solanaFreeUsdc }),
    pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_AT_4_12 }),
    kamino: { shares: 40_000_000n },
  });

  it('takes each venue\'s origin from ITS OWN chain, and never from the other', async () => {
    const { app } = harness(twoChains(2_500_000n));

    const body = (await (await get(app)).json()) as BalanceBody;
    const aave = rowOf(body, 'invest.aave_v3_usdc_monad');
    const kamino = rowOf(body, 'invest.kamino_earn_usdc_solana');

    // $1.50 free on Monad for the Monad venue; $2.50 free on Solana for the
    // Solana one. Two different networks, two different numbers, and neither
    // venue can see the other's.
    expect(aave.depositable).toEqual({
      status: 'ok',
      amount: { raw: '1500000', amount: '1.5', decimals: 6, unit: 'USDC' },
    });
    expect(kamino.depositable).toEqual({
      status: 'ok',
      amount: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USDC' },
    });

    // The crossed answers, named: each of these is what a swap would produce, and
    // neither is what the answer says.
    expect(aave.depositable).not.toEqual(kamino.depositable);
    expect(aave.depositable).not.toMatchObject({ amount: { raw: '2500000' } });
    expect(kamino.depositable).not.toMatchObject({ amount: { raw: '1500000' } });
  });

  it('answers `unreadable`, never `0`, when the chain\'s free piece could not be read', async () => {
    /*
     * El mismo fixture, con la lectura de Monad caída. El Aave venue sigue
     * publicando su posición exacta — la posición se leyó — pero su **origen** no,
     * y esa es una respuesta distinta de "no tenés nada".
     *
     * El `evmReader` sin holdings lanza en cada `erc20Balance`, así que la cadena
     * entera queda ilegible: es el peor caso, y el que no puede degenerar en un 0
     * sin que un test lo note.
     */
    const { app } = harness({
      ...twoChains(2_500_000n),
      evm: evmReader({}, threeMon),
    });

    const body = (await (await get(app)).json()) as BalanceBody;

    // `unreadable` con el motivo de la lectura, y **sin** ninguna cifra: un `0`
    // acá es un botón que deposita sobre un número que nadie conoce.
    const aave = rowOf(body, 'invest.aave_v3_usdc_monad');
    expect(aave.depositable).toEqual({ status: 'unreadable', reason: 'RPC_UNAVAILABLE' });
    expect(aave.depositable).not.toHaveProperty('amount');
    // Y no es el cero: el mismo campo en el otro venue, con la cadena legible,
    // es `ok` con una cifra.
    expect(rowOf(body, 'invest.kamino_earn_usdc_solana').depositable).toEqual({
      status: 'ok',
      amount: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USDC' },
    });
  });

  it('publishes a real zero as `ok`, because nobody holding free USDC is a fact', async () => {
    // Same two venues, and this person simply holds no free USDC anywhere.
    const { app } = harness({
      evm: evmReader({ [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '0' }, threeMon),
      solana: solanaReader({}, { [SOLANA_USDC_MINT]: 0n }),
      pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_AT_4_12 }),
      kamino: { shares: 40_000_000n },
    });

    const body = (await (await get(app)).json()) as BalanceBody;
    const venues = body.investedValue.yield.venues;

    // Cero legible: `ok` con `raw: '0'`, no `unreadable`. Un `0` real puede
    // dibujar su botón con tope cero; un `unreadable` no dibuja ninguno.
    for (const venue of venues) {
      expect(venue.depositable).toEqual({ status: 'ok', amount: { raw: '0', amount: '0', decimals: 6, unit: 'USDC' } });
    }
    // Y sigue siendo una fila entera: una posición depositada es real aunque no
    // haya nada libre para sumar.
    expect(venues.map((venue) => venue.status)).toEqual(['ok', 'ok']);
  });

  it('publishes it even when the venue\'s own position or rate is unreadable', async () => {
    // El origen y la posición son dos hechos separados: el botón depende del
    // primero, y no puede desaparecer porque el segundo fallara.
    const { app } = harness({
      ...twoChains(2_500_000n),
      kamino: { shares: 40_000_000n, apy: { status: 'unreadable', reason: 'APY_NON_POSITIVE' } },
    });

    const body = (await (await get(app)).json()) as BalanceBody;

    expect(body.investedValue.yield.venues[1]).toMatchObject({
      status: 'unreadable',
      reason: 'APY_NON_POSITIVE',
      depositable: { status: 'ok', amount: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USDC' } },
    });
  });

  it('does not change a single figure of the balance: no double count', async () => {
    /*
     * Éste es el test que protege la plata. El saldo de origen es **la misma** USDC
     * libre que `digitalDollarsValue` ya contó del lado libre: sumarlo en algún
     * lado —
     *
     *   free Monad 1.50 + free Ethereum 0.50 + free Solana 2.50 = 4.50
     *   posiciones depositadas                                 = 100.00
     *   ─────────────────────────────────────────────────────────────────────
     *   d\u00f3lares digitales                                        104.50
     *
     * — y cualquier cifra que valga 109.00 delata el doble conteo. Lo mismo con el
     * total: 104.585926, no 109.085926.
     */
    const { app } = harness({
      evm: evmReader({ ...holdings, [`ethereum:${ETHEREUM_USDC}:${EVM_ADDRESS}`]: '500000' }, threeMon),
      solana: solanaReader({}, { [SOLANA_USDC_MINT]: 2_500_000n }),
      pool: fakePool({ aTokenBalance: 60_000_000n, reserve: RESERVE_AT_4_12 }),
      kamino: { shares: 40_000_000n },
    });

    const body = (await (await get(app)).json()) as BalanceBody;

    // Los dos origins están publicados y ninguno está recontado.
    expect(body.investedValue.yield.venues.map((venue) => venue.depositable)).toEqual([
      { status: 'ok', amount: { raw: '1500000', amount: '1.5', decimals: 6, unit: 'USDC' } },
      { status: 'ok', amount: { raw: '2500000', amount: '2.5', decimals: 6, unit: 'USDC' } },
    ]);

    // Los tres buckets, exactos, con los origins presentes.
    expect(body.cryptoValue.total.amount).toBe('0.085926');
    expect(body.cryptoValue.complete).toBe(false);
    expect(body.investedValue.total.amount).toBe('100');
    expect(body.investedValue.complete).toBe(true);
    expect(body.digitalDollarsValue.total.amount).toBe('104.5');
    expect(body.digitalDollarsValue.complete).toBe(true);
    expect(body.total.usd.amount).toBe('104.585926');
    // Same honest gap: polygon POL is read, but there is no verified feed for it.
    expect(body.total.complete).toBe(false);

    // Y el origen no se coló como una pieza más: `investedValue` sigue siendo las
    // dos posiciones y nada más, y cada origin sigue siendo **una sola** pieza
    // del lado libre, contada una vez.
    expect(body.investedValue.pieces.map((piece) => piece.key)).toEqual([
      'invest.aave_v3_usdc_monad',
      'invest.kamino_earn_usdc_solana',
    ]);
    const freeKeys = body.digitalDollarsValue.pieces
      .filter((piece) => piece.source === 'free_wallet')
      .map((piece) => piece.key);
    expect(freeKeys).toEqual([
      'dollars.monad.USDC',
      'dollars.ethereum.USDC',
      'dollars.base.USDC',
      'dollars.base.USDT',
      'dollars.arbitrum.USDC',
      'dollars.arbitrum.USDT',
      'dollars.optimism.USDC',
      'dollars.optimism.USDT',
      'dollars.polygon.USDC',
      'dollars.polygon.USDT',
      'dollars.solana.USDC',
    ]);
  });

  it('carries a free balance no float could hold, digit for digit', async () => {
    /*
     * Un saldo de origen de 30 dígitos, muy por encima de `Number.MAX_SAFE_INTEGER`.
     * La aritmética del importe es `bigint` de punta a punta: si algo cruzara un
     * `number` en el medio, los últimos dígitos no voltarían — y una cifra de
     * depósito con el final redondeado es una autorización sobre otra cantidad.
     */
    const huge = '987654321098765432109876543210';
    const { app } = harness(twoChains(2_500_000n, huge));

    const body = (await (await get(app)).json()) as BalanceBody;
    const origin = rowOf(body, 'invest.aave_v3_usdc_monad').depositable;

    expect(origin).toEqual({
      status: 'ok',
      amount: { raw: huge, amount: '987654321098765432109876.54321', decimals: 6, unit: 'USDC' },
    });
    // The exact integer survives the round trip; the float does not, and never
    // gets asked to.
    expect(BigInt(origin.status === 'ok' ? origin.amount.raw : '0')).toBe(BigInt(huge));
    expect(String(Number(huge))).not.toBe(huge);
  });
});

/*
 * `depositReady`: SI EL VENUE PUEDE RECIBIR EL DEPÓSITO.
 *
 * ── El defecto que este archivo evita ────────────────────────────────────────
 *
 * El botón de depósito vive en la fila del venue, así que la fila tiene que decir
 * si esa fila puede recibir plata. Y hay **dos verdades** que podrían desincronizarse
 * sin que nada falle: la fila del balance (`depositReady`) y la preparación del
 * depósito (`completion` en `POST /api/pool/deposit`). El día que alguien construya
 * las dos instrucciones que faltan del farm de Kamino, la tentación es cambiar el
 * `false` de un lado y olvidar el otro — y el resultado es un botón que dibuja y
 * una transacción que falla en la red principal.
 *
 * Por eso el test de acá no prueba "que Kamino diga que no": prueba que **las dos
 * respuestas no puedan contradecirse**, corriendo los dos casos de uso de verdad
 * sobre los mismos ports.
 *
 * Y el otro defecto, que es el que la decisión del owner dejó escrito: un flag por
 * venue **escrito a mano en el front**. Eso no se arregla acá, pero se documenta:
 * por eso `depositReady` viaja en la respuesta y la pantalla no tiene lista propia.
 */
describe('si el venue puede recibir el depósito: `depositReady`', () => {
  const rowOf = (body: BalanceBody, key: string) => {
    const found = body.investedValue.yield.venues.find((venue) => venue.key === key);
    if (found === undefined) throw new Error(`no venue ${key}`);
    return found;
  };

  /**
   * El preparador de Kamino, que es un puerto y no un caso de uso: la respuesta
   * del balance **no** lo necesita —el depósito no se prepara para leer el
   * balance—, pero hace falta acá para correr `prepareDepositKamino` sobre los
   * mismos ports y comparar las dos respuestas.
   */
  const fakePreparer = (): KaminoDepositPreparer => {
    const accountsOf = (): KaminoDepositAccounts => ({
      vault: {
        address: KAMINO_VAULT.address,
        protocol: 'Kamino Earn',
        program: 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd',
        tokenMint: KAMINO_VAULT.tokenMint,
        tokenDecimals: 6,
        sharesMint: KAMINO_VAULT.sharesMint,
      },
      accounts: [
        { role: 'usdc_token_account', address: 'UsdcAta1111111111111111111111111111111111', exists: true, rent: { status: 'ok', lamports: 2_039_280n } },
        { role: 'shares_token_account', address: 'SharesAta11111111111111111111111111111111', exists: true, rent: { status: 'ok', lamports: 2_039_280n } },
      ],
      requiredRentLamports: 0n,
      unpricedAccounts: 0,
    });

    return {
      accounts: async () => accountsOf(),
      prepare: async () => ({
        serializedTransaction: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY',
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqK',
      }),
    };
  };

  it('says why a venue cannot receive a deposit, instead of a bare `false`', async () => {
    const { app } = harness({ kamino: { shares: 40_000_000n } });

    const body = (await (await get(app)).json()) as BalanceBody;

    // Aave sí: su depósito se arma y se ejecuta, y no lleva nada más al lado.
    expect(rowOf(body, 'invest.aave_v3_usdc_monad').depositReady).toEqual({ status: 'ready' });

    // Kamino no, y el `false` viene con un motivo acotado y una frase para pintar
    // tal cual. Un `false` pelado obligaría a la pantalla a inventar la explicación.
    const kamino = rowOf(body, 'invest.kamino_earn_usdc_solana').depositReady;
    expect(kamino.status).toBe('not_ready');
    if (kamino.status !== 'not_ready') throw new Error('unreachable');
    expect(kamino.reason).toBe('DEPOSIT_INSTRUCTIONS_UNVERIFIED');
    expect(kamino.missingSteps).toBeGreaterThan(0);
    expect(kamino.message.length).toBeGreaterThan(0);
    // Y es una frase, no un código: sin mayúsculas de enum ni guiones bajos.
    expect(kamino.message).not.toMatch(/[A-Z_]{4,}/);
  });

  it('does not contradict what the deposit endpoint actually executes', async () => {
    const { app, solana, log } = harness({ kamino: { shares: 40_000_000n } });

    const body = (await (await get(app)).json()) as BalanceBody;

    // La misma persona, la misma billetera, el mismo lector de Solana: lo que el
    // balance dice que se puede depositar y lo que la preparación dice que se
    // ejecuta, contados uno por uno.
    const readiness = new Map(body.investedValue.yield.venues.map((venue) => [venue.key, venue.depositReady]));

    const aave = await prepareDeposit({
      wallets: twoWalletRows,
      pool: fakePool(),
      log,
    })(USER_ID, '1000000');
    const kamino = await prepareDepositKamino({
      wallets: twoWalletRows,
      solana: solana,
      preparer: fakePreparer(),
      log,
    })(USER_ID, '1000000');

    // El botón de la fila de Kamino y el `completion` del depósito de Kamino son
    // **la misma verdad dicha en dos lugares**: o los dos están abiertos, o los
    // dos están cerrados. Un lado_only sería un botón que falla en mainnet.
    const kaminoReady = readiness.get('invest.kamino_earn_usdc_solana');
    if (kaminoReady === undefined) throw new Error('the Kamino venue row did not arrive');
    expect(kaminoReady.status === 'ready').toBe(kamino.completion.executes);
    expect(kamino.completion.executes).toBe(false);
    expect(kaminoReady.status === 'not_ready' && kaminoReady.missingSteps).toBe(
      kamino.completion.missingSteps.length,
    );

    // Y Aave, que sí ejecuta, tampoco se contradice: su fila ofrece botón y su
    // preparación trae las dos transacciones que se firman.
    const aaveReady = readiness.get('invest.aave_v3_usdc_monad');
    expect(aaveReady?.status).toBe('ready');
    expect(aave.transactions.length).toBeGreaterThan(0);
  });
});

describe('GET /api/wallet-balance — the door', () => {
  it('answers 401 without a cookie, and reads nothing', async () => {
    const { app, evm, solana, pool, prices } = harness();

    const response = await app.request('/api/wallet-balance');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(evm.asked).toEqual([]);
    expect(solana.asked).toEqual([]);
    expect((pool as AavePoolReader & { asked: string[] }).asked).toEqual([]);
    expect(prices.asked).toEqual([]);
  });

  it('answers 401 for a cookie that does not verify, and reads nothing', async () => {
    const { app, evm, prices } = harness();

    const response = await app.request('/api/wallet-balance', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=stale.or.expired` },
    });

    expect(response.status).toBe(401);
    expect(evm.asked).toEqual([]);
    expect(prices.asked).toEqual([]);
  });

  it('answers 502, not a balance of zeroes, when the wallet rows cannot be read', async () => {
    const { app } = harness({ wallets: failingWalletStore });

    const response = await get(app);

    // Without the rows there is no address for any piece, so there is no partial
    // truth either: a total of zero would be a lie about somebody's account.
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'WALLETS_UNAVAILABLE' } });
  });

  it('is absent, rather than answering zeroes, when the use case is not wired', async () => {
    const { app } = harness({ withoutBalance: true });
    expect((await get(app)).status).toBe(404);
  });
});

describe('GET /api/wallet-balance — nothing in the request is read', () => {
  it('ignores an address, a chain or a userId in the query string', async () => {
    const { app, evm, solana, prices } = harness({ evm: evmReader(holdings, threeMon) });

    const response = await get(
      app,
      '?address=0x000000000000000000000000000000000000dEaD&chain=ethereum&userId=someone-else',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as BalanceBody;

    // Every read used the database address, and only the symbols the catalog has.
    expect(evm.asked.every((call) => call.endsWith(EVM_ADDRESS))).toBe(true);
    expect(solana.asked).toEqual([SOLANA_ADDRESS]);
    expect(prices.asked).toEqual(['MON', 'ETH', 'SOL']);
    expect(JSON.stringify(body)).not.toContain('dEaD');
    expect(JSON.stringify(body)).not.toContain('someone-else');
  });

  it('answers only for the person the cookie proved', async () => {
    const askedFor: string[] = [];
    const rows = twoWalletRows;
    const { app } = harness({
      wallets: {
        findByUserId: async (id) => {
          askedFor.push(id);
          return rows.findByUserId(id);
        },
        save: async () => {},
      },
    });

    await get(app, '?userId=someone-else');

    expect(askedFor.length).toBeGreaterThan(0);
    expect(askedFor.every((id) => id === USER_ID)).toBe(true);
  });

  it('has no method that carries a body, so an address in one cannot arrive', async () => {
    const { app, evm } = harness();

    const response = await app.request('/api/wallet-balance', {
      method: 'POST',
      headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', chain: 'monad' }),
    });

    expect(response.status).toBe(404);
    expect(evm.asked).toEqual([]);
  });
});
