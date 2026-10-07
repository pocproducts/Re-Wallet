import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { loadEnvFiles } from '../../src/lib/dotenv';
import { testEnv } from '../helpers/testDb';
import { createApp } from '../../src/app';
import type { Env } from '@bestpath/config';
import { SESSION_COOKIE } from '../../src/lib/session';
import { __resetPrivy } from '../../src/services/privy';
import { getDb } from '../../src/db/client';
import { eq } from 'drizzle-orm';
import { users } from '../../src/db/schema';

/**
 * `PATCH /me/recovery`, against a real session and a real database.
 *
 * This route used to be a stub that answered `200 { ok: true, data: { user:
 * null } }` and wrote nothing at all. The onboarding form REQUIRES an email and a
 * phone before it lets anyone continue, so a real user typed a real recovery
 * email, the app advanced, and the email was discarded — with a success envelope
 * on both sides and nothing to notice it by.
 *
 * So the assertions here are mostly about what the STUB could not do:
 *
 *   1. the values come back changed, not as a null user;
 *   2. a body with nothing in it is a 400, because a patch that changes nothing
 *      and answers 200 is an endpoint that lies;
 *   3. a partial body does NOT erase the fields it did not mention — the failure
 *      mode of a naive `Object.assign(body)` into the update, and the reason a
 *      recovery email must survive a form that only changes the phone.
 *
 * The session is real: a locally minted ES256 token served by this process's own
 * JWKS, exactly as `auth.e2e.test.ts` does it, so `requireAuth` runs its
 * production path.
 */

loadEnvFiles(import.meta.url);

const TEST_APP_ID = 'test-app-recovery';
const TEST_DID = (n: number) => `did:e2e:recovery${n}:${randomUUID().slice(0, 8)}`;

let env: Env;
let app: ReturnType<typeof createApp>;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwksServer: Server;

// The real provider provisions a wallet in Privy's TEE over the network, so the
// CALL is stubbed and the contract is not. Unique per DID because
// `wallets.address` is UNIQUE: one fixed address makes the second registration
// fail on the wallet insert, which looks like a product bug and is a fixture bug.
vi.mock('../../src/services/privy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/privy')>();
  return {
    ...actual,
    getWalletForUser: vi.fn(async (privyDid: string) => {
      const tail = privyDid.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
      return { address: `0x${tail.padStart(40, '0').slice(0, 40)}`, walletId: 'stub' };
    }),
  };
});

const mintAccessToken = async (did: string): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: `sess_${randomUUID().slice(0, 12)}` })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setIssuer('privy.io')
    .setAudience(TEST_APP_ID)
    .setSubject(did)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti(randomUUID())
    .sign(keys.privateKey);
};

/**
 * Call the app directly, with the session as a cookie.
 *
 * Only the two headers this suite needs are set. Spreading `init.headers` would
 * mean spreading a `HeadersInit`, which can be a `Headers` instance or an array
 * of tuples — neither of which spreads into an object literal, and pretending
 * otherwise is how a test ends up sending no headers at all.
 */
const call = async (
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any; setCookie: string | undefined }> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers['cookie'] = `${SESSION_COOKIE}=${init.token}`;
  const res = await app.request(path, { ...init, headers });
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') ?? undefined };
};

const sessionTokenFrom = (setCookie: string | undefined): string => {
  if (!setCookie) throw new Error('no Set-Cookie: the endpoint did not start a session');
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error(`Set-Cookie without ${SESSION_COOKIE}`);
  return match[1] as string;
};

/** The stored row, read straight from Postgres. The response is not the proof. */
const rowFor = async (userId: string) => {
  const rows = await getDb(env.DATABASE_URL)
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
};

/** Register a user and return its session cookie plus its id. */
const register = async (n: number): Promise<{ token: string; userId: string }> => {
  const did = TEST_DID(n);
  const res = await call('/auth/register/finish', {
    method: 'POST',
    body: JSON.stringify({ idToken: await mintAccessToken(did) }),
  });
  if (res.status !== 201) throw new Error(`register falló: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: sessionTokenFrom(res.setCookie), userId: res.body.data.user.id };
};

const patchRecovery = (token: string, body: unknown) =>
  call('/me/recovery', { method: 'PATCH', token, body: JSON.stringify(body) });

beforeAll(async () => {
  const base = testEnv();

  keys = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'recovery-key', alg: 'ES256', use: 'sig' };
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const { port } = jwksServer.address() as AddressInfo;

  env = {
    ...base,
    PRIVY_APP_ID: TEST_APP_ID,
    PRIVY_VERIFICATION_JWKS: `http://127.0.0.1:${port}/jwks`,
  } as Env;
  app = createApp(env);
  __resetPrivy();
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
});

describe('the recovery fields actually reach the database', () => {
  it('email, phone and country are written and come back on the user', async () => {
    const { token, userId } = await register(1);

    const res = await patchRecovery(token, {
      email: 'ana@example.com',
      phone: '+549112345678',
      country: 'ar',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The stub answered with `user: null` here. A null user is what made the
    // loss invisible: the client had nothing to compare and no reason to doubt it.
    expect(res.body.data.user).not.toBeNull();
    expect(res.body.data.user.email).toBe('ana@example.com');

    // And the response is not the proof on its own — the row has to be there.
    const row = await rowFor(userId);
    expect(row?.recoveryEmail).toBe('ana@example.com');
    expect(row?.recoveryPhone).toBe('+549112345678');
    // Lowercase in, uppercase stored: the picker is driven by this value.
    expect(row?.recoveryPhoneCountry).toBe('AR');
  }, 30000);

  it('a body with nothing in it is a 400, not a 200 that changed nothing', async () => {
    const { token } = await register(2);
    const res = await patchRecovery(token, {});
    expect(res.status).toBe(400);
    // The same slug the rest of the API uses for a bad body, so the client has
    // one thing to branch on.
    expect(res.body.error).toBe('validation_failed');
  }, 30000);

  it('a body that only sets the email does NOT erase the phone', async () => {
    // The failure mode of `Object.assign(body)` into the update: the client sends
    // `undefined` for what it did not touch, and a recovery phone silently
    // disappears because a form changed the email.
    const { token, userId } = await register(3);
    await patchRecovery(token, { phone: '+5491100000000', country: 'ar' });

    const res = await patchRecovery(token, { email: 'solo@example.com' });
    expect(res.status).toBe(200);

    const row = await rowFor(userId);
    expect(row?.recoveryEmail).toBe('solo@example.com');
    expect(row?.recoveryPhone).toBe('+5491100000000');
    expect(row?.recoveryPhoneCountry).toBe('AR');
  }, 30000);

  it('an invalid email is a 400 and writes nothing', async () => {
    const { token, userId } = await register(4);
    const res = await patchRecovery(token, { email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
    // A rejected body must leave the row exactly as it was.
    expect((await rowFor(userId))?.recoveryEmail).toBeNull();
  }, 30000);

  it('the route needs a session', async () => {
    const res = await call('/me/recovery', {
      method: 'PATCH',
      body: JSON.stringify({ email: 'nadie@example.com' }),
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('a body that is not JSON is a 400, not a crash', async () => {
    const { token } = await register(5);
    const res = await call('/me/recovery', { method: 'PATCH', token, body: '{' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  }, 30000);
});
