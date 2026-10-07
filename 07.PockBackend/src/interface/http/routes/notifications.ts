/**
 * `GET /api/notifications` — what happened to this person's account, in sentences.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```json
 * { "notifications": [
 *   { "id": "…", "eventType": "wallet.created", "category": "wallet",
 *     "message": "Se creó una billetera nueva en tu cuenta.",
 *     "createdAt": "2025-06-01T11:00:00.000Z" } ] }
 * ```
 *
 * There is no `payload` in the item, and no way to ask for one. A Privy payload
 * carries identifiers — a DID, an address, a wallet id — that the UI has no use
 * for and that would put a provider's internal shape on a screen. The screen needs
 * a sentence; the row stays where it is.
 *
 * ── The same door as every other route ────────────────────────────────────────
 *
 * Same cookie, same codec, same 401, same "read nothing on failure". The person
 * comes from the session claims, and there is no query parameter, no path segment
 * and no header that could name somebody else: the set of events this route can
 * answer about is exactly the set that belongs to the person who asked.
 *
 * ── 502 instead of an empty feed ──────────────────────────────────────────────
 *
 * An empty list is a claim: "you have no notifications". A failed read is not
 * that claim, and answering 200 would render an outage as a quiet account.
 */
import { Hono } from 'hono';

import type { ReadNotifications } from '../../../application/webhooks/readNotifications';
import { NotificationsUnavailable } from '../../../application/webhooks/readNotifications';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';

/** The one 502 this route can produce. The reason stays in the log. */
export const NOTIFICATIONS_UNAVAILABLE_BODY = { error: { code: 'NOTIFICATIONS_UNAVAILABLE' } } as const;

export interface NotificationsDeps {
  readonly sessions: SessionCodec;
  readonly readNotifications: ReadNotifications;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createNotificationsRoutes = (deps: NotificationsDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.get('/', async (c) => {
    // The same door as `GET /api/portfolio`: same cookie, same codec, same 401.
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      const notifications = await deps.readNotifications(claims.privyDid);
      return c.json(
        {
          generatedAt: clock().toISOString(),
          notifications: notifications.map((item) => ({
            id: item.id,
            eventType: item.eventType,
            category: item.category,
            message: item.message,
            createdAt: item.createdAt.toISOString(),
          })),
        },
        200,
      );
    } catch (error) {
      if (error instanceof NotificationsUnavailable) {
        log.error('GET /notifications could not read the webhook rows', error);
        return c.json(NOTIFICATIONS_UNAVAILABLE_BODY, 502);
      }
      // Anything else is ours, and is not the person's answer to guess at.
      throw error;
    }
  });

  return app;
};
