/**
 * The JSON-RPC adapter of the pool, over an injected `fetch`: no network.
 *
 * ── What this file is for ─────────────────────────────────────────────────────
 *
 * The decoder is proven against a transcript in `test/domain/aavePool.test.ts`.
 * This file proves the other half: that the hex a node answers arrives at the
 * decoder **intact**, and that an answer that is not a reserve fails as a decode
 * failure rather than as a reserve full of zeroes.
 *
 * The three failures are kept apart on purpose, and this is where that separation
 * is exercised end to end: an endpoint that does not answer, an endpoint that says
 * no, and an endpoint that answers with something this code cannot read as a
 * reserve are three different operator problems.
 */
import { describe, expect, it } from 'vitest';

import { ReserveDecodeError } from '../../src/domain/pool/reserveData';
import { createJsonRpcAavePoolReader } from '../../src/infrastructure/rpc/jsonRpcAavePoolReader';
import { BalanceReadError } from '../../src/domain/portfolio/errors';

/** The transcript of `getReserveData(USDC)` on Monad mainnet, 2026-10-04. */
const RAW_RESERVE: readonly string[] = [
  '0',
  '138625857678',
  '173874477777314',
  '0',
  '159699152138313',
  '41196389349252103065387833',
  '49876895160470413431331597',
  '0',
  '0',
  '1009859695804839225116566637',
  '1012201287234727256155333993',
  '1791088293',
];

const hexOf = (words: readonly string[]): string =>
  `0x${words.map((word) => BigInt(word).toString(16).padStart(64, '0')).join('')}`;

/** A `fetch` that answers `eth_call` with `result`, and records the requests. */
const answering = (result: string) => {
  const requests: { to?: string; data?: string; method?: string }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      method: string;
      params: [{ to: string; data: string }, string];
    };
    requests.push({ method: body.method, to: body.params[0]?.to, data: body.params[0]?.data });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
};

const RPC_URL = 'https://rpc.example.invalid';

const OWNER = '0x1234567890abcdef1234567890abcdef12345678';
const SPENDER = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef';

describe('the pool adapter', () => {
  it('carries the twelve words of the answer through to the named fields', async () => {
    const { fetchImpl, requests } = answering(hexOf(RAW_RESERVE));
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl });

    const reserve = await reader.reserveData();

    expect(reserve.totalAToken).toBe(173874477777314n);
    expect(reserve.liquidityRate).toBe(41196389349252103065387833n);
    expect(Number(reserve.lastUpdateTimestamp)).toBe(1791088293);
    // The call went to the data provider with the V3 selector.
    expect(requests[0]?.to).toBe('0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad');
    expect(requests[0]?.data?.startsWith('0x35ea6a75')).toBe(true);
  });

  it('refuses an answer that is not twelve words, instead of misaligning the rest', async () => {
    // Six words: the exact shape that produced a `lastUpdateTimestamp` of `4e25`.
    const { fetchImpl } = answering(hexOf(RAW_RESERVE.slice(0, 6)));
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl });

    await expect(reader.reserveData()).rejects.toBeInstanceOf(ReserveDecodeError);
  });

  it('reads the reserve configuration, with the reserve factor in basis points', async () => {
    // Ten outputs, in the official order. `1000` is 10%, not 1000%.
    const configuration = hexOf(['6', '7500', '7800', '10750', '1000', '1', '1', '0', '1', '0']);
    const { fetchImpl, requests } = answering(configuration);
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl });

    const read = await reader.reserveConfiguration();

    expect(read.decimals).toBe(6n);
    expect(read.reserveFactorBps).toBe(1000n);
    expect(read.isActive).toBe(true);
    expect(read.isFrozen).toBe(false);
    expect(requests[0]?.data?.startsWith('0x028a2c12')).toBe(true);
  });

  it('reads a balance and an allowance as bigints, and a real zero as zero', async () => {
    const { fetchImpl, requests } = answering('0x');
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl });

    expect(await reader.erc20Balance('0x754704Bc059F8C67012fEd69BC8A327a5aafb603', OWNER)).toBe(0n);
    expect(requests[0]?.data?.startsWith('0x70a08231')).toBe(true);

    expect(await reader.allowance('0x754704Bc059F8C67012fEd69BC8A327a5aafb603', OWNER, SPENDER)).toBe(0n);
    expect(requests[1]?.data?.startsWith('0xdd62ed3e')).toBe(true);
  });

  it('keeps the three endpoint failures apart', async () => {
    const rejecting = (async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl: rejecting });
    await expect(reader.reserveData()).rejects.toMatchObject({ reason: 'RPC_REJECTED' });

    const unavailable = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const down = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl: unavailable });
    await expect(down.reserveData()).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });

    const garbage = (async () => new Response('<html>challenge</html>', { status: 200 })) as unknown as typeof fetch;
    const wrong = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl: garbage });
    await expect(wrong.reserveData()).rejects.toMatchObject({ reason: 'RPC_MALFORMED_RESPONSE' });
  });

  it('tries the next endpoint before giving up, and reports the last failure', async () => {
    const first = 'https://down.invalid';
    const { fetchImpl } = answering(hexOf(RAW_RESERVE));
    const reader = createJsonRpcAavePoolReader({
      endpoints: [first, RPC_URL],
      fetchImpl: (async (url: string, init: RequestInit) => {
        if (url === first) throw new Error('socket hang up');
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    });

    expect((await reader.reserveData()).totalAToken).toBe(173874477777314n);

    const dead = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const both = createJsonRpcAavePoolReader({ endpoints: [first, RPC_URL], fetchImpl: dead });
    await expect(both.reserveData()).rejects.toBeInstanceOf(BalanceReadError);
  });
});
