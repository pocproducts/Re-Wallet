/**
 * The database client.
 *
 * ── Why the HTTP driver ───────────────────────────────────────────────────────
 *
 * A Cloudflare Worker has **no sockets**. The only way to speak to Postgres from
 * there is over HTTP, which is what `@neondatabase/serverless` does. The existing
 * database is Neon, so this is the driver that has to be used, and there is no
 * second transport to support: this Worker only ever runs on Workers.
 *
 * ── Why it fails closed ───────────────────────────────────────────────────────
 *
 * Without a URL this **throws**. It does not return an empty client, does not
 * default to "some database". A backend that starts up not knowing which database
 * it writes to looks healthy and then writes somewhere wrong.
 */
import { neon } from '@neondatabase/serverless';

export type Database = ReturnType<typeof neon>;

export const createDatabase = (databaseUrl: string): Database => {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not defined. The Worker does not start without knowing which ' +
        'database it writes to: the wrong database is an incident, and a missing one ' +
        'is a startup error. Both beat guessing.',
    );
  }
  return neon(databaseUrl);
};

/** The only place in the project that reads an environment variable. */
export const readEnv = (env: Record<string, unknown>, key: string): string => {
  const value = env[key];
  return typeof value === 'string' ? value : '';
};