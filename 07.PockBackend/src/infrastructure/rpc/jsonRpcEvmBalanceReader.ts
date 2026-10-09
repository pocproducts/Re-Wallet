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
 *  - the endpoint did not answer (DNS, TLS, deadline, 5xx, 429) → `RPC_UNAVAILABLE`
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
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from './httpDeadline';

/**
 * The public endpoints this POC reads.
 *
 * Each endpoint below was answered by hand — `eth_blockNumber`,
 * `eth_getBalance` and a `balanceOf` `eth_call` on the USDC contract — from this
 * project, and re-checked on 2026-10-04. That re-check mattered: the Ethereum
 * endpoint used to be `cloudflare-eth.com`, which answered at the time and now
 * returns `Internal error`, and the screen showed "we could not read your
 * Ethereum balance" for an entire session before anyone compared the comment
 * with reality. **A comment claiming an endpoint was verified is worth nothing
 * on its own; a deploy that answers is.**
 *
 * Both are overridable per environment (`MONAD_RPC_URL`, `ETHEREUM_RPC_URL`),
 * and the new networks the same way (`BASE_RPC_URL`, `ARBITRUM_RPC_URL`,
 * `OPTIMISM_RPC_URL`, `POLYGON_RPC_URL`),
 * because public endpoints go down and rate-limit. When one does, the chain
 * reports `error` and the screen says it could not be read — never zero.
 */
/**
 * One or more candidate endpoints per network. Not an open `Record`: with an
 * index signature a missing key is legal, and a network with no endpoint would
 * compile and only fail at the moment somebody needed the balance.
 */
export interface EvmEndpointCandidates {
  readonly monad: readonly string[];
  readonly ethereum: readonly string[];
  readonly base: readonly string[];
  readonly arbitrum: readonly string[];
  readonly optimism: readonly string[];
  readonly polygon: readonly string[];
}

export const DEFAULT_EVM_ENDPOINTS: EvmEndpointCandidates = {
  monad: ['https://rpc.monad.xyz'],
  ethereum: [
    'https://ethereum-rpc.publicnode.com',
    'https://rpc.mevblocker.io',
    'https://eth.drpc.org',
  ],
  // Verificados a mano 2026-10-08 (eth_blockNumber + eth_getBalance + balanceOf
  // en USDC), igual que los de arriba. `polygon-rpc.com` devuelve 403 hoy, así
  // que Polygon va por `polygon.drpc.org`.
  // Cada red tiene varios fallbacks: desde Cloudflare Workers la latencia a
  // RPCs públicos varía y un solo endpoint a 3s falla seguido. Con 2-3 por
  // cadena el reader reintenta antes de dar error.
  base: [
    'https://mainnet.base.org',
    'https://base.drpc.org',
    'https://base-rpc.publicnode.com',
  ],
  arbitrum: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.drpc.org',
    'https://arbitrum-rpc.publicnode.com',
  ],
  optimism: [
    'https://mainnet.optimism.io',
    'https://optimism.drpc.org',
    'https://optimism-rpc.publicnode.com',
  ],
  polygon: [
    'https://polygon.drpc.org',
    'https://polygon-rpc.com',
    'https://polygon-rpc.publicnode.com',
  ],
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

/** El mensaje sin el prefijo que `BalanceReadError` antepone: en un agregado se repite y estorba. */
const bareMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : 'unknown failure';
  const marker = '): ';
  const cut = raw.indexOf(marker);
  return (cut === -1 ? raw : raw.slice(cut + marker.length)).slice(0, 120);
};

/** El host de un endpoint, sin su ruta ni query: lo unico de una URL externa que es seguro escribir. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'un endpoint sin URL valida';
  }
};

/** Que respondera el endpoint cuando no es JSON: HTML de desafio, vacio, otra cosa. */
const describeUnparseableBody = async (response: Response): Promise<string> => {
  let raw: string;
  try {
    raw = (await response.clone().text()).slice(0, 120);
  } catch {
    return 'a body that cannot be read';
  }
  const head = raw.trimStart()[0];
  if (head === undefined) return 'an empty body';
  if (head === '<') return 'an HTML page (most likely a bot challenge, not JSON-RPC)';
  return 'a body that is not JSON-RPC';
};

/** A JSON-RPC quantity: `0x`-prefixed hex. `BigInt` is the only safe parser. */
const parseQuantity = (result: unknown): bigint => {
  /*
   * `0x` a secas es una respuesta valida: es lo que devuelve una llamada a una
   * direccion sin codigo, y para un `balanceOf` significa cero. Declararlo
   * corrupto convertia "este contrato no existe en esta red" en "no pudimos
   * leer la red", que es un hecho distinto y mas grave.
   */
  if (result === '0x') return 0n;
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `expected a hex quantity, got ${typeof result}`);
  }
  return BigInt(result);
};

export interface JsonRpcEvmBalanceReaderOptions {
  /**
   * One or more candidate endpoints per network, tried **in order**. A public
   * endpoint dying is not an exception, it is Tuesday: `cloudflare-eth.com`
   * answered when it was written down and stopped answering later, and
   * `ethereum-rpc.publicnode.com` answers from a laptop and does not answer
   * from the Workers runtime. Depending on one URL makes an outage look like a
   * broken chain. The last error is the one reported when every candidate
   * fails, because that is the one worth reading.
   */
  readonly endpoints?: EvmEndpointCandidates;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * How long one attempt at one endpoint may take. Defaults to
   * {@link EVM_BALANCE_REQUEST_TIMEOUT_MS}; tests replace the schedule to drive
   * the deadline by hand instead of waiting for it.
   */
  readonly deadline?: DeadlinePolicy;
}

/**
 * How long one `eth_getBalance` / `balanceOf` attempt is given, and why 3 s.
 *
 * This is the cheapest read in the codebase: one storage slot, no contract
 * dispatch beyond a `balanceOf` hop, against the fastest public endpoints this
 * repository uses — the Ethereum candidates answer in well under a second from a
 * laptop. Three seconds is set where a slow endpoint is already slow rather than
 * where a loaded one is merely loaded, and where somebody staring at a balance
 * screen has already stopped believing the screen.
 *
 * It is the same number the Kamino REST feed uses, deliberately: both are
 * single-value reads from healthy public infrastructure, and splitting them
 * would be an invented distinction. What the bound buys is bounded, not
 * generous — past three seconds the endpoint is not slow, it is not answering,
 * and the next candidate endpoint is a better use of the request than a fourth
 * second of waiting.
 */
export const EVM_BALANCE_REQUEST_TIMEOUT_MS = 5_000;

export const createJsonRpcEvmBalanceReader = (options: JsonRpcEvmBalanceReaderOptions = {}): EvmBalanceReader => {
  const endpoints = options.endpoints ?? DEFAULT_EVM_ENDPOINTS;
  /*
   * The deadline is bound here, once, and not at the call sites: `send` is the
   * only way this adapter leaves the isolate, so no call below can reach an
   * endpoint without one. The deadline is per **attempt** — a list of three
   * candidates is three budgets — because a dead first endpoint must not spend
   * the whole read's time before the second one is even tried.
   */
  const send = withDeadline(options.fetchImpl ?? fetch, {
    timeoutMs: EVM_BALANCE_REQUEST_TIMEOUT_MS,
    ...options.deadline,
  });

  /** One JSON-RPC call. Throws `BalanceReadError`, never returns a wrong number. */
  const rpc = async (network: EvmNetwork, method: string, params: readonly unknown[]): Promise<bigint> => {
    const candidates = endpoints[network];
    /*
     * Cada candidato se reporta, no solo el ultimo. Con una lista de tres, decir
     * "fallo el tercero" esconde que el primero y el segundo ya habian fallado
     * por otra razon, y son justo esas razones las que dicen que endpoint usar.
     * Un solo fallo publicado obligo a un ida y vuelta entero por cada intento.
     */
    const failures: string[] = [];
    let firstReason: 'RPC_REJECTED' | 'RPC_UNAVAILABLE' | 'RPC_MALFORMED_RESPONSE' | undefined;

    for (const url of candidates) {
      try {
        return await callOnce(url, network, method, params, send);
      } catch (error) {
        // Un endpoint caido no es el final de la cadena: se prueba el siguiente.
        if (firstReason === undefined && error instanceof BalanceReadError) firstReason = error.reason;
        failures.push(`${hostOf(url)}: ${bareMessage(error)}`);
      }
    }

    throw new BalanceReadError(
      firstReason ?? 'RPC_UNAVAILABLE',
      failures.length > 0
        ? `${network} ${method} failed on all ${failures.length} endpoint(s): ${failures.join(' | ')}`
        : `${network} ${method} has no configured endpoint`,
    );
  };

    /**
 * One request against one endpoint. Isolated from the candidate loop so the
 * loop reads as what it is: "try each endpoint in turn".
 */
const callOnce = async (
  url: string,
  network: EvmNetwork,
  method: string,
  params: readonly unknown[],
  send: typeof fetch,
): Promise<bigint> => {
  let response: Response;
  try {
    response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (error) {
    throw new BalanceReadError('RPC_UNAVAILABLE', `${network} ${method} ${transportDetail(error, 'did not reach the endpoint')}`, {
      cause: error,
    });
  }

  if (!response.ok) {
      // 429 is a rate limit and 5xx is an outage; both are the endpoint's problem
      // and both mean "no number", which is what the caller has to be told.
      throw new BalanceReadError(
        'RPC_UNAVAILABLE',
        `${network} ${method} at ${hostOf(url)} answered HTTP ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      // Un endpoint publico puede responder 200 con una pagina de desafio HTML
      // cuando ve trafico de datacenter. El host y la CLASE del cuerpo bastan
      // para distinguir eso de un JSON roto, y son lo unico seguro de escribir:
      // el cuerpo del proveedor no va al log.
      /*
       * Un JSON-RPC answer can cortarse a mitad. Desde aqui un plazo agotado y
       * una respuesta que no es JSON se ven igual — `json()` fallo en los dos
       * casos — y reportar un endpoint mudo como corrupto es el unico error que
       * este vocabulario existe para evitar: mandaria a un operador a arreglar
       * aqui una caida del proveedor.
       */
      if (isDeadlineExceeded(error)) {
        throw new BalanceReadError(
          'RPC_UNAVAILABLE',
          `${network} ${method} at ${hostOf(url)} ${error.message}`,
          { cause: error },
        );
      }

      const kind = await describeUnparseableBody(response);
      throw new BalanceReadError(
        'RPC_MALFORMED_RESPONSE',
        `${network} ${method} at ${hostOf(url)} answered ${response.status} with ${kind}`,
        { cause: error },
      );
    }

    const payload = body as { error?: unknown; result?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `${network} ${method} answered with no JSON object`);
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new BalanceReadError(
        'RPC_REJECTED',
        `${network} ${method} at ${hostOf(url)} was rejected by the endpoint`,
      );
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