import { describe, expect, it } from 'vitest';

import { readPrivyMetrics } from '../../src/application/webhooks/readPrivyMetrics';
import type { PrivyMetrics } from '../../src/domain/ports/webhook-event-store';

const SAMPLE: PrivyMetrics = { walletsCreated: 12, activeUsers24h: 3, signIns: 40 };

describe('readPrivyMetrics', () => {
  it('passes the store answer through unchanged', async () => {
    const read = readPrivyMetrics({ store: { metrics: async () => SAMPLE } });
    expect(await read()).toEqual(SAMPLE);
  });

  it('hands the store the clock it was given, so the window edge is the caller’s', async () => {
    const edges: Date[] = [];
    const now = new Date('2026-01-01T12:00:00Z');
    const read = readPrivyMetrics({
      store: {
        metrics: async ({ now: at }) => {
          edges.push(at);
          return SAMPLE;
        },
      },
      now: () => now,
    });

    await read();

    expect(edges).toEqual([now]);
  });

  it('reports zeros as zeros — an empty table is the truth, not an error', async () => {
    const read = readPrivyMetrics({
      store: { metrics: async () => ({ walletsCreated: 0, activeUsers24h: 0, signIns: 0 }) },
    });
    expect(await read()).toEqual({ walletsCreated: 0, activeUsers24h: 0, signIns: 0 });
  });
});
