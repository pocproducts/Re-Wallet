import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Session tokens: 32 random bytes, URL-safe base64. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

/** Only the hash is stored, so a DB leak does not yield usable session tokens. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Constant-time comparison for webhook signatures. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 over the raw request body, hex encoded. */
export function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
