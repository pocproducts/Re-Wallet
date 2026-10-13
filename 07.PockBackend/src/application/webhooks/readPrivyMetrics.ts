/**
 * USE CASE: aggregate Privy metrics for the public landing page.
 *
 * ── Why it is this thin ───────────────────────────────────────────────────────
 *
 * Aggregation lives in the store, where the SQL is; this file only pins the
 * clock. There is no fallback for an empty table: the store answers real zeros,
 * and zeros are the truth of a product that has not seen its first event.
 */
import type { PrivyMetrics, WebhookEventStore } from '../../domain/ports/webhook-event-store';

export interface ReadPrivyMetrics {
  (): Promise<PrivyMetrics>;
}

export const readPrivyMetrics = (deps: {
  readonly store: Pick<WebhookEventStore, 'metrics'>;
  readonly now?: () => Date;
}): ReadPrivyMetrics => {
  const clock = deps.now ?? ((): Date => new Date());
  return () => deps.store.metrics({ now: clock() });
};
