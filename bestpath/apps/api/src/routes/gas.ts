import { Hono } from 'hono';
import type { AppEnv } from '../types/context';
import { buildGasConfig, toStatus } from '../services/gas/config';

/**
 * Debug only: which paymaster and which network are live right now.
 *
 * Exposes no secrets and no user data. The point is that switching phase or
 * network is observable rather than silent — you can tell from here whether a
 * deploy is actually on mainnet with the provider you think it is.
 */
export const gasRoutes = new Hono<AppEnv>().get('/status', (c) =>
  c.json({ ok: true as const, data: toStatus(buildGasConfig(c.get('env'))) }),
);
