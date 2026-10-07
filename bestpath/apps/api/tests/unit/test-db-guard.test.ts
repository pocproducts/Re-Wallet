import { describe, it, expect, afterEach } from 'vitest';
import { assertDisposableDatabase, databaseNameOf, looksDisposable } from '../helpers/testDb';

/**
 * The guard that stopped four users being written into production.
 *
 * This is the one test in the suite that has to be right even when everything
 * else is convenient: it is the difference between a throw and a real account
 * deleted. It is a pure function, so it is also the cheapest thing in the suite
 * to keep honest.
 *
 * The cases below are the actual URLs this project has used. `neondb` is the
 * production branch in `.env`; `bestpath` is the local Postgres from
 * `docker-compose.yml`, which is ALSO not a test database and was the other way
 * this mistake could have gone.
 */

const PROD = 'postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require';
const LOCAL_APP = 'postgres://bestpath:bestpath@localhost:5432/bestpath';
const LOCAL_TEST = 'postgres://bestpath:bestpath@localhost:5432/bestpath_test';
const SCRATCH = 'postgresql://u:p@host/scratch_tmp';

const after = () => { delete process.env.ALLOW_NON_TEST_DATABASE; };

describe('reading the database name out of a URL', () => {
  it('takes the last path segment', () => {
    expect(databaseNameOf(PROD)).toBe('neondb');
    expect(databaseNameOf(LOCAL_APP)).toBe('bestpath');
    expect(databaseNameOf(LOCAL_TEST)).toBe('bestpath_test');
  });

  it('decodes it, because a name with a dot in it still has to be read', () => {
    expect(databaseNameOf('postgresql://u:p@host/best%2Dpath_test')).toBe('best-path_test');
  });

  it('returns null for something that is not a URL, rather than guessing', () => {
    expect(databaseNameOf('not a url')).toBeNull();
    expect(databaseNameOf('postgres://u:p@host/')).toBeNull();
  });
});

describe('what counts as disposable', () => {
  it('a name that says test, tmp or scratch', () => {
    expect(looksDisposable('bestpath_test')).toBe(true);
    expect(looksDisposable('tmp_e2e')).toBe(true);
    expect(looksDisposable('scratch')).toBe(true);
  });

  it('a name that does not, however innocent it sounds', () => {
    // The local `bestpath` database is the app's real schema on a developer
    // laptop. "It is only localhost" is exactly the reasoning that ends with a
    // wiped dev database, and it is the reasoning this guard exists to refuse.
    expect(looksDisposable('bestpath')).toBe(false);
    expect(looksDisposable('neondb')).toBe(false);
    expect(looksDisposable('latestest')).toBe(false);
  });
});

describe('the guard, on the URLs this project has actually used', () => {
  afterEach(after);

  it('REFUSES the production Neon database', () => {
    expect(() => assertDisposableDatabase(PROD)).toThrow(/no es de test/);
  });

  it('names the database it refused, so the message is actionable', () => {
    // An error that says "wrong database" without saying WHICH leaves the reader
    // to go and find out, which is the part that takes the afternoon.
    expect(() => assertDisposableDatabase(PROD)).toThrow(/neondb/);
  });

  it('suggests the command that fixes it', () => {
    expect(() => assertDisposableDatabase(PROD)).toThrow(/TEST_DATABASE_URL/);
  });

  it('REFUSES the local app database too', () => {
    expect(() => assertDisposableDatabase(LOCAL_APP)).toThrow(/no es de test/);
  });

  it('accepts a real test database', () => {
    expect(assertDisposableDatabase(LOCAL_TEST)).toBe('bestpath_test');
    expect(assertDisposableDatabase(SCRATCH)).toBe('scratch_tmp');
  });

  it('refuses a URL it cannot read a name from', () => {
    expect(() => assertDisposableDatabase('nonsense')).toThrow(/No se pudo leer/);
  });

  it('the override is a SEPARATE name, and it works', () => {
    // Deliberately not settable by pointing TEST_DATABASE_URL somewhere: a smoke
    // test against production is a decision with its own word for it.
    process.env.ALLOW_NON_TEST_DATABASE = '1';
    expect(assertDisposableDatabase(PROD)).toBe('neondb');
  });

  it('the override is opt-in, not a default', () => {
    process.env.ALLOW_NON_TEST_DATABASE = 'true';
    expect(() => assertDisposableDatabase(PROD)).toThrow(/no es de test/);
    process.env.ALLOW_NON_TEST_DATABASE = 'yes';
    expect(() => assertDisposableDatabase(PROD)).toThrow(/no es de test/);
  });
});
