/**
 * ADAPTER: JSON-RPC balance reads over HTTP.
 *
 * ── Why a hand-written JSON-RPC call and not a library ────────────────────────
 *
 * A client library is a dependency that would have to be bundled into the Worker
 * to save about forty lines, and it would hide exactly the thing that matters
 * here: the two ways a read fails. A rate limit and a malformed answer must not
 * produce the same value, and the code that decides that is the code that parses
 * the response. It is here, and it is small.
 *
 * ── Why `bigint` and never `Number` ──────────────────────────────────────────
 *
 * `eth_getBalance` answers with a **hex quantity**. `Number('0x1b7c…')` is already
 * wrong past 53 bits, and `parseInt` would be worse. The hex is parsed by `BigInt`
 * and stays a `bigint` all the way to the response.
 *
 * ── Why the three failures are kept apart ────────────────────────────────────
 *
 *  - the endpoint did not answer (DNS, TLS, timeout, 5xx, 429) → `RPC_UNAVAILABLE`
 *  - it answered with an `error` object → `RPC_REJECTED`
 *  - it answered with something that is not a hex quantity → `RPC_MALFORMED_RESPONSE`
 *
 * The third one is the case that must never be mistaken for a zero balance, which
 * is why it has its own name: it is the one that means the adapter itself is
 * wrong, and it is the one an operator has to see.
 */
import { BalanceReadError } from '../../domain/portfolio/errors';
import type { EvmNetwork } from '../../domain/portfolio/networks';
import type { EvmBalanceReader } from '../../domain/ports/evm-balance-reader';

export interface EvmEndpoints {
  readonly monad: string;
  readonly ethereum: string;
}

/**
 * The public endpoints this POC reads.
 *
 * Both were answered by hand before being written down — `eth_getBalance` and a
 * `balanceOf` `eth_call` on the USDC contract — because an endpoint that cannot
 * be reached is discovered by a screen showing zeros, not by a deploy.
 */
export const DEFAULT_EVM_ENDPOINTS: EvmEndpoints = {
  monad: 'https://rpc.monad.xyz',
  ethereum: 'https://cloudflare-eth.com',
};

/** `balanceOf(address)`, the first four bytes of the keccak of that signature. */
const BALANCE_OF_SELECTOR = '70a08231';

/** A 20-byte address, left-padded to the 32-byte word a `uint256` argument is. */
const encodeAddressArgument = (address: string): string => {
  const bare = address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(bare)) {
    // An address we cannot encode is a bug above this adapter, not a chain failure.
    throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `not an EVM address: ${address}`);
  }
  return bare.toLowerCase().padStart(64, '0');
};

/** A JSON-RPC quantity: `0x`-prefixed hex. `BigInt` is the only safe parser. */
const parseQuantity = (result: unknown): bigint => {
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `expected a hex quantity, got ${typeof result}`);
  }
  return BigInt(result);
};

export interface JsonRpcEvmBalanceReaderOptions {
  readonly endpoints?: EvmEndpoints;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export const createJsonRpcEvmBalanceReader = (options: JsonRpcEvmBalanceReaderOptions = {}): EvmBalanceReader => {
  const endpoints = options.endpoints ?? DEFAULT_EVM_ENDPOINTS;
  const send = options.fetchImpl ?? fetch;

  /** One JSON-RPC call. Throws `BalanceReadError`, never returns a wrong number. */
  const rpc = async (network: EvmNetwork, method: string, params: readonly unknown[]): Promise<bigint> => {
    const url = endpoints[network];

    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (error) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `${network} ${method} did not reach the endpoint`, {
        cause: error,
      });
    }

    if (!response.ok) {
      // 429 is a rate limit and 5xx is an outage; both are the endpoint's problem
      // and both mean "no number", which is what the caller has to be told.
      throw new BalanceReadError('RPC_UNAVAILABLE', `${network} ${method} answered HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `${network} ${method} answered with no JSON`, {
        cause: error,
      });
    }

    const payload = body as { error?: unknown; result?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `${network} ${method} answered with no JSON object`);
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new BalanceReadError('RPC_REJECTED', `${network} ${method} was rejected by the endpoint`);
    }

    return parseQuantity(payload.result);
  };

  return {
    nativeBalance: (network, address) => rpc(network, 'eth_getBalance', [address, 'latest']),

    erc20Balance: (network, token, address) =>
      rpc(network, 'eth_call', [
        { to: token, data: `0x${BALANCE_OF_SELECTOR}${encodeAddressArgument(address)}` },
        'latest',
      ]),
  };
};