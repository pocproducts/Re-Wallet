import { Hono } from 'hono';
import { authRoutes, profileRoutes } from './auth';
import { contactRoutes } from './contacts';
import { gasRoutes } from './gas';
import { healthRoutes } from './health';
import { meRoutes } from './me';
import { walletRoutes } from './wallet';
import { webhookRoutes } from './webhooks';
import { yieldRoutes } from './yield';
import type { AppEnv } from '../types/context';

export const routes = new Hono<AppEnv>()
  .route('/auth', authRoutes)
  // profileRoutes is mounted before meRoutes so PATCH /me/profile resolves to
  // the real handler; the legacy /me stub is kept for the endpoints not migrated.
  .route('/me', profileRoutes)
  .route('/me', meRoutes)
  .route('/wallet', walletRoutes)
  .route('/contacts', contactRoutes)
  .route('/yield', yieldRoutes)
  .route('/webhooks', webhookRoutes)
  .route('/gas', gasRoutes)
  .route('/', healthRoutes);

export * from './auth';
export * from './contacts';
export * from './gas';
export * from './health';
export * from './me';
export * from './wallet';
export * from './webhooks';
export * from './yield';
