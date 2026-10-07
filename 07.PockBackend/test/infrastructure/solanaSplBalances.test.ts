/**
 * The SPL side of the Solana adapter: **one catalogued mint**, read with
 * `getTokenAccountsByOwner` filtered by `mint`.
 *
 * No network. A `fetch` that answers whatever the test hands it, which is what
 * every assertion here is built on: an endpoint that is not up must produce a
 * refusal, never a zero.
 *
 * ── What this file pins, and why each one is money ──────────────────────────
 *
 *  - **The exact request.** One call, filtered by the mint, `jsonParsed`. The
 *    filter is what makes the read *ours*: without it the answer is "every
 *    token this wallet holds", which is not a portfolio and is not bounded.
 *  - **Exactness past 2^53.** Solana token amounts are decimal strings; a
 *    balance that loses digits is a balance nobody can explain.
 *  - **Every account, not only the canonical one.** A wallet can hold more than
 *    one token account of the same mint, and the portfolio counts all of them.
 *  - **`decimals` in the response is ignored.** The catalog is the authority on
 *    the scale; a network answer is a fact to check, not a source of truth.
 *  - **Nothing malformed is ever a zero.**
 */
import { describe, expect, it } from 'vitest';

import { createHttpSolanaBalanceReader } from '../../src/infrastructure/rpc/solanaBalanceReader.http';

const OWNER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ACCOUNT = '4Nd1mBQtrMJVYVfKf2PJy9zvxp17aAMC3RaK6mho1FM';

/** A `fetch` that answers with whatever the test hands it, and records the calls. */
const answering = (
  handler: (body: Record<string, unknown>) => { status?: number; text: string },
): { fetchImpl: typeof fetch; calls: { body: Record<string, unknown> }[] } => {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ body });
    const answer = handler(body);
    return new Response(answer.text, { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
};

/** One parsed token account, the shape `encoding: 'jsonParsed'` produces. */
const tokenAccount = (
  amount: string,
  decimals: number,
  mint = USDC_MINT,
  owner = OWNER,
  pubkey = ACCOUNT,
): unknown => ({
  pubkey,
  account: {
    lamports: 2039280,
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    data: {
      program: 'spl-token',
      space: 165,
      parsed: { type: 'account', info: { mint, owner, tokenAmount: { amount, decimals, uiAmount: 1.5 } } },
    },
  },
});

const result = (value: unknown[]): string => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value } });

describe('Solana SPL balance — the request', () => {
  it('asks getTokenAccountsByOwner with the mint as the filter and jsonParsed', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: result([tokenAccount('1500000', 6)]) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await reader.mintBalance(OWNER, USDC_MINT);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body['method']).toBe('getTokenAccountsByOwner');
    /*
     * The filter is the mint and the encoding is `jsonParsed`: an unfiltered
     * read is "every token this wallet holds", which is not our portfolio and
     * makes the screen unbounded.
     */
    expect(calls[0]?.body['params']).toEqual([
      OWNER,
      { mint: USDC_MINT },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
  });

  it('refuses anything that is not two Solana addresses, before any RPC', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: result([]) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(
      reader.mintBalance('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', USDC_MINT),
    ).rejects.toMatchObject({ reason: 'RPC_REJECTED' });
    expect(calls).toHaveLength(0);
  });
});

describe('Solana SPL balance — the answer', () => {
  it('reads the amount exactly, as a decimal string', async () => {
    // 10^19 units. A double has already lost digits here.
    const { fetchImpl } = answering(() => ({ text: result([tokenAccount('10000000000000000000', 6)]) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).resolves.toBe(10n ** 19n);
  });

  it('sums every token account the owner has for that mint, not only the first', async () => {
    /*
     * Two accounts of the same mint. Counting only the first one reports less
     * money than the person holds, which is the failure this read exists to
     * avoid — and it is invisible, because a smaller number still looks right.
     */
    const { fetchImpl } = answering(() => ({
      text: result([tokenAccount('1500000', 6, USDC_MINT, OWNER, ACCOUNT), tokenAccount('2500000', 6, USDC_MINT, OWNER, '9xQeWvG816LUx6kRww48hZfewbAWLLdc3A4k6pgT9nQ')]),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).resolves.toBe(4_000_000n);
  });

  it('reads a wallet that holds none of this mint as zero, not as a failure', async () => {
    // An empty `value` array is a fact about the chain: this owner has no
    // account of this mint. Reading it as "unreadable" would make a new wallet
    // look broken, and reading it as a *failure* would be a lie in the other
    // direction.
    const { fetchImpl } = answering(() => ({ text: result([]) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).resolves.toBe(0n);
  });

  it('ignores the decimals the response carries: the catalog owns the scale', async () => {
    /*
     * The endpoint claims nine decimals for a six-decimal mint. The parsed
     * integer is the integer: `1500000` base units, whatever anybody says the
     * exponent is. Re-scaling here would be reading the exponent off a network
     * answer, which is exactly what this project refuses to do.
     */
    const { fetchImpl } = answering(() => ({ text: result([tokenAccount('1500000', 9)]) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).resolves.toBe(1_500_000n);
  });
});

describe('Solana SPL balance — what is refused', () => {
  it('refuses a malformed response instead of reporting a zero', async () => {
    // `value` is not a list: the answer does not say what it is, so it does not
    // say "nothing".
    const { fetchImpl } = answering(() => ({
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: { oops: true } } }),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('refuses an account with no parsed token amount', async () => {
    const { fetchImpl } = answering(() => ({
      text: result([{ pubkey: ACCOUNT, account: { data: { program: 'spl-token', parsed: { type: 'account' } } } }]),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('refuses an amount that is not a decimal integer', async () => {
    const { fetchImpl } = answering(() => ({ text: result([tokenAccount('1.5', 6)]) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('refuses a short answer that carries no value at all', async () => {
    const { fetchImpl } = answering(() => ({ text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('reports an endpoint that is down as RPC_UNAVAILABLE, never as a zero', async () => {
    const { fetchImpl } = answering(() => ({ status: 429, text: 'rate limited' }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
  });

  it('reports a rejection as RPC_REJECTED', async () => {
    const { fetchImpl } = answering(() => ({
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' } }),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.mintBalance(OWNER, USDC_MINT)).rejects.toMatchObject({ reason: 'RPC_REJECTED' });
  });
});