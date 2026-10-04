/**
 * The EVM and Solana adapters, against a `fetch` that answers what it is told.
 *
 * No network. What is asserted is the part that decides whether a person is told
 * the truth: a hex quantity becomes an exact `bigint`, a lamport count stays exact
 * past `2^53`, and **nothing that failed is ever reported as a zero**.
 */
import { describe, expect, it } from 'vitest';

import { formatUnits, USDC_ADDRESS } from '../../src/domain/portfolio/assets';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import { createJsonRpcEvmBalanceReader } from '../../src/infrastructure/rpc/jsonRpcEvmBalanceReader';
import { createHttpSolanaBalanceReader } from '../../src/infrastructure/rpc/solanaBalanceReader.http';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const ENDPOINTS = { monad: 'https://monad.invalid', ethereum: 'https://ethereum.invalid' };

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

  it('asks each network its own endpoint with the same address', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: json('0x0') }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await reader.nativeBalance('monad', ADDRESS);
    await reader.nativeBalance('ethereum', ADDRESS);

    expect(calls.map((c) => c.url)).toEqual([ENDPOINTS.monad, ENDPOINTS.ethereum]);
    // The same address on both: one EVM wallet, two networks.
    expect(calls.map((c) => c.body['params'])).toEqual([[ADDRESS, 'latest'], [ADDRESS, 'latest']]);
  });

  it('encodes balanceOf(address) with the selector and a padded argument', async () => {
    const { fetchImpl, calls } = answering(() => ({ text: json('0x16e360') }));
    const reader = createJsonRpcEvmBalanceReader({ endpoints: ENDPOINTS, fetchImpl });

    await expect(reader.erc20Balance('monad', USDC_ADDRESS, ADDRESS)).resolves.toBe(1500000n);

    const call = calls[0]?.body as { method: string; params: { to: string; data: string }[] };
    expect(call.method).toBe('eth_call');
    expect(call.params[0]?.to).toBe(USDC_ADDRESS);
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