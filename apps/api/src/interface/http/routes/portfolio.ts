/**
 * `GET /api/portfolio` — the balances of the authenticated person, per chain and
 * per asset, read from the chain.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```json
 * {
 *   "generatedAt": "2025-01-01T00:00:00.000Z",
 *   "chains": [
 *     { "chain": "monad", "status": "ok", "address": "0x…",
 *       "assets": [{ "symbol": "MON", "unit": "MON", "decimals": 18,
 *                    "raw": "123456789012345678901", "amount": "123.456789012345678901" }] },
 *     { "chain": "ethereum", "status": "error",
 *       "error": { "code": "CHAIN_READ_FAILED", "reason": "RPC_UNAVAILABLE" } },
 *     { "chain": "solana", "status": "no_wallet" }
 *   ]
 * }
 * ```
 *
 * ── Why the whole thing is a 200 even when a chain fails ─────────────────────
 *
 * Because the answer to "what does this person hold" is mostly known even when one
 * network is down, and an HTTP error would throw that knowledge away along with
 * everything else. A per-chain error state inside a 200 is the only shape that
 * lets a screen show two real balances and one honest "we could not read this
 * chain". The alternative — a zero for a failed read — is not a degraded answer,
 * it is a false one: it renders as an empty wallet.
 *
 * ── Why nothing in the request is read ───────────────────────────────────────
 *
 * No address, no chain list, no body, no query parameter. The address comes from
 * `rewallet.wallets` for the user the cookie proved, so the set of wallets this
 * route can answer about is exactly the set the person owns. A route that took an
 * address would be a route that could be asked about somebody else's balance —
 * and "we ignored the parameter you sent" is a much better property than
 * "we validated the parameter you sent".
 *
 * ── Why 401 and 502 stay HTTP statuses ───────────────────────────────────────
 *
 * 401: no cookie, or a cookie that does not verify. Nothing was read.
 * 502 `WALLETS_UNAVAILABLE`: the wallet rows could not be read, so no address
 * could be resolved and **no** chain has a truth to report. That is a failed
 * request, not a partial one, and answering 200 would mean reporting every chain
 * as `no_wallet` — which is a lie about somebody's account.
 */
import { Hono } from 'hono';

import type { ReadPortfolio } from '../../../application/portfolio/readPortfolio';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';

/** The one 502 this route can produce. The reason stays in the log. */
export const WALLETS_UNAVAILABLE_BODY = { error: { code: 'WALLETS_UNAVAILABLE' } } as const;

export interface PortfolioDeps {
  readonly sessions: SessionCodec;
  readonly readPortfolio: ReadPortfolio;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createPortfolioRoutes = (deps: PortfolioDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.get('/', async (c) => {
    // The same door as `GET /api/auth/session`: same cookie, same codec, same 401.
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      const portfolio = await deps.readPortfolio(claims.userId, clock());
      return c.json({ generatedAt: clock().toISOString(), chains: portfolio.chains }, 200);
    } catch (error) {
      if (error instanceof WalletsUnavailable) {
        log.error('GET /portfolio could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      // Anything else is ours and is not the person's answer to guess at.
      throw error;
    }
  });

  return app;
};