import { describe, expect, it } from 'vitest';

import { createMetricsRoutes } from '../../src/interface/http/routes/metrics';
import type { PrivyMetrics } from '../../src/domain/ports/webhook-event-store';

const SAMPLE: PrivyMetrics = { walletsCreated: 7, activeUsers24h: 2, signIns: 15 };

const app = (read: () => Promise<PrivyMetrics>, now?: () => number) => createMetricsRoutes({ readMetrics: read, now });

describe('GET /api/metrics/privy', () => {
  it('answers the aggregate counts as JSON, with no session', async () => {
    const response = await app(async () => SAMPLE).request('/');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SAMPLE);
  });

  it('serves the cached value within the TTL instead of re-reading', async () => {
    let reads = 0;
    let clock = 0;
    const routes = app(
      async () => {
        reads += 1;
        return SAMPLE;
      },
      () => clock,
    );

    await routes.request('/');
    clock = 30_000; // inside the 60s window
    const second = await routes.request('/');

    expect(reads).toBe(1);
    expect(await second.json()).toEqual(SAMPLE);
  });

  it('re-reads once the cache has expired', async () => {
    let reads = 0;
    let clock = 0;
    const routes = app(
      async () => {
        reads += 1;
        return SAMPLE;
      },
      () => clock,
    );

    await routes.request('/');
    clock = 61_000;
    await routes.request('/');

    expect(reads).toBe(2);
  });
});
