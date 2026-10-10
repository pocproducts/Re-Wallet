/**
 * `GET /api/metrics/privy` — public aggregate counts for the landing page.
 *
 * ── Why there is no cookie and no auth ────────────────────────────────────────
 *
 * The response is three integers over the whole table. Nobody's id, payload or
 * behaviour is in it, so there is nothing a session would protect. It is the
 * same kind of public fact as a status page.
 *
 * ── Why the 60-second cache ───────────────────────────────────────────────────
 *
 * The aggregation is a `COUNT DISTINCT` over jsonb payloads; on a landing page
 * it would run once per visitor for numbers that cannot visibly change in
 * seconds. A short in-process cache caps that at one query per minute per
 * isolate, and after restart the first request simply pays one query.
 */
import { Hono } from 'hono';

import type { ReadPrivyMetrics } from '../../../application/webhooks/readPrivyMetrics';
import type { PrivyMetrics } from '../../../domain/ports/webhook-event-store';

const CACHE_TTL_MS = 60_000;

export interface MetricsDeps {
  readonly readMetrics: ReadPrivyMetrics;
  readonly now?: () => number;
}

export const createMetricsRoutes = (deps: MetricsDeps) => {
  const app = new Hono();
  const clock = deps.now ?? ((): number => Date.now());

  let cached: { readonly value: PrivyMetrics; readonly expiresAt: number } | null = null;

  app.get('/', async (c) => {
    if (cached !== null && cached.expiresAt > clock()) {
      return c.json(cached.value);
    }
    const value = await deps.readMetrics();
    cached = { value, expiresAt: clock() + CACHE_TTL_MS };
    return c.json(value);
  });

  return app;
};
