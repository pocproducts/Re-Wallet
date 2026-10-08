/**
 * `GET /api/wallet-balance` — the whole balance, composed **here**.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```json
 * {
 *   "generatedAt": "2026-10-04T05:00:00.000Z",
 *   "unit": "USD",
 *   "cryptoValue": {
 *     "unit": "USD", "complete": false,
 *     "total": { "raw": "2864200000000000000000000", "amount": "2.8642", "decimals": 18, "unit": "USD" },
 *     "pieces": [
 *       { "key": "crypto.monad.MON", "label": "MON en Monad", "source": "free_wallet",
 *         "chain": "monad", "status": "unreadable", "reason": "STALE",
 *         "quantity": { "raw": "3000000000000000000", "amount": "3", "decimals": 18, "unit": "MON" },
 *         "price": null, "value": null }
 *     ]
 *   },
 *   "digitalDollarsValue": { "unit": "USD", "complete": true,
 *     "total": { "raw": "2320428", "amount": "2.320428", "decimals": 6, "unit": "USD" },
 *     "pieces": [
 *       { "key": "dollars.monad.USDC", "label": "USDC en Monad", "source": "free_wallet",
 *         "chain": "monad", "status": "ok", "reason": null,
 *         "quantity": { "raw": "1500000", "amount": "1.5", "decimals": 6, "unit": "USDC" },
 *         "price": { "usd": "1", "decimals": 0, "source": "peg", "pair": null, "updatedAt": null, "crossChecked": null },
 *         "value": { "raw": "1500000", "amount": "1.5", "decimals": 6, "unit": "USD" } },
 *       { "key": "invest.aave_v3_usdc_monad", "…": "the same object, seen from the pools view" }
 *     ]
 *   },
 *   "investedValue": { "unit": "USD", "complete": true,
 *     "total": { "raw": "820428", "amount": "0.820428", "decimals": 6, "unit": "USD" },
 *     "pieces": [ … ],
 *     "yield": {
 *       "complete": true,
 *       "rate": { "numerator": "4144000000000", "denominator": "100000000000000" },
 *       "venues": [
 *         { "key": "invest.aave_v3_usdc_monad", "label": "Aave V3 · USDC en Monad",
 *           "status": "ok", "exclusion": null,
 *           "balance": { "raw": "60000000", "amount": "60", "decimals": 6, "unit": "USD" },
 *           "rate": { "raw": "41200", "decimals": 6, "text": "0.0412" },
 *           "depositable": { "status": "ok",
 *             "amount": { "raw": "1500000", "amount": "1.5", "decimals": 6, "unit": "USDC" } } },
 *         { "key": "invest.kamino_earn_usdc_solana", "label": "Kamino Earn · USDC en Solana",
 *           "status": "ok", "exclusion": null,
 *           "balance": { "raw": "40000000", "amount": "40", "decimals": 6, "unit": "USD" },
 *           "rate": { "raw": "418", "decimals": 4, "text": "0.0418" },
 *           "depositable": { "status": "unreadable", "reason": "FREE_BALANCE_ABSENT" } }
 *       ] } },
 *   "total": { "unit": "USD", "complete": false, "usd": { … } }
 * }
 * ```
 *
 * ── `investedValue.yield`: the ONE figure, not one per pool ────────────────
 *
 * A person's dollars sit in up to two pools and the screen shows **one** yield:
 *
 * ```
 *   combined = Σ(balanceᵢ x rateᵢ) / Σ(balanceᵢ)
 * ```
 *
 * A **weighted mean**, never an average of the rates: with $60 at 4.1200 % and
 * $40 at 4.1800 % the answer is 4.1440 %, not the 4.1500 % an average gives.
 *
 * `rate` is an exact ratio — `numerator / denominator`, two whole integers as
 * decimal strings. Nothing is rounded inside the combination, so **the screen
 * rounds, once, at paint**: `(numerator x 100 x 10^places + denominator/2) /
 * denominator` is the whole of it (`percentLabelOfRatio` in
 * `src/domain/yield/combinedYield.ts`, exported for exactly that use).
 *
 * `rate` is `null` **iff** `complete` is `false`: a weighted mean over the venues
 * that happened to answer is a confident number computed from missing data, and
 * it is never published. `venues` is always there, each entry with its own rate,
 * its own balance and its own state, so the screen can say *which* venue is
 * missing. `exclusion: "zero_balance"` means the venue holds nothing and was
 * therefore left out of the weighting — a different fact from `status:
 * "unreadable"`, and never to be drawn the same way.
 *
 * ── `depositable`: cuánto se puede depositar EN ese venue ───────────────────
 *
 * Cada fila lleva, al lado de `balance` y `rate`, el saldo de origen del venue:
 * el USDC libre de **su** cadena, exacto (`raw`, `amount`, `decimals`, `unit`).
 *
 * ```
 *   depositable: { "status": "ok", "amount": { "raw": "1500000", …, "unit": "USDC" } }
 *   depositable: { "status": "unreadable", "reason": "RPC_UNAVAILABLE" }
 * ```
 *
 * - **Nunca un `0` por ilegible.** Un `0` es una cifra: la persona no tiene USDC
 *   libre en esa cadena. Un `unreadable` es una incógnita, y vestida de `0` se
 *   convierte en un botón que deposita sobre un número que nadie conoce. La regla
 *   que lo impide está escrita en `depositableOf`
 *   (`src/application/portfolio/readWalletBalance.ts`).
 * - **Un cero real sí es `ok`**, con `raw: "0"`. Una billetera sin USDC libre es un
 *   hecho, y el botón puede existir con tope cero.
 * - **No es dinero nuevo.** `depositable` es el mismo USDC libre que ya está en
 *   `digitalDollarsValue`; por eso no aparece en ningún total ni cambia ninguno, y
 *   las cifras del balance son idénticas con el campo presente o ausente. Sumarlo
 *   sería el doble conteo que estos tres buckets existen para volver imposible.
 * - **Cadena contra cadena.** El de Aave sale del USDC libre de **Monad** y el de
 *   Kamino del de **Solana**. Nunca se cruzan: el índice se arma por cadena, así
 *   que un venue no puede ni pedir la plata de otro.
 *
 * ── The three buckets, and which card each one serves ───────────────────────
 *
 * | bucket                | serves                    | contents                          |
 * |-----------------------|---------------------------|-----------------------------------|
 * | `cryptoValue`         | "Bitcoin & Crypto"        | free, **non-pegged**: MON, ETH, SOL, BTC |
 * | `digitalDollarsValue` | "Dólares digitales"       | every pegged piece, free or deposited |
 * | `investedValue`       | the "de dónde sale" view  | pool positions alone, plus their combined `yield` |
 *
 * **`cryptoValue` holds no dollar-pegged asset, in any form.** The split is the
 * peg table's — `isDigitalDollar`, the same predicate that skips the oracle — and
 * it is taken on the server, so no client ever subtracts a USDC row out of a
 * total. `total` is `cryptoValue + digitalDollarsValue` and is composed here;
 * `investedValue` is a view inside the second of those and is **not** a third
 * term, which is what keeps a deposited dollar from being counted twice.
 * ── Why there is nothing to add on the client ───────────────────────────────
 *
 * `total` is computed by the use case, from the buckets, in `bigint`. A
 * browser that adds two numbers itself can add them wrong, and worse: the two
 * numbers it was handed come from different scales and a float would round them
 * on the way. The front prints `total` and shows the two cards beside it.
 *
 * ── Why the completeness statement is never optional ─────────────────────────
 *
 * A bucket that could not read everything says `complete: false`, and the total
 * says so too. **A total that silently omits what it could not read is a lie** —
 * the same rule `GET /api/digital-dollars` states. So a partial total is still
 * returned, because throwing away what we do know is also a loss, and it travels
 * beside the statement that it is partial. The field is always present.
 *
 * ── Why nothing in the request is read ─────────────────────────────────────
 *
 * No address, no chain, no `userId`, no body, no query parameter. Every piece
 * comes from `rewallet.wallets` for the user the cookie proved, so the set of
 * balances this route can describe is exactly the set of wallets the person
 * owns. There is no parameter through which a foreign address could arrive, and
 * no method here that carries a body.
 *
 * ── Why 401 and 502 stay HTTP statuses ───────────────────────────────────────
 *
 * 401: no cookie, or one that does not verify. **Nothing was read** — no chain,
 * no feed, no database.
 * 502 `WALLETS_UNAVAILABLE`: the wallet rows could not be read, so no address
 * could be resolved for **any** piece and there is no partial truth either.
 * Answering 200 with a total of `0` would be a lie about somebody's account.
 *
 * Everything else is a 200 with a per-piece state: a stale MON feed does not take
 * the deposited USDC away from the person.
 */
import { Hono } from 'hono';

import type { ReadWalletBalance } from '../../../application/portfolio/readWalletBalance';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import { WALLETS_UNAVAILABLE_BODY } from './portfolio';

export interface WalletBalanceDeps {
  readonly sessions: SessionCodec;
  readonly readWalletBalance: ReadWalletBalance;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createWalletBalanceRoutes = (deps: WalletBalanceDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.get('/', async (c) => {
    // The same door as every other route: same cookie, same codec, same 401,
    // and nothing read on either side of it.
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      return c.json(await deps.readWalletBalance(claims.userId, clock()), 200);
    } catch (error) {
      if (error instanceof WalletsUnavailable) {
        log.error('GET /wallet-balance could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      // Anything else is ours and is not the person's answer to guess at.
      throw error;
    }
  });

  return app;
};
