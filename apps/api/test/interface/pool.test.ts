/**
 * `GET /api/pool` and `POST /api/pool/deposit`, over HTTP, with injected ports
 * only: no network, no database, no RPC, and no signer.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **The numbers are the chain's.** The supply APR comes out of a twelve-word
 *      decode, and the position is a `balanceOf` on the aToken. A field that
 *      could not be read is `unreadable`, never `0`: a zero reads as an empty
 *      wallet and an empty pool.
 *   2. **The address cannot be chosen by the caller.** It comes from
 *      `rewallet.wallets`, and a body or a query that carries one is ignored. The
 *      `onBehalfOf` of the deposit is the row's address, always.
 *   3. **The frontend never learns a contract to call.** It receives
 *      transactions to sign. The addresses stay here.
 *   4. **An amount that cannot be right is refused**, with a distinct code per
 *      case, so a screen can say what is wrong instead of failing a signature.
 *
 * Every import of a not-yet-existing module is **type-only** wherever a value
 * would be needed, so the first run of this file fails because the route is
 * absent and not because an import could not be resolved.
 */
import { describe, expect, it } from 'vitest';

import { readPool, POOL_MEMO_TTL_MS } from '../../src/application/pool/readPool';
import { readWalletBalance } from '../../src/application/portfolio/readWalletBalance';
import { prepareDeposit, DepositRejected } from '../../src/application/pool/prepareDeposit';
import type { AavePoolReader } from '../../src/domain/ports/aave-pool-reader';
import type { PriceFeed } from '../../src/domain/ports/price-feed';
import type { ReadPortfolio } from '../../src/application/portfolio/readPortfolio';
import type { ReserveData } from '../../src/domain/pool/reserveData';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;

const POOL = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const A_USDC = '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042';

/** The transcript of `getReserveData(USDC)` on Monad mainnet, 2026-10-04. */
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

/**
 * A reader that answers with what the test says, and records what it was asked.
 *
 * `asked` is not decoration: it is how "the address came from the database" is
 * proven — the row's address is the only one that reaches the reader.
 */
interface FakeReaderOptions {
  readonly reserve?: ReserveData;
  readonly aTokenBalance?: bigint;
  readonly usdcBalance?: bigint;
  readonly gasBalance?: bigint;
  readonly allowance?: bigint;
  readonly fail?: Partial<Record<'reserve' | 'aToken' | 'usdc' | 'gas' | 'allowance' | 'config', string>>;
}

const fakeReader = (options: FakeReaderOptions = {}) => {
  const asked: string[] = [];
  const fails = options.fail ?? {};

  const reader: AavePoolReader & { readonly asked: string[] } = {
    asked,
    async reserveData() {
      if (fails.reserve !== undefined) throw new Error(fails.reserve);
      return options.reserve ?? RESERVE;
    },
    async reserveConfiguration() {
      if (fails.config !== undefined) throw new Error(fails.config);
      return { decimals: 6n, ltv: 7500n, liquidationThreshold: 7800n, reserveFactorBps: 1000n, isActive: true, isFrozen: false };
    },
    async erc20Balance(token, address) {
      asked.push(`balanceOf:${token}:${address}`);
      if (token === A_USDC) {
        if (fails.aToken !== undefined) throw new Error(fails.aToken);
        return options.aTokenBalance ?? 820428n;
      }
      if (fails.usdc !== undefined) throw new Error(fails.usdc);
      return options.usdcBalance ?? 5000000n;
    },
    async allowance(token, owner, spender) {
      asked.push(`allowance:${token}:${owner}:${spender}`);
      if (fails.allowance !== undefined) throw new Error(fails.allowance);
      return options.allowance ?? 0n;
    },
    async nativeBalance(address) {
      asked.push(`native:${address}`);
      if (fails.gas !== undefined) throw new Error(fails.gas);
      return options.gasBalance ?? 3_000_000_000_000_000_000n;
    },
  };

  return reader;
};

interface HarnessOptions {
  readonly reader?: AavePoolReader;
  readonly wallets?: WalletStore;
  /** Mount the app with the pool use cases absent, to prove the route is absent too. */
  readonly withoutPool?: boolean;
  /**
   * Mount `GET /api/wallet-balance` over the **same** `readPool` instance, which
   * is what the front actually does: both hooks mount, and the balance composes
   * this use case internally.
   */
  readonly withWalletBalance?: boolean;
  /**
   * The memo's clock, injected so a TTL assertion costs no wall time. A test
   * chooses the age of a cached snapshot instead of waiting for it to expire.
   */
  readonly nowMs?: () => number;
}

/**
 * The **real** use cases over a fake reader.
 *
 * Not stubs: the assertions below are about what the application layer does with
 * a failed read, and a stub would answer them by construction.
 */
const harness = (options: HarnessOptions = {}) => {
  const reader = options.reader ?? fakeReader();
  const wallets = options.wallets ?? twoWalletRows;
  const log = recordingLogger();
  const pool = readPool({ wallets, pool: reader, log, nowMs: options.nowMs });

  /*
   * The portfolio and the price feed are stubbed **here only** to isolate the pool
   * read: the point of this harness option is that both routes reach the same
   * `readPool` instance, not that the balance arithmetic is exercised again. The
   * balance's own behaviour is `walletBalance.test.ts`'s subject.
   */
  const noChains: ReadPortfolio = async (userId: string) => ({ userId, chains: [] });
  const noPrices: PriceFeed = {
    async usdPrice() {
      return { status: 'unreadable' as const, reason: 'RPC_UNAVAILABLE' as const };
    },
  };

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
    sessions: acceptingCodec(),
    readPool: options.withoutPool === true ? undefined : pool,
    prepareDeposit: options.withoutPool === true ? undefined : prepareDeposit({ wallets, pool: reader, log }),
    readWalletBalance:
      options.withWalletBalance === true
        ? readWalletBalance({ readPortfolio: noChains, readPool: pool, prices: noPrices, log })
        : undefined,
    log,
    now: () => new Date('2026-10-04T05:00:00.000Z'),
  });

  return { app, reader, log, readPool: pool };
};

const getPool = async (app: ReturnType<typeof harness>['app'], query = '') =>
  app.request('/api/pool' + query, { headers: { cookie: SESSION_COOKIE } });

const postDeposit = async (app: ReturnType<typeof harness>['app'], body: unknown, query = '') =>
  app.request(`/api/pool/deposit${query}`, {
    method: 'POST',
    headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const getWalletBalance = async (app: ReturnType<typeof harness>['app']) =>
  app.request('/api/wallet-balance', { headers: { cookie: SESSION_COOKIE } });

/**
 * Every upstream call the pool read makes, counted — including the two reads the
 * fake reader does not record (`reserveData` and `reserveConfiguration`).
 *
 * "One set of upstream calls" is only provable if *all five* are counted: an
 * assertion on `reader.asked` alone would not notice the reserve being decoded
 * twice.
 */
const countingReader = (options: FakeReaderOptions = {}) => {
  const inner = fakeReader(options);
  const calls = { reserve: 0, config: 0, aToken: 0, usdc: 0, gas: 0 };

  const reader: AavePoolReader = {
    async reserveData() {
      calls.reserve += 1;
      return inner.reserveData();
    },
    async reserveConfiguration() {
      calls.config += 1;
      return inner.reserveConfiguration();
    },
    async erc20Balance(token, address) {
      if (token === A_USDC) calls.aToken += 1;
      else calls.usdc += 1;
      return inner.erc20Balance(token, address);
    },
    async allowance(token, owner, spender) {
      return inner.allowance(token, owner, spender);
    },
    async nativeBalance(address) {
      calls.gas += 1;
      return inner.nativeBalance(address);
    },
  };

  return { reader, calls };
};

/** One set of upstream calls, as the shape an assertion reads best. */
const oneSetOfCalls = () => ({ reserve: 1, config: 1, aToken: 1, usdc: 1, gas: 1 });

describe('readPool — the memo that makes the front\'s two requests cheap', () => {
  it('gives two concurrent reads of the same person exactly one set of upstream calls', async () => {
    /*
     * The actual duplication, not a synthetic one: `GET /api/pool` and
     * `GET /api/wallet-balance` are the two requests a page load makes, and they
     * reach the same `readPool` instance — the balance composes it internally.
     * Started together, because that is the case that matters and the one an
     * ordinary TTL would *not* save.
     */
    const { reader, calls } = countingReader();
    const { app } = harness({ reader, withWalletBalance: true });

    const [pool, balance] = await Promise.all([getPool(app), getWalletBalance(app)]);

    expect(pool.status).toBe(200);
    expect(balance.status).toBe(200);
    expect(calls).toEqual(oneSetOfCalls());
  });

  it('reuses one read for a second request inside the TTL, with the same generatedAt', async () => {
    const { reader, calls } = countingReader();
    const { app } = harness({ reader });

    const first = (await (await getPool(app)).json()) as { generatedAt: string; apr: { supply: unknown } };
    const second = (await (await getPool(app)).json()) as { generatedAt: string; apr: { supply: unknown } };

    expect(calls).toEqual(oneSetOfCalls());
    /*
     * The reused snapshot keeps the moment the chain was read. Re-stamping it
     * would publish a fresh `generatedAt` over a figure up to a TTL old.
     */
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.apr.supply).toEqual(first.apr.supply);
  });

  it('reads again once the TTL has passed, on the injected clock', async () => {
    let clockMs = Date.parse('2026-10-04T05:00:00.000Z');
    const { reader, calls } = countingReader();
    const { app } = harness({ reader, nowMs: () => clockMs });

    await getPool(app);
    clockMs += POOL_MEMO_TTL_MS - 1;
    await getPool(app);
    expect(calls).toEqual(oneSetOfCalls());

    clockMs += 1;
    await getPool(app);
    expect(calls).toEqual({ reserve: 2, config: 2, aToken: 2, usdc: 2, gas: 2 });
  });

  it('never memoizes a refusal: the very next request reads again', async () => {
    /*
     * Mutated on purpose: the same use case instance has to recover the moment
     * the chain does, without waiting for anything to expire.
     */
    const options: FakeReaderOptions = { fail: { reserve: 'endpoint died' } };
    const { reader, calls } = countingReader(options);
    const { app } = harness({ reader });

    const refused = (await (await getPool(app)).json()) as { reserve: { status: string; reason: string } };
    expect(refused.reserve).toEqual({ status: 'unreadable', reason: 'RPC_UNAVAILABLE' });

    delete options.fail?.reserve;
    const recovered = (await (await getPool(app)).json()) as { reserve: { status: string } };

    expect(recovered.reserve.status).toBe('ok');
    // Two reads, not one: a refusal served twice would be a coincidence, a
    // refusal republished for five seconds would be a stuck screen.
    expect(calls.reserve).toBe(2);
  });

  it('does not memoize a position that could not be read either', async () => {
    const options: FakeReaderOptions = { fail: { aToken: 'reverted' } };
    const { reader, calls } = countingReader(options);
    const { app } = harness({ reader });

    const refused = (await (await getPool(app)).json()) as {
      position: { aTokenBalance: { status: string } };
      apr: { supply: { status: string } };
    };
    expect(refused.position.aTokenBalance.status).toBe('unreadable');

    delete options.fail?.aToken;
    const recovered = (await (await getPool(app)).json()) as {
      position: { aTokenBalance: { status: string } };
    };
    expect(recovered.position.aTokenBalance.status).toBe('ok');
    expect(calls.aToken).toBe(2);
  });

  it('lets a thrown refusal travel to both callers without remembering it', async () => {
    const failing: WalletStore = {
      findByUserId: async () => {
        throw new Error('connection reset');
      },
      save: async () => {},
    };
    const { reader, calls } = countingReader();
    const { app } = harness({ reader, wallets: failing });

    const [first, second] = await Promise.all([getPool(app), getPool(app)]);

    expect(first.status).toBe(502);
    expect(second.status).toBe(502);
    // The read never started: the wallet rows are read before any chain call.
    expect(calls).toEqual({ reserve: 0, config: 0, aToken: 0, usdc: 0, gas: 0 });
  });

  it('keys on the person, not on the caller: a different user is a different read', async () => {
    const otherAddress = '0x1111111111111111111111111111111111111111';
    const wallets: WalletStore = {
      findByUserId: async (userId: string) => [
        {
          address: userId === USER_ID ? EVM_ADDRESS : otherAddress,
          providerWalletId: 'wallet-evm-1',
          chain: 'ethereum',
          evmNetwork: 'eip155:1',
        },
      ],
      save: async () => {},
    };
    const { reader, calls } = countingReader();
    const { readPool: read } = harness({ reader, wallets });

    const mine = await read(USER_ID);
    const theirs = await read('user-b');

    /*
     * One read each. The memo is keyed on the user id the caller proved, and the
     * row for that id is the only address that can be described — so a second
     * person is a second read, never a hit on the first person's snapshot.
     */
    expect(calls).toEqual({ reserve: 2, config: 2, aToken: 2, usdc: 2, gas: 2 });
    expect(mine.position.address).toBe(EVM_ADDRESS);
    expect(theirs.position.address).toBe(otherAddress);
  });
});

describe('GET /api/pool', () => {
  it('refuses a request without a session', async () => {
    const { app } = harness();
    const response = await app.request('/api/pool');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('answers with the chain id and the asset, and no contract address for the screen to call', async () => {
    const { app } = harness();
    const body = (await (await getPool(app)).json()) as Record<string, never>;
    expect(body.network).toEqual({ name: 'monad', chainId: 143, protocol: 'Aave V3' });
    expect(body.asset).toEqual({ symbol: 'USDC', unit: 'USDC', decimals: 6 });
    // The pool and the aToken are the server's business: what travels is the
    // position and the rates, not a menu of contracts.
    expect(JSON.stringify(body)).not.toContain(POOL.toLowerCase());
  });

  it('reports the live numbers, exact, with the decimals and the unit', async () => {
    const { app } = harness();
    const body = (await (await getPool(app)).json()) as {
      apr: { supply: { status: string; value: string }; borrow: { value: string } };
      totals: {
        supplied: { status: string; value: { raw: string; amount: string; decimals: number; unit: string } };
        borrowed: { status: string; value: { raw: string } };
        available: { status: string; value: { raw: string } };
        utilisation: { status: string; value: string };
      };
      lastUpdate: { value: { unix: number; iso: string } };
      reconciliation: { value: { percent: string; agrees: boolean } };
    };

    expect(body.apr.supply).toEqual({ status: 'ok', value: '4.1196' });
    expect(body.apr.borrow.value).toBe('4.9876');
    expect(body.totals.supplied.value).toEqual({
      raw: '173874477777314',
      amount: '173874477.777314',
      decimals: 6,
      unit: 'USDC',
    });
    expect(body.totals.borrowed.value.raw).toBe('159699152138313');
    expect(body.totals.available.value.raw).toBe('14175325639001');
    expect(body.totals.utilisation.value).toBe('91.8473');
    expect(body.lastUpdate.value.iso).toBe('2026-10-04T04:31:33.000Z');
    // The supply APR, reproduced from the borrow rate, the utilisation and the
    // reserve factor. The screen shows both, so a mismatch is visible.
    expect(body.reconciliation.value).toEqual({ percent: '4.1228', agrees: true });
  });

  it('reports a position of zero as zero, not as unreadable', async () => {
    const { app } = harness({ reader: fakeReader({ aTokenBalance: 0n, usdcBalance: 0n }) });
    const body = (await (await getPool(app)).json()) as {
      position: { address: string; aTokenBalance: { status: string; value: { raw: string; amount: string } } };
    };

    expect(body.position.aTokenBalance).toEqual({
      status: 'ok',
      value: { raw: '0', amount: '0', decimals: 6, unit: 'aMonUSDC' },
    });
    expect(body.position.address).toBe(EVM_ADDRESS);
  });

  it('marks a reserve that could not be read as unreadable, never as zero', async () => {
    const { app, log } = harness({ reader: fakeReader({ fail: { reserve: 'endpoint died' } }) });
    const body = (await (await getPool(app)).json()) as {
      reserve: { status: string; reason: string | null };
      apr: Record<string, { status: string; reason?: string | null; value?: unknown }>;
    };

    expect(body.reserve).toEqual({ status: 'unreadable', reason: 'RPC_UNAVAILABLE' });
    for (const field of Object.values(body.apr)) {
      expect(field.status).toBe('unreadable');
      expect(field.value).toBeUndefined();
    }
    // The provider's own words go to the log, never to the browser.
    expect(JSON.stringify(body)).not.toContain('endpoint died');
    expect(log.lines.some((line) => line.includes('pool.reserve_failed'))).toBe(true);
  });

  it('marks a position that could not be read as unreadable, distinctly from a zero', async () => {
    const { app } = harness({ reader: fakeReader({ fail: { aToken: 'reverted' } }) });
    const body = (await (await getPool(app)).json()) as {
      position: { aTokenBalance: { status: string; value?: unknown } };
      apr: { supply: { status: string } };
    };

    expect(body.position.aTokenBalance.status).toBe('unreadable');
    expect(body.position.aTokenBalance.value).toBeUndefined();
    // The reserve is independent of the position: one failure does not take the
    // other one down.
    expect(body.apr.supply.status).toBe('ok');
  });

  it('never takes an address from the request', async () => {
    const { app } = harness();
    await getPool(app, '?address=0x000000000000000000000000000000000000dEaD');

    const body = (await (await getPool(app)).json()) as { position: { address: string } };
    expect(body.position.address).toBe(EVM_ADDRESS);
  });
});

describe('POST /api/pool/deposit', () => {
  it('refuses a request without a session', async () => {
    const { app } = harness();
    const response = await app.request('/api/pool/deposit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: '1000000' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('builds approve then deposit, with the pool as spender and the database address as onBehalfOf', async () => {
    const { app } = harness();
    const response = await postDeposit(app, { amount: '1000000' });
    const body = (await response.json()) as {
      chainId: number;
      approvalRequired: boolean;
      transactions: { purpose: string; to: string; data: string; value: string; chainId: number }[];
    };

    expect(response.status).toBe(200);
    expect(body.chainId).toBe(143);
    expect(body.approvalRequired).toBe(true);
    expect(body.transactions.map((tx) => tx.purpose)).toEqual(['approve', 'deposit']);

    /*
     * Composed from words here: a hand-typed 64-character word is where a calldata
     * assertion stops being an assertion about encoding.
     */
    const word = (value: bigint): string => value.toString(16).padStart(64, '0');
    const addressWord = (address: string): string => address.slice(2).toLowerCase().padStart(64, '0');

    const [approve, deposit] = body.transactions as unknown as [
      { to: string; data: string },
      { to: string; data: string },
    ];
    // An exact approval, never an infinite one: an infinite approval is a
    // standing permission that outlives the deposit and nobody asked for.
    expect(approve.to).toBe(USDC);
    expect(approve.data).toBe(`0x095ea7b3${addressWord(POOL)}${word(1_000_000n)}`);
    expect(deposit.to).toBe(POOL);
    expect(deposit.data).toBe(
      `0xe8eda9df${addressWord(USDC)}${word(1_000_000n)}${addressWord(EVM_ADDRESS)}${word(0n)}`,
    );
    for (const tx of body.transactions) {
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(143);
    }
  });

  it('ignores an address in the body or in the query', async () => {
    const { app, reader } = harness();
    await postDeposit(
      app,
      { amount: '1000000', onBehalfOf: '0x000000000000000000000000000000000000dEaD', address: '0x000000000000000000000000000000000000dEaD' },
      '?onBehalfOf=0x000000000000000000000000000000000000dEaD',
    );

    // The only address the reader ever saw is the one from `rewallet.wallets`.
    const asked = (reader as AavePoolReader & { asked: string[] }).asked;
    expect(asked.every((line: string) => !line.includes('dEaD'))).toBe(true);
  });

  it('rejects zero, a negative amount and an amount that is not an integer string', async () => {
    const { app } = harness();

    const zero = await postDeposit(app, { amount: '0' });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toEqual({ error: { code: 'AMOUNT_NOT_POSITIVE' } });

    const negative = await postDeposit(app, { amount: '-1000000' });
    expect(negative.status).toBe(400);
    expect(await negative.json()).toEqual({ error: { code: 'AMOUNT_NOT_POSITIVE' } });

    for (const amount of ['1.5', 'abc', '', 1.5, null, undefined, '0x10']) {
      const response = await postDeposit(app, { amount });
      expect(response.status, `amount=${String(amount)}`).toBe(400);
      const refused = (await response.json()) as { error: { code: string } };
      expect(refused.error.code).toBe('AMOUNT_INVALID');
    }
  });

  it('rejects an amount above the balance with its own reason', async () => {
    const { app } = harness({ reader: fakeReader({ usdcBalance: 1_000_000n }) });
    const response = await postDeposit(app, { amount: '1000001' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'AMOUNT_EXCEEDS_BALANCE' } });
  });

  it('refuses to build anything when the balance could not be read', async () => {
    const { app } = harness({ reader: fakeReader({ fail: { usdc: 'node down' } }) });
    const response = await postDeposit(app, { amount: '1000000' });

    expect(response.status).toBe(400);
    // A different code from "above the balance": an unreadable balance is not a
    // zero balance, and the screen must not tell the person they have no USDC.
    expect(await response.json()).toEqual({ error: { code: 'BALANCE_UNREADABLE' } });
  });

  it('says so when the amount is already approved, and drops the first signature', async () => {
    const { app } = harness({ reader: fakeReader({ allowance: 1_000_000n }) });
    const body = (await (await postDeposit(app, { amount: '1000000' })).json()) as {
      approvalRequired: boolean;
      transactions: { purpose: string }[];
      allowance: { status: string; value: { amount: string } };
    };

    expect(body.approvalRequired).toBe(false);
    expect(body.transactions.map((tx) => tx.purpose)).toEqual(['deposit']);
    expect(body.allowance).toEqual({
      status: 'ok',
      value: { raw: '1000000', amount: '1', decimals: 6, unit: 'USDC' },
    });
  });

  it('keeps the approval when the allowance could not be read', async () => {
    const { app } = harness({ reader: fakeReader({ fail: { allowance: 'timeout' } }) });
    const body = (await (await postDeposit(app, { amount: '1000000' })).json()) as {
      approvalRequired: boolean;
      allowance: { status: string };
      transactions: { purpose: string }[];
    };

    // An approval that turns out to be unnecessary costs one signature; an
    // `approve` that is skipped when it was needed costs the whole deposit.
    expect(body.approvalRequired).toBe(true);
    expect(body.allowance.status).toBe('unreadable');
    expect(body.transactions.map((tx) => tx.purpose)).toEqual(['approve', 'deposit']);
  });

  it('answers 502 when the wallet rows cannot be read', async () => {
    const failing: WalletStore = {
      findByUserId: async () => {
        throw new Error('connection reset');
      },
      save: async () => {},
    };
    const { app } = harness({ reader: fakeReader(), wallets: failing });
    const response = await postDeposit(app, { amount: '1000000' });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'WALLETS_UNAVAILABLE' } });
  });

  it('is absent when the use cases are not wired', async () => {
    const { app } = harness({ withoutPool: true });
    const response = await postDeposit(app, { amount: '1000000' });

    // No `prepareDeposit` means no deposit route at all: not a route that
    // answers "not configured", which a screen cannot tell from a refusal.
    expect(response.status).toBe(404);
  });

  it('accepts an amount that is exactly the balance, and refuses one unit more', async () => {
    const { app } = harness({ reader: fakeReader({ usdcBalance: 1_000_000n }) });

    const exact = await postDeposit(app, { amount: '1000000' });
    expect(exact.status).toBe(200);

    const oneMore = await postDeposit(app, { amount: '1000001' });
    expect(oneMore.status).toBe(400);
    expect(await oneMore.json()).toEqual({ error: { code: 'AMOUNT_EXCEEDS_BALANCE' } });
  });

  it('drops the approval when the allowance is larger than the amount asked for', async () => {
    const { app } = harness({ reader: fakeReader({ allowance: 2_000_000n }) });
    const body = (await (await postDeposit(app, { amount: '1000000' })).json()) as {
      approvalRequired: boolean;
      transactions: { purpose: string }[];
    };

    expect(body.approvalRequired).toBe(false);
    expect(body.transactions.map((tx) => tx.purpose)).toEqual(['deposit']);
  });

  it('accepts a JSON number that is a whole number of the smallest unit', async () => {
    const { app } = harness();
    // The contract is a decimal string. A number is tolerated only when it is a
    // safe integer: `1000000.5` is a decimal amount, and this route does not
    // convert decimals — it refuses them.
    const response = await postDeposit(app, { amount: 1000000 });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { amount: { raw: string; amount: string } };
    expect(body.amount).toEqual({ raw: '1000000', amount: '1', decimals: 6, unit: 'USDC' });
  });

  it('reports a reserve that answered with something undecodable as its own failure', async () => {
    const { app } = harness({
      reader: fakeReader({ fail: { reserve: 'six words where twelve were declared' } }),
    });
    const body = (await (await getPool(app)).json()) as { reserve: { status: string; reason: string } };

    expect(body.reserve).toEqual({ status: 'unreadable', reason: 'RPC_UNAVAILABLE' });
  });

  it('rejects with a distinct code per case, never a raw reason', async () => {
    const { app } = harness({ reader: fakeReader({ usdcBalance: 0n }) });
    const response = await postDeposit(app, { amount: '1' });
    const body = (await response.json()) as { error: { code: string } };

    expect(DepositRejected.codes).toContain(body.error.code);
  });
});
