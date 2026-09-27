import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types/context';

/** TODO(feature: profile) — read the user, patch the name/recovery fields. */
export const meRoutes = new Hono<AppEnv>()
  .use(requireAuth())
  .get('/', (c) =>
    c.json({ ok: true as const, data: { user: null, wallet: null, yieldSummary: null } }),
  )
  .patch('/profile', zValidator('json', z.object({ name: z.string().min(1).max(60) })), (c) =>
    c.json({ ok: true as const, data: { user: null } }),
  )
  .patch(
    '/recovery',
    zValidator(
      'json',
      z.object({ email: z.string().email().optional(), phone: z.string().min(6).optional() }),
    ),
    (c) => c.json({ ok: true as const, data: { user: null } }),
  );
