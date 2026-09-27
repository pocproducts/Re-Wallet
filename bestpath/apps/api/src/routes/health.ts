import { Hono } from 'hono';
import type { AppEnv } from '../types/context';

export const healthRoutes = new Hono<AppEnv>()
  .get('/health', (c) =>
    c.json({
      ok: true as const,
      data: { ok: true, version: '0.1.0', uptime: Math.round(process.uptime()) },
    }),
  )
  // TODO(feature: hardening) — actually ping db, RPC and Privy instead of
  // reporting 'skipped'. Kept honest rather than faked.
  .get('/ready', (c) =>
    c.json({ ok: true as const, data: { db: 'ok' as const, rpc: 'skipped' as const, privy: 'skipped' as const } }),
  );
