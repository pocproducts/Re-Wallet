/**
 * ADAPTER: the Aave V3 pool on Monad, over JSON-RPC.
 *
 * ── Why this adapter does not share the balance reader ────────────────────────
 *
 * `jsonRpcEvmBalanceReader` answers `eth_getBalance` and `balanceOf`, and it
 * parses every answer into a `bigint` — which is the wrong shape for
 * `getReserveData`, whose answer is a **struct** and not a number. Forcing a
 * twelve-word struct through a `bigint` port is how a decode ends up one word
 * off. So this adapter keeps `eth_call`'s hex answer as hex and hands it to the
 * decoder, which is the only place allowed to interpret it.
 *
 * ── Why the raw answer is a string and never a number ─────────────────────────
 *
 * `0x` (an empty answer, which a call to an address with no code returns) and a
 * 27-digit rate are both valid `eth_call` answers, and neither is a double. The
 * whole path is strings and `bigint`, and it stops being a string only where the
 * response is JSON.
 *
 * ── Why one endpoint list and not an address parameter ────────────────────────
 *
 * The addresses are in `domain/pool/aaveMonad.ts` and are read from there. This
 * adapter cannot be pointed at another pool, which is the property that keeps
 * "a deposit on mainnet" from becoming "a deposit on whatever the caller typed".
 */
import { BalanceReadError } from '../../domain/portfolio/errors';
import {
  AAVE_V3_MONAD,
  ALLOWANCE_SELECTOR,
  BALANCE_OF_SELECTOR,
  DEFAULT_MONAD_POOL_RPC_URL,
  GET_RESERVE_CONFIGURATION_SELECTOR,
} from '../../domain/pool/aaveMonad';
import {
  ReserveDecodeError,
  decodeReserveData,
  reserveDataCall,
  type ReserveData,
} from '../../domain/pool/reserveData';
import type { AavePoolReader, ReserveConfiguration } from '../../domain/ports/aave-pool-reader';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from './httpDeadline';

/** A 32-byte word holding an `address`, from a plain 20-byte address. */
const addressWord = (address: string): string => {
  const bare = address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(bare)) {
    throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `not an EVM address: ${address}`);
  }
  return bare.toLowerCase().padStart(64, '0');
};

/** `getReserveConfigurationData`, whose ten outputs are documented below. */
const RESERVE_CONFIGURATION_CALL = `${GET_RESERVE_CONFIGURATION_SELECTOR}${addressWord(
  AAVE_V3_MONAD.asset,
)}`;

const decodeConfiguration = (data: string): ReserveConfiguration => {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  if (body.length !== 10 * 64) {
    throw new ReserveDecodeError(
      `getReserveConfigurationData declares ten outputs, the answer carries ${body.length / 64}`,
    );
  }

  const words = Array.from({ length: 10 }, (_, index) => BigInt(`0x${body.slice(index * 64, index * 64 + 64)}`));

  /*
   * The order of the official ABI:
   *   decimals, ltv, liquidationThreshold, liquidationBonus, reserveFactor,
   *   usageAsCollateralEnabled, borrowingEnabled, stableBorrowRateEnabled,
   *   isActive, isFrozen
   *
   * `reserveFactor` comes back in **basis points** (`1000` = 10%), which is the
   * unit `reconcileSupplyApr` wants. Converting it here would be the one place
   * in the codebase where 1000 could be read as 1000%.
   */
  return {
    decimals: words[0] as bigint,
    ltv: words[1] as bigint,
    liquidationThreshold: words[2] as bigint,
    reserveFactorBps: words[4] as bigint,
    isActive: (words[8] as bigint) !== 0n,
    isFrozen: (words[9] as bigint) !== 0n,
  };
};

export interface JsonRpcAavePoolReaderOptions {
  /**
   * Candidate endpoints, tried in order. A public endpoint rate-limiting is not
   * an exception, it is Tuesday: the last failure of the list is the one reported,
   * and a reader with no working endpoint reports `RPC_UNAVAILABLE` rather than
   * a zero reserve.
   */
  readonly endpoints?: readonly string[];
  /** Injected so this adapter is testable with no network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Injected clock, in Unix **milliseconds**. A test chooses the age of a cached
   * reserve instead of waiting for it to expire, so no assertion in this
   * repository depends on wall time.
   */
  readonly nowMs?: () => number;
  /**
   * How long a successful reserve read may be reused, in milliseconds. Defaults
   * to {@link AAVE_RESERVE_CACHE_TTL_MS}.
   */
  readonly reserveCacheTtlMs?: number;
  /**
   * How long one `eth_call` attempt at one endpoint may take. Defaults to
   * {@link AAVE_POOL_REQUEST_TIMEOUT_MS}; tests replace the schedule to drive
   * the deadline by hand instead of waiting for it.
   */
  readonly deadline?: DeadlinePolicy;
}

/**
 * How long one pool `eth_call` is given, and why 4 s.
 *
 * `getReserveData` and `getReserveConfigurationData` are not storage reads of one
 * slot: each walks several slots of the reserve — decimals, LTV, thresholds, the
 * factor, and then the live liquidity, utilisation and both borrow indexes — and
 * a public endpoint serves them from state it may not hold in memory. It is the
 * most expensive **read** this repository makes on an EVM node, and it is the
 * read behind the pool screen, so the bound is a second wider than the plain
 * balance read's and not much wider than that: the balance screen and this one
 * are answered by the same person waiting on the same request, and a bound that
 * protected the pool screen but not the balance would just move the stall.
 *
 * It is the same number the Chainlink feed uses, and deliberately so — both are a
 * handful of state-only `eth_call`s against the same kind of public Monad
 * endpoint, and neither of them is one slot.
 */
export const AAVE_POOL_REQUEST_TIMEOUT_MS = 4_000;

/**
 * How long `getReserveData` / `getReserveConfigurationData` are reused, and why
 * that is acceptable.
 *
 * These two reads are **global**: the USDC reserve on Aave V3 on Monad is the same
 * struct for every person, on every request, on every route. Nothing in either
 * answer depends on who asked, and this project has exactly one reserve — so
 * caching them cannot leak one person's balance into another's answer, because
 * they are not balances.
 *
 * Fifteen seconds, against what the reserve actually does: `reserveConfiguration`
 * (decimals, LTV, reserve factor) only changes through a governance action, and
 * `reserveData` moves the figures the pool screen paints — utilisation, the two
 * APRs, `lastUpdateTimestamp` — at the pace of blocks. Fifteen seconds is a
 * handful of blocks: long enough for a page load that asks `/api/pool` and
 * `/api/wallet-balance` to share one read instead of two, short enough that the
 * reserve on screen is not a screenshot from a minute ago.
 *
 * **No money is cached.** `erc20Balance`, `nativeBalance` and `allowance` are the
 * person's own figures and are read through on every single call, which is the
 * line this cache does not cross.
 */
export const AAVE_RESERVE_CACHE_TTL_MS = 15_000;

export const DEFAULT_POOL_ENDPOINTS: readonly string[] = [DEFAULT_MONAD_POOL_RPC_URL];

export const createJsonRpcAavePoolReader = (
  options: JsonRpcAavePoolReaderOptions = {},
): AavePoolReader => {
  const endpoints = options.endpoints ?? DEFAULT_POOL_ENDPOINTS;
  /*
   * Bound once, so no `eth_call` below can go out without a deadline. Per attempt,
   * not per read: an endpoint that does not answer must not spend the budget of
   * the one after it.
   */
  const send = withDeadline(options.fetchImpl ?? fetch, {
    timeoutMs: AAVE_POOL_REQUEST_TIMEOUT_MS,
    ...options.deadline,
  });
  const nowMs = options.nowMs ?? ((): number => Date.now());
  const reserveTtlMs = options.reserveCacheTtlMs ?? AAVE_RESERVE_CACHE_TTL_MS;

  /**
   * The edge cache for the two **global** reserve reads.
   *
   * It is a plain `Map` in this closure, which in a Worker is one map per isolate:
   * two fixed keys, so nothing grows without bound, and an entry is deleted the
   * moment it is found expired rather than being swept. There is no eviction
   * policy to get wrong because there are only ever two things to evict.
   *
   * Two rules the rest of this repository cares about are encoded here:
   *
   *  - **a cache failure is never a read failure.** Nothing below can throw; if
   *    the map misbehaves the read is simply performed, and if the source refuses
   *    the caller sees exactly the `BalanceReadError` it saw before the cache
   *    existed.
   *  - **a failure is never cached.** Only a reserve that was read is remembered,
   *    so one refused endpoint call is retried by the very next request instead of
   *    being republished for fifteen seconds.
   *
   * Concurrent misses share the read in flight, because a warm isolate serves
   * every request at once and two callers arriving together must not mean two
   * identical `eth_call`s.
   */
  const reserveCache = new Map<'data' | 'configuration', { readonly value: unknown; readonly storedAtMs: number }>();
  const reserveInFlight = new Map<'data' | 'configuration', Promise<unknown>>();

  const memoized = <T>(key: 'data' | 'configuration', read: () => Promise<T>): Promise<T> => {
    const now = nowMs();
    const entry = reserveCache.get(key);

    if (entry !== undefined) {
      if (now - entry.storedAtMs < reserveTtlMs) return Promise.resolve(entry.value as T);
      reserveCache.delete(key);
    }

    const pending = reserveInFlight.get(key);
    if (pending !== undefined) return pending as Promise<T>;

    const flight: Promise<T> = read().then(
      (value) => {
        reserveInFlight.delete(key);
        reserveCache.set(key, { value, storedAtMs: nowMs() });
        return value;
      },
      (error: unknown) => {
        // Read through and let the failure travel unchanged: a cache that could
        // not store an answer is not a reason to invent one.
        reserveInFlight.delete(key);
        throw error;
      },
    );

    reserveInFlight.set(key, flight);
    return flight;
  };

  /** One `eth_call`, answered as the hex string the node sent. */
  const call = async (to: string, data: string): Promise<string> => {
    const failures: string[] = [];
    let firstReason: 'RPC_UNAVAILABLE' | 'RPC_REJECTED' | 'RPC_MALFORMED_RESPONSE' | undefined;

    for (const url of endpoints) {
      try {
        return await callOnce(url, to, data, send);
      } catch (error) {
        if (firstReason === undefined && error instanceof BalanceReadError) firstReason = error.reason;
        failures.push(error instanceof Error ? error.message.slice(0, 160) : 'unknown failure');
      }
    }

    throw new BalanceReadError(
      firstReason ?? 'RPC_UNAVAILABLE',
      `aave on Monad failed on all ${failures.length} endpoint(s): ${failures.join(' | ')}`,
    );
  };

  /** One endpoint, one request. */
  const callOnce = async (
    url: string,
    to: string,
    data: string,
    send: typeof fetch,
  ): Promise<string> => {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
      });
    } catch (error) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint ${transportDetail(error, 'did not answer')}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint answered HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      // A body that stopped mid-answer is our deadline, not a broken answer: the
      // two are indistinguishable here, and calling a silent endpoint a corrupt
      // one would send an operator to this file to fix a provider outage.
      if (isDeadlineExceeded(error)) {
        throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint ${error.message}`, { cause: error });
      }
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'the pool endpoint answered with no JSON', {
        cause: error,
      });
    }

    const payload = body as { error?: unknown; result?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'the pool endpoint answered with no JSON object');
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new BalanceReadError('RPC_REJECTED', 'the pool call was rejected by the endpoint');
    }
    if (typeof payload.result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(payload.result)) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'the pool call answered with no hex string');
    }

    return payload.result;
  };

  /** `eth_getBalance`, whose answer really is a number and not a struct. */
  const nativeBalance = async (address: string): Promise<bigint> => {
    let response: Response;
    try {
      response = await send(endpoints[0] as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      });
    } catch (error) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint ${transportDetail(error, 'did not answer')}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint answered HTTP ${response.status}`);
    }
    let body: { result?: unknown };
    try {
      body = (await response.json()) as { result?: unknown };
    } catch (error) {
      // Same rule as above, on the one read whose answer is a number: an expired
      // deadline is silence, and silence is `RPC_UNAVAILABLE`, never a corrupted
      // hex string — which would otherwise read as a bug in this adapter.
      if (isDeadlineExceeded(error)) {
        throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint ${error.message}`, { cause: error });
      }
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'eth_getBalance answered with no JSON', {
        cause: error,
      });
    }
    if (typeof body.result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(body.result)) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'eth_getBalance answered with no hex string');
    }
    return body.result === '0x' ? 0n : BigInt(body.result);
  };

  return {
    reserveData: (): Promise<ReserveData> =>
      memoized('data', async () => decodeReserveData(await call(AAVE_V3_MONAD.dataProvider, reserveDataCall(AAVE_V3_MONAD.asset)))),

    reserveConfiguration: (): Promise<ReserveConfiguration> =>
      memoized('configuration', async () => decodeConfiguration(await call(AAVE_V3_MONAD.dataProvider, RESERVE_CONFIGURATION_CALL))),

    erc20Balance: (token, address) =>
      call(token, `${BALANCE_OF_SELECTOR}${addressWord(address)}`).then((result) =>
        result === '0x' ? 0n : BigInt(result),
      ),

    allowance: (token, owner, spender) =>
      call(token, `${ALLOWANCE_SELECTOR}${addressWord(owner)}${addressWord(spender)}`).then((result) =>
        result === '0x' ? 0n : BigInt(result),
      ),

    nativeBalance,
  };
};
