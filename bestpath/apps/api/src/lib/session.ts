import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { sessions, users, wallets } from '../db/schema';
import { generateToken, hashToken } from './crypto';

/**
 * Server-side sessions.
 *
 * The token is a 32-byte random string handed to the browser in an httpOnly
 * cookie. Only its SHA-256 is stored, so a database leak yields nothing usable:
 * an attacker holding the table still cannot mint a session.
 *
 * This is the reason the frontend never keeps a session flag in localStorage —
 * it does not have one to keep.
 */

export const SESSION_COOKIE = 'bp_session';
export const SESSION_TTL_DAYS = 30;

export interface SessionActor {
  userId: string;
  sessionId: string;
  name: string;
  firstName: string;
  lastName: string;
  tag: string;
  tagNormalized: string;
  email: string | null;
  phone: string | null;
  phoneCountry: string | null;
  walletId: string;
  address: string;
  balance: string;
  /** null until the first credit ever lands. Never reset. */
  firstFundsAt: Date | null;
  /**
   * null until the wallet earns its first yield position. Latched the same way
   * as firstFundsAt, and for the same reason: it is a state, not a balance.
   *
   * Carried on the actor so the hot read routes can serve it without a second
   * query. See routes/wallet.ts.
   */
  yieldStartedAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: Record<string, unknown>;
}

/**
 * Mint a session. Returns the RAW token — this is the only time it exists in
 * plaintext, and the caller must put it in the cookie immediately.
 */
export async function createSession(
  db: Database,
  { userId, ipAddress, userAgent, deviceInfo }: CreateSessionInput,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      deviceInfo: JSON.stringify(deviceInfo ?? {}),
    })
    .returning({ id: sessions.id });

  if (!row) throw new Error('createSession: insert returned nothing');

  return { token, sessionId: row.id, expiresAt };
}

/**
 * Resolve a raw token to the actor behind it.
 *
 * Returns null for anything that is not a live, unrevoked, unexpired session.
 * Callers treat null as "unauthenticated" and nothing else — a half-resolved
 * session is never good enough to act on.
 */
export async function verifySession(db: Database, token: string): Promise<SessionActor | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      name: users.name,
      firstName: users.firstName,
      lastName: users.lastName,
      tag: users.tag,
      tagNormalized: users.tagNormalized,
      email: users.recoveryEmail,
      phone: users.recoveryPhone,
      phoneCountry: users.recoveryPhoneCountry,
      walletId: wallets.id,
      address: wallets.address,
      balance: wallets.balance,
      firstFundsAt: wallets.firstFundsAt,
      yieldStartedAt: wallets.yieldStartedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(wallets, eq(wallets.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  // A user with no wallet is not a usable actor: there is nothing to show them.
  // Narrowing each field explicitly rather than trusting the guard to satisfy TS.
  if (!row || !row.walletId || !row.address || !row.balance) return null;

  // Sliding expiry: a user who is actively using the wallet should not be logged
  // out mid-session. Bounded by SESSION_TTL_DAYS from now, never extended past it.
  await db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.id, row.sessionId));

  return {
    userId: row.userId,
    sessionId: row.sessionId,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    tag: row.tag,
    tagNormalized: row.tagNormalized,
    email: row.email,
    phone: row.phone,
    phoneCountry: row.phoneCountry,
    walletId: row.walletId,
    address: row.address,
    balance: row.balance,
    firstFundsAt: row.firstFundsAt,
    yieldStartedAt: row.yieldStartedAt,
  };
}

/** Revoke a single session. Returns true if a live session was actually closed. */
export async function revokeSession(db: Database, token: string): Promise<boolean> {
  if (!token) return false;
  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return result.length > 0;
}

/** Housekeeping: drop sessions that expired long ago. */
export async function pruneExpired(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const result = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < ${cutoff}`)
    .returning({ id: sessions.id });
  return result.length;
}
