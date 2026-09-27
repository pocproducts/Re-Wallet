import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types/context';

/** TODO(feature: contacts) — CRUD, enforcing the 20-contact product limit. */
export const contactRoutes = new Hono<AppEnv>()
  .use(requireAuth())
  .get('/', (c) => c.json({ ok: true as const, data: { items: [] } }))
  .post(
    '/',
    zValidator('json', z.object({ name: z.string().min(1).max(60), tag: z.string().min(1).max(120) })),
    (c) => c.json({ ok: true as const, data: { contact: null } }),
  )
  .delete('/:id', zValidator('param', z.object({ id: z.string().uuid() })), (c) => c.body(null, 204));
