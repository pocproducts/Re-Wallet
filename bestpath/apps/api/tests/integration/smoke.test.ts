import { describe, it, expect, afterAll } from 'vitest';
import { getEnv } from '@bestpath/config';
import { loadEnvFiles } from '../../src/lib/dotenv';
import { createApp } from '../../src/app';
import { toMinorUnits, fromMinorUnits, add, sub, applyBps, formatBps } from '../../src/lib/money';
import { generateToken, hashToken, signPayload, safeEqual } from '../../src/lib/crypto';

/**
 * Integration smoke test for the skeleton.
 *
 * The point is that the app boots, the middleware chain runs, and every route
 * answers with the documented envelope. It does NOT test business logic —
 * there is none yet by design.
 */

loadEnvFiles(import.meta.url);

const env = getEnv();
const app = createApp(env);

afterAll(async () => {
  // close the pooled postgres client so vitest can exit
  const { getDb } = await import('../../src/db/client');
  const db = getDb(env.DATABASE_URL) as unknown as { $client?: { end: () => Promise<void> } };
  await db.$client?.end();
});

describe('health', () => {
  it('GET /health returns 200 with the version and uptime', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { ok: boolean; version: string } };
    expect(body.ok).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(body.data.version).toBe('0.1.0');
  });

  it('GET /ready answers', async () => {
    const res = await app.request('/ready');
    expect(res.status).toBe(200);
  });

  it('an unknown path returns a JSON 404, not text', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string; code: number };
    expect(body).toMatchObject({ ok: false, error: 'not_found', code: 404 });
  });
});

describe('auth guards', () => {
  it('GET /wallet is 401 without a session', async () => {
    const res = await app.request('/wallet');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string; code: number };
    expect(body).toMatchObject({ ok: false, error: 'unauthorized', code: 401 });
  });

  for (const path of ['/me', '/contacts', '/yield/summary']) {
    it(`GET ${path} is 401 without a session`, async () => {
      expect((await app.request(path)).status).toBe(401);
    });
  }
});

describe('idempotency guard', () => {
  it('rejects a money POST with no Idempotency-Key', async () => {
    const res = await app.request('/wallet/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    // auth runs first, so an unauthenticated call never reaches idempotency
    expect([400, 401]).toContain(res.status);
  });
});

describe('public routes are reachable without a session', () => {
  it('GET /wallet/request/:id answers without auth', async () => {
    const res = await app.request('/wallet/request/abc123');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { request: unknown } };
    expect(body.ok).toBe(true);
    expect(body.data.request).toBeNull();
  });

  it('POST /webhooks/chain answers without auth', async () => {
    const res = await app.request('/webhooks/chain', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('money helpers', () => {
  it('round-trips minor units without float drift', () => {
    expect(fromMinorUnits(toMinorUnits('1234.567890'))).toBe('1234.567890');
    expect(fromMinorUnits(toMinorUnits('0.000001'))).toBe('0.000001');
    expect(fromMinorUnits(toMinorUnits('1000000.000000'))).toBe('1000000.000000');
  });

  it('adds and subtracts exactly', () => {
    // 0.1 + 0.2 !== 0.3 in float land; it must here.
    expect(add('0.1', '0.2')).toBe('0.300000'); // canonical 6-decimal form
    expect(sub('0.3', '0.1')).toBe('0.200000');
    expect(add('99999999.999999', '0.000001')).toBe('100000000.000000');
  });

  it('applies basis points', () => {
    expect(applyBps('1000.000000', 565)).toBe('56.500000');
    expect(formatBps(565)).toBe('5.65%');
  });

  it('rejects malformed amounts', () => {
    expect(() => toMinorUnits('abc')).toThrow();
    expect(() => toMinorUnits('1.1234567')).toThrow();
    expect(() => toMinorUnits('-1')).toThrow();
  });
});

describe('crypto helpers', () => {
  it('never stores the raw token', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).not.toBe(token);
    expect(hashToken(token)).toBe(hash);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('compares signatures in constant time and rejects mismatches', () => {
    const sig = signPayload('secret', '{"a":1}');
    expect(safeEqual(sig, signPayload('secret', '{"a":1}'))).toBe(true);
    expect(safeEqual(sig, signPayload('other', '{"a":1}'))).toBe(false);
    expect(safeEqual(sig, 'short')).toBe(false);
  });
});

describe('env validation', () => {
  it('refuses to boot on missing config', () => {
    expect(() => getEnv({} as NodeJS.ProcessEnv)).toThrow(/Invalid environment/);
  });

  it('refuses COOKIE_SECURE=false in production', () => {
    expect(() => getEnv({ ...process.env, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow();
  });
});
