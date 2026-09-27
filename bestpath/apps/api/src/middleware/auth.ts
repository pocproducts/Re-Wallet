import type { MiddlewareHandler } from 'hono';
import { readSession, clearSession } from '../lib/cookie';
import { verifySession, SESSION_COOKIE } from '../lib/session';
import { unauthorized } from '../lib/errors';
import type { AppEnv } from '../types/context';

export { SESSION_COOKIE };

/**
 * Resolves the session cookie to a userId when present. Does not reject.
 * TODO(feature: passkey): replace cookie lookup with the Privy session
 * verification flow. The shape — a validated userId on the context — stays.
 */
export const attachUser = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const token = readSession(c);
  if (!token) return next();

  const actor = await verifySession(c.get('db'), token);
  if (actor) {
    c.set('sessionId', actor.sessionId);
    c.set('userId', actor.userId);
    c.set('actor', actor);
  } else {
    // A cookie that resolves to nothing is a dead cookie. Clear it so the
    // browser stops sending it on every request.
    clearSession(c, c.get('env'));
  }
  await next();
};

/** Guard for every private route. */
export const requireAuth = (): MiddlewareHandler<AppEnv> => {
  const attach = attachUser();
  return async (c, next) => {
    await attach(c, async () => undefined);
    if (!c.get('userId')) throw unauthorized();
    await next();
  };
};
