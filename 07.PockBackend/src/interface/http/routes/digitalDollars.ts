/**
 * `GET /api/digital-dollars` — this person's total digital dollars.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```json
 * {
 *   "generatedAt": "2026-10-04T05:00:00.000Z",
 *   "unit": "USDC",
 *   "total": { "raw": "2820428", "amount": "2.820428", "decimals": 6, "unit": "USDC" },
 *   "complete": true,
 *   "components": [
 *     { "key": "free_usdc_monad", "label": "USDC en Monad", "source": "free_wallet",
 *       "status": "ok", "reason": null,
 *       "value": { "raw": "1500000", "amount": "1.5", "decimals": 6, "unit": "USDC" } },
 *     { "key": "aave_v3_usdc_monad", "label": "Aave V3 · USDC en Monad", "source": "yield",
 *       "status": "unreadable", "reason": "RPC_REJECTED", "value": null }
 *   ]
 * }
 * ```
 *
 * ── Why the total has no `status` of its own ──────────────────────────────────
 *
 * Because it would have to lie in one direction or the other. It is the sum of
 * the components that could be read, so it is never "unreadable" — but calling it
 * `ok` while a component is missing is exactly the confident lie this route
 * exists to prevent. So the completeness statement travels beside the number, in
 * a field that is **always present**: `complete: false` says the total is
 * partial, and `components[]` says which part is missing.
 *
 * ── Why nothing in the request is read ───────────────────────────────────────
 *
 * No address, no chain, no `userId`, no body, no query parameter. Every
 * component comes from `rewallet.wallets` for the user the cookie proved, so the
 * set of totals this route can describe is exactly the set of wallets the person
 * owns. There is no parameter through which a foreign address could arrive, and
 * no method here that carries a body.
 *
 * ── Why 401 and 502 stay HTTP statuses ───────────────────────────────────────
 *
 * 401: no cookie, or a cookie that does not verify. Nothing was read.
 * 502 `WALLETS_UNAVAILABLE`: the wallet rows could not be read, so no address
 * could be resolved for **any** component and there is no partial truth either.
 * Answering 200 with a total of `0` would be a lie about somebody's account.
 *
 * Everything else is a 200 with a per-component state. A provider hiccup on one
 * piece does not take the other pieces away from the person.
 */
import { Hono } from 'hono';

import type { ReadDigitalDollars } from '../../../application/portfolio/readDigitalDollars';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import { WALLETS_UNAVAILABLE_BODY } from './portfolio';

export interface DigitalDollarsDeps {
  readonly sessions: SessionCodec;
  readonly readDigitalDollars: ReadDigitalDollars;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createDigitalDollarsRoutes = (deps: DigitalDollarsDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.get('/', async (c) => {
    // The same door as every other route: same cookie, same codec, same 401.
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      return c.json(await deps.readDigitalDollars(claims.userId, clock()), 200);
    } catch (error) {
      if (error instanceof WalletsUnavailable) {
        log.error('GET /digital-dollars could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      // Anything else is ours and is not the person's answer to guess at.
      throw error;
    }
  });

  return app;
};
