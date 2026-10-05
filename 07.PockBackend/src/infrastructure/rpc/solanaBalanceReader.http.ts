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
 *
 * ── Why an SPL balance is read from the RPC, and not through the token library ─
 *
 * `getTokenAccountBalance` answers the exact question — the amount of one token
 * held by one token account — in one call and in the token's own units. The
 * library would do the same thing with more machinery around it. It is used here
 * for the one thing only it can do: **deriving** the associated token account,
 * which is a program-derived address.
 *
 * ── Why the amount is read out of the raw text again ──────────────────────────
 *
 * `{"value":{"amount":"1500000","decimals":6,…}}` — the amount is a string here,
 * but the object next to it carries `uiAmount` as a JSON number, and reading a
 * token balance out of a parsed body is how a nineteen-digit balance gets rounded
 * on its way to a transfer.
 */
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { BalanceReadError } from '../../domain/portfolio/errors';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import { isSolanaAddress } from '../../domain/send/recipients';

export const DEFAULT_SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';

/** `{"value": 123}` — digits only, so `BigInt` can take them verbatim. */
const LAMPORTS_PATTERN = /"value"\s*:\s*(\d+)/;

/** `{"value":{"amount":"123",…}}` — quoted, because a token amount is a string. */
const TOKEN_AMOUNT_PATTERN = /"amount"\s*:\s*"(\d+)"/;

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

  /** One JSON-RPC call, and the four ways it can go wrong. */
  const call = async (method: string, params: unknown[]): Promise<string> => {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (error) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `solana ${method} did not reach the endpoint`, {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `solana ${method} answered HTTP ${response.status}`);
    }

    // Read the text first: `JSON.parse` would round a lamport or a token amount.
    const text = await response.text();

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `solana ${method} answered with no JSON`, {
        cause: error,
      });
    }

    const payload = body as { error?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `solana ${method} answered with no JSON object`);
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new BalanceReadError('RPC_REJECTED', `solana ${method} was rejected by the endpoint`);
    }

    return text;
  };

  return {
    lamports: async (address) => {
      const text = await call('getBalance', [address, { commitment: 'confirmed' }]);

      const match = LAMPORTS_PATTERN.exec(text);
      if (match === null) {
        throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'solana getBalance answered without a lamport value');
      }

      // Exact, at any magnitude: this is the number a transfer would be built from.
      return BigInt(match[1] as string);
    },

    tokenAmount: async (owner, mint) => {
      if (!isSolanaAddress(owner) || !isSolanaAddress(mint)) {
        throw new BalanceReadError('RPC_REJECTED', 'a token balance needs two Solana addresses');
      }

      /*
       * The associated token account of this owner for this mint. Derived here for
       * the same reason the transfer derives it: the address is a program
       * computation, not a concatenation anybody can spell by hand.
       */
      const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true);
      const text = await call('getTokenAccountBalance', [tokenAccount.toBase58(), { commitment: 'confirmed' }]);

      /*
       * A token account that does not exist is an address that holds none of this
       * token: `0n`, which is a fact about the chain and not a failure.
       * `getTokenAccountBalance` answers with a null `value` in that case, so it
       * is checked explicitly instead of being read as "no amount in the text".
       */
      if (/"value"\s*:\s*null/.test(text)) return 0n;

      const match = TOKEN_AMOUNT_PATTERN.exec(text);
      if (match === null) {
        throw new BalanceReadError(
          'RPC_MALFORMED_RESPONSE',
          'solana getTokenAccountBalance answered without an amount',
        );
      }

      return BigInt(match[1] as string);
    },
  };
};