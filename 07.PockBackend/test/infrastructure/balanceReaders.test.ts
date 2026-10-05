/**
 * The EVM and Solana adapters, against a `fetch` that answers what it is told.
 *
 * No network. What is asserted is the part that decides whether a person is told
 * the truth: a hex quantity becomes an exact `bigint`, a lamport count stays exact
 * past `2^53`, and **nothing that failed is ever reported as a zero**.
 */
import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { formatUnits, USDC_ADDRESS_BY_CHAIN } from '../../src/domain/portfolio/assets';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import { createJsonRpcEvmBalanceReader } from '../../src/infrastructure/rpc/jsonRpcEvmBalanceReader';
import { createHttpSolanaBalanceReader } from '../../src/infrastructure/rpc/solanaBalanceReader.http';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const ENDPOINTS = { monad: ['https://monad.invalid'], ethereum: ['https://ethereum.invalid'] };

/** A `fetch` that answers with whatever the test hands it, and records the calls. */
const answering = (
  handler: (url: string, body: Record<string, unknown>) => { status?: number; text: string },
): { fetchImpl: typeof fetch; calls: { url: string; body: Record<string, unknown> }[] } => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body });
    const answer = handler(url, body);
    return new Response(answer.text, { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
};

const json = (value: unknown): string => JSON.stringify({ jsonrpc: '2.0', id: 1, result: value });

describe('jsonRpcEvmBalanceReader', () => {
  it('parses a hex quantity exactly, past the range of a double', async () => {
    // 10^30 wei. `Number` would have produced `1.0000000000000001e+30`.
    const { fetchImpl } = answering(() => ({ text: json('0xc9f2c9cd04674edea40000000') }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).resolves.toBe(10n ** 30n);
  });

  it('reads 0x — an address with no contract — as zero, not as a corrupted answer', async () => {
    // `eth_call` a una direccion sin codigo responde `0x`. Para un `balanceOf`
    // eso es cero. Declararlo corrupto convertia "este contrato no existe en
    // esta red" en "no pudimos leer la red".
    const { fetchImpl } = answering(() => ({ text: json('0x') }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.erc20Balance('ethereum', USDC_ADDRESS_BY_CHAIN.ethereum, ADDRESS)).resolves.toBe(0n);
  });

  it('falls through to the next endpoint when the first one is down', async () => {
    // Un endpoint público caído es martes, no una excepción: se prueba el
    // siguiente. Depender de una sola URL convierte una caída externa en una
    // cadena rota en pantalla.
    const candidates = { monad: ['https://primero.invalid'], ethereum: ['https://primero.invalid'] };
    const { fetchImpl, calls } = answering((url) =>
      url === 'https://primero.invalid'
        ? { status: 503, text: 'down' }
        : { text: json('0x2a') },
    );
    const reader = createJsonRpcEvmBalanceReader({
      endpoints: { monad: [...candidates.monad, 'https://segundo.invalid'], ethereum: [...candidates.ethereum, 'https://segundo.invalid'] },
      fetchImpl,
    });

    await expect(reader.nativeBalance('monad', ADDRESS)).resolves.toBe(42n);
    expect(calls.map((c) => c.url)).toEqual(['https://primero.invalid', 'https://segundo.invalid']);
  });

  it('reports the failure when every candidate endpoint is down', async () => {
    const { fetchImpl, calls } = answering(() => ({ status: 500, text: 'down' }));
    const reader = createJsonRpcEvmBalanceReader({
      endpoints: { monad: ['https://a.invalid', 'https://b.invalid'], ethereum: ['https://a.invalid'] },
      fetchImpl,
    });

    // Nunca un cero: si toda la lista falla, la cadena se declara ilegible.
    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toThrow(BalanceReadError);
    expect(calls).toHaveLength(2);
  });

  it('asks each network its own endpoint with the same address', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: json('0x0') }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await reader.nativeBalance('monad', ADDRESS);
    await reader.nativeBalance('ethereum', ADDRESS);

    expect(calls.map((c) => c.url)).toEqual([ENDPOINTS.monad[0], ENDPOINTS.ethereum[0]]);
    // The same address on both: one EVM wallet, two networks.
    expect(calls.map((c) => c.body['params'])).toEqual([[ADDRESS, 'latest'], [ADDRESS, 'latest']]);
  });

  it('encodes balanceOf(address) with the selector and a padded argument', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: json('0x16e360') }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.erc20Balance('monad', USDC_ADDRESS_BY_CHAIN.monad, ADDRESS)).resolves.toBe(1500000n);

    const call = calls[0]?.body as { method: string; params: { to: string; data: string }[] };
    expect(call.method).toBe('eth_call');
    expect(call.params[0]?.to).toBe(USDC_ADDRESS_BY_CHAIN.monad);
    expect(call.params[0]?.data).toBe(
      `0x70a08231${ADDRESS.slice(2).toLowerCase().padStart(64, '0')}`,
    );
  });

  it('reports a missing endpoint as RPC_UNAVAILABLE, not as zero', async () => {
    const { fetchImpl } = answering(() => ({ status: 502, text: 'bad gateway' }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
  });

  it('reports a rate limit as RPC_UNAVAILABLE', async () => {
    const { fetchImpl } = answering(() => ({ status: 429, text: 'slow down' }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
  });

  it('reports an endpoint that answers with an error object as RPC_REJECTED', async () => {
    const { fetchImpl } = answering(() => ({
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'header not found' } }),
    }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toMatchObject({ reason: 'RPC_REJECTED' });
  });

  it('reports an answer that is not a hex quantity as RPC_MALFORMED_RESPONSE', async () => {
    // The response that must never be read as a zero.
    const { fetchImpl } = answering(() => ({ text: json(null) }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('reports a decimal answer as RPC_MALFORMED_RESPONSE', async () => {
    const { fetchImpl } = answering(() => ({ text: json(1000000000000000000) }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('reports an answer with no JSON as RPC_MALFORMED_RESPONSE', async () => {
    const { fetchImpl } = answering(() => ({ text: '<html>gateway</html>' }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.nativeBalance('monad', ADDRESS)).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('carries the reason, and never a provider message, in the thrown error', async () => {
    const { fetchImpl } = answering(() => ({ status: 503, text: 'the node is resyncing, sorry about that' }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    const error = await reader.nativeBalance('monad', ADDRESS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BalanceReadError);
    expect((error as BalanceReadError).reason).toBe('RPC_UNAVAILABLE');
  });
});

describe('httpSolanaBalanceReader', () => {
  it('reads a lamport count exactly, past MAX_SAFE_INTEGER', async () => {
    // 10^18 lamports is a million SOL — and 1e18 > 2^53, so `JSON.parse` would
    // already have lost the last digits here.
    const { fetchImpl } = answering(() => ({
      text: JSON.stringify({ context: { slot: 1 }, value: 1000000000000000000 }),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.lamports('So11111111111111111111111111111111111111112')).resolves.toBe(10n ** 18n);
  });

  it('reads a zero balance as zero', async () => {
    const { fetchImpl } = answering(() => ({ text: JSON.stringify({ context: { slot: 1 }, value: 0 }) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.lamports('So11111111111111111111111111111111111111112')).resolves.toBe(0n);
  });

  it('asks for the address it was given, with a commitment', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: JSON.stringify({ value: 1 }) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await reader.lamports('So11111111111111111111111111111111111111112');

    expect(calls[0]?.body['method']).toBe('getBalance');
    expect(calls[0]?.body['params']).toEqual(['So11111111111111111111111111111111111111112', { commitment: 'confirmed' }]);
  });

  it('reports a rate limit as RPC_UNAVAILABLE, not as zero', async () => {
    const { fetchImpl } = answering(() => ({ status: 429, text: 'rate limited' }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.lamports('So11111111111111111111111111111111111111112')).rejects.toMatchObject({
      reason: 'RPC_UNAVAILABLE',
    });
  });

  it('reports a rejection as RPC_REJECTED', async () => {
    const { fetchImpl } = answering(() => ({
      text: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' } }),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.lamports('nope')).rejects.toMatchObject({ reason: 'RPC_REJECTED' });
  });

  it('reads an SPL balance exactly, from the derived token account', async () => {
    /*
     * 10^19 units of a six-decimal token. A JSON `number` would already have lost
     * digits here, which is why the amount is read out of the raw text.
     */
    const { fetchImpl, calls } = answering(() => ({
      text: JSON.stringify({
        context: { slot: 1 },
        value: { amount: '10000000000000000000', decimals: 6, uiAmount: 10_000_000_000 },
      }),
    }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    const owner = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    await expect(reader.tokenAmount(owner, mint)).resolves.toBe(10n ** 19n);

    // The account asked about is the **associated token account**, derived: not
    // the owner's address, and not a concatenation anybody can spell by hand.
    expect(calls[0]?.body['method']).toBe('getTokenAccountBalance');
    const asked = (calls[0]?.body['params'] as string[])[0] as string;
    expect(asked).not.toBe(owner);
    expect(asked).toBe(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true).toBase58());
  });

  it('reads a token account that does not exist as zero, not as a failure', async () => {
    // An address that has never held USDC holds none of it. That is a fact about
    // the chain, and calling it unreadable would block a new wallet from sending.
    const { fetchImpl } = answering(() => ({ text: JSON.stringify({ context: { slot: 1 }, value: null }) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(
      reader.tokenAmount('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    ).resolves.toBe(0n);
  });

  it('refuses a token balance for something that is not two Solana addresses', async () => {
    // An EVM address pasted where a mint belongs: refused before any RPC, because
    // there is no token account of an address that is not on this chain.
    const { fetchImpl, calls } = answering(() => ({ text: JSON.stringify({ value: 1 }) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(
      reader.tokenAmount('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    ).rejects.toMatchObject({ reason: 'RPC_REJECTED' });
    expect(calls).toHaveLength(0);
  });

  it('reports an answer without a lamport value as RPC_MALFORMED_RESPONSE', async () => {
    const { fetchImpl } = answering(() => ({ text: JSON.stringify({ context: { slot: 1 } }) }));
    const reader = createHttpSolanaBalanceReader({ url: 'https://solana.invalid', fetchImpl });

    await expect(reader.lamports('So11111111111111111111111111111111111111112')).rejects.toMatchObject({
      reason: 'RPC_MALFORMED_RESPONSE',
    });
  });
});

describe('formatUnits', () => {
  it('keeps every digit of an eighteen-decimal balance', () => {
    expect(formatUnits(123456789012345678901n, 18)).toBe('123.456789012345678901');
  });

  it('keeps six decimals, and drops only the trailing zeros', () => {
    expect(formatUnits(1500000n, 6)).toBe('1.5');
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(1234567890123456n, 6)).toBe('1234567890.123456');
  });

  it('keeps nine decimals of lamports', () => {
    expect(formatUnits(1234567890n, 9)).toBe('1.23456789');
  });

  it('keeps a value past 2^53 exact', () => {
    // The same balance read through a double would print differently.
    expect(formatUnits(1000000000000000000n, 18)).toBe('1');
    expect(formatUnits(999999999999999999999n, 18)).toBe('999.999999999999999999');
  });

  it('reports zero as zero, with no decimal point', () => {
    expect(formatUnits(0n, 18)).toBe('0');
    expect(formatUnits(0n, 6)).toBe('0');
    expect(formatUnits(0n, 0)).toBe('0');
  });

  it('refuses a negative balance rather than printing one', () => {
    expect(() => formatUnits(-1n, 18)).toThrow(RangeError);
  });
});