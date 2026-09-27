import type { MiddlewareHandler } from 'hono';
import { and, eq, gt } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema';
import { badRequest } from '../lib/errors';
import { IDEMPOTENCY_TTL_HOURS } from '@bestpath/shared/constants';
import type { Database } from '../db/client';
import type { AppEnv } from '../types/context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ttl = (): Date => new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

/**
 * Replay lookup: returns the stored response for a key that is still valid, or
 * undefined. A key whose row exists but has expired is treated as absent, and
 * the caller overwrites it.
 */
export async function findReplay(
  db: Database,
  key: string,
  endpoint: string,
): Promise<unknown | undefined> {
  const [row] = await db
    .select({ response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.endpoint, endpoint),
        gt(idempotencyKeys.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.response;
}

export async function remember(
  db: Database,
  key: string,
  endpoint: string,
  userId: string,
  response: unknown,
): Promise<void> {
  await db
    .insert(idempotencyKeys)
    .values({ key, endpoint, userId, response, expiresAt: ttl() })
    .onConflictDoUpdate({
      target: idempotencyKeys.key,
      set: { response, expiresAt: ttl() },
    });
}

/**
 * Every money-mutating POST must carry an `Idempotency-Key`. Without it the
 * request is rejected before any side effect; with it, a retry replays the
 * stored response instead of moving money twice.
 *
 * TODO(feature: send): call findReplay() at the top of a money route and return
 * the stored payload immediately when it hits. The validation half below is
 * already final.
 */
export const requireIdempotencyKey = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const key = c.req.header('idempotency-key');
  if (!key) throw badRequest('idempotency_key_required', 'Falta el header Idempotency-Key.');
  if (!UUID_RE.test(key)) {
    throw badRequest('idempotency_key_invalid', 'Idempotency-Key debe ser un UUID.');
  }
  c.set('idempotencyKey', key);
  await next();
};
