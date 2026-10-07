import { getEnv, type Env } from '@bestpath/config';
import { loadEnvFiles } from '../../src/lib/dotenv';
import type { Database } from '../../src/db/client';
import { getDb } from '../../src/db/client';

/**
 * A database a test is allowed to write to.
 *
 * ── What happened, and why this file exists ─────────────────────────────────
 *
 * Running `pnpm --filter @bestpath/api test` at 16:52 UTC on 2026-09-27 inserted
 * four users into the PRODUCTION Neon database:
 *
 *   did:e2e:96ea280a:1  →  wallet 0x000000000000000000000000000000006ea280a1
 *   did:e2e:46fb032c:3  →  wallet 0x000000000000000000000000000000006fb032c3
 *   did:e2e:efe155c1:1  →  wallet 0x00000000000000000000000000000000fe155c11
 *   did:e2e:c847a7c3:3  →  wallet 0x00000000000000000000000000000000847a7c33
 *
 * None of those wallets exists in Privy, so none of those accounts can ever be
 * signed for, and all four took a public `@tag` that a real user could have been
 * given. The cause was not a bug in the tests: it was that they read
 * `DATABASE_URL` from the repo `.env`, and that file points at the Neon
 * `production` branch, because the app's real database lives there.
 *
 * So a test suite with no idea which database it is talking to is not a sharp
 * tool, it is a loaded one pointed at the wrong target.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A test may only write to a database whose NAME says it is disposable. The
 * check is on the NAME and not on the host, because the host is the thing that
 * is hard to reason about: localhost, a Docker service name, a Neon branch, a
 * tunnel — and a production database can be behind any of them. A name is
 * declared, and a declared name is a decision someone made on purpose.
 *
 * `TEST_DATABASE_URL` wins when it is set, so pointing the suite at a throwaway
 * Neon branch needs no code change. `ALLOW_NON_TEST_DATABASE` exists for the one
 * legitimate case — a smoke test against production, run deliberately by someone
 * who read this — and it is a second, separate name so that enabling it can
 * never happen by accident.
 */

/** The escape hatch, deliberately a different name from the URL override. */
const OVERRIDE = 'ALLOW_NON_TEST_DATABASE';

/** Read the URL a test would use, preferring the explicitly test-scoped one. */
const resolveUrl = (): string => {
  const scoped = process.env.TEST_DATABASE_URL;
  if (typeof scoped === 'string' && scoped.trim().length > 0) return scoped.trim();
  loadEnvFiles(import.meta.url);
  return getEnv().DATABASE_URL;
};

/** The database name out of a postgres URL, or `null` when it cannot be read. */
export const databaseNameOf = (url: string): string | null => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
};

/**
 * Tokens that announce the contents do not matter.
 *
 * Matched as WHOLE tokens, not as substrings. Substring matching accepted
 * `latestest` and any database whose name merely contained the letters — and a
 * guard that waves through `contest_data` is not a guard. Splitting on
 * non-alphanumerics means `bestpath_test`, `test-bestpath` and `tmp_e2e` are
 * disposable, and `latestest` is not.
 */
const DISPOSABLE_TOKENS = new Set(['test', 'tests', 'tmp', 'temp', 'scratch', 'e2e', 'ci']);

/**
 * True when the name declares itself disposable.
 *
 * The point is that the name was CHOSEN to announce that its contents do not
 * matter, not that it follows a convention.
 */
export const looksDisposable = (name: string): boolean =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => DISPOSABLE_TOKENS.has(token));

/**
 * Throw unless this database may be written to by a test.
 *
 * The error names the database and says how to fix it, because the alternative —
 * a test that quietly targets production — is the failure that costs a real
 * account.
 */
export const assertDisposableDatabase = (url: string): string => {
  const name = databaseNameOf(url);
  if (name === null) {
    throw new Error(
      'No se pudo leer el nombre de la base de datos de test a partir de la URL. ' +
        'Pasá TEST_DATABASE_URL con una base descartable, por ejemplo ' +
        'postgres://bestpath:bestpath@localhost:5432/bestpath_test',
    );
  }
  if (looksDisposable(name)) return name;
  if (process.env[OVERRIDE] === '1') return name;
  throw new Error(
    `La base "${name}" no es de test y los tests de integración ESCRIBEN en ella. ` +
      'Un test de integración no puede correr contra una base real.\n' +
      '  Levantar una base descartable:  docker compose up -d\n' +
      '  Crear la base de test:           createdb -h localhost -U bestpath bestpath_test\n' +
      '  Correr los tests con:             TEST_DATABASE_URL=postgres://bestpath:bestpath@localhost:5432/bestpath_test pnpm --filter @bestpath/api test\n' +
      `  O, solo contra una base real a propósito, con ${OVERRIDE}=1 y sabiendo qué se está borrando.`,
  );
};

/**
 * The env an integration test must use: the real one, with the database swapped
 * for the disposable one.
 *
 * The tests used to call `getEnv()` and inherit whatever `DATABASE_URL` said.
 * They now get an env built here, so `createApp(env)` and every `getDb(...)` in
 * the test point at the same, verified database.
 */
export const testEnv = (): Env => {
  const url = resolveUrl();
  assertDisposableDatabase(url);
  return { ...getEnv(), DATABASE_URL: url } as Env;
};

/** The db for an integration test. Always the verified one. */
export const testDb = (env: Env): Database => getDb(env.DATABASE_URL);
