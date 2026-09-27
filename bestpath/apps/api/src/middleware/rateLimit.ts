import type { MiddlewareHandler } from 'hono';
import { rateLimited } from '../lib/errors';
import type { AppEnv } from '../types/context';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * In-memory fixed-window limiter, keyed by user when authenticated and by IP
 * otherwise. TODO(feature: hardening): this does not survive a restart and does
 * not coordinate across instances. Swap the Map for Redis when there is more
 * than one API process.
 */
export const rateLimit = (options?: { keyPrefix?: string }): MiddlewareHandler<AppEnv> => {
  const prefix = options?.keyPrefix ?? '';
  return async (c, next) => {
    const env = c.get('env');
    const now = Date.now();
    const identity = c.get('userId') ?? c.req.header('x-forwarded-for') ?? 'anonymous';
    const key = `${prefix}:${identity}`;

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS });
    } else {
      bucket.count += 1;
      if (bucket.count > env.RATE_LIMIT_MAX_REQUESTS) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        c.header('retry-after', String(retryAfter));
        throw rateLimited();
      }
    }
    await next();
  };
};

/** Test helper. */
export const __resetRateLimits = (): void => buckets.clear();
