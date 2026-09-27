import { pino } from 'pino';
import type { Env } from '@bestpath/config';

/** Structured logger. Every line is JSON in production, pretty in dev. */
export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'bestpath-api' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.sessionSecret', '*.apiKey'],
      remove: true,
    },
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
