/**
 * The session cookie.
 *
 * ── Why `HttpOnly` and `Secure` with no exception ──────────────────────────────
 *
 * `HttpOnly` is the reason the token cannot be read by JavaScript: without it, one
 * XSS steals the session in a single line. `Secure` is the same idea for the wire.
 * Neither is a default that can be lowered in development: lowering it is a
 * decision, and decisions are taken once.
 *
 * ── Why `SameSite=Lax` ────────────────────────────────────────────────────────
 *
 * `Strict` would break coming back from an external link — the "open a payment
 * request" case, which is central to this product. `Lax` sends the cookie on
 * top-level navigations, which is what is needed, and not on third-party
 * requests, which is what must be prevented.
 *
 * ── Why the name carries the `__Host-` prefix ─────────────────────────────────
 *
 * `__Host-` forces `Secure`, no `Domain`, and `Path=/`. The **browser** rejects
 * the cookie otherwise. With the prefix nobody has to trust that the code got it
 * right every time: a refactor that writes `Domain: '.example.com'` makes the
 * cookie stop being stored — a loud, immediate failure instead of a silent
 * security hole.
 */
export const SESSION_COOKIE_NAME = '__Host-rewallet_poc_session';

/** A cookie that deletes the session must carry the same attributes as the one that created it. */
export const buildSessionCookie = (token: string, name: string, maxAgeSeconds: number): string =>
  `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;

/**
 * `Max-Age=0` is what makes the browser drop it. The attributes are identical to
 * the ones that set it: a delete cookie with different attributes does not delete
 * the original, and the symptom is a session that "logged out" and stays alive.
 */
export const clearSessionCookie = (name: string = SESSION_COOKIE_NAME): string =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Reads the cookie out of the `Cookie` header. `null` if absent or empty. */
export const readSessionCookie = (header: string | undefined, name: string): string | null => {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }

  return null;
};