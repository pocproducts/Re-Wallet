/**
 * `GET /api/portfolio`, over HTTP, with injected ports only: no network, no
 * database, no RPC.
 *
 * The contract asserted here is the one a screen codes against, and it has three
 * parts that are easy to break and expensive to get wrong:
 *
 *   1. **Amounts are exact.** A value with six decimals and a value with nine
 *      come back unrounded, with the decimals and the unit stated. The screen
 *      rounds; the backend does not. A balance already rounded to cents cannot
 *      build a transaction.
 *   2. **A chain that fails does not empty the portfolio.** The failure is
 *      stated for that chain, with a bounded reason, inside a 200. Silence
 *      would be read as an empty wallet, which is the worst possible answer.
 *   3. **The address is never taken from the request.** It comes from
 *      `rewallet.wallets` for the authenticated person, and a request that
 *      carries one is ignored.
 *
 * Every import of a not-yet-existing module here is **type-only**, so the first
 * run of this file fails because the route is absent — not because a module
 * could not be resolved. A RED that fails for the wrong reason proves nothing.
 */
import { describe, expect, it } from 'vitest';

import { readPortfolio, WalletsUnavailable, type ReadPortfolio } from '../../src/application/portfolio/readPortfolio';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');

const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;

/** A codec that accepts exactly the cookie above, and nothing else. */
const acceptingCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
  read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: DID } : null),
});

/** The two rows a person has today: one EVM address, one Solana address. */
const twoWalletRows: WalletStore = {
  findByUserId: async () => [
    // The EVM row also carries the network in use: one EVM address serves both
    // supported EVM networks, so the network is on the row, not on a second row.
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

/** Answers by network+address+token, so an unexpected read fails loudly. */
const evmReader = (
  native: Record<string, string>,
  erc20: Record<string, string>,
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
  };
};

/** What the container wires, with the ports a test can answer. */
const readPortfolioOf = (opts: {
  readonly wallets: WalletStore;
  readonly evm: EvmBalanceReader;
  readonly solana: SolanaBalanceReader;
}): ReadPortfolio => readPortfolio({ wallets: opts.wallets, evm: opts.evm, solana: opts.solana });

const app = (readPortfolio: ReadPortfolio) =>
  createApp({
    mint: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
    sessions: acceptingCodec(),
    readPortfolio,
    now: () => new Date('2025-01-01T00:00:00Z'),
    log: recordingLogger(),
  });

describe('GET /api/portfolio — happy path', () => {
  it('returns exact amounts with their units and decimals, for every chain', async () => {
    // 18 decimals on MON, 6 on USDC, 9 on SOL. None of them may lose a digit.
    const evm = evmReader(
      { [`monad:${EVM_ADDRESS}`]: '123456789012345678901', [`ethereum:${EVM_ADDRESS}`]: '2000000000000000000' },
      {
        [`monad:0x754704Bc059F8C67012fEd69BC8A327a5aafb603:${EVM_ADDRESS}`]: '1500000',
        [`ethereum:0x754704Bc059F8C67012fEd69BC8A327a5aafb603:${EVM_ADDRESS}`]: '0',
      },
    );
    const solana = solanaReader({ [SOLANA_ADDRESS]: '1234567890' });

    const response = await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana })).request('/api/portfolio', {
      headers: { cookie: SESSION_COOKIE },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { chains: { chain: string; assets: Record<string, string>[] }[] };

    const monad = body.chains.find((c) => c.chain === 'monad');
    expect(monad?.assets[0]).toEqual({
      symbol: 'MON',
      unit: 'MON',
      decimals: 18,
      raw: '123456789012345678901',
      amount: '123.456789012345678901',
    });
    expect(monad?.assets[1]).toEqual({
      symbol: 'USDC',
      unit: 'USDC',
      decimals: 6,
      raw: '1500000',
      amount: '1.5',
    });

    const solanaChain = body.chains.find((c) => c.chain === 'solana');
    expect(solanaChain?.assets[0]).toEqual({
      symbol: 'SOL',
      unit: 'SOL',
      decimals: 9,
      raw: '1234567890',
      amount: '1.23456789',
    });
  });

  it('reads the EVM address on both networks, and only the wallet rows', async () => {
    const evm = evmReader({}, {});
    const solana = solanaReader({});

    await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana })).request('/api/portfolio', {
      headers: { cookie: SESSION_COOKIE },
    });

    // One address, two EVM networks, one Solana address. Never a second EVM read
    // with a different address: there is no second EVM wallet.
    expect(evm.asked).toEqual([
      `native:monad:${EVM_ADDRESS}`,
      `erc20:monad:0x754704Bc059F8C67012fEd69BC8A327a5aafb603:${EVM_ADDRESS}`,
      `native:ethereum:${EVM_ADDRESS}`,
      `erc20:ethereum:0x754704Bc059F8C67012fEd69BC8A327a5aafb603:${EVM_ADDRESS}`,
    ]);
    expect(solana.asked).toEqual([SOLANA_ADDRESS]);
  });
});

/** Every chain fails. Used where a test only cares about one of them. */
const failingReader = (): EvmBalanceReader => ({
  nativeBalance: async () => {
    throw new BalanceReadError('RPC_UNAVAILABLE', 'the endpoint did not answer');
  },
  erc20Balance: async () => {
    throw new BalanceReadError('RPC_UNAVAILABLE', 'the endpoint did not answer');
  },
});

const failingSolanaReader = (): SolanaBalanceReader => ({
  lamports: async () => {
    throw new BalanceReadError('RPC_REJECTED', 'the endpoint rejected the request');
  },
});

const failingWalletStore: WalletStore = {
  findByUserId: async () => {
    throw new Error('connection terminated unexpectedly');
  },
  save: async () => {},
};

const chainsOf = (body: { chains: { chain: string; status: string }[] }): Record<string, string> =>
  Object.fromEntries(body.chains.map((c) => [c.chain, c.status]));

describe('GET /api/portfolio — a chain that fails', () => {
  it('answers 200, states the failure for that chain, and still returns the others', async () => {
    // Solana is down; Monad and Ethereum answer.
    const response = await app(
      readPortfolioOf({ wallets: twoWalletRows, evm: evmReader({ [`monad:${EVM_ADDRESS}`]: '1' }, {}), solana: failingSolanaReader() }),
    ).request('/api/portfolio', { headers: { cookie: SESSION_COOKIE } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chains: { chain: string; status: string; assets?: { amount: string }[]; error?: { code: string; reason: string } }[];
    };

    expect(chainsOf(body)).toEqual({ monad: 'ok', ethereum: 'ok', solana: 'error' });
    expect(body.chains.find((c) => c.chain === 'solana')?.error).toEqual({
      code: 'CHAIN_READ_FAILED',
      reason: 'RPC_REJECTED',
    });

    // The chains that answered keep their real values. One failure does not empty
    // the portfolio — that is the whole point of the per-chain state.
    expect(body.chains.find((c) => c.chain === 'monad')?.assets?.[0]?.amount).toBe('0.000000000000000001');
  });

  it('never turns a failed read into a zero balance', async () => {
    const response = await app(
      readPortfolioOf({ wallets: twoWalletRows, evm: failingReader(), solana: failingSolanaReader() }),
    ).request('/api/portfolio', { headers: { cookie: SESSION_COOKIE } });

    expect(response.status).toBe(200);
    // Not one `ok` state, and not one asset. A zero here would render as an empty
    // wallet, which is the worst possible answer to "how much do I hold".
    const body = (await response.json()) as { chains: { status: string; assets?: unknown }[] };
    expect(body.chains.every((c) => c.status === 'error')).toBe(true);
    expect(body.chains.some((c) => c.assets !== undefined)).toBe(false);
  });

  it('carries the failure reason in a bounded form, not the provider message', async () => {
    const response = await app(
      readPortfolioOf({ wallets: twoWalletRows, evm: failingReader(), solana: failingSolanaReader() }),
    ).request('/api/portfolio', { headers: { cookie: SESSION_COOKIE } });

    const text = await response.text();
    expect(text).not.toContain('did not answer');
    expect(text).not.toContain('BalanceReadError');
    expect(text).not.toContain('Connection refused');
  });
});

describe('GET /api/portfolio — zeros and missing wallets', () => {
  it('reports a zero balance as zero, not as an error and not as absent', async () => {
    const response = await app(
      readPortfolioOf({
        wallets: twoWalletRows,
        evm: evmReader({ [`monad:${EVM_ADDRESS}`]: '0', [`ethereum:${EVM_ADDRESS}`]: '0' }, {}),
        solana: solanaReader({ [SOLANA_ADDRESS]: '0' }),
      }),
    ).request('/api/portfolio', { headers: { cookie: SESSION_COOKIE } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chains: { chain: string; status: string; assets: { amount: string; raw: string }[] }[];
    };

    expect(chainsOf(body)).toEqual({ monad: 'ok', ethereum: 'ok', solana: 'ok' });
    for (const chain of body.chains) {
      expect(chain.assets[0]?.amount).toBe('0');
      expect(chain.assets[0]?.raw).toBe('0');
    }
  });

  it('reports a chain with no wallet row as no_wallet, not as a zero balance', async () => {
    // The person has an EVM address and nothing on Solana.
    const evmOnly: WalletStore = {
      findByUserId: async () => [
        { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
      ],
      save: async () => {},
    };
    const solana = solanaReader({});

    const response = await app(readPortfolioOf({ wallets: evmOnly, evm: evmReader({}, {}), solana })).request(
      '/api/portfolio',
      { headers: { cookie: SESSION_COOKIE } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { chains: { chain: string; status: string; assets?: unknown }[] };

    expect(chainsOf(body)).toEqual({ monad: 'ok', ethereum: 'ok', solana: 'no_wallet' });
    // An absent wallet is not an empty one, and it is not "ok" either.
    expect(body.chains.find((c) => c.chain === 'solana')?.assets).toBeUndefined();
    // Nothing was read for a chain this person has no address on.
    expect(solana.asked).toEqual([]);
  });

  it('answers 502, not a portfolio of empty chains, when the rows cannot be read', async () => {
    // Without the rows there is no address for any chain, so there is no truth to
    // report per chain. Reporting `no_wallet` for all three would be a lie.
    const response = await app(
      readPortfolioOf({ wallets: failingWalletStore, evm: evmReader({}, {}), solana: solanaReader({}) }),
    ).request('/api/portfolio', { headers: { cookie: SESSION_COOKIE } });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'WALLETS_UNAVAILABLE' } });
  });
});

describe('GET /api/portfolio — the door', () => {
  it('answers 401 without a cookie, and reads nothing', async () => {
    const evm = evmReader({}, {});

    const response = await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana: solanaReader({}) })).request(
      '/api/portfolio',
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(evm.asked).toEqual([]);
  });

  it('answers 401 for a cookie that does not verify, and reads nothing', async () => {
    const evm = evmReader({}, {});

    const response = await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana: solanaReader({}) })).request(
      '/api/portfolio',
      { headers: { cookie: `${SESSION_COOKIE_NAME}=stale.or.expired` } },
    );

    expect(response.status).toBe(401);
    expect(evm.asked).toEqual([]);
  });
});

describe('GET /api/portfolio — the address is never taken from the request', () => {
  it('ignores an address in the query string', async () => {
    const evm = evmReader({}, {});
    const solana = solanaReader({});

    const response = await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana })).request(
      `/api/portfolio?address=${EVM_ADDRESS}&chain=ethereum&solana=${SOLANA_ADDRESS}`,
      { headers: { cookie: SESSION_COOKIE } },
    );

    expect(response.status).toBe(200);
    // Every read still used the database address. The parameter had no path in.
    expect(evm.asked.every((call) => call.endsWith(EVM_ADDRESS))).toBe(true);
    expect(solana.asked).toEqual([SOLANA_ADDRESS]);
  });

  it('has no method that carries a body, so an address in one cannot arrive', async () => {
    const evm = evmReader({}, {});

    // Not merely ignored: there is no POST here at all. A body has no route to
    // reach, which is stronger than reading it and refusing to use it.
    const response = await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana: solanaReader({}) })).request(
      '/api/portfolio',
      {
        method: 'POST',
        headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
        body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', chain: 'ethereum' }),
      },
    );

    expect(response.status).toBe(404);
    expect(evm.asked).toEqual([]);
  });

  it('ignores an address sent alongside the request as JSON content', async () => {
    const evm = evmReader({}, {});
    const solana = solanaReader({});

    // A GET that claims to carry JSON, with an address in the URL as well. The
    // route never parses a body and never reads a parameter, so the declared
    // content type changes nothing about which address is read.
    const response = await app(readPortfolioOf({ wallets: twoWalletRows, evm, solana })).request(
      `/api/portfolio?address=0x0000000000000000000000000000000000000001`,
      { headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' } },
    );

    expect(response.status).toBe(200);
    expect(evm.asked.every((call) => call.endsWith(EVM_ADDRESS))).toBe(true);
    expect(solana.asked).toEqual([SOLANA_ADDRESS]);
  });

  it('answers for the person the cookie proved, whoever the request claims', async () => {
    const asked: string[] = [];
    const readPortfolio: ReadPortfolio = async (userId) => {
      asked.push(userId);
      return { userId, chains: [] };
    };

    const response = await app(readPortfolio).request('/api/portfolio?userId=someone-else', {
      headers: { cookie: SESSION_COOKIE },
    });

    expect(response.status).toBe(200);
    // The user id comes from the session claims, not from the query string.
    expect(asked).toEqual([USER_ID]);
  });
});

describe('GET /api/portfolio — not mounted without a reader', () => {
  it('is absent, rather than answering zeroes, when no chain readers are wired', async () => {
    const response = await createApp({
      mint: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID }),
      sessions: acceptingCodec(),
    }).request('/api/portfolio', { headers: { cookie: SESSION_COOKIE } });

    expect(response.status).toBe(404);
  });
});

describe('readPortfolio — the use case on its own', () => {
  it('raises WalletsUnavailable, and no per-chain state, when the rows cannot be read', async () => {
    const useCase = readPortfolio({ wallets: failingWalletStore, evm: evmReader({}, {}), solana: solanaReader({}) });

    await expect(useCase(USER_ID)).rejects.toBeInstanceOf(WalletsUnavailable);
  });

  it('reads every chain it knows, in a fixed order, whatever happens', async () => {
    const useCase = readPortfolio({ wallets: twoWalletRows, evm: evmReader({}, {}), solana: solanaReader({}) });

    const portfolio = await useCase(USER_ID);

    expect(portfolio.chains.map((c) => c.chain)).toEqual(['monad', 'ethereum', 'solana']);
    expect(portfolio.userId).toBe(USER_ID);
  });
});