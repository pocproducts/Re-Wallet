import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/context';

/** Correlation id for logs. Echoed back so a user can quote it in a bug report. */
export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
};
