import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import { getEnv, type Env } from '@bestpath/config';
import { createLogger, type Logger } from './lib/logger';
import { getDb, type Database } from './db/client';
import { AppError } from './lib/errors';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/logger';
import { attachUser } from './middleware/auth';
import { routes } from './routes';
import type { AppEnv } from './types/context';

export function createApp(env: Env = getEnv()) {
  const log: Logger = createLogger(env);
  const db: Database = getDb(env.DATABASE_URL);

  const app = new Hono<AppEnv>();

  // Seed the context before any route handler can read it.
  app.use('*', async (c, next) => {
    c.set('env', env);
    c.set('log', log);
    c.set('db', db);
    await next();
  });
  app.use('*', requestId());
  app.use('*', requestLogger());
  app.use('*', attachUser());

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.status >= 500) c.get('log').error({ err }, 'request failed');
      else c.get('log').warn({ error: err.error }, 'request rejected');
      return c.json({ ok: false, error: err.error, message: err.message, code: err.code }, err.status as ContentfulStatusCode);
    }
    if (err instanceof HTTPException) {
      return c.json(
        { ok: false, error: 'http_error', message: err.message, code: err.status },
        err.status,
      );
    }
    c.get('log').error({ err, requestId: c.get('requestId') }, 'unhandled error');
    return c.json({ ok: false, error: 'internal', message: 'Error interno.', code: 500 }, 500);
  });

  app.notFound((c) =>
    c.json({ ok: false, error: 'not_found', message: 'Ruta no encontrada.', code: 404 }, 404),
  );

  app.route('/', routes);

  return app;
}
