/**
 * The HTTP surface of `/api/auth/session`, exercised with injected ports only:
 * no network, no database, no Privy.
 */
import { describe, expect, it } from 'vitest';

import type { MintSession } from '../../src/application/session/mintSession';
import { IdentityUnavailable } from '../../src/application/session/mintSession';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { DID, recordingLogger, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');

const BODY = { accessToken: 'a.b.c' };

const happyMint = (): MintSession => async () => ({
  token: 'rw1.super.secret',
  expiresAt: EXPIRY,
  userId: USER_ID,
  privyDid: DID,
});

const rejectingMint = (): MintSession => async () => {
  throw new Error('Privy token rejected: signature');
};

/** Authenticated, but the provider could not name the person. */
const unnameableMint = (): MintSession => async () => {
  throw new IdentityUnavailable('user has no linked email account');
};

/** A codec that accepts exactly the token the happy mint produces. */
const acceptingCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
  read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: DID } : null),
});

const app = (mint: MintSession, sessions: SessionCodec) =>
  createApp({ mint, sessions, now: () => new Date('2025-01-01T00:00:00Z'), log: recordingLogger() });

const setCookieOf = (response: Response): string => response.headers.get('set-cookie') ?? '';

describe('POST /api/auth/session', () => {
  it('sets an HttpOnly __Host- cookie and returns an EMPTY body', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(204);

    const cookie = setCookieOf(response);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=rw1.super.secret`);
    expect(SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');

    // The body carries nothing: no token for page JavaScript to read.
    expect(await response.text()).toBe('');
  });

  it('rejects a bad token with a clean error and no cookie', async () => {
    const log = recordingLogger();
    const response = await createApp({ mint: rejectingMint(), sessions: acceptingCodec(), log }).request(
      '/api/auth/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(BODY),
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(setCookieOf(response)).toBe('');
    // The reason goes to the log, never to the person.
    expect(log.lines).toContain('error:POST /auth/session rejected');
  });

  // ── Fails closed, loudly ─────────────────────────────────────────────────────

  it('answers 502 when the identity cannot be resolved, with no cookie', async () => {
    const log = recordingLogger();
    const response = await createApp({ mint: unnameableMint(), sessions: acceptingCodec(), log }).request(
      '/api/auth/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(BODY),
      },
    );

    // Not 401: the person is authenticated, retrying will not help.
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'IDENTITY_UNAVAILABLE' } });
    expect(setCookieOf(response)).toBe('');
    expect(log.lines).toContain('error:POST /auth/session could not resolve an identity');
  });

  it('rejects a body without an accessToken', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(setCookieOf(response)).toBe('');
  });

  it('accepts a body carrying only the access token, and ignores extras', async () => {
    // The frontend SDK exposes no id token, so the contract asks for exactly the one
    // thing it can produce. A body that still carries the old field is not rejected:
    // unknown fields are ignored, and what matters is that a valid access token logs
    // the person in.
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BODY, idToken: 'id.a.b' }),
    });

    expect(response.status).toBe(204);
    expect(setCookieOf(response)).toContain(`${SESSION_COOKIE_NAME}=rw1.super.secret`);
  });

  it('mints from the access token alone, never from a second token', async () => {
    const seen: unknown[][] = [];
    const mint: MintSession = async (...args: unknown[]) => {
      seen.push(args);
      return { token: 'rw1.super.secret', expiresAt: EXPIRY, userId: USER_ID, privyDid: DID };
    };

    const response = await app(mint, acceptingCodec()).request('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(204);
    // (accessToken, now) — the clock, and nothing token-shaped after the access token.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe('a.b.c');
    expect(seen[0]?.[1]).toBeInstanceOf(Date);
    expect(seen[0]).toHaveLength(2);
  });
});

describe('GET /api/auth/session', () => {
  it('is 401 without a cookie', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('is 401 with a malformed cookie', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-session-token` },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('is 401 with an EMPTY cookie value', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=` },
    });

    expect(response.status).toBe(401);
  });

  it('is 200 with a minimal payload when the cookie is valid', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=rw1.super.secret` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true });
  });
});

describe('DELETE /api/auth/session', () => {
  it('clears the cookie with the same attributes that set it', async () => {
    const response = await app(happyMint(), acceptingCodec()).request('/api/auth/session', { method: 'DELETE' });

    expect(response.status).toBe(204);

    const cookie = setCookieOf(response);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });
});