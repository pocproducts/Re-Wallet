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
import { keccak256, toBytes } from 'viem';

/** Los primeros 4 bytes del keccak de una firma, que es como se calcula un selector. */
const selectorOf = (signature: string): string => keccak256(toBytes(signature)).slice(0, 10);
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import type { DeadlinePolicy } from '../../src/infrastructure/rpc/httpDeadline';

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
    /*
     * El selector se **deriva** del nombre de la funcion, no se escribe a mano.
     * Escribiendolo a mano se colaron dos equivocados en este proyecto:
     * `0x026b1d5f` (que es el de Aave V2) y despues `0x028a2c12` (que no es
     * esta funcion). Los dos revierten, y un revert se lee como "el contrato no
     * responde" cuando el contrato esta perfectamente bien.
     */
    expect(requests[0]?.data?.startsWith(selectorOf('getReserveConfigurationData(address)'))).toBe(true);
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

/**
 * The edge cache on the two **global** reserve reads.
 *
 * `getReserveData(USDC)` and `getReserveConfigurationData(USDC)` are the same
 * structs for every person, on every route — and this project has exactly one
 * reserve — so `/api/pool` and `/api/wallet-balance` in the same page load were
 * asking for two copies of them. The cache reuses them for a short, explicit
 * TTL and nothing else: every test below moves a **fake clock**, so no assertion
 * depends on wall time, and the balances are shown to stay uncached.
 */
describe('the edge cache on the reserve reads', () => {
  const clock = (start: number = 1_700_000_000_000) => {
    const state = { now: start };
    return {
      state,
      advance: (ms: number): void => {
        state.now += ms;
      },
    };
  };

  it('reuses the reserve inside the TTL and reads again outside it', async () => {
    const time = clock();
    const { fetchImpl, requests } = answering(hexOf(RAW_RESERVE));
    const reader = createJsonRpcAavePoolReader({
      endpoints: [RPC_URL],
      fetchImpl,
      nowMs: () => time.state.now,
    });

    const first = await reader.reserveData();
    expect(requests).toHaveLength(1);

    // Fourteen seconds later — inside the fifteen-second TTL.
    time.advance(14_000);
    expect(await reader.reserveData()).toEqual(first);
    expect(requests).toHaveLength(1);

    // One second more and it is read again, from the node, as it always was.
    time.advance(1_000);
    expect(await reader.reserveData()).toEqual(first);
    expect(requests).toHaveLength(2);
  });

  it('reuses the configuration on its own key, never as the reserve', async () => {
    const time = clock();
    const configuration = hexOf(['6', '7500', '7800', '10750', '1000', '1', '1', '0', '1', '0']);
    const requests: { data?: string }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { params: [{ to: string; data: string }, string] };
      requests.push({ data: body.params[0]?.data });
      // The two calls are told apart by the selector, so neither key can be
      // answered with the other's struct.
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: body.params[0]?.data.startsWith(selectorOf('getReserveConfigurationData(address)'))
            ? configuration
            : hexOf(RAW_RESERVE),
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl, nowMs: () => time.state.now });

    const data = await reader.reserveData();
    const config = await reader.reserveConfiguration();
    expect(data.totalAToken).toBe(173874477777314n);
    expect(config.reserveFactorBps).toBe(1000n);

    // Both again, one second later: two requests total, not four.
    time.advance(1_000);
    expect((await reader.reserveData()).totalAToken).toBe(173874477777314n);
    expect((await reader.reserveConfiguration()).reserveFactorBps).toBe(1000n);
    expect(requests).toHaveLength(2);
  });

  it('never caches a refusal, so a dead endpoint is retried at once', async () => {
    const time = clock();
    let attempts = 0;
    const failing = (async () => {
      attempts += 1;
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl: failing, nowMs: () => time.state.now });

    await expect(reader.reserveData()).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
    // One millisecond later — nowhere near the TTL — it is asked again.
    time.advance(1);
    await expect(reader.reserveData()).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
    expect(attempts).toBe(2);
  });

  it('collapses concurrent misses into a single read', async () => {
    // Two requests arriving together in one isolate must not mean two identical
    // `eth_call`s.
    const { fetchImpl, requests } = answering(hexOf(RAW_RESERVE));
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl });

    const [first, second] = await Promise.all([reader.reserveData(), reader.reserveData()]);

    expect(second).toEqual(first);
    expect(requests).toHaveLength(1);
  });

  it('caches no money: every balance and allowance is read on every call', async () => {
    /*
     * The line the cache does not cross. `erc20Balance`, `nativeBalance` and
     * `allowance` are the person's own figures, so they go to the node every
     * single time, whatever the TTL says about the reserve.
     */
    const { fetchImpl, requests } = answering('0x');
    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl });
    const token = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';

    await reader.erc20Balance(token, OWNER);
    await reader.erc20Balance(token, OWNER);
    await reader.allowance(token, OWNER, SPENDER);
    await reader.nativeBalance(OWNER);
    await reader.nativeBalance(OWNER);

    expect(requests).toHaveLength(5);
  });
});

describe('a node that does not answer', () => {
  it('refuses the reserve as RPC_UNAVAILABLE, and caches the refusal for nobody', async () => {
    /*
     * The hung node, with the deadline expired by hand rather than waited for: the
     * proof that the bound exists costs no wall time, and without one this read
     * never settles — which is the failure this adapter had.
     */
    const requests: string[] = [];
    let fire: (() => void) | undefined;

    const fetchImpl = ((_url: string, init?: RequestInit) => {
      requests.push(String(init?.body ?? ''));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init?.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
        });
      });
    }) as unknown as typeof fetch;

    const deadline: DeadlinePolicy = {
      timeoutMs: 4_000,
      schedule: (_ms, onDeadline) => {
        fire = onDeadline;
        return () => {
          fire = undefined;
        };
      },
    };

    const reader = createJsonRpcAavePoolReader({ endpoints: [RPC_URL], fetchImpl, deadline });

    const pending = reader.reserveData();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fire?.();

    // Not a zero reserve and not a decode failure: the node answered nothing, and
    // the reserve is unreadable for exactly that reason.
    await expect(pending).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });

    /*
     * And the failed read left nothing behind. The in-flight entry is gone, so the
     * next caller starts a real read instead of joining a flight that already gave
     * up — a cache entry must not outlive a request that failed.
     */
    const afterFailure = requests.length;
    const second = reader.reserveData();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests.length).toBeGreaterThan(afterFailure);

    fire?.();
    await expect(second).rejects.toBeInstanceOf(BalanceReadError);
  });
});
