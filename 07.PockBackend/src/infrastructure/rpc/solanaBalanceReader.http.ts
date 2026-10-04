/**
 * ADAPTER: Solana `getBalance` over HTTP.
 *
 * ── Why the lamport value is read out of the raw text ────────────────────────
 *
 * `getBalance` answers `{"context":…,"value": 1234567890}` — a JSON **number**.
 * `JSON.parse` hands that back as a double, and Solana's total supply is about
 * `5.8e17` lamports, which is **past `Number.MAX_SAFE_INTEGER` (`9.007e15`)**. A
 * wallet holding more than nine million SOL would therefore have its balance
 * silently rounded by `JSON.parse`, and a portfolio that reads high by a few
 * lamports is a portfolio nobody can explain.
 *
 * So the text is scanned for `"value": <digits>` and handed to `BigInt`. The rest
 * of the response is still parsed as JSON — for the `error` field and for
 * validation — but no number that reaches the response ever passes through a
 * double first.
 *
 * ── Why `confirmed` and not `finalized` ───────────────────────────────────────
 *
 * `finalized` on a public endpoint regularly exceeds the RPC's slot limit and
 * answers with an error instead of a balance. `confirmed` is one slot behind and
 * is what a balance screen wants; a deposit that is about to finalize is, for a
 * few seconds, not wrong in any way the person can act on.
 */
import { BalanceReadError } from '../../domain/portfolio/errors';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';

export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

/** `{"value": 123}` — digits only, so `BigInt` can take them verbatim. */
const LAMPORTS_PATTERN = /"value"\s*:\s*(\d+)/;

export interface HttpSolanaBalanceReaderOptions {
  readonly url?: string;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export const createHttpSolanaBalanceReader = (
  options: HttpSolanaBalanceReaderOptions = {},
): SolanaBalanceReader => {
  const url = options.url ?? DEFAULT_SOLANA_RPC_URL;
  const send = options.fetchImpl ?? fetch;

  return {
    lamports: async (address) => {
      let response: Response;
      try {
        response = await send(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [address, { commitment: 'confirmed' }],
          }),
        });
      } catch (error) {
        throw new BalanceReadError('RPC_UNAVAILABLE', 'solana getBalance did not reach the endpoint', {
          cause: error,
        });
      }

      if (!response.ok) {
        throw new BalanceReadError('RPC_UNAVAILABLE', `solana getBalance answered HTTP ${response.status}`);
      }

      // Read the text first: `JSON.parse` would round the lamport count.
      const text = await response.text();

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'solana getBalance answered with no JSON', {
          cause: error,
        });
      }

      const payload = body as { error?: unknown } | null;
      if (payload === null || typeof payload !== 'object') {
        throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'solana getBalance answered with no JSON object');
      }
      if (payload.error !== undefined && payload.error !== null) {
        throw new BalanceReadError('RPC_REJECTED', 'solana getBalance was rejected by the endpoint');
      }

      const match = LAMPORTS_PATTERN.exec(text);
      if (match === null) {
        throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'solana getBalance answered without a lamport value');
      }

      // Exact, at any magnitude: this is the number a transfer would be built from.
      return BigInt(match[1] as string);
    },
  };
};