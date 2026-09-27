import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getEnv } from '@bestpath/config';
import { loadEnvFiles } from '../../src/lib/dotenv';
import { testEnv } from '../helpers/testDb';
import { createApp } from '../../src/app';
import { generateToken, hashToken } from '../../src/lib/crypto';
import { movements, sessions, users, wallets } from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/lib/session';

/**
 * GET /wallet and GET /wallet/movements against a real database.
 *
 * Unlike the smoke test, these routes no longer answer from a stub, so a green
 * run means the query, the cursor and the wallet scope actually work.
 *
 * The fixture is built and torn down here instead of relying on the seed: the
 * seed is optional state a developer may or may not have applied, and a test
 * that depends on it fails for reasons that have nothing to do with the code
 * under test. Every row is namespaced with a random suffix because `users` has
 * three UNIQUE columns and other test files may run in parallel.
 */

loadEnvFiles(import.meta.url);

const env = testEnv();
const app = createApp(env);

/** Short random tag so a concurrent run can never collide on the UNIQUE columns. */
const SUFFIX = randomUUID().slice(0, 8);

const SEEDED_BALANCE = '1234.567890';

const userId = randomUUID();
const walletId = randomUUID();
const address = `0x${randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40)}`;

let token = '';
/** Newest-first list of the movements seeded for the authenticated wallet. */
let seededIds: string[] = [];

interface WalletEnvelope {
  ok: boolean;
  data: {
    id: string;
    address: string;
    balance: string;
    currency: string;
    firstFundsAt: string | null;
    yieldStartedAt: string | null;
  };
}

interface MovementItem {
  id: string;
  type: string;
  amount: string;
  title: string;
  status: string;
  createdAt: string;
  meta: Record<string, unknown>;
}

interface MovementsEnvelope {
  ok: boolean;
  data: { items: MovementItem[]; cursor: string | null };
}

const auth = (t: string) => ({ headers: { cookie: `${SESSION_COOKIE}=${t}` } });

beforeAll(async () => {
  const { getDb } = await import('../../src/db/client');
  const database = getDb(env.DATABASE_URL);

  await database.insert(users).values({
    id: userId,
    privyDid: `did:privy:test-wallet-${SUFFIX}`,
    name: 'Test Wallet',
    firstName: 'Test',
    lastName: 'Wallet',
    tag: `@test-wallet-${SUFFIX}`,
    tagNormalized: `test-wallet-${SUFFIX}`.toLowerCase(),
  });

  await database.insert(wallets).values({
    id: walletId,
    userId,
    address,
    balance: SEEDED_BALANCE,
    // firstFundsAt deliberately left null: a wallet that has never been funded
    // must not claim otherwise.
  });

  token = generateToken();
  await database.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  // Mixed types, distinct createdAt: the `send` row is the one that would
  // render as a deposit if the sign were applied on the wrong side.
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  const seeded = await database
    .insert(movements)
    .values([
      {
        walletId,
        type: 'deposit',
        amount: '1000.000000',
        title: 'Depósito inicial',
        status: 'completed',
        meta: { txHash: '0xdeposit' },
        createdAt: new Date(base),
      },
      {
        walletId,
        type: 'send',
        amount: '120.500000',
        title: 'Envío a Ana',
        status: 'completed',
        meta: { recipient: '@ana' },
        createdAt: new Date(base + 60_000),
      },
      {
        walletId,
        type: 'yield',
        amount: '3.250000',
        title: 'Rendimiento diario',
        status: 'pending',
        meta: {},
        createdAt: new Date(base + 120_000),
      },
      {
        walletId,
        type: 'receive',
        amount: '42.000000',
        title: 'Recibido de Bruno',
        status: 'completed',
        createdAt: new Date(base + 180_000),
      },
      {
        walletId,
        type: 'deposit',
        amount: '9.999999',
        title: 'Depósito menor',
        status: 'failed',
        createdAt: new Date(base + 240_000),
      },
    ])
    .returning({ id: movements.id, createdAt: movements.createdAt });
  seededIds = seeded
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => r.id);

  // A second, unrelated wallet with a movement. If the route ever scopes by
  // something the client controls, this row is the leak.
  const otherUserId = randomUUID();
  const otherWalletId = randomUUID();
  await database.insert(users).values({
    id: otherUserId,
    privyDid: `did:privy:test-wallet-other-${SUFFIX}`,
    name: 'Other Wallet',
    firstName: 'Other',
    lastName: 'Wallet',
    tag: `@test-wallet-other-${SUFFIX}`,
    tagNormalized: `test-wallet-other-${SUFFIX}`.toLowerCase(),
  });
  await database.insert(wallets).values({
    id: otherWalletId,
    userId: otherUserId,
    address: `0x${randomUUID().replace(/-/g, '').padEnd(40, '1').slice(0, 40)}`,
    balance: '77.000000',
  });
  await database.insert(movements).values({
    walletId: otherWalletId,
    type: 'deposit',
    amount: '5000.000000',
    title: 'Movimiento ajeno',
    createdAt: new Date(base + 300_000),
  });
});

afterAll(async () => {
  const { getDb } = await import('../../src/db/client');
  const db = getDb(env.DATABASE_URL);

  // Deleting the user cascades to wallet, movements and sessions. Leaving rows
  // behind would make the next run collide on the UNIQUE user columns.
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.privyDid, `did:privy:test-wallet-other-${SUFFIX}`));

  const closable = db as unknown as { $client?: { end: () => Promise<void> } };
  await closable.$client?.end();
});

describe('GET /wallet', () => {
  it('is 401 without a session', async () => {
    const res = await app.request('/wallet');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string; code: number };
    expect(body).toMatchObject({ ok: false, error: 'unauthorized', code: 401 });
  });

  it('is 401 and clears the cookie when the token resolves to nothing', async () => {
    const res = await app.request('/wallet', auth('not-a-real-session-token'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string; code: number };
    expect(body).toMatchObject({ ok: false, error: 'unauthorized', code: 401 });
    // A dead cookie is deleted, otherwise the browser keeps replaying it.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('serves the wallet envelope straight off the session actor', async () => {
    const res = await app.request('/wallet', auth(token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as WalletEnvelope;

    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(walletId);
    expect(body.data.address).toBe(address);
    expect(body.data.currency).toBe('USD');
    // A string, exactly as stored. A number here would mean something parsed
    // money through a float on its way out.
    expect(typeof body.data.balance).toBe('string');
    expect(body.data.balance).toBe(SEEDED_BALANCE);
    expect(body.data.firstFundsAt).toBeNull();
    expect(body.data.yieldStartedAt).toBeNull();
  });
});

describe('GET /wallet/movements', () => {
  it('is 401 without a session', async () => {
    const res = await app.request('/wallet/movements');
    expect(res.status).toBe(401);
  });

  it('returns the movements newest first, every amount positive', async () => {
    const res = await app.request('/wallet/movements', auth(token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as MovementsEnvelope;

    expect(body.ok).toBe(true);
    expect(body.data.items.map((i) => i.id)).toEqual(seededIds);
    expect(body.data.cursor).toBeNull();

    const send = body.data.items.find((i) => i.type === 'send');
    expect(send).toBeDefined();
    // The direction lives in `type`; the amount is always a positive string and
    // the frontend mapper owns the sign.
    expect(typeof send?.amount).toBe('string');
    expect(Number(send?.amount)).toBeGreaterThan(0);
    expect(send?.amount).toBe('120.500000');

    for (const item of body.data.items) {
      expect(Number(item.amount)).toBeGreaterThan(0);
      expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
      expect(typeof item.meta).toBe('object');
    }

    const deposit = body.data.items.find((i) => i.title === 'Depósito inicial');
    expect(deposit?.meta).toMatchObject({ txHash: '0xdeposit' });
    // An explicit empty object in the DB comes back as an object too, never as
    // null/undefined — the frontend mapper defaults it either way.
    const failed = body.data.items.find((i) => i.status === 'failed');
    expect(failed?.meta).toEqual({});
  });

  it('walks every page through the cursor with no gaps and no repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await app.request(`/wallet/movements${query}`, auth(token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as MovementsEnvelope;
      seen.push(...body.data.items.map((i) => i.id));
      cursor = body.data.cursor;
      pages += 1;
      // 5 rows at 2 per page: 3 pages. A cursor that never ends would loop.
      expect(pages).toBeLessThan(10);
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(seen).toEqual(seededIds);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('rejects a malformed cursor', async () => {
    const res = await app.request('/wallet/movements?cursor=not-a-cursor', auth(token));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; code: number };
    expect(body).toMatchObject({ ok: false, error: 'invalid_cursor', code: 400 });
  });

  it.each(['limit=0', 'limit=500', 'limit=abc'])('rejects %s', async (query) => {
    const res = await app.request(`/wallet/movements?${query}`, auth(token));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; code: number };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('validation_failed');
  });

  it('never leaks a movement from another wallet', async () => {
    const res = await app.request('/wallet/movements?limit=50', auth(token));
    const body = (await res.json()) as MovementsEnvelope;
    const titles = body.data.items.map((i) => i.title);
    expect(titles).not.toContain('Movimiento ajeno');
    // The other wallet's row is newer than all of ours, so a scope bug would
    // put it at the very top of the page rather than somewhere in the middle.
    expect(body.data.items[0]?.title).not.toBe('Movimiento ajeno');
  });
});
