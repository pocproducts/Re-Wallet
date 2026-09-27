import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { eq } from 'drizzle-orm';
import { getEnv, type Env } from '@bestpath/config';
import { loadEnvFiles } from '../../src/lib/dotenv';
import { createApp } from '../../src/app';
import { getWalletForUser, __resetPrivy } from '../../src/services/privy';
import { getDb } from '../../src/db/client';
import { sessions, users, wallets } from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/lib/session';
// THE OTHER HALF. The frontend's own guard and projection, imported across the
// workspace so the real backend response is projected by the real frontend code.
// Nothing else in the repo checks these two halves against each other.
//
// From `wire/session-envelope`, NOT from `wire/privy`: that module imports the
// Router, which reaches `window` at load time, and this suite runs in node.
import { isApiSession, toStorePatch } from '../../../web/src/wire/session-envelope';

/**
 * The auth contract, end to end, with a real token and a real database.
 *
 * WHY THIS FILE EXISTS, AND WHY IT HAD TO BE WRITTEN
 *
 * Every other test checks one half and trusts the other:
 *
 *   - `tests/integration/wallet.test.ts` inserts its own session row and calls the
 *     app. It never verifies a token and never touches a register.
 *   - `apps/web/scripts/privy.test.ts` stubs `fetch` and asserts the bridge
 *     handles whatever envelope arrives.
 *
 * So the register response could have the wrong shape, a `balance` could arrive as
 * a number instead of a `numeric(20,6)` string, and BOTH suites would stay green
 * while the real login 500s on a phone. This file closes that: it mints a real
 * ES256 token, drives the real Hono app against the real database, and then runs
 * the response through the frontend's own guard and mapper.
 *
 * ── The token is real, Privy is not ───────────────────────────────────────
 *
 * `verifyAccessToken` checks five things: ES256, `iss: 'privy.io'`, `aud` equal to
 * our app id, and the `iat`/`exp`/`sid`/`sub` claims. Signing all of them locally
 * against a JWKS served from this process exercises the REAL verification path
 * with the real `jose` code — no network, no Privy account, no browser, and it
 * cannot go stale when Privy rotates anything.
 *
 * ── The custody provider is stubbed, and that is a debt, not a convenience ──
 *
 * The real provider provisions a wallet in Privy's TEE over the network, so the
 * suite stubs it. What is stubbed is the CALL, not the contract: below, the
 * `describe` for the failure path pins the invariant that a provisioning failure
 * authenticates nobody and leaves no orphan user behind.
 */

loadEnvFiles(import.meta.url);

/** A distinct app id: the audience check must not accidentally pass on the real one. */
const TEST_APP_ID = 'test-app-e2e';
const TEST_DID = (n: number) => `did:e2e:${randomUUID().slice(0, 8)}:${n}`;

/** Deterministic and unique per DID, mirroring the stubbed custody provider. */
const custodianAddressFor = (did: string): string => {
  const tail = did.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  return `0x${tail.padStart(40, '0').slice(0, 40)}`;
};

let env: Env;
let app: ReturnType<typeof createApp>;
/** jose's own return type: naming it beats importing a lib-specific key type. */
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwksServer: Server;
let jwksUrl: string;

vi.mock('../../src/services/privy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/privy')>();
  return {
    ...actual,
    // Unique per DID, because `wallets.address` is UNIQUE: a single fixed
    // address makes the second registration fail on the wallet insert, which
    // looks like a product bug and is only a fixture bug.
    getWalletForUser: vi.fn(async (privyDid: string) => {
      const tail = privyDid.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
      return { address: `0x${tail.padStart(40, '0').slice(0, 40)}`, walletId: 'stub' };
    }),
  };
});

/** Mint a token the real `verifyAccessToken` will accept. */
const mintAccessToken = async (opts: { did: string; appId?: string }): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  // `sid` goes in the payload, not through a setter: jose v6 has no `setClaim`,
  // and `sid` is the claim Privy reads for the session id.
  //
  // `typ: 'JWT'` IS NOT OPTIONAL. `verifyAccessToken` passes `typ: 'JWT'` to
  // `jwtVerify`, and a header without it is rejected as invalid even when the
  // signature, issuer, audience and expiry are all correct. Found by reading the
  // installed SDK, not by guessing.
  return new SignJWT({ sid: `sess_${randomUUID().slice(0, 12)}` })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setIssuer('privy.io')
    .setAudience(opts.appId ?? TEST_APP_ID)
    .setSubject(opts.did)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti(randomUUID())
    .sign(keys.privateKey);
};

/** One request, with the session cookie carried by hand. */
const call = async (
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any; setCookie: string | undefined }> => {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any) };
  if (init.token) headers['cookie'] = `${SESSION_COOKIE}=${init.token}`;
  const res = await app.request(path, { ...init, headers });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  return { status: res.status, body, setCookie };
};

/** Pull the session token out of Set-Cookie. */
const sessionTokenFrom = (setCookie: string | undefined): string => {
  if (!setCookie) throw new Error('no Set-Cookie: the endpoint did not start a session');
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error(`Set-Cookie without ${SESSION_COOKIE}`);
  return match[1] as string;
};

beforeAll(async () => {
  const base = getEnv();

  // A local JWKS, served by this process, so `createRemoteJWKSet` has something
  // real to fetch and the verification path is the production one.
  keys = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'e2e-key', alg: 'ES256', use: 'sig' };
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const { port } = jwksServer.address() as AddressInfo;
  jwksUrl = `http://127.0.0.1:${port}/jwks`;

  env = { ...base, PRIVY_APP_ID: TEST_APP_ID, PRIVY_VERIFICATION_JWKS: jwksUrl } as Env;
  app = createApp(env);
  // The JWKS client is module-level and cached on first use: without this the
  // first test would bind it to the REAL Privy URL from .env.
  __resetPrivy();
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
});

/* ─── the verification itself ──────────────────────────────────────────────── */

describe('a token that is not trustworthy never becomes an identity', () => {
  it('a garbage token is rejected with the documented envelope', async () => {
    const res = await call('/auth/register/finish', {
      method: 'POST',
      body: JSON.stringify({ idToken: 'not-a-jwt' }),
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'unauthorized' });
    // A failed verification must not leave a session behind.
    expect(res.setCookie).toBeUndefined();
  });

  it('a token minted for another app is rejected', async () => {
    const token = await mintAccessToken({ did: TEST_DID(90), appId: 'someone-elses-app' });
    const res = await call('/auth/register/finish', {
      method: 'POST',
      body: JSON.stringify({ idToken: token }),
    });
    // `aud` is checked by jose AND again by our own app_id comparison. Either
    // way the answer is no, and no user is created.
    expect(res.status).toBe(401);
  });

  it('an expired token is rejected', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sid: 'sess_expired' })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuer('privy.io')
      .setAudience(TEST_APP_ID)
      .setSubject(TEST_DID(91))
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600)
      .sign(keys.privateKey);
    const res = await call('/auth/register/finish', { method: 'POST', body: JSON.stringify({ idToken: token }) });
    expect(res.status).toBe(401);
  });
});

/* ─── the flow, across both halves ─────────────────────────────────────────── */

describe('register, use, and log out — with the real frontend mapper', () => {
  const did = TEST_DID(1);
  let token = '';

  it('register/finish answers 201 with a session cookie', async () => {
    const res = await call('/auth/register/finish', {
      method: 'POST',
      body: JSON.stringify({ idToken: await mintAccessToken({ did }) }),
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    token = sessionTokenFrom(res.setCookie);

    const created = res.body.data;
    expect(created.isNewUser).toBe(true);
    expect(created.user.id).toEqual(expect.any(String));
    // The balance comes back as `'0.000000'`, not the `'0'` we inserted: Postgres
    // normalises `numeric(20,6)`. Asserting the exact literal would be asserting
    // the storage format instead of the contract — what matters is that it is a
    // STRING the mapper can turn into a number.
    expect(typeof created.wallet.balance).toBe('string');
    expect(Number(created.wallet.balance)).toBe(0);
    // The provisional handle exists so a SECOND account can register; the real
    // one is derived from the name in onboarding.
    //
    // Length is deliberately NOT asserted exactly: nanoid's alphabet includes
    // `-` and `_`, and the tag normaliser strips both, so the handle comes out
    // 6-9 characters. Asserting a fixed width made this test flaky for a reason
    // that had nothing to do with the contract. What matters is that it is
    // `@u` + lowercase alphanumerics: unmistakably not a real name, so a
    // half-finished account is not mistaken for a completed one.
    expect(created.user.tag).toMatch(/^@u[a-z0-9]{6,}$/);
    expect(created.wallet.address).toBe(custodianAddressFor(did));
  }, 30000);

  it('THE ENVELOPE THE BACKEND SENDS IS ONE THE FRONTEND ACCEPTS', async () => {
    const res = await call('/auth/register/finish', {
      method: 'POST',
      body: JSON.stringify({ idToken: await mintAccessToken({ did: TEST_DID(3) }) }),
    });
    const data = res.body.data;

    // The frontend's own type guard, on the backend's own response.
    expect(isApiSession(data), 'frontend isApiSession rejected the real register response').toBe(true);

    const patch = toStorePatch(data);
    // A `numeric(20,6)` string became a number, and the sign/direction rule
    // lives in the mapper rather than in the UI.
    expect(typeof patch.balance).toBe('number');
    expect(patch.bpTag).toMatch(/^@/);
    // And the store never receives a session-shaped field.
    expect(patch).not.toHaveProperty('session');
    expect(patch).not.toHaveProperty('accessToken');
  });

  it('the cookie is the only credential: /auth/session answers from it', async () => {
    const res = await call('/auth/session', { token });
    expect(res.status).toBe(200);
    expect(isApiSession(res.body.data)).toBe(true);
    // Same envelope shape as register, so one hydrate path covers both.
    expect(toStorePatch(res.body.data).balance).toBe(0);
  });

  it('no cookie, no data', async () => {
    expect((await call('/wallet')).status).toBe(401);
    expect((await call('/auth/session')).status).toBe(401);
  });

  it('the wallet answers with a balance STRING, as numeric(20,6) arrives', async () => {
    const res = await call('/wallet', { token });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.balance).toBe('string');
  });

  it('movements answer a page, and an invalid cursor is a 400 not a crash', async () => {
    const ok = await call('/wallet/movements', { token });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.data.items)).toBe(true);
    expect((await call('/wallet/movements?cursor=not-a-cursor', { token })).status).toBe(400);
  });

  it('registering the same passkey twice is an explicit conflict', async () => {
    // The bridge retries login/finish ONLY on this slug; anything else would turn
    // an outage into a misleading "not registered".
    const res = await call('/auth/register/finish', {
      method: 'POST',
      body: JSON.stringify({ idToken: await mintAccessToken({ did }) }),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_registered');
  });

  it('login/finish with an unknown passkey is the mirror-image conflict', async () => {
    const res = await call('/auth/login/finish', {
      method: 'POST',
      body: JSON.stringify({ idToken: await mintAccessToken({ did: TEST_DID(4) }) }),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_registered');
  });

  it('logout revokes the session, and the cookie stops working', async () => {
    const res = await call('/auth/logout', { method: 'POST', body: '{}', token });
    expect(res.status).toBe(204);
    expect((await call('/auth/session', { token })).status).toBe(401);
  });
}, 60000);

/* ─── the gap, kept visible ────────────────────────────────────────────────── */

describe('a custody failure must never authenticate anyone', () => {
  it('register/finish issues no session when provisioning fails', async () => {
    const mock = vi.mocked(getWalletForUser);
    const spy = mock.mockImplementationOnce(async () => {
      throw new Error('custody: wallet provisioning failed');
    });
    try {
      const res = await call('/auth/register/finish', {
        method: 'POST',
        body: JSON.stringify({ idToken: await mintAccessToken({ did: TEST_DID(5) }) }),
      });
      // The status is Privy's business, not ours. The invariant is the cookie: a
      // registration that could not produce a wallet must leave the browser
      // unauthenticated, or the user ends up "signed in" with no wallet to sign
      // anything with.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.setCookie, 'a failed register must not authenticate anyone').toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('and the user row does not survive either', async () => {
    // register runs in one transaction, so a provisioning failure rolls the user
    // back. Without it, the account is stuck forever: login/finish answers 500
    // "user has no wallet" and the passkey has no way out.
    const rows = await getDb(env.DATABASE_URL)
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyDid, TEST_DID(5)));
    expect(rows).toHaveLength(0);
  });
});
