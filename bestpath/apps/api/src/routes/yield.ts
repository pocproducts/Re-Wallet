import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types/context';

/**
 * TODO(feature: yield) — the rate must be read from the Aave pool at request
 * time. Never serve a hardcoded APY: the number has to survive a judge opening
 * the repo.
 */
export const yieldRoutes = new Hono<AppEnv>()
  .use(requireAuth())
  .get('/summary', (c) =>
    c.json({ ok: true as const, data: { rate: null, earned: null, projected: null } }),
  )
  .get(
    '/history',
    zValidator('query', z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })),
    (c) => c.json({ ok: true as const, data: { items: [] } }),
  );
