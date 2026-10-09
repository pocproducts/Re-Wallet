/**
 * `readPortfolio` on Solana: the lamports read that already existed, **plus** the
 * SPL token read that did not.
 *
 * The use case over injected ports. No network, no RPC, no database: the Solana
 * reader is a fake that answers per mint and records what it was asked for, which
 * is how the two rules that are not about arithmetic get asserted.
 *
 * ── The rules this file exists for ───────────────────────────────────────────
 *
 *  - **Only the mints the catalog declares are requested.** The set of mints the
 *    reader is asked for is asserted against the catalog itself, so a second
 *    mint cannot be added by accident and a first one cannot be dropped.
 *  - **The decimals are the catalog's.** The reader returns a raw integer and the
 *    catalog's exponent turns it into an amount; nothing in this path reads an
 *    exponent off a network answer.
 *  - **A mint that cannot be read is `unreadable`, never a zero.** And one mint
 *    failing does not take the other assets on the same wallet down.
 *  - **The lamports read is untouched.**
 */
import { describe, expect, it } from 'vitest';

import { readPortfolio } from '../../src/application/portfolio/readPortfolio';
import { DEPOSIT_NETWORKS } from '../../src/domain/deposit/catalog';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import { createHttpSolanaBalanceReader } from '../../src/infrastructure/rpc/solanaBalanceReader.http';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { WalletStore } from '../../src/domain/ports/wallet-store';

const USER_ID = 'user-1';
const SOLANA_ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const EVM_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

/** The mints the deposit catalog declares for Solana, in its own order. */
const CATALOGUED_MINTS = DEPOSIT_NETWORKS.find((network) => network.chain === 'solana')?.assets
  .filter((asset) => !asset.native)
  .map((asset) => asset.token ?? '');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const wallets: WalletStore = {
  findByUserId: async () => [
    { address: EVM_ADDRESS, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

const evmReader: EvmBalanceReader = {
  nativeBalance: async () => 0n,
  erc20Balance: async () => 0n,
};

interface FakeSolanaOptions {
  readonly lamports?: bigint | 'FAIL';
  /** Per mint: the raw integer, or the failure the endpoint produced. */
  readonly mints?: Record<string, bigint | BalanceReadError>;
}

interface FakeSolana extends SolanaBalanceReader {
  readonly mintsAsked: string[];
  readonly lamportsAsked: string[];
}

const solanaReader = (options: FakeSolanaOptions = {}): FakeSolana => {
  const mintsAsked: string[] = [];
  const lamportsAsked: string[] = [];

  return {
    mintsAsked,
    lamportsAsked,
    lamports: async (address) => {
      lamportsAsked.push(address);
      if (options.lamports === 'FAIL') throw new BalanceReadError('RPC_REJECTED', 'the endpoint rejected it');
      return options.lamports ?? 0n;
    },
    tokenAmount: async () => 0n,
    mintBalance: async (_owner, mint) => {
      mintsAsked.push(mint);
      const answer = options.mints?.[mint];
      if (answer === undefined) return 0n;
      if (answer instanceof BalanceReadError) throw answer;
      return answer;
    },
  };
};

const read = async (solana: SolanaBalanceReader) => {
  const portfolio = await readPortfolio({ wallets, evm: evmReader, solana })(USER_ID, new Date(0));
  const solanaChain = portfolio.chains.find((chain) => chain.chain === 'solana');
  return solanaChain;
};

describe('readPortfolio — Solana SPL tokens', () => {
  it('reads the catalogued mints, and only those', async () => {
    // The rule is asserted against the catalog rather than a literal, so the
    // catalog and the read cannot drift apart in either direction.
    const solana = solanaReader({ lamports: 1_234_567_890n, mints: { [USDC_MINT]: 1_500_000n } });

    await read(solana);

    expect(CATALOGUED_MINTS).toContain(USDC_MINT);
    expect(solana.mintsAsked).toEqual(CATALOGUED_MINTS);
  });

  it('shows Solana USDC as a six-decimal balance, at the catalog decimals', async () => {
    const solana = solanaReader({ lamports: 1_234_567_890n, mints: { [USDC_MINT]: 1_500_000n } });

    const chain = await read(solana);
    const usdc = chain?.status === 'ok' ? chain.assets.find((asset) => asset.symbol === 'USDC') : undefined;

    expect(usdc).toEqual({ symbol: 'USDC', unit: 'USDC', decimals: 6, raw: '1500000', amount: '1.5' });
  });

  it('keeps the lamports read exactly as it was, alongside the token read', async () => {
    const solana = solanaReader({ lamports: 1_234_567_890n, mints: { [USDC_MINT]: 1_500_000n } });

    const chain = await read(solana);

    expect(solana.lamportsAsked).toEqual([SOLANA_ADDRESS]);
    // The native coin first, at nine decimals, and still exactly as before.
    expect(chain?.status === 'ok' ? chain.assets[0] : undefined).toEqual({
      symbol: 'SOL',
      unit: 'SOL',
      decimals: 9,
      raw: '1234567890',
      amount: '1.23456789',
    });
  });

  it('reads a mint the wallet holds none of as a zero, not as a failure', async () => {
    // Zero is an answer. It is not the same answer as "we could not read it", and
    // it is the one the person can do something about.
    const solana = solanaReader({ lamports: 0n, mints: {} });

    const chain = await read(solana);

    expect(chain?.status).toBe('ok');
    const usdc = chain?.status === 'ok' ? chain.assets.find((asset) => asset.symbol === 'USDC') : undefined;
    expect(usdc).toEqual({ symbol: 'USDC', unit: 'USDC', decimals: 6, raw: '0', amount: '0' });
  });

  it('reports a mint that cannot be read as unreadable, never as a zero', async () => {
    const solana = solanaReader({
      lamports: 1_234_567_890n,
      mints: { [USDC_MINT]: new BalanceReadError('RPC_UNAVAILABLE', 'the endpoint did not answer') },
    });

    const chain = await read(solana);

    // The chain is readable: its other asset was. The mint that failed is a
    // hole in one asset, stated as a hole.
    expect(chain?.status).toBe('ok');
    const usdc = chain?.status === 'ok' ? chain.assets.find((asset) => asset.symbol === 'USDC') : undefined;
    expect(usdc !== undefined && usdc.raw === null ? usdc.error : undefined).toEqual({
      code: 'ASSET_READ_FAILED',
      reason: 'RPC_UNAVAILABLE',
    });
  });

  it('keeps the other assets on the same wallet standing when one mint fails', async () => {
    // One failure does not empty the wallet: SOL was read, and it is reported.
    const solana = solanaReader({
      lamports: 4_000_000_000n,
      mints: { [USDC_MINT]: new BalanceReadError('RPC_REJECTED', 'the endpoint rejected it') },
    });

    const chain = await read(solana);

    expect(chain?.status === 'ok' ? chain.assets[0] : undefined).toEqual({
      symbol: 'SOL',
      unit: 'SOL',
      decimals: 9,
      raw: '4000000000',
      amount: '4',
    });
  });

  it('refuses a malformed token answer rather than coercing it to zero', async () => {
    // What the adapter hands over when the response is not what a balance looks
    // like. It reaches the person as "we could not read it", never as `0`.
    const solana = solanaReader({
      lamports: 1_234_567_890n,
      mints: { [USDC_MINT]: new BalanceReadError('RPC_MALFORMED_RESPONSE', 'answered without an amount') },
    });

    const chain = await read(solana);
    const usdc = chain?.status === 'ok' ? chain.assets.find((asset) => asset.symbol === 'USDC') : undefined;

    expect(usdc !== undefined && usdc.raw === null ? usdc.error : undefined).toEqual({
      code: 'ASSET_READ_FAILED',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
    expect(usdc?.raw).not.toBe('0');
  });

  it('still fails the whole chain when the native read fails', async () => {
    // Solana itself is unreadable: that is a per-chain state, as it always was.
    const solana = solanaReader({ lamports: 'FAIL', mints: { [USDC_MINT]: 1_500_000n } });

    const chain = await read(solana);

    expect(chain?.status).toBe('error');
    expect(chain?.status === 'error' ? chain.error : undefined).toEqual({
      code: 'CHAIN_READ_FAILED',
      reason: 'RPC_REJECTED',
    });
  });
});

describe('readPortfolio — the reads are issued together, and still decided apart', () => {
  /**
   * A read that records having been **asked for** and answers only once `expected`
   * reads are in flight.
   *
   * The barrier is what makes this a test of concurrency rather than of timing: a
   * reader that answered instantly would let a serial implementation pass by
   * accident. Here nothing answers until every read is outstanding, so a
   * serial implementation cannot get past the first one — and the short timer
   * means it fails fast, with a count, instead of hanging until the suite times
   * out.
   */
  const together = <T>(expected: number, answer: (index: number) => T) => {
    const issued: number[] = [];
    /*
     * How many reads were **in flight** when this one got its answer. A serial
     * implementation leaves `1` here for the first read, no matter how many reads
     * it eventually gets to — which is what the assertion looks at, and why it is
     * taken at the moment of the answer rather than at the end of the call.
     */
    const overlapped: number[] = [];
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    return {
      issued,
      overlapped,
      read: async (): Promise<T> => {
        const index = issued.length;
        issued.push(index);
        if (issued.length === expected) open();
        await Promise.race([gate, new Promise<void>((resolve) => setTimeout(resolve, 50))]);
        overlapped.push(issued.length);
        return answer(index);
      },
    };
  };

  it('asks every chain and every asset at the same time', async () => {
    // Eighteen reads: seven chains, two or three assets each. The number is
    // the catalog's own, so a chain gaining an asset has to be counted here too.
    const reads = together(18, () => 1n);
    const solana: SolanaBalanceReader = {
      lamports: reads.read,
      tokenAmount: async () => 0n,
      mintBalance: reads.read,
    };
    const evm: EvmBalanceReader = {
      nativeBalance: reads.read,
      erc20Balance: reads.read,
    };

    const portfolio = await readPortfolio({ wallets, evm, solana })(USER_ID, new Date(0));

    expect(reads.issued).toHaveLength(18);
    // The load-bearing assertion: every read was still outstanding when each of
    // them answered, which is what "asked at the same time" means.
    expect(reads.overlapped).toEqual(Array(18).fill(18));
    // And every chain still reported: overlap did not cost anybody a figure.
    expect(portfolio.chains.map((chain) => chain.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  });

  it('keeps one chain failing from taking the other two down', async () => {
    // Ethereum is down. Monad and Solana must not be — and the failure keeps its
    // own reason, on its own chain, exactly as it did when the chains were read
    // one after the other.
    const failing: EvmBalanceReader = {
      nativeBalance: async (chain) => {
        if (chain === 'ethereum') throw new BalanceReadError('RPC_REJECTED', 'the endpoint rejected it');
        return 7n;
      },
      erc20Balance: async (chain) => {
        if (chain === 'ethereum') throw new BalanceReadError('RPC_REJECTED', 'the endpoint rejected it');
        return 9n;
      },
    };
    const solana = solanaReader({ lamports: 4_000_000_000n, mints: { [USDC_MINT]: 1_500_000n } });

    const portfolio = await readPortfolio({ wallets, evm: failing, solana })(USER_ID, new Date(0));

    const byChain = new Map(portfolio.chains.map((chain) => [chain.chain, chain]));
    expect(byChain.get('monad')?.status).toBe('ok');
    expect(byChain.get('solana')?.status).toBe('ok');
    expect(byChain.get('ethereum')).toEqual({
      chain: 'ethereum',
      status: 'error',
      error: { code: 'CHAIN_READ_FAILED', reason: 'RPC_REJECTED' },
    });
    // The two healthy chains kept their exact figures.
    const solanaChain = byChain.get('solana');
    expect(solanaChain?.status === 'ok' ? solanaChain.assets[0] : undefined).toMatchObject({ raw: '4000000000' });
  });

  it('reports the chains in the catalog order, whatever order they answered in', async () => {
    // Overlap must not reorder the response: the screen reads `chains[]` positionally.
    const slowFirst = together(18, (index) => (index === 0 ? 0n : BigInt(index + 1)));
    const solana: SolanaBalanceReader = {
      lamports: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        return 1n;
      },
      tokenAmount: async () => 0n,
      mintBalance: slowFirst.read,
    };
    const evm: EvmBalanceReader = { nativeBalance: slowFirst.read, erc20Balance: slowFirst.read };

    const portfolio = await readPortfolio({ wallets, evm, solana })(USER_ID, new Date(0));

    expect(portfolio.chains.map((chain) => chain.chain)).toEqual(['monad', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana']);
  });
});

describe('readPortfolio — the real adapter, over a fake endpoint', () => {
  /*
   * The two halves together, because the rule they carry lives between them: the
   * adapter returns base units and **no scale**, and the catalog's scale is what
   * turns them into an amount. No network: `fetch` answers with a scripted body.
   */
  const endpoint = (
    answer: (method: string) => string | undefined,
  ): { fetchImpl: typeof fetch; asked: string[] } => {
    const asked: string[] = [];
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string };
      asked.push(body.method);
      return new Response(answer(body.method) ?? JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }));
    }) as unknown as typeof fetch;
    return { fetchImpl, asked };
  };

  const tokenAccounts = (amount: string, decimals: number): string =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        context: { slot: 1 },
        value: [
          {
            pubkey: '4Nd1mBQtrMJVYVfKf2PJy9zvxp17aAMC3RaK6mho1FM',
            account: {
              data: {
                program: 'spl-token',
                parsed: {
                  type: 'account',
                  info: { mint: USDC_MINT, owner: SOLANA_ADDRESS, tokenAmount: { amount, decimals, uiAmount: 1.5 } },
                },
              },
            },
          },
        ],
      },
    });

  it('scales the base units with the catalog, whatever the endpoint claims', async () => {
    // The endpoint says this six-decimal mint has nine decimals. The amount is
    // still six-decimal USDC, because the exponent came from the catalog and
    // nowhere else.
    const { fetchImpl, asked } = endpoint((method) =>
      method === 'getTokenAccountsByOwner' ? tokenAccounts('1500000', 9) : JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 1234567890 } }),
    );
    const solana = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    const chain = await read(solana);
    const usdc = chain?.status === 'ok' ? chain.assets.find((asset) => asset.symbol === 'USDC') : undefined;

    expect(asked).toEqual(['getBalance', 'getTokenAccountsByOwner']);
    expect(usdc).toEqual({ symbol: 'USDC', unit: 'USDC', decimals: 6, raw: '1500000', amount: '1.5' });
  });

  it('refuses a malformed token answer as an unreadable asset, not as a zero', async () => {
    const { fetchImpl } = endpoint((method) =>
      method === 'getTokenAccountsByOwner'
        ? JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { not: 'a list' } } })
        : JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 1234567890 } }),
    );
    const solana = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    const chain = await read(solana);

    // The coin read is untouched by a token answer we cannot parse.
    expect(chain?.status === 'ok' ? chain.assets[0] : undefined).toMatchObject({ symbol: 'SOL', raw: '1234567890' });
    const usdc = chain?.status === 'ok' ? chain.assets.find((asset) => asset.symbol === 'USDC') : undefined;
    expect(usdc !== undefined && usdc.raw === null ? usdc.error : undefined).toEqual({
      code: 'ASSET_READ_FAILED',
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });
});