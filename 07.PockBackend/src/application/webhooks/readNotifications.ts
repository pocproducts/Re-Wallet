/**
 * The feed: the authenticated person's events, as sentences.
 *
 * The payload enters the application layer and stops at the sentence. The row is
 * a record of what a provider said; the screen needs a sentence, and the only
 * thing taken from the payload is a figure — see
 * `domain/webhooks/eventAmount.ts`. No payload field is passed on to the item.
 *
 * ── Why the store cannot be asked about somebody else ─────────────────────────
 *
 * The person arrives as the DID from the session claims, and this use case is
 * the only thing that reads rows. There is no `userId` parameter, no
 * `privyDid` parameter, and nothing to pass through from the request: the route
 * has exactly one input, the identity the cookie proved.
 */
import type { NotificationCategory } from '../../domain/webhooks/eventDescription';
import { describeEvent } from '../../domain/webhooks/eventDescription';
import type { WebhookEventStore } from '../../domain/ports/webhook-event-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

/** A feed is a screen, not an archive. */
export const NOTIFICATIONS_PAGE_SIZE = 50;

export interface NotificationItem {
  readonly id: string;
  readonly eventType: string;
  readonly category: NotificationCategory;
  readonly message: string;
  readonly createdAt: Date;
}

/** Raised when the rows cannot be read at all: 502, never an empty feed. */
export class NotificationsUnavailable extends Error {
  constructor(cause: unknown) {
    super('the notification rows could not be read', { cause });
    this.name = 'NotificationsUnavailable';
  }
}

export type ReadNotifications = (privyDid: string) => Promise<readonly NotificationItem[]>;

export const readNotifications = (deps: {
  readonly store: WebhookEventStore;
  readonly log?: Logger;
  readonly pageSize?: number;
}): ReadNotifications => {
  const log = deps.log ?? noopLogger;
  const pageSize = deps.pageSize ?? NOTIFICATIONS_PAGE_SIZE;

  return async (privyDid) => {
    let rows;
    try {
      rows = await deps.store.listForPerson(privyDid, pageSize);
    } catch (error) {
      // An empty feed is a **claim**: "you have no notifications". A failed read
      // is not that, and reporting it as 200 would make an outage look like a
      // quiet account.
      log.error('GET /notifications could not read the webhook rows', error);
      throw new NotificationsUnavailable(error);
    }

    return rows.map((row) => {
      const described = describeEvent(row.eventType, row.payload);
      return {
        id: row.id,
        eventType: row.eventType,
        category: described.category,
        message: described.message,
        createdAt: row.createdAt,
      };
    });
  };
};
