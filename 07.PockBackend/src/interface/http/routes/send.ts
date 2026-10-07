/**
 * `POST /api/send/prepare` — the unsigned transaction of a send.
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 *
 * ```json
 * POST /api/send/prepare
 * { "requestId": "<client uuid>",
 *   "chain": "monad",
 *   "asset": { "symbol": "USDC", "decimals": 6 },
 *   "recipient": "0x…",
 *   "amountRaw": "1500000" }
 *
 * 200 { "requestId": "…", "chain": "monad", "address": "0x…", "chainId": 143,
 *       "network": "eip155:143",
 *       "transactions": [ { "purpose": "transfer", "to": "0x…", "data": "0x…",
 *                           "value": "0", "chainId": 143 } ],
 *       "movement": { "id": "…", "status": "pending" } }
 * ```
 *
 * ── Why the answer carries `address` ──────────────────────────────────────────
 *
 * `address` is the wallet the balance was read for and the transfer moves from,
 * named as `POST /api/pool/deposit` names it. The browser has to sign for
 * **that** wallet; it cannot infer it from its own idea of the person's wallets,
 * and a mismatch between the two is a transfer out of an address nobody checked.
 * The browser must fail closed if this field is missing rather than fall back to
 * a client-side guess.
 *
 * ── Two doors to the same destination ────────────────────────────────────────
 *
 * `contrato-dinero.md:26` — *"Se llega por QR o por nombre o @tag, y ReWALLET
 * resuelve la dirección por detrás."* So the body may carry **`recipientTag`**
 * as well as `recipient`, and this route forwards whichever the person typed
 * without looking at either one: normalizing a handle, refusing one, and
 * resolving it are all `prepareSend`'s job, and a route that resolved the tag
 * would have to hold the address it resolved to.
 *
 * That is the whole point. **This route never holds the payee's address**, so
 * there is no field, no branch and no typo that could put it in a response. The
 * two refusals the tag door adds — `RECIPIENT_NOT_FOUND` and
 * `RECIPIENT_NO_WALLET_ON_CHAIN` — travel out of `SendRejected` on the same 400
 * as every other refusal, carrying the code and nothing else.
 *
 * ── Why the status codes are the ones the rest of the app uses ───────────────
 *
 * 401: no cookie, or a cookie that does not verify. Nothing was read.
 * 400: the send was refused, with one bounded code per distinct wrong thing, so
 *      a screen can say *what* — `AMOUNT_EXCEEDS_BALANCE` and
 *      `BALANCE_UNREADABLE` are different facts, and the second must never be
 *      drawn as "you have nothing".
 * 409 `IDEMPOTENT_REPLAY`: this `requestId`, from this person, already prepared a
 *      transfer. The stored answer travels back under `replay`, so the screen
 *      shows the same transaction instead of inventing a second one.
 * 409 `IDEMPOTENT_IN_FLIGHT`: the claim exists and has no answer yet. A different
 *      answer from "you already sent this", and a retryable one.
 * 502 `WALLETS_UNAVAILABLE`: the rows could not be read, so there is no address to
 *      send from and nothing was written.
 *
 * ── Why the sender is never read from the body ───────────────────────────────
 *
 * The address comes from `rewallet.wallets` for the user the cookie proved. An
 * `address`, a `from` or an `onBehalfOf` in the body or the query is not looked
 * at: there is no parameter to read, so there is no code path that sends from
 * somebody else's account.
 */
import { Hono, type Context } from 'hono';

import {
  SendInFlight,
  SendRejected,
  SendReplay,
  type PrepareSend,
} from '../../../application/send/prepareSend';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';
import { WALLETS_UNAVAILABLE_BODY } from './portfolio';

export interface SendDeps {
  readonly sessions: SessionCodec;
  readonly prepareSend: PrepareSend;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createSendRoutes = (deps: SendDeps) => {
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

  app.post('/prepare', async (c) => {
    const claims = await authenticate(c);
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    /*
     * A body that is not JSON is not a send. It is refused as an unusable
     * request rather than becoming a 500: nothing about it was read, and a
     * browser that sent nonsense deserves the same code as one that sent no
     * `requestId` at all.
     */
    const body = await c.req.json().catch(() => null);

    try {
      const preparation = await deps.prepareSend(claims.userId, (body ?? {}) as Record<string, never>);
      return c.json(preparation, 200);
    } catch (error) {
      if (error instanceof SendReplay) {
        log.log('POST /send/prepare replayed', { userId: claims.userId });
        return c.json({ error: { code: 'IDEMPOTENT_REPLAY' }, replay: error.replay }, 409);
      }
      if (error instanceof SendInFlight) {
        log.log('POST /send/prepare in flight', { userId: claims.userId });
        return c.json({ error: { code: 'IDEMPOTENT_IN_FLIGHT' } }, 409);
      }
      if (error instanceof WalletsUnavailable) {
        log.error('POST /send/prepare could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      if (error instanceof SendRejected) {
        log.error(`POST /send/prepare refused: ${error.code}`, error);
        return c.json({ error: { code: error.code } }, 400);
      }
      throw error;
    }
  });

  return app;
};
