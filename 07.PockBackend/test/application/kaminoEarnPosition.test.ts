/**
 * The Kamino Earn venue: the use case, and its place in the composed balance —
 * **no network, no database, both collaborators faked.**
 *
 * ── What this file is for ────────────────────────────────────────────────────
 *
 * One shape, nine ways it can be wrong, and every one of them is a way this
 * application could tell a person they have less money than they have:
 *
 *  1. reading the **wallet's other tokens** instead of the vault's shares mint —
 *     the trap, and it fails *silently*;
 *  2. ignoring shares **staked in the farm**, which Kamino's docs say are
 *     invisible in the wallet;
 *  3. rounding the conversion, or assuming the price's scale;
 *  4. reading a **zero** where a failed read happened;
 *  5. reporting an outage as an **empty** position;
 *  6. folding the second venue in as a new bucket, or double counting it.
 *
 * The composition half is built on the **real** `readPortfolio`, `readPool` and
 * `readWalletBalance` over fake readers, so "the Aave position still reads exactly
 * as before" and "the buckets stay disjoint" are assertions about this code and
 * not about a stub.
 */
import { describe, expect, it } from 'vitest';

import { readPortfolio } from '../../src/application/portfolio/readPortfolio';
import { readPool } from '../../src/application/pool/readPool';
import {
  readKaminoEarnPosition,
  valueOfShares,
} from '../../src/application/portfolio/readKaminoEarnPosition';
import {
  AAVE_V3_USDC_MONAD_KEY,
  KAMINO_EARN_USDC_SOLANA_KEY,
  readWalletBalance,
} from '../../src/application/portfolio/readWalletBalance';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import type { AavePoolReader } from '../../src/domain/ports/aave-pool-reader';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { PricedAsset, PriceFeed } from '../../src/domain/ports/price-feed';
import type { ReserveData } from '../../src/domain/pool/reserveData';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { FarmStateUnreadableError, type KaminoEarnVaultReader } from '../../src/domain/ports/kamino-earn-vault-reader';
import type {
  KaminoApyResult,
  KaminoSharePriceFeed,
  KaminoSharePriceResult,
} from '../../src/domain/ports/kamino-share-price-feed';
import type { KaminoKVaultState } from '../../src/domain/yield/kaminoEarnVault';
import {
  percentLabelOfRatio,
  type ExactRatio,
} from '../../src/domain/yield/combinedYield';
import { EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const NOW = new Date('2026-10-04T05:00:00.000Z');

/** The vault, as its own account decodes it. The values are the pinned ones. */
const VAULT: KaminoKVaultState = {
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

/** The live share price, at the nineteen decimals it is published with. */
const LIVE_PRICE = { raw: 10617770761260384793n, decimals: 19, usd: '1.0617770761260384793' };

/** The live APY, at the eighteen decimals Kamino publishes it with. */
const LIVE_APY = { raw: 41808723945949255n, decimals: 18, text: '0.041808723945949255' };

const twoWalletRows: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

interface VaultFake {
  readonly askedForStakes: (string | null)[];
  readonly reader: KaminoEarnVaultReader;
}

const vaultReader = (options: { staked?: bigint; farmUnreadable?: boolean; vaultFails?: boolean } = {}): VaultFake => {
  const askedForStakes: (string | null)[] = [];
  return {
    askedForStakes,
    reader: {
      vault: async () => {
        if (options.vaultFails === true) throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'not a KVault account');
        return VAULT;
      },
      stakedShares: async (farm, owner) => {
        askedForStakes.push(farm);
        if (options.farmUnreadable === true) {
          throw new FarmStateUnreadableError('a farm account exists and its user state could not be decoded');
        }
        return options.staked ?? 0n;
      },
    },
  };
};

interface SolanaFake {
  readonly askedMints: string[];
  readonly reader: SolanaBalanceReader;
}

/**
 * The SPL reader over injected values, and a record of every mint it was asked
 * about. A mint it was not told about answers `0n`, which is an empty account and
 * not a failure.
 */
const solanaReader = (balances: Record<string, bigint | BalanceReadError> = {}): SolanaFake => {
  const askedMints: string[] = [];
  return {
    askedMints,
    reader: {
      lamports: async () => 1_234_567_890n,
      tokenAmount: async () => 0n,
      mintBalance: async (_owner, mint) => {
        askedMints.push(mint);
        const answer = balances[mint];
        if (answer === undefined) return 0n;
        if (answer instanceof BalanceReadError) throw answer;
        return answer;
      },
    },
  };
};

const priceFeed = (
  result: KaminoSharePriceResult = { status: 'ok', value: LIVE_PRICE },
  apy: KaminoApyResult = { status: 'ok', value: LIVE_APY },
): KaminoSharePriceFeed & {
  readonly asked: string[];
} => {
  const asked: string[] = [];
  return {
    asked,
    sharePrice: async (vault) => {
      asked.push(vault);
      return result;
    },
    apy: async (vault) => {
      asked.push(vault);
      return apy;
    },
  };
};

const readPosition = (options: {
  solana?: SolanaFake;
  vault?: VaultFake;
  prices?: ReturnType<typeof priceFeed>;
  wallets?: WalletStore;
} = {}) => {
  const solana = options.solana ?? solanaReader({ [VAULT.sharesMint]: 1_000_000n });
  const vault = options.vault ?? vaultReader();
  const prices = options.prices ?? priceFeed();
  const log = recordingLogger();
  const read = readKaminoEarnPosition({
    wallets: options.wallets ?? twoWalletRows,
    vaults: vault.reader,
    solana: solana.reader,
    prices,
    log,
  });
  return { read, solana, vault, prices, log };
};

describe('the Kamino Earn position', () => {
  it('reads the shares from the shares-mint account, not from the wallet\'s other tokens', async () => {
    const { read, solana } = readPosition({
      solana: solanaReader({
        [VAULT.sharesMint]: 1_000_000n,
        // Everything else this wallet holds, which is not a Kamino position.
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 500_000_000n,
        Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 7_000_000n,
      }),
    });

    const position = await read(USER_ID, NOW);

    // The **one** question that was asked, and it is about the vault's own mint.
    expect(solana.askedMints).toEqual([VAULT.sharesMint]);

    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;
    expect(position.shares.raw).toBe(1_000_000n);
    expect(position.shares.decimals).toBe(6);
  });

  it('includes shares staked in the farm, which the wallet cannot show', async () => {
    /*
     * Kamino's docs: "If the vault has a farm attached, shares are automatically
     * staked in the farm and are not visible in the user's wallet." So a reader
     * that only looked at the wallet would report a smaller position and nothing
     * would look wrong.
     */
    const { read, vault } = readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 1_000_000n }),
      vault: vaultReader({ staked: 2_500_000n }),
    });

    const position = await read(USER_ID, NOW);

    expect(vault.askedForStakes).toEqual(['9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj']);
    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;
    expect(position.shares.staked).toBe(2_500_000n);
    expect(position.shares.raw).toBe(3_500_000n);
  });

  it('reports a farm that cannot be read as incomplete, never as a smaller position', async () => {
    const { read } = readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 1_000_000n }),
      vault: vaultReader({ farmUnreadable: true }),
    });

    const position = await read(USER_ID, NOW);

    // Not `ok` with the wallet's shares alone: that would be a position smaller
    // than the person holds, silently.
    expect(position.status).toBe('unreadable');
    if (position.status !== 'unreadable') return;
    expect(position.reason).toBe('FARM_STATE_UNREADABLE');
    // What *was* read is kept, and it is never valued.
    expect(position.shares?.raw).toBe(1_000_000n);
    expect(position.shares?.staked).toBe(0n);
  });

  it('values the position as shares x price, exactly, at the combined scale', async () => {
    const { read } = readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 1_000_000n }), // one share
      vault: vaultReader({ staked: 500_000n }), // one and a half
    });

    const position = await read(USER_ID, NOW);
    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;

    // 6 + 19 = 25 decimals, and the product is carried whole.
    expect(position.price).toEqual(LIVE_PRICE);
    expect(position.value.decimals).toBe(25);
    expect(position.value.raw).toBe((1_500_000n * LIVE_PRICE.raw).toString());
    expect(position.value.amount).toBe('1.59266561418905771895');

    // The same figure from the exported conversion, so the composition and the
    // use case cannot be doing different arithmetic.
    expect(valueOfShares(position.shares, LIVE_PRICE)).toEqual(position.value);
  });

  it('keeps whatever scale the price carries, and never rounds inside', async () => {
    // A four-decimal price today and nineteen tomorrow must both be exact.
    const { read } = readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 1n }), // one millionth of a share
      prices: priceFeed({ status: 'ok', value: { raw: 10625n, decimals: 4, usd: '1.0625' } }),
    });

    const position = await read(USER_ID, NOW);
    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;

    expect(position.value.decimals).toBe(10);
    expect(position.value.raw).toBe('10625');
    expect(position.value.amount).toBe('0.0000010625');
  });

  it('carries the vault APY exactly as Kamino published it, on the same port', async () => {
    const { read, prices } = readPosition();

    const position = await read(USER_ID, NOW);

    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;

    // Eighteen fractional digits, read off the answer's own digits.
    expect(position.apy).toEqual(LIVE_APY);
    expect(position.apyReason).toBeNull();
    // One vault, asked of the same injected port for both questions.
    expect(new Set(prices.asked)).toEqual(new Set(['HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E']));
  });

  it('leaves the position exact and ok when only the APY is unreadable', async () => {
    const { read } = readPosition({
      prices: priceFeed(undefined, { status: 'unreadable', reason: 'APY_NON_POSITIVE' }),
    });

    const position = await read(USER_ID, NOW);

    /*
     * A rate this code cannot read is not a balance it cannot read. The position
     * is still `ok` and still exact — publishing it as anything else would be a
     * $1,000 deposit turning into a hole because a yield field was malformed.
     */
    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;
    expect(position.apy).toBeNull();
    expect(position.apyReason).toBe('APY_NON_POSITIVE');
    expect(position.value.raw).toBe((1_000_000n * LIVE_PRICE.raw).toString());
  });

  it('reports zero shares as ok with a zero, never as unreadable', async () => {
    const { read } = readPosition({ solana: solanaReader({ [VAULT.sharesMint]: 0n }) });

    const position = await read(USER_ID, NOW);

    // `0n` is falsy: this is the branch a truthiness test would have broken.
    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;
    expect(position.shares.raw).toBe(0n);
    expect(position.value).toEqual({ raw: '0', amount: '0', decimals: 0, unit: 'USD' });
  });

  it('reports zero shares as zero even when Kamino is down, because zero x any price is zero', async () => {
    const { read } = readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 0n }),
      prices: priceFeed({ status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' }),
    });

    const position = await read(USER_ID, NOW);

    expect(position.status).toBe('ok');
    if (position.status !== 'ok') return;
    expect(position.value.raw).toBe('0');
    expect(position.price).toBeNull();
  });

  it('never turns an unreadable share read or an unreachable price into a zero', async () => {
    const sharesFailed = await readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: new BalanceReadError('RPC_REJECTED', 'the node refused') }),
    }).read(USER_ID, NOW);

    expect(sharesFailed.status).toBe('unreadable');
    if (sharesFailed.status !== 'unreadable') return;
    expect(sharesFailed.reason).toBe('RPC_REJECTED');
    expect(sharesFailed.shares).toBeNull();

    const priceFailed = await readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 1_000_000n }),
      prices: priceFeed({ status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' }),
    }).read(USER_ID, NOW);

    expect(priceFailed.status).toBe('unreadable');
    if (priceFailed.status !== 'unreadable') return;
    expect(priceFailed.reason).toBe('KAMINO_UNAVAILABLE');
    // The share count survives: it is true, and it is not valued.
    expect(priceFailed.shares?.raw).toBe(1_000_000n);

    // A price of nothing is not a price.
    const nonPositive = await readPosition({
      solana: solanaReader({ [VAULT.sharesMint]: 1_000_000n }),
      prices: priceFeed({ status: 'unreadable', reason: 'SHARE_PRICE_NON_POSITIVE' }),
    }).read(USER_ID, NOW);
    expect(nonPositive.status).toBe('unreadable');
  });

  it('reports a vault account it cannot decode as unreadable, with its own reason', async () => {
    const { read } = readPosition({ vault: vaultReader({ vaultFails: true }) });

    const position = await read(USER_ID, NOW);

    // Not "the endpoint did not answer": a struct this repository cannot read is
    // ours to investigate, and it is a different investigation.
    expect(position.status).toBe('unreadable');
    if (position.status !== 'unreadable') return;
    expect(position.reason).toBe('VAULT_LAYOUT_UNREADABLE');
  });

  it('knows that a person with no Solana wallet has no position, and says so by being absent', async () => {    const evmOnly: WalletStore = {
      findByUserId: async () => [
        { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
      ],
      save: async () => {},
    };
    const { read, solana } = readPosition({ wallets: evmOnly, solana: solanaReader({ [VAULT.sharesMint]: 1_000_000n }) });

    const position = await read(USER_ID, NOW);

    expect(position.status).toBe('no_wallet');
    // And nothing was read: a known absence is not a hole, and it must not cost a
    // cluster call or make anybody's balance permanently incomplete.
    expect(solana.askedMints).toEqual([]);
  });

  it('takes the address from the wallet rows, and nothing from the caller', async () => {
    const calls: { owner: string; mint: string }[] = [];
    const solana: SolanaBalanceReader = {
      lamports: async () => 0n,
      tokenAmount: async () => 0n,
      mintBalance: async (owner, mint) => {
        calls.push({ owner, mint });
        return 1_000_000n;
      },
    };
    const log = recordingLogger();
    const read = readKaminoEarnPosition({
      wallets: twoWalletRows,
      vaults: vaultReader().reader,
      solana,
      prices: priceFeed(),
      log,
    });

    await read(USER_ID, NOW);

    // The only inputs are the user id and the time. The address came from
    // `rewallet.wallets`, so there is no parameter through which another
    // person's money could be described.
    expect(calls).toEqual([{ owner: SOLANA_ADDRESS, mint: VAULT.sharesMint }]);
  });
});

/* ── The composition: a second venue in a bucket that already existed ──────── */

const RESERVE: ReserveData = {
  unbacked: 0n,
  accruedToTreasuryScaled: 138625857678n,
  totalAToken: 173874477777314n,
  totalStableDebt: 0n,
  totalVariableDebt: 159699152103313n,
  liquidityRate: 41196389349252103065387833n,
  variableBorrowRate: 49876895160470413431331597n,
  stableBorrowRate: 0n,
  averageStableBorrowRate: 0n,
  liquidityIndex: 1009859695804839225116566637n,
  variableBorrowIndex: 1012201287234727256155333993n,
  lastUpdateTimestamp: 1791088293n,
};

const A_TOKEN = '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042';

/** The Aave position, unchanged: `0.820428` USDC worth of `aMonUSDC`. */
const fakePool = (options: { aTokenBalance?: bigint; reserve?: ReserveData } = {}): AavePoolReader => ({
  reserveData: async () => options.reserve ?? RESERVE,
  reserveConfiguration: async () => ({
    decimals: 6n,
    ltv: 7500n,
    liquidationThreshold: 7800n,
    reserveFactorBps: 1000n,
    isActive: true,
    isFrozen: false,
  }),
  erc20Balance: async (token) => (token === A_TOKEN ? (options.aTokenBalance ?? 820_428n) : 1_500_000n),
  allowance: async () => 0n,
  nativeBalance: async () => 3_000_000_000_000_000_000n,
});

const evmReader = (): EvmBalanceReader => ({
  nativeBalance: async () => 0n,
  erc20Balance: async () => 0n,
});

/** A feed that answers every non-pegged asset, so the crypto side is complete. */
const PRICES: Record<PricedAsset, { raw: string; usd: string; decimals: number; pair: string }> = {
  MON: { raw: '2864200', usd: '0.028642', decimals: 8, pair: 'MON_USD' },
  ETH: { raw: '268939000000', usd: '2689.39', decimals: 8, pair: 'ETH_USD' },
  SOL: { raw: '1462500000000000000', usd: '1.4625', decimals: 18, pair: 'SOL_USD' },
  BTC: { raw: '9500000000000', usd: '95000', decimals: 8, pair: 'BTC_USD' },
};

const prices: PriceFeed = {
  usdPrice: async (asset) => ({
    status: 'ok',
    value: { asset, ...PRICES[asset], updatedAt: 1_700_000_000, crossChecked: false },
  }),
};

interface Composition {
  readonly balance: Awaited<ReturnType<ReturnType<typeof readWalletBalance>>>;
  readonly solana: SolanaFake;
}

/** The **real** composition, over fake readers. Not a stub of the answer. */
const compose = async (options: {
  shares?: bigint | BalanceReadError;
  prices?: KaminoSharePriceResult;
  apy?: KaminoApyResult;
  aTokenBalance?: bigint;
  reserve?: ReserveData;
} = {}): Promise<Composition> => {
  const log = recordingLogger();
  const solana = solanaReader({
    [VAULT.sharesMint]: options.shares ?? 1_000_000n,
    // The same person's free USDC on Solana: a **different** piece, and the one a
    // double count would show up on.
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 2_000_000n,
  });
  const wallets = twoWalletRows;
  const pool = fakePool({ aTokenBalance: options.aTokenBalance, reserve: options.reserve });
  const evm = evmReader();
  const portfolio = readPortfolio({ wallets, evm, solana: solana.reader, log });
  const poolRead = readPool({ wallets, pool, log });
  const kamino = readKaminoEarnPosition({
    wallets,
    vaults: vaultReader().reader,
    solana: solana.reader,
    prices: priceFeed(
      options.prices ?? { status: 'ok', value: LIVE_PRICE },
      options.apy ?? { status: 'ok', value: LIVE_APY },
    ),
    log,
  });

  const balance = await readWalletBalance({
    readPortfolio: portfolio,
    readPool: poolRead,
    readKaminoEarn: kamino,
    prices,
    log,
  })(USER_ID, NOW);

  return { balance, solana };
};

describe('the second venue in the composed balance', () => {
  it('adds Kamino to the invested bucket and to the total, with no new bucket', async () => {
    const { balance } = await compose();

    const keys = balance.investedValue.pieces.map((piece) => piece.key);
    expect(keys).toEqual([AAVE_V3_USDC_MONAD_KEY, KAMINO_EARN_USDC_SOLANA_KEY]);

    // The Aave piece reads exactly as it did before this venue existed.
    const aave = balance.investedValue.pieces[0];
    expect(aave?.status).toBe('ok');
    expect(aave?.value).toEqual({ raw: '820428', amount: '0.820428', decimals: 6, unit: 'USD' });
    expect(aave?.price).toEqual({
      usd: '1',
      raw: '1',
      decimals: 0,
      source: 'peg',
      pair: null,
      updatedAt: null,
      crossChecked: null,
    });

    // The Kamino piece: labelled with its protocol **and** its chain, valued by
    // the share price it published, never by the peg table.
    const kamino = balance.investedValue.pieces[1];
    expect(kamino?.status).toBe('ok');
    expect(kamino?.chain).toBe('solana');
    expect(kamino?.source).toBe('pool_position');
    expect(kamino?.quantity).toEqual({
      raw: '1000000',
      amount: '1',
      decimals: 6,
      unit: 'kV-STKUSDC',
    });
    expect(kamino?.price).toEqual({
      usd: LIVE_PRICE.usd,
      raw: LIVE_PRICE.raw.toString(),
      decimals: 19,
      source: 'kamino_share_price',
      pair: null,
      updatedAt: null,
      crossChecked: null,
    });
    expect(kamino?.value?.decimals).toBe(25);

    // And it is in the sum, at the **widest** scale of everything in it: SOL is
    // nine decimals against an eighteen-decimal feed, so the headline is at 27 and
    // the Kamino value at 25 was scaled up to it exactly.
    expect(balance.investedValue.complete).toBe(true);
    expect(balance.total.complete).toBe(true);
    expect(balance.investedValue.total.decimals).toBe(25);
    expect(balance.total.usd.decimals).toBe(27);

    const kaminoRaw = BigInt(kamino?.value?.raw ?? '0');
    const kaminoDecimals = kamino?.value?.decimals ?? 0;
    const aaveRaw = BigInt(aave?.value?.raw ?? '0');
    expect(balance.investedValue.total.raw).toBe(
      (aaveRaw * 10n ** 19n + kaminoRaw).toString(),
    );
  });

  it('keeps the buckets disjoint: the invested view is inside the dollars, not added to them', async () => {
    const { balance } = await compose();

    const scale = Math.max(
      balance.cryptoValue.total.decimals,
      balance.digitalDollarsValue.total.decimals,
      balance.investedValue.total.decimals,
    );
    const at = (value: { raw: string; decimals: number }): bigint =>
      BigInt(value.raw) * 10n ** BigInt(scale - value.decimals);

    // The headline is exactly the two buckets, and `investedValue` is a view.
    expect(at(balance.total.usd)).toBe(at(balance.cryptoValue.total) + at(balance.digitalDollarsValue.total));
    expect(balance.total.usd.decimals).toBe(scale);

    // A piece is in the invested view exactly when it is in the dollars: same
    // object, so the two cannot disagree.
    const investedKeys = balance.investedValue.pieces.map((piece) => piece.key).sort();
    const dollarKeys = balance.digitalDollarsValue.pieces
      .filter((piece) => piece.source === 'pool_position')
      .map((piece) => piece.key)
      .sort();
    expect(dollarKeys).toEqual(investedKeys);

    // The **free** USDC on Solana and the Kamino position are different pieces:
    // the claim is not the money, and the free side was never re-counted.
    const freeSolanaUsdc = balance.digitalDollarsValue.pieces.find(
      (piece) => piece.key === 'dollars.solana.USDC',
    );
    expect(freeSolanaUsdc?.value?.raw).toBe('2000000');
    expect(balance.cryptoValue.pieces.some((piece) => piece.key.includes('USDC'))).toBe(false);
  });

  it('makes the buckets incomplete when the second venue cannot be read, and never smaller', async () => {
    const broken = await compose({ prices: { status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' } });
    const kamino = broken.balance.investedValue.pieces.find((piece) => piece.key === KAMINO_EARN_USDC_SOLANA_KEY);

    expect(kamino?.status).toBe('unreadable');
    expect(kamino?.reason).toBe('KAMINO_UNAVAILABLE');
    expect(kamino?.value).toBeNull();

    expect(broken.balance.investedValue.complete).toBe(false);
    expect(broken.balance.digitalDollarsValue.complete).toBe(false);
    expect(broken.balance.total.complete).toBe(false);

    // The partial total is still returned — it is what we do know — and it is
    // **beside** the statement that it is not the whole truth: the Aave claim,
    // with no smaller Kamino figure standing in for the one we could not read.
    expect(broken.balance.investedValue.total.raw).toBe('820428');
    expect(broken.balance.investedValue.total.decimals).toBe(6);

    // The Aave piece, meanwhile, reads exactly as before.
    const aave = broken.balance.investedValue.pieces.find((piece) => piece.key === AAVE_V3_USDC_MONAD_KEY);
    expect(aave?.status).toBe('ok');
    expect(aave?.value?.raw).toBe('820428');
  });

  it('composes exactly as before when the second venue is not wired at all', async () => {
    // A deployment without Kamino wired is not a different answer: it is the one
    // this repository had before this venue existed.
    const log = recordingLogger();
    const solana = solanaReader({ 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 2_000_000n });
    const balance = await readWalletBalance({
      readPortfolio: readPortfolio({ wallets: twoWalletRows, evm: evmReader(), solana: solana.reader, log }),
      readPool: readPool({ wallets: twoWalletRows, pool: fakePool(), log }),
      prices,
      log,
    })(USER_ID, NOW);

    expect(balance.investedValue.pieces.map((piece) => piece.key)).toEqual([AAVE_V3_USDC_MONAD_KEY]);
    expect(balance.investedValue.total.raw).toBe('820428');
    expect(balance.total.complete).toBe(true);
  });
});
/* ── The one yield figure, across both venues ─────────────────────────────── */

/**
 * A reserve whose supply APR reconciles **and** reads as exactly 4.1200 %.
 *
 * `aprPercentFromRay` is `rate x 1e6 / RAY` in integers, so 4.12 % is
 * `4.12e25` RAY and nothing else. It is written as a number here rather than
 * derived, because a test whose fixture is computed by the same expression it is
 * checking would agree with a broken implementation.
 */
const RESERVE_AT_4_12: ReserveData = { ...RESERVE, liquidityRate: 41_200_000_000_000_000_000_000_000n };

/** A supply APR that cannot be reproduced from the rest of the reserve. */
const RESERVE_UNRECONCILED: ReserveData = {
  ...RESERVE_AT_4_12,
  liquidityRate: 1_302_812_990_000_000_000_000_000_000n,
};

/** $40 of Kamino shares at a share price of exactly one, so the value is $40. */
const A_DOLLAR_A_SHARE = { status: 'ok', value: { raw: 1n, decimals: 0, usd: '1' } } as const;
const APY_AT_4_18 = { status: 'ok', value: { raw: 418n, decimals: 4, text: '0.0418' } } as const;

const ratio = (combined: { rate: unknown }): ExactRatio => combined.rate as ExactRatio;

describe('the one combined yield across both venues', () => {
  it('weighs each venue by its balance, and it is not the average of the rates', async () => {
    // $60 on Aave at 4.1200 % and $40 on Kamino at 4.1800 %.
    const { balance } = await compose({
      aTokenBalance: 60_000_000n,
      shares: 40_000_000n,
      reserve: RESERVE_AT_4_12,
      prices: A_DOLLAR_A_SHARE,
      apy: APY_AT_4_18,
    });

    const combined = balance.investedValue.yield;
    expect(combined.complete).toBe(true);

    // (60 x 4.1200 + 40 x 4.1800) / 100 = 4.1440 % — and the unweighted average
    // of the two rates is 4.1500 %, which is the wrong answer this formula exists
    // to avoid.
    expect(percentLabelOfRatio(ratio(combined))).toBe('4.1440');
    expect(percentLabelOfRatio(ratio(combined))).not.toBe('4.1500');

    // Exact, not rounded on the way: both halves carried as whole integers.
    expect(combined.rate).toEqual({ numerator: '4144000000000', denominator: '100000000000000' });
  });

  it('sits on investedValue, beside the pieces it describes, with the breakdown', async () => {
    const { balance } = await compose({
      aTokenBalance: 60_000_000n,
      shares: 40_000_000n,
      reserve: RESERVE_AT_4_12,
      prices: A_DOLLAR_A_SHARE,
      apy: APY_AT_4_18,
    });

    const combined = balance.investedValue.yield;

    // Each venue carries its own rate **and its own balance**, at the scales they
    // were read at, so the screen explains the figure from this object instead of
    // recomputing it.
    expect(combined.venues).toEqual([
      {
        key: AAVE_V3_USDC_MONAD_KEY,
        label: 'Aave V3 · USDC en Monad',
        status: 'ok',
        exclusion: null,
        balance: { raw: '60000000', amount: '60', decimals: 6, unit: 'USD' },
        rate: { raw: '41200', decimals: 6, text: '0.0412' },
      },
      {
        key: KAMINO_EARN_USDC_SOLANA_KEY,
        label: 'Kamino Earn · USDC en Solana',
        status: 'ok',
        exclusion: null,
        balance: { raw: '40000000', amount: '40', decimals: 6, unit: 'USD' },
        rate: { raw: '418', decimals: 4, text: '0.0418' },
      },
    ]);
  });

  it('publishes no combined number when one venue cannot be read, and says which', async () => {
    /*
     * The honesty rule. A weighted mean over the venue that answered would be
     * 4.1200 % — a confident figure computed from a missing term, looking
     * entirely ordinary on a screen.
     */
    const { balance } = await compose({
      aTokenBalance: 60_000_000n,
      shares: 40_000_000n,
      reserve: RESERVE_AT_4_12,
      prices: A_DOLLAR_A_SHARE,
      apy: { status: 'unreadable', reason: 'APY_NON_POSITIVE' },
    });

    const combined = balance.investedValue.yield;
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();

    // The missing venue is named, and the venue that answered is still described.
    expect(combined.venues[1]).toMatchObject({ status: 'unreadable', reason: 'APY_NON_POSITIVE' });
    expect(combined.venues[0]).toMatchObject({ status: 'ok', exclusion: null });

    // And the **balance** is untouched by a missing rate: the money is still
    // exact, and the bucket is still complete.
    expect(balance.investedValue.complete).toBe(true);
    expect(balance.investedValue.total.raw).toBe('100000000');
  });

  it('publishes no combined number when a venue balance cannot be read', async () => {
    const { balance } = await compose({
      aTokenBalance: 60_000_000n,
      shares: new BalanceReadError('RPC_REJECTED', 'the node refused'),
      reserve: RESERVE_AT_4_12,
      prices: A_DOLLAR_A_SHARE,
      apy: APY_AT_4_18,
    });

    const combined = balance.investedValue.yield;
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();
    expect(combined.venues[1]).toMatchObject({ status: 'unreadable', reason: 'RPC_REJECTED' });
  });

  it('excludes a venue holding zero — a different fact from one it could not read', async () => {
    const { balance } = await compose({
      aTokenBalance: 60_000_000n,
      shares: 0n, // nobody deposited on Solana
      reserve: RESERVE_AT_4_12,
      prices: A_DOLLAR_A_SHARE,
      apy: { status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' },
    });

    const combined = balance.investedValue.yield;

    /*
     * The Kamino venue is `ok`, excluded, and its unreadable rate does not matter:
     * `0 x p = 0` for every finite `p`, so a venue holding nothing cannot move a
     * weighted mean. `complete` is therefore still true — and this is exactly why
     * the exclusion is stated, because "excluded because it is zero" and "excluded
     * because we could not read it" must never look the same.
     */
    expect(combined.complete).toBe(true);
    expect(percentLabelOfRatio(ratio(combined))).toBe('4.1200');
    expect(combined.venues[1]).toMatchObject({
      status: 'ok',
      exclusion: 'zero_balance',
      balance: { raw: '0', amount: '0' },
    });
  });

  it('reports a real zero when every venue holds zero, and it is complete', async () => {
    const { balance } = await compose({
      aTokenBalance: 0n,
      shares: 0n,
      reserve: RESERVE_AT_4_12,
    });

    const combined = balance.investedValue.yield;

    // Nothing failed: a person with nothing deposited earns nothing.
    expect(combined.complete).toBe(true);
    expect(combined.rate).toEqual({ numerator: '0', denominator: '1' });
    expect(percentLabelOfRatio(ratio(combined))).toBe('0.0000');
    expect(combined.venues).toEqual([
      expect.objectContaining({ key: AAVE_V3_USDC_MONAD_KEY, exclusion: 'zero_balance' }),
      expect.objectContaining({ key: KAMINO_EARN_USDC_SOLANA_KEY, exclusion: 'zero_balance' }),
    ]);
  });

  it('inherits Aave\'s own refusal rather than publishing a rate that does not reconcile', async () => {
    /*
     * `readPool` reports `agrees: false` and the client refuses to paint a rate.
     * The combined figure is a **second consumer** of the same number, so it
     * refuses in exactly the same way — and it says why with Aave's own name.
     */
    const { balance } = await compose({
      aTokenBalance: 60_000_000n,
      shares: 40_000_000n,
      reserve: RESERVE_UNRECONCILED,
      prices: A_DOLLAR_A_SHARE,
      apy: APY_AT_4_18,
    });

    const combined = balance.investedValue.yield;
    expect(combined.complete).toBe(false);
    expect(combined.rate).toBeNull();
    expect(combined.venues[0]).toMatchObject({ status: 'unreadable', reason: 'APR_NOT_RECONCILED' });

    // The **balances** are unaffected: a rate nobody can trust is not money nobody
    // has. The Aave piece is still `ok` with its exact value.
    expect(balance.investedValue.complete).toBe(true);
    expect(balance.investedValue.pieces[0]).toMatchObject({ status: 'ok', value: { raw: '60000000' } });
  });

  it('is Aave\'s own figure when the second venue is not wired at all', async () => {
    const log = recordingLogger();
    const solana = solanaReader({ 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 2_000_000n });
    const balance = await readWalletBalance({
      readPortfolio: readPortfolio({ wallets: twoWalletRows, evm: evmReader(), solana: solana.reader, log }),
      readPool: readPool({ wallets: twoWalletRows, pool: fakePool({ reserve: RESERVE_AT_4_12 }), log }),
      prices,
      log,
    })(USER_ID, NOW);

    const combined = balance.investedValue.yield;
    expect(combined.complete).toBe(true);
    expect(percentLabelOfRatio(ratio(combined))).toBe('4.1200');
    expect(combined.venues).toHaveLength(1);
  });
});
