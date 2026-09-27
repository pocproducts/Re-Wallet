import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * One pooled client per process. In dev, Vite/tsx reloads create new pools, so
 * the instance is cached on globalThis to avoid exhausting connections.
 */
const globalForDb = globalThis as unknown as { __bestpathDb?: Database };

export function createDb(databaseUrl: string): Database {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    prepare: false,
  });
  return drizzle(client, { schema });
}

export function getDb(databaseUrl: string): Database {
  if (!globalForDb.__bestpathDb) globalForDb.__bestpathDb = createDb(databaseUrl);
  return globalForDb.__bestpathDb;
}
