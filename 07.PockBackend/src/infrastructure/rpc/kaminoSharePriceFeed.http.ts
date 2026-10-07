/**
 * ADAPTER: the Kamino Earn share price, from Kamino's public REST API, with
 * plain `fetch`.
 *
 * ── Why `fetch` and not an SDK ──────────────────────────────────────────────
 *
 * The answer is one GET against one documented endpoint and one decimal string.
 * That is `@kamino-finance/klend-sdk`'s entire contribution to this reader, and
 * the cost of taking it would be a dependency that reaches for a cluster, for a
 * node indexer and for its own notion of what a vault is — none of which this
 * application wants, because it wants the **published figure** and nothing else.
 * Adding a megabyte of SDK to read one field would also mean a version bump could
 * change somebody's balance.
 *
 * ── The endpoint, and where the scale comes from ────────────────────────────
 *
 * ```
 * GET https://api.kamino.finance/kvaults/vaults/{vault}/stats
 *   → { "token": …, "tokenPrice": …, "sharesIssued": …,
 *       "tokensPerShare": …, "sharePrice": "1.0617770761260384793", … }
 * ```
 *
 * `sharePrice` is typed `Decimal` in Kamino's own OpenAPI document, and `Decimal`
 * is `{"type": "string"}`. **That is where the scale comes from: from the digits
 * the API publishes.** There is no declared exponent anywhere in the document —
 * the live figure carries nineteen fractional digits, and a future one could carry
 * a different number — so the only exact reading of the answer is the integer its
 * digits make, at the scale its digits state. `parseExactDecimal` does exactly
 * that, and refuses anything it cannot read that way.
 *
 * A number here would be a lie twice over: `JSON.parse` rounds it, and a rounded
 * share price is a rounded balance.
 *
 * ── Why the token's own USD price is not consulted ──────────────────────────
 *
 * `/stats` publishes `tokenPrice` (`0.99990…`) next to `sharePrice`, and
 * multiplying them would be a different number from a different question. The
 * vault's token is Solana USDC, which this project already values at exactly one
 * dollar by definition (`domain/price/digitalDollar.ts`), so the USD value of a
 * position is the product of the shares and `sharePrice` alone. No second price
 * is asked for, and none is needed.
 *
 * ── The APY comes out of the same document, at the same discipline ───────────
 *
 * ```
 * GET https://api.kamino.finance/kvaults/vaults/{vault}/stats
 *   → { …, "sharePrice": "1.0617770761260384793",
 *           "apy": { "total": "0.041808723945949255", "base": { … }, … } }
 * ```
 *
 * `apy.total` is the vault's annual yield as a **fraction of one**, published the
 * same way `sharePrice` is: `Decimal = string`, no declared exponent, the live
 * figure at eighteen fractional digits. So the scale is read off the answer's own
 * digits, exactly as below — `parseExactDecimal` refuses an exponent, a sign and
 * anything that is not a string, and `0` is `APY_NON_POSITIVE` rather than a
 * yield of nothing.
 *
 * `base`, `points`, `farm` and the rest of `apy` are **not** read. They are
 * rewards programs layered on the vault, they are not the vault's own yield, and
 * adding them would publish a number answering a different question than "what
 * does this vault earn".
 *
 * One GET per question, so reading both costs two requests for one small JSON
 * document. That is the deliberate price of keeping the two answers independent:
 * a rate this code cannot parse must not make a share price unreadable, and the
 * alternative — one method returning both — would couple the failure of a rate to
 * the balance of the person who owns it.
 */
import type {
  KaminoApyResult,
  KaminoSharePriceFeed,
  KaminoSharePriceResult,
} from '../../domain/ports/kamino-share-price-feed';
import { formatExactDecimal, parseExactDecimal } from '../../domain/yield/kaminoEarnVault';

/** Kamino's public API. Overridable per environment, like every other endpoint. */
export const DEFAULT_KAMINO_API_URL = 'https://api.kamino.finance';

/** The path of the vault statistics document that carries the share price. */
export const KAMINO_VAULT_STATS_PATH = '/kvaults/vaults/{vault}/stats';

export interface HttpKaminoSharePriceFeedOptions {
  readonly baseUrl?: string;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export const createHttpKaminoSharePriceFeed = (options: HttpKaminoSharePriceFeedOptions = {}): KaminoSharePriceFeed => {
  const baseUrl = (options.baseUrl ?? DEFAULT_KAMINO_API_URL).replace(/\/+$/, '');
  const send = options.fetchImpl ?? fetch;

  /**
   * The one document both answers come from, with every failure mapped to its own
   * bounded name. It returns `null` for each failure rather than a result, so
   * each caller turns *its* failure into *its* reason: the price's zero is not
   * the rate's zero, and neither is anybody's outage a rate of zero.
   */
  const statsOf = async (
    vault: string,
  ): Promise<{ body: unknown } | { unavailable: true } | { malformed: true }> => {
    const url = `${baseUrl}${KAMINO_VAULT_STATS_PATH.replace('{vault}', encodeURIComponent(vault))}`;

    let response: Response;
    try {
      response = await send(url, { method: 'GET', headers: { accept: 'application/json' } });
    } catch {
      return { unavailable: true };
    }

    if (!response.ok) {
      // 404, 429 and 5xx are all "Kamino did not answer". The body goes to the
      // caller's log; a provider's error page is sometimes an HTML document and
      // it never crosses this boundary.
      return { unavailable: true };
    }

    try {
      return { body: (await response.json()) as unknown };
    } catch {
      return { malformed: true };
    }
  };

  return {
    sharePrice: async (vault: string): Promise<KaminoSharePriceResult> => {
      const stats = await statsOf(vault);

      if ('unavailable' in stats) return { status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' };
      if ('malformed' in stats) return { status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' };

      const sharePrice = (stats.body as { sharePrice?: unknown } | null)?.sharePrice;
      if (typeof sharePrice !== 'string') {
        return { status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' };
      }

      const exact = parseExactDecimal(sharePrice);
      if (exact === null) {
        // A share price whose scale this code cannot read exactly is not a price.
        return { status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' };
      }

      if (exact.raw <= 0n) {
        return { status: 'unreadable', reason: 'SHARE_PRICE_NON_POSITIVE' };
      }

      return {
        status: 'ok',
        value: { raw: exact.raw, decimals: exact.decimals, usd: formatExactDecimal(exact) },
      };
    },

    apy: async (vault: string): Promise<KaminoApyResult> => {
      const stats = await statsOf(vault);

      if ('unavailable' in stats) return { status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' };
      if ('malformed' in stats) return { status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' };

      const published = (stats.body as { apy?: { total?: unknown } } | null)?.apy?.total;
      if (typeof published !== 'string') {
        // Absent, not an object, or a number where Kamino's own type is a string.
        return { status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' };
      }

      const exact = parseExactDecimal(published);
      if (exact === null) {
        // An exponent, a sign, or more fractional digits than a mint has: a scale
        // this code would have to guess, and a guessed yield is a false one.
        return { status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' };
      }

      if (exact.raw <= 0n) {
        return { status: 'unreadable', reason: 'APY_NON_POSITIVE' };
      }

      return { status: 'ok', value: { raw: exact.raw, decimals: exact.decimals, text: published } };
    },
  };
};