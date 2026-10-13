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
 *
 * ── Why the portfolio's SPL read is `getTokenAccountsByOwner`, not an ATA ──────
 *
 * The associated-token-account read above answers "how much is in **the** account
 * the Token Program derives for this owner and this mint", which is the right
 * question for a transfer. It is the wrong question for a portfolio: a wallet can
 * hold several accounts of one mint, and only the canonical one is read by an ATA
 * lookup. The other one is money the person holds.
 *
 * `getTokenAccountsByOwner` with a `mint` filter answers the portfolio's
 * question instead — "everything of **this** mint" — and still refuses to be an
 * unbounded read, because the filter is a mint we declared:
 *
 * ```json
 * {"method":"getTokenAccountsByOwner",
 *  "params":["<owner>", {"mint":"<mint>"},
 *            {"encoding":"jsonParsed","commitment":"confirmed"}]}
 * ```
 *
 * `jsonParsed` is what makes the answer readable without a second call per
 * account, and the accounts are summed in `bigint`.
 *
 * ── Why the `decimals` in that response is never read ────────────────────────
 *
 * The response carries a `decimals` next to each amount, and this adapter
 * **ignores it**. The exponent of a mint is a fact our catalog declares, and an
 * answer from a network is a fact to check, not a source of truth: rescaling on
 * the strength of a response field would let an endpoint choose the scale of a
 * balance. This method returns base units and no scale, and the catalog's scale
 * is applied by the use case that knows the symbol.
 */
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { BalanceReadError } from '../../domain/portfolio/errors';
import type { SolanaBalanceReader } from '../../domain/ports/solana-balance-reader';
import { isSolanaAddress } from '../../domain/send/recipients';
import { isDeadlineExceeded, transportDetail, withDeadline, type DeadlinePolicy } from './httpDeadline';

/**
 * ── Why the endpoint is the official public Solana RPC ──────────────────────
 *
 * Every SPL read this adapter makes is **indexed** — `getTokenAccountsByOwner`
 * walks an owner's accounts for a mint, and `getTokenAccountBalance` reads an
 * account the index owns. The endpoint this file used to default to,
 * `solana-rpc.publicnode.com`, answers both of those with **HTTP 403**:
 * "Indexed requests require a personal token." `getBalance` still answered 200,
 * which is why the failure looked so narrow: lamports read fine and every SPL
 * balance read failed, so the wallet treated Solana USDC as unreadable and hid
 * it instead of reporting an endpoint that cannot answer.
 *
 * ── Why the default is `publicnode` and not the official endpoint ─────────────
 *
 * Both were measured **from this Worker's runtime**, not from a laptop, because
 * that is the only measurement that matters here:
 *
 * ```
 * api.mainnet-beta.solana.com   getBalance               403  "Your IP or provider is blocked"
 * api.mainnet-beta.solana.com   getTokenAccountsByOwner  403  idem
 * solana-rpc.publicnode.com     getBalance               200
 * solana-rpc.publicnode.com     getTokenAccountsByOwner  429  Rate limit exceeded
 * solana.drpc.org               both                     400  not available on the free plan
 * solana.api.onfinality.io      both                     429  Too Many Requests
 * rpc.ankr.com/solana           both                     403  API key is not allowed
 * ```
 *
 * The official endpoint refuses Cloudflare outright, so moving to it took the
 * **native SOL** down with it — `getBalance` answered 200 before and 403 after.
 * `publicnode` is the only free endpoint that still answers the native read from
 * here, so it is the default again.
 *
 * What it cannot do is the **indexed** read, and that is a real limit, not a
 * preference: from a Worker, no free keyless Solana RPC serves
 * `getTokenAccountsByOwner`. Until {@link DEFAULT_SOLANA_RPC_URL} is pointed at a
 * provider with a key, SPL balances on Solana read as unreadable and the wallet
 * hides them — which is the rule the owner asked for, and the reason a Solana
 * USDC balance is invisible rather than wrong.
 *
 * `SOLANA_RPC_URL`, read in `container.ts`, is the override for a real provider
 * and wins over the constant whenever it is set.
 */
export const DEFAULT_SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';

/** `{"value": 123}` — digits only, so `BigInt` can take them verbatim. */
const LAMPORTS_PATTERN = /"value"\s*:\s*(\d+)/;

/** `{"value":{"amount":"123",…}}` — quoted, because a token amount is a string. */
const TOKEN_AMOUNT_PATTERN = /"amount"\s*:\s*"(\d+)"/;

/** One account out of a `jsonParsed` `getTokenAccountsByOwner` answer. */
interface ParsedTokenAccount {
  readonly account?: {
    readonly data?: {
      readonly parsed?: {
        readonly info?: {
          readonly tokenAmount?: { readonly amount?: unknown };
        };
      };
    };
  };
}

/**
 * The base-unit amount of one parsed account, or `null` when the account is not
 * shaped like a token balance.
 *
 * `null` is a refusal, not a zero: the caller turns it into
 * `RPC_MALFORMED_RESPONSE`, and an amount we cannot read is never reported as an
 * amount of nothing.
 */
const baseAmountOf = (account: ParsedTokenAccount): bigint | null => {
  const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
  if (amount === null || amount === undefined) return null;
  
  const amountString = String(amount);
  // Check if it's a non-negative integer (no decimal point, no minus sign)
  if (!/^[0-9]+$/.test(amountString)) return null;
  
  return BigInt(amountString);
}

export interface HttpSolanaBalanceReaderOptions {
  readonly url?: string;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * How long one request to the cluster may take. Defaults to
   * {@link SOLANA_BALANCE_REQUEST_TIMEOUT_MS}; tests replace the schedule to
   * drive the deadline by hand instead of waiting for it.
   */
  readonly deadline?: DeadlinePolicy;
}

/**
 * How long one Solana balance request is given, and why 5 s.
 *
 * The reads here are small — a lamport count, an amount, a list — except
 * `getTokenAccountsByOwner`, which asks a public node to walk an owner's whole
 * account set for a mint and answer every hit as `jsonParsed`: parsed accounts
 * are the bulky form, and a person who has used a few tokens pays for all of
 * them in one answer. A node that is doing that work honestly can take a couple
 * of seconds on a busy public endpoint, and five is where "slow" stops being a
 * reason to keep somebody's balance screen empty.
 *
 * It is the same number the Kamino vault reader uses, and deliberately so — the
 * two issue the same `jsonParsed` account read to the same public cluster. Past
 * that, the cluster is not slow, it is not answering, and the answer this adapter
 * owes is the one reason that says so.
 */
export const SOLANA_BALANCE_REQUEST_TIMEOUT_MS = 5_000;

export const createHttpSolanaBalanceReader = (
  options: HttpSolanaBalanceReaderOptions = {},
): SolanaBalanceReader => {
  const url = options.url ?? DEFAULT_SOLANA_RPC_URL;
  /*
   * Bound once, so no read below — and no read added to this adapter later — can
   * reach the cluster without a deadline. Per request, not per balance: a
   * portfolio reads several mints, and one silent method must not consume the
   * time of the others.
   */
  const send = withDeadline(options.fetchImpl ?? fetch, {
    timeoutMs: SOLANA_BALANCE_REQUEST_TIMEOUT_MS,
    ...options.deadline,
  });

  /**
   * The one mapping every body read of this adapter needs.
   *
   * A `text()` that rejects is either our deadline — the cluster answered the
   * request and then stopped sending, which is silence and belongs to
   * `RPC_UNAVAILABLE` — or bytes that are not JSON, which is a corrupted answer
   * and belongs to `RPC_MALFORMED_RESPONSE`. The two are indistinguishable at the
   * call site, so they are told apart once, here, where the difference is stated.
   */
  const bodyFailed = (method: string, error: unknown): BalanceReadError =>
    isDeadlineExceeded(error)
      ? new BalanceReadError('RPC_UNAVAILABLE', `solana ${method} ${error.message}`, { cause: error })
      : new BalanceReadError('RPC_MALFORMED_RESPONSE', `solana ${method} answered with no JSON`, { cause: error });

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
      throw new BalanceReadError(
        'RPC_UNAVAILABLE',
        `solana ${method} ${transportDetail(error, 'did not reach the endpoint')}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `solana ${method} answered HTTP ${response.status}`);
    }

    // Read the text first: `JSON.parse` would round a lamport or a token amount.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw bodyFailed(method, error);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw bodyFailed(method, error);
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

    mintBalance: async (owner, mint) => {
      if (!isSolanaAddress(owner) || !isSolanaAddress(mint)) {
        throw new BalanceReadError('RPC_REJECTED', 'a token balance needs two Solana addresses');
      }

      const text = await call('getTokenAccountsByOwner', [
        owner,
        { mint },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);

      /*
       * The amount of each account is a decimal **string**, so `JSON.parse` costs
       * nothing here: a string is not rounded by the parser, whatever numbers
       * sit next to it in the same object.
       */
      let body: { result?: { value?: unknown } };
      try {
        body = JSON.parse(text) as { result?: { value?: unknown } };
      } catch (error) {
        throw bodyFailed('getTokenAccountsByOwner', error);
      }

      const value = body?.result?.value;
      // No `value`, or a `value` that is not a list, is an answer that does not
      // say what it is. It does not say "this owner holds none of this mint".
      if (!Array.isArray(value)) {
        throw new BalanceReadError(
          'RPC_MALFORMED_RESPONSE',
          'solana getTokenAccountsByOwner answered without a list of token accounts',
        );
      }

      let total = 0n;
      for (const account of value as ParsedTokenAccount[]) {
        const amount = baseAmountOf(account);
        if (amount === null) {
          throw new BalanceReadError(
            'RPC_MALFORMED_RESPONSE',
            'solana getTokenAccountsByOwner answered with an account that is not a token balance',
          );
        }
        total += amount;
      }

      /*
       * An empty list is `0n`: this owner holds no account of this mint, which is
       * a fact about the chain and not a failed read — the same rule the
       * associated-account read above follows.
       */
      return total;
    },
  };
};