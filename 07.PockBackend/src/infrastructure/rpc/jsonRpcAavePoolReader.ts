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
}

export const DEFAULT_POOL_ENDPOINTS: readonly string[] = [DEFAULT_MONAD_POOL_RPC_URL];

export const createJsonRpcAavePoolReader = (
  options: JsonRpcAavePoolReaderOptions = {},
): AavePoolReader => {
  const endpoints = options.endpoints ?? DEFAULT_POOL_ENDPOINTS;
  const send = options.fetchImpl ?? fetch;

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
      throw new BalanceReadError('RPC_UNAVAILABLE', 'the pool endpoint did not answer', { cause: error });
    }

    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint answered HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
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
      throw new BalanceReadError('RPC_UNAVAILABLE', 'the pool endpoint did not answer', { cause: error });
    }
    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `the pool endpoint answered HTTP ${response.status}`);
    }
    const body = (await response.json()) as { result?: unknown };
    if (typeof body.result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(body.result)) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'eth_getBalance answered with no hex string');
    }
    return body.result === '0x' ? 0n : BigInt(body.result);
  };

  return {
    async reserveData(): Promise<ReserveData> {
      return decodeReserveData(await call(AAVE_V3_MONAD.dataProvider, reserveDataCall(AAVE_V3_MONAD.asset)));
    },

    async reserveConfiguration(): Promise<ReserveConfiguration> {
      return decodeConfiguration(await call(AAVE_V3_MONAD.dataProvider, RESERVE_CONFIGURATION_CALL));
    },

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
