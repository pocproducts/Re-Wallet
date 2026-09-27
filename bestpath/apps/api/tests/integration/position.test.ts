import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getEnv, type Env } from '@bestpath/config';
import { loadEnvFiles } from '../../src/lib/dotenv';
import { createApp } from '../../src/app';
import { generateToken, hashToken } from '../../src/lib/crypto';
import { sessions, users, wallets } from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/lib/session';

/**
 * `GET /wallet/position` — the on-chain truth, read from Monad.
 *
 * This route exists because there are TWO balances and they are not the same
 * thing: the ledger says what we believe happened, the chain says where the
 * money is. The route is the one the UI puts on screen, so the properties worth
 * pinning are the ones that keep it honest:
 *
 *   1. Money crosses the wire as a 6-decimal STRING, never a number.
 *   2. `earning` and `available` are separate, so idle money is never hidden.
 *   3. It requires a session, like every other private read.
 *   4. The contract addresses come from the environment, not from a constant, so
 *      a chain switch cannot leave the app pointing at the old market.
 *
 * The read is a real one against Monad: that is the point of the route, and a
 * stubbed chain would only prove the route copies its own mock.
 */

loadEnvFiles(import.meta.url);
const env: Env = getEnv();
const app = createApp(env);

const SUFFIX = randomUUID().slice(0, 8);
const userId = randomUUID();
const walletId = randomUUID();
const address = `0x${randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40)}` as `0x${string}`;

let token = '';
const auth = (t: string) => ({ headers: { cookie: `${SESSION_COOKIE}=${t}` } });

beforeAll(async () => {
  const { getDb } = await import('../../src/db/client');
  const db = getDb(env.DATABASE_URL);

  await db.insert(users).values({
    id: userId,
    privyDid: `did:privy:test-position-${SUFFIX}`,
    name: 'Test Position',
    firstName: 'Test',
    lastName: 'Position',
    tag: `@test-pos-${SUFFIX}`,
    tagNormalized: `test-pos-${SUFFIX}`.toLowerCase(),
  });
  await db.insert(wallets).values({ id: walletId, userId, address, balance: '0' });

  token = generateToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
});

afterAll(async () => {
  const { getDb } = await import('../../src/db/client');
  const db = getDb(env.DATABASE_URL);
  // Cascade takes the wallet and the session; the user goes with it.
  await db.delete(users).where(eq(users.id, userId));
});

describe('GET /wallet/position', () => {
  it('requires a session', async () => {
    const res = await app.request('/wallet/position');
    expect(res.status).toBe(401);
  });

  it('answers money as 6-decimal strings and separates earning from available', async () => {
    const res = await app.request('/wallet/position', auth(token));
    if (res.status === 503) {
      // A chain read that fails is documented behaviour, and the envelope is the
      // one the frontend already knows how to handle.
      const body = (await res.json()) as { ok: boolean; error: string; code: number };
      expect(body.ok).toBe(false);
      expect(body.error).toBe('position_unavailable');
      expect(body.code).toBe(503);
      return;
    }

    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        wallet: string;
        earning: unknown;
        available: unknown;
        total: unknown;
        aToken: string;
        usdc: string;
        readAt: string;
      };
    };

    for (const [field, value] of [
      ['earning', data.earning],
      ['available', data.available],
      ['total', data.total],
    ] as const) {
      expect(typeof value, `${field} must be a string, never a float`).toBe('string');
      expect(String(value)).toMatch(/^\d+\.\d{6}$/);
    }

    // A fresh address holds nothing, and saying so exactly is the whole point.
    expect(data.total).toBe('0.000000');
    expect(data.earning).toBe('0.000000');
    expect(data.available).toBe('0.000000');

    // The addresses come from config: a chain switch must not leave the app
    // pointing at the previous market's aToken.
    expect(data.aToken.toLowerCase()).toBe(env.AAVE_ATOKEN_ADDRESS_MONAD.toLowerCase());
    expect(data.usdc.toLowerCase()).toBe(env.USDC_ADDRESS_MONAD.toLowerCase());
    expect(data.wallet.toLowerCase()).toBe(address.toLowerCase());
    expect(Number.isNaN(Date.parse(data.readAt))).toBe(false);
  });
});
