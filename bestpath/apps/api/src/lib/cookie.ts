import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './session';
import type { Env } from '@bestpath/config';

/**
 * Session cookie handling.
 *
 * httpOnly so the frontend cannot read it — the browser's own script has no
 * access, which is the point. SameSite=Lax so it survives normal navigation but
 * not cross-site posts. Secure in production, and never omitted there.
 */

const base = (env: Env) => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  path: '/',
  secure: env.COOKIE_SECURE,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

export const readSession = (c: Context): string => getCookie(c, SESSION_COOKIE) ?? '';

export function writeSession(c: Context, token: string, env: Env): void {
  setCookie(c, SESSION_COOKIE, token, {
    ...base(env),
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export function clearSession(c: Context, env: Env): void {
  deleteCookie(c, SESSION_COOKIE, base(env));
}
