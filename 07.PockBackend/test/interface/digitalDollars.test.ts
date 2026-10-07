/**
 * `GET /api/digital-dollars`, over HTTP, with injected ports only: no network, no
 * database, no RPC.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **An incomplete total says so.** The sum of what could be read is returned
 *      — throwing it away would be as bad as inventing it — but alongside
 *      `complete: false`. A total that quietly leaves out a component it could
 *      not read is a confident lie, and it is the one failure mode this route
 *      exists to make impossible.
 *   2. **Zero is not unreadable.** An empty position is `ok` with `0`; it is a
 *      different truth from "we could not read it", and the screen is told which
 *      one it has. This is `pool.test.ts`'s rule, carried over.
 *   3. **Nothing in the request is read.** No address, no chain, no `userId`, in
 *      a body or in a query. The components come from `rewallet.wallets` for the
 *      user the cookie proved — the same property the portfolio and pool routes
 *      hold.
 *   4. **No price, no valuation.** Only USDC-denominated pieces are summed.
 *      MON, ETH and SOL are not digital dollars and there is no feed that would
 *      make them one; a hardcoded price would be worse than their absence.
 */
import { describe, expect, it } from 'vitest';

import { readPortfolio } from '../../src/application/portfolio/readPortfolio';
import { readDigitalDollars } from '../../src/application/portfolio/readDigitalDollars';
import { readPool } from '../../src/application/pool/readPool';
import { prepareDeposit } from '../../src/application/pool/prepareDeposit';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import type { AavePoolReader } from '../../src/domain/ports/aave-pool-reader';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { ReserveData } from '../../src/domain/pool/reserveData';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;
const NOW = '2026-10-04T05:00:00.000Z';

const MONAD_USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const A_USDC = '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042';

/** `getReserveData(USDC)` on Monad mainnet, 2026-10-04. Only its shape matters. */
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

/** The two rows a person has today: one EVM address, one Solana address. */
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

/**
 * Answers by `network:token:address`, and records every call.
 *
 * `asked` is not decoration: it is how "the address came from the database" is
 * proven — the row's address is the only one that reaches a reader.
 */
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
      if (!( `${network}:${token}:${address}` in erc20)) {
        throw new BalanceReadError('RPC_UNAVAILABLE', 'the endpoint did not answer');
      }
      return BigInt(erc20[`${network}:${token}:${address}`] ?? '0');
    },
  };
};

const solanaReader = (lamports: Record<string, string>): SolanaBalanceReader & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    lamports: async (address) => {
      asked.push(address);
      return BigInt(lamports[address] ?? '0');
    },
    tokenAmount: async () => 0n,
    mintBalance: async () => 0n,
  };
};

interface FakePoolOptions {
  readonly aTokenBalance?: bigint;
  readonly failAaveToken?: boolean;
}

const fakePool = (options: FakePoolOptions = {}) => {
  const asked: string[] = [];
  const reader: AavePoolReader & { readonly asked: string[] } = {
    asked,
    reserveData: async () => RESERVE,
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
      return 0n;
    },
    allowance: async () => 0n,
    nativeBalance: async () => 0n,
  };
  return reader;
};

interface HarnessOptions {
  readonly wallets?: WalletStore;
  readonly evm?: EvmBalanceReader & { readonly asked: string[] };
  readonly solana?: SolanaBalanceReader & { readonly asked: string[] };
  readonly pool?: AavePoolReader & { readonly asked: string[] };
  /** Mount the app without the aggregation use case, to prove the route is absent. */
  readonly withoutTotal?: boolean;
}

/**
 * The **real** use cases over fake readers. Not stubs: the assertions below are
 * about what the application layer does with a read that failed, and a stub would
 * answer them by construction.
 */
const harness = (options: HarnessOptions = {}) => {
  const wallets = options.wallets ?? twoWalletRows;
  const evm = options.evm ?? evmReader({});
  const solana = options.solana ?? solanaReader({});
  const pool = options.pool ?? fakePool();
  const log = recordingLogger();

  const portfolio = readPortfolio({ wallets, evm, solana, log });
  const readPoolOf = readPool({ wallets, pool, log });

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
    sessions: acceptingCodec(),
    readPortfolio: portfolio,
    readPool: readPoolOf,
    prepareDeposit: prepareDeposit({ wallets, pool, log }),
    readDigitalDollars:
      options.withoutTotal === true
        ? undefined
        : readDigitalDollars({ readPortfolio: portfolio, readPool: readPoolOf, log }),
    log,
    now: () => new Date(NOW),
  });

  return { app, evm, solana, pool, log };
};

const get = (app: ReturnType<typeof harness>['app'], query = '') =>
  app.request('/api/digital-dollars' + query, { headers: { cookie: SESSION_COOKIE } });

/** `$1.50 of free USDC on Monad, $0.50 on Ethereum, $0.82 deposited`. */
const oneFiftyAndAHalf: Record<string, string> = {
  [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '1500000',
  [`ethereum:${ETHEREUM_USDC}:${EVM_ADDRESS}`]: '500000',
};

interface TotalBody {
  generatedAt: string;
  unit: string;
  complete: boolean;
  total: { raw: string; amount: string; decimals: number; unit: string };
  components: {
    key: string;
    label: string;
    status: string;
    reason: string | null;
    value: { raw: string; amount: string; decimals: number; unit: string } | null;
  }[];
}

const componentOf = (body: TotalBody, key: string) => {
  const found = body.components.find((component) => component.key === key);
  if (found === undefined) throw new Error(`no component ${key}`);
  return found;
};

describe('GET /api/digital-dollars — happy path', () => {
  it('adds the free USDC and the deposited USDC exactly, and says the total is complete', async () => {
    const { app } = harness({
      evm: evmReader(oneFiftyAndAHalf, { [`monad:${EVM_ADDRESS}`]: '3000000000000000000' }),
      pool: fakePool({ aTokenBalance: 820428n }),
    });

    const response = await get(app);
    expect(response.status).toBe(200);

    const body = (await response.json()) as TotalBody;
    expect(body.generatedAt).toBe(NOW);
    expect(body.unit).toBe('USDC');
    // 1.5 + 0.5 + 0.820428, in the smallest unit. No float touched it.
    expect(body.total).toEqual({ raw: '2820428', amount: '2.820428', decimals: 6, unit: 'USDC' });
    expect(body.complete).toBe(true);
  });

  it('lists every component with its own read state, so a screen can explain the number', async () => {
    const { app } = harness({ evm: evmReader(oneFiftyAndAHalf), pool: fakePool({ aTokenBalance: 820428n }) });
    const body = (await (await get(app)).json()) as TotalBody;

    /*
     * Solana contributes a component now, because its catalog declares USDC and
     * the SPL balance is read: it was the third chain's row that could be
     * deposited to and never appeared anywhere.
     */
    expect(body.components.map((component) => component.key)).toEqual([
      'free_usdc_monad',
      'free_usdc_ethereum',
      'free_usdc_solana',
      'aave_v3_usdc_monad',
    ]);
    expect(componentOf(body, 'free_usdc_monad')).toEqual({
      key: 'free_usdc_monad',
      label: 'USDC en Monad',
      source: 'free_wallet',
      status: 'ok',
      reason: null,
      value: { raw: '1500000', amount: '1.5', decimals: 6, unit: 'USDC' },
    });
    expect(componentOf(body, 'free_usdc_ethereum').value).toEqual({
      raw: '500000',
      amount: '0.5',
      decimals: 6,
      unit: 'USDC',
    });
    // The receipt token is USDC principal plus accrued interest: already USDC,
    // so it is added at its own value and never at a price.
    expect(componentOf(body, 'aave_v3_usdc_monad').value).toEqual({
      raw: '820428',
      amount: '0.820428',
      decimals: 6,
      unit: 'USDC',
    });
  });

  it('leaves out what is not denominated in USDC, and never prices it', async () => {
    // 3 MON and 1.23456789 SOL are in the response of `/api/portfolio` and in
    // neither this one. There is no price feed in this project, and a hardcoded
    // one would be a worse lie than their absence.
    const { app } = harness({
      evm: evmReader(oneFiftyAndAHalf, { [`monad:${EVM_ADDRESS}`]: '3000000000000000000' }),
      solana: solanaReader({ [SOLANA_ADDRESS]: '1234567890' }),
    });

    const text = await (await get(app)).text();
    expect(text).not.toContain('MON');
    // The **coin** stays out of this total. The USDC of that same wallet is in
    // it, which is the unit rule and not a leak: one chain, two assets, and only
    // the dollar-denominated one is a piece of a total in dollars.
    expect(text).not.toContain('SOL');
    expect(text).not.toContain('price');
    const body = JSON.parse(text) as TotalBody;
    // Three before the SPL read, four now: the Solana USDC component is the
    // fourth, and it exists because the balance is read.
    expect(body.components).toHaveLength(4);
    expect(body.components.map((component) => component.key)).toContain('free_usdc_solana');
  });

  it('reports a component of zero as ok, never as unreadable', async () => {
    const empty: Record<string, string> = {
      [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '0',
      [`ethereum:${ETHEREUM_USDC}:${EVM_ADDRESS}`]: '0',
    };
    const { app } = harness({ evm: evmReader(empty), pool: fakePool({ aTokenBalance: 0n }) });

    const body = (await (await get(app)).json()) as TotalBody;
    expect(componentOf(body, 'aave_v3_usdc_monad').status).toBe('ok');
    expect(componentOf(body, 'aave_v3_usdc_monad').value).toEqual({
      raw: '0',
      amount: '0',
      decimals: 6,
      unit: 'USDC',
    });
    expect(body.total.raw).toBe('0');
    // Empty is not missing: nothing failed, so the total is the whole truth.
    expect(body.complete).toBe(true);
  });
});

describe('GET /api/digital-dollars — an incomplete total says so', () => {
  it('returns the partial sum, marks it incomplete, and keeps the other component intact', async () => {
    const { app } = harness({
      evm: evmReader(oneFiftyAndAHalf),
      pool: fakePool({ failAaveToken: true }),
    });

    const response = await get(app);
    expect(response.status).toBe(200);

    const body = (await response.json()) as TotalBody;
    // 1.5 + 0.5, and not one unit of the deposit: the sum is of what was read.
    expect(body.total).toEqual({ raw: '2000000', amount: '2', decimals: 6, unit: 'USDC' });
    // And it is not dressed up as the whole truth.
    expect(body.complete).toBe(false);

    const missing = componentOf(body, 'aave_v3_usdc_monad');
    expect(missing.status).toBe('unreadable');
    expect(missing.reason).toBe('RPC_REJECTED');
    expect(missing.value).toBeNull();
    // One failure does not take the others down.
    expect(componentOf(body, 'free_usdc_monad').status).toBe('ok');
  });

  it('marks the total incomplete when one chain could not be read', async () => {
    const partial: Record<string, string> = { [`monad:${MONAD_USDC}:${EVM_ADDRESS}`]: '1500000' };
    const { app } = harness({ evm: evmReader(partial) });
    const body = (await (await get(app)).json()) as TotalBody;

    // `evmReader` fails any erc20 read it was not given: Ethereum is the missing key.
    expect(componentOf(body, 'free_usdc_ethereum').status).toBe('unreadable');
    expect(componentOf(body, 'free_usdc_monad').status).toBe('ok');
    expect(body.complete).toBe(false);
    // The deposit still counts: a failing chain is not a failing person.
    expect(body.total.raw).toBe((1500000 + 820428).toString());
  });

  it('carries the reason, never the provider message', async () => {
    const { app, log } = harness({
      evm: evmReader(oneFiftyAndAHalf),
      pool: fakePool({ failAaveToken: true }),
    });

    const text = await (await get(app)).text();
    expect(text).not.toContain('the node rejected it');
    expect(text).not.toContain('BalanceReadError');
    expect(JSON.stringify(log.lines)).toContain('digital_dollars.incomplete');
  });
});

describe('GET /api/digital-dollars — the door', () => {
  it('answers 401 without a cookie, and reads nothing', async () => {
    const { app, evm, solana, pool } = harness();

    const response = await app.request('/api/digital-dollars');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(evm.asked).toEqual([]);
    expect(solana.asked).toEqual([]);
    expect((pool as AavePoolReader & { asked: string[] }).asked).toEqual([]);
  });

  it('answers 401 for a cookie that does not verify, and reads nothing', async () => {
    const { app, evm, pool } = harness();

    const response = await app.request('/api/digital-dollars', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=stale.or.expired` },
    });

    expect(response.status).toBe(401);
    expect(evm.asked).toEqual([]);
    expect((pool as AavePoolReader & { asked: string[] }).asked).toEqual([]);
  });

  it('answers 502, not a total of zeroes, when the wallet rows cannot be read', async () => {
    const { app } = harness({ wallets: failingWalletStore });

    const response = await get(app);

    // Without the rows there is no address for any component, so there is no
    // partial truth to report either: a total of zero would be a lie.
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'WALLETS_UNAVAILABLE' } });
  });

  it('is absent, rather than answering zeroes, when the use case is not wired', async () => {
    const { app } = harness({ withoutTotal: true });
    const response = await get(app);

    expect(response.status).toBe(404);
  });
});

describe('GET /api/digital-dollars — the address is never taken from the request', () => {
  it('ignores an address or a chain in the query string', async () => {
    const { app, evm, solana, pool } = harness({ evm: evmReader(oneFiftyAndAHalf) });

    const response = await get(
      app,
      '?address=0x000000000000000000000000000000000000dEaD&chain=ethereum&solana=SoLdeadBeef',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as TotalBody;
    expect(body.total.raw).toBe('2820428');

    // Every read still used the database address. The parameters had no path in.
    expect(evm.asked.every((call) => call.endsWith(EVM_ADDRESS))).toBe(true);
    expect(solana.asked).toEqual([SOLANA_ADDRESS]);
    expect(
      (pool as AavePoolReader & { asked: string[] }).asked.every((line) => line.endsWith(EVM_ADDRESS)),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain('dEaD');
  });

  it('answers for the person the cookie proved, whoever the request claims', async () => {
    const askedFor: string[] = [];
    const { app } = harness();

    const response = await get(app, '?userId=someone-else');
    expect(response.status).toBe(200);

    // The user id comes from the session claims, not from the query string: the
    // wallet store is only ever asked for `USER_ID`.
    const walletStore = twoWalletRows;
    const probe = harness({ wallets: { ...walletStore, findByUserId: async (id) => {
      askedFor.push(id);
      return walletStore.findByUserId(id);
    } } });
    await get(probe.app, '?userId=someone-else');
    // Twice, because the portfolio and the pool each resolve their own address
    // from the same row — and always for the person the cookie proved.
    expect(askedFor.length).toBeGreaterThan(0);
    expect(askedFor.every((id) => id === USER_ID)).toBe(true);
  });

  it('has no method that carries a body, so an address in one cannot arrive', async () => {
    const { app, evm } = harness();

    const response = await app.request('/api/digital-dollars', {
      method: 'POST',
      headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', chain: 'monad' }),
    });

    expect(response.status).toBe(404);
    expect(evm.asked).toEqual([]);
  });
});
