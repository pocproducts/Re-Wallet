/**
 * `GET /api/pool` and `POST /api/pool/deposit` — the Aave V3 USDC reserve on
 * Monad, and the unsigned transactions of a deposit into it.
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
 * ```
 *
 * ── Why nothing in the request is read ───────────────────────────────────────
 *
 * No address, no chain, no `onBehalfOf`. The address comes from
 * `rewallet.wallets` for the user the cookie proved, so the set of accounts these
 * routes can describe — and the set they can move money for — is exactly the set
 * of wallets the person owns. "We ignored the parameter you sent" is a much
 * better property than "we validated the parameter you sent".
 *
 * ── Why the status codes are the ones the rest of the app uses ───────────────
 *
 * 401: no cookie, or a cookie that does not verify. Nothing was read.
 * 400: the amount is refused, with a code per case, so a screen can say *what* is
 * wrong — `AMOUNT_EXCEEDS_BALANCE` and `BALANCE_UNREADABLE` are different facts
 * and the second one must never be drawn as "you have nothing".
 * 502 `WALLETS_UNAVAILABLE`: the rows could not be read, so there is no address
 * and nothing to report or sign.
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
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import { WALLETS_UNAVAILABLE_BODY } from './portfolio';

export interface PoolDeps {
  readonly sessions: SessionCodec;
  readonly readPool: ReadPool;
  readonly prepareDeposit: PrepareDeposit;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

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
     * Only `amount` is read from the body. An `address` or an `onBehalfOf` in the
     * body, or in the query, is not looked at: the address is a row.
     */
    const body = (await c.req.json().catch(() => null)) as { amount?: unknown } | null;

    try {
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
      throw error;
    }
  });

  return app;
};
