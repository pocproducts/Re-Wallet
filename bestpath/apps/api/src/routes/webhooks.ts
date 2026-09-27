import { Hono } from 'hono';
import { rateLimit } from '../middleware/rateLimit';
import type { AppEnv } from '../types/context';

/**
 * These routes carry no session. Authentication is the request signature,
 * verified against WEBHOOK_SECRET_* BEFORE the body is trusted or parsed.
 * TODO(feature: indexer) — verify, persist to webhook_events, then dispatch.
 */
export const webhookRoutes = new Hono<AppEnv>()
  .use(rateLimit({ keyPrefix: 'webhook' }))
  .post('/privy', (c) => c.json({ ok: true as const, data: { received: true } }))
  .post('/chain', (c) => c.json({ ok: true as const, data: { received: true } }))
  .post('/pimlico', (c) => c.json({ ok: true as const, data: { received: true } }));
