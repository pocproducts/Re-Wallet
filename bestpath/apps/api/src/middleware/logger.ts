import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';

export const requestLogger = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const start = performance.now();
  await next();
  c.get('log').info(
    {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    },
    'request',
  );
};
