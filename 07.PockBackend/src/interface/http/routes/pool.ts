/**
 * `GET /api/pool` and `POST /api/pool/deposit` — the Aave V3 USDC reserve on
 * Monad, the Kamino Earn vault on Solana, and the unsigned messages of a deposit
 * into either of them.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```json
 * GET /api/pool
 * {
 *   "generatedAt": "…", "network": { "name": "monad", "chainId": 143, "protocol": "Aave V3" },
 *   "asset": { "symbol": "USDC", "unit": "USDC", "decimals": 6 },
 *   "address": "0x…",
 *   "reserve": { "status": "ok", "reason": null },
 *   "apr": { "supply": { "status": "ok", "value": "4.1196" },
 *            "borrow": { "status": "ok", "value": "4.9876" } },
 *   "totals": { "supplied": { "status": "ok", "value": { "raw": "…", "amount": "…", "decimals": 6, "unit": "USDC" } },
 *               "borrowed": { … }, "available": { … },
 *               "utilisation": { "status": "ok", "value": "91.8473" } },
 *   "lastUpdate": { "status": "ok", "value": { "unix": 1791088293, "iso": "…" } },
 *   "reconciliation": { "status": "ok", "value": { "percent": "4.1228", "agrees": true } },
 *   "position": { "aTokenBalance": { "status": "ok", "value": { "raw": "820428", "amount": "0.820428", "decimals": 6, "unit": "aMonUSDC" } },
 *                 "availableUsdc": { … }, "gasBalance": { … } }
 * }
 *
 * POST /api/pool/deposit  { "amount": "1000000" }
 * { "chainId": 143, "address": "0x…", "approvalRequired": true,
 *   "transactions": [ { "purpose": "approve", "to": "0x…", "data": "0x…", "value": "0", "chainId": 143 },
 *                     { "purpose": "deposit", "to": "0x…", "data": "0x…", "value": "0", "chainId": 143 } ] }
 *
 * POST /api/pool/deposit  { "venue": "kamino", "amount": "1000000" }
 * { "venue": "kamino", "chain": "solana", "network": "solana:…", "address": "5tz…",
 *   "asset": { "symbol": "USDC", "unit": "USDC", "decimals": 6 },
 *   "amount": { … }, "depositable": { … }, "solBalance": { … }, "requiredRent": { … },
 *   "accountsToCreate": [ { "role": "usdc_token_account", "address": "…", "exists": false,
 *                           "rent": { "status": "ok", "lamports": 2039280 } } ],
 *   "rentShortfall": { … },
 *   "transactions": [ { "purpose": "kamino_earn_deposit", "kind": "solana",
 *                       "serializedTransaction": "AQ…", "chain": "solana" } ],
 *   "warnings": [ { "code": "ACCOUNTS_TO_CREATE", "message": "Es tu primer depósito…" } ],
 *   "completion": { "status": "incomplete", "executes": false, "message": "…" } }
 * ```
 *
 * ── Why nothing in the request is read except `amount` and `venue` ────────────
 *
 * No address, no chain, no `onBehalfOf`, no destination. The address comes from
 * `rewallet.wallets` for the user the cookie proved, and the vault is a pinned
 * constant. So the set of accounts these routes can describe — and the set they
 * can move money for — is exactly the set of wallets the person owns. "We ignored
 * the parameter you sent" is a much better property than "we validated the
 * parameter you sent".
 *
 * `venue` **is** read, and it is the one string a caller gets to choose. It is why
 * {@link DEPOSIT_VENUES} is a closed list declared here: a venue that is not on it
 * is refused with `VENUE_UNKNOWN` before **either** use case is called, so an
 * invented name cannot reach a deposit of any kind. A venue string the server
 * would resolve with a fallback would turn "no conozco ese destino" into
 * "depositó en el destino que yo eligiera".
 *
 * ── Why the status codes are the ones the rest of the app uses ───────────────
 *
 * 401: no cookie, or a cookie that does not verify. Nothing was read.
 * 400: the amount is refused, with a code per case, so a screen can say *what* is
 * wrong — `AMOUNT_EXCEEDS_BALANCE` and `BALANCE_UNREADABLE` are different facts
 * and the second one must never be drawn as "you have nothing".
 * 502 `WALLETS_UNAVAILABLE`: the rows could not be read, so there is no address
 * and nothing to report or sign.
 * 502 `KAMINO_DEPOSIT_UNAVAILABLE`: the chain did not answer, so no message could
 * be built — and **not** a 400, because nothing the person sent is wrong.
 * 503 `VENUE_NOT_AVAILABLE`: the venue asked for exists, but this deployment has
 * no use case behind it. Not a fallback to the other venue: a person asking for
 * Solana and getting Monad is worse than a 503.
 *
 * ── Why a reserve that could not be read is a 200 ─────────────────────────────
 *
 * Because the position can still be read. The screen shows one honest sentence
 * about the rate and the person's real position beside it.
 */
import { Hono, type Context } from 'hono';

import type { ReadPool } from '../../../application/pool/readPool';
import type { PrepareDeposit } from '../../../application/pool/prepareDeposit';
import { DepositRejected } from '../../../application/pool/prepareDeposit';
import type { PrepareDepositKamino } from '../../../application/pool/prepareDepositKamino';
import { KaminoDepositUnavailable } from '../../../domain/ports/kamino-earn-vault-reader';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import { WALLETS_UNAVAILABLE_BODY } from './portfolio';

/**
 * The venues a deposit can be prepared for, and the whole list of them.
 *
 * A closed list **on the server**, y no un `string` que el cliente pueda inventar:
 * esta es la respuesta a la pregunta "a dónde va mi plata", y una lista de
 * destinos que crece con lo que dice un cuerpo HTTP es una lista de destinos que
 * cualquiera elige. A venue that is not here does not exist.
 */
export const DEPOSIT_VENUES = ['aave', 'kamino'] as const;

export type DepositVenue = (typeof DEPOSIT_VENUES)[number];

/**
 * The Aave deposit, and the Kamino one when it is wired.
 *
 * ── Why the Kamino use case travels attached to the Aave one ──────────────────
 *
 * `AppDeps` (`src/interface/http/app.ts`) declares a single `prepareDeposit`, and
 * that file is outside the surface this feature was written in. Rather than leave
 * the venue unreachable in production —a deposit destination that answers 404— or
 * cast the dependency object to sneak a second field past the type checker, the
 * Kamino use case is carried **on** the Aave one, and this type is the statement
 * of that contract.
 *
 * It is a seam, not an architecture: when `AppDeps` grows a `prepareDepositKamino`,
 * this becomes two independent fields and this alias disappears. The alternative —
 * a route that only exists when a field nobody can pass is present — is a smaller
 * feature than the one this task asks for.
 */
export type PoolDepositUseCases = PrepareDeposit & { readonly kamino?: PrepareDepositKamino };

export interface PoolDeps {
  readonly sessions: SessionCodec;
  readonly readPool: ReadPool;
  readonly prepareDeposit: PoolDepositUseCases;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

/**
 * The venue asked for, or `null` when it is not one of ours.
 *
 * An **absent** venue is Aave, because that is the contract this route had before
 * venues existed and a screen that sends none must keep working. A venue that is
 * present and unknown is a refusal: guessing the nearest match would deposit
 * somebody's USDC somewhere they did not choose.
 */
const venueOf = (value: unknown): DepositVenue | null => {
  if (value === undefined || value === null) return 'aave';
  return DEPOSIT_VENUES.find((venue) => venue === value) ?? null;
};

export const createPoolRoutes = (deps: PoolDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  /** The same door, the same codec, the same 401 as every other route. */
  const authenticate = async (c: Context) => {
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return null;
    return deps.sessions.read(presented, clock());
  };

  app.get('/', async (c) => {
    const claims = await authenticate(c);
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      const snapshot = await deps.readPool(claims.userId, clock());
      return c.json(snapshot, 200);
    } catch (error) {
      if (error instanceof WalletsUnavailable) {
        log.error('GET /pool could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      throw error;
    }
  });

  app.post('/deposit', async (c) => {
    const claims = await authenticate(c);
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    /*
     * Only `amount` and `venue` are read from the body. An `address` or an
     * `onBehalfOf` in the body, or in the query, is not looked at: the address is
     * a row.
     */
    const body = (await c.req.json().catch(() => null)) as { amount?: unknown; venue?: unknown } | null;

    /*
     * The venue is resolved **before** any use case runs, and a venue that is not
     * on the list is refused here. That is the whole point: neither the Aave
     * deposit nor the Kamino one has been called yet, so an invented destination
     * cannot move money anywhere on the strength of a typo.
     */
    const venue = venueOf(body?.venue);
    if (venue === null) {
      log.error('POST /pool/deposit refused: a venue that is not on the list was asked for');
      return c.json({ error: { code: 'VENUE_UNKNOWN' } }, 400);
    }

    try {
      if (venue === 'kamino') {
        const kamino = deps.prepareDeposit.kamino;
        if (kamino === undefined) {
          log.error('POST /pool/deposit refused: the Kamino venue is not wired');
          return c.json({ error: { code: 'VENUE_NOT_AVAILABLE' } }, 503);
        }
        return c.json(await kamino(claims.userId, body?.amount), 200);
      }

      const preparation = await deps.prepareDeposit(claims.userId, body?.amount);
      return c.json(preparation, 200);
    } catch (error) {
      if (error instanceof WalletsUnavailable) {
        log.error('POST /pool/deposit could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      if (error instanceof DepositRejected) {
        log.error(`POST /pool/deposit refused: ${error.code}`, error);
        return c.json({ error: { code: error.code } }, 400);
      }
      if (error instanceof KaminoDepositUnavailable) {
        /*
         * A 502, not a 400: nobody sent anything wrong. The cluster did not
         * answer, or the vault could not be read, and both are worth retrying.
         */
        log.error(`POST /pool/deposit could not prepare the Kamino deposit: ${error.code}`, error);
        return c.json({ error: { code: 'KAMINO_DEPOSIT_UNAVAILABLE' } }, 502);
      }
      throw error;
    }
  });

  return app;
};
