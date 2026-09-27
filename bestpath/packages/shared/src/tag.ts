/**
 * Tag sanitisation — the pure part, shared by the client and the server.
 *
 * Lives here so the recommended tag the UI shows and the tag the server
 * allocates can never drift apart. A client that guessed a different rule would
 * show "@ana" and hand the user "anna".
 *
 * The server remains the only authority on availability and uniqueness: this
 * module says what a handle LOOKS like, never whether it is free.
 */

export const FALLBACK_BASE = 'user';
export const TAG_MAX_LENGTH = 24;

/** How many suffixes to try before falling back to `user{seq}`. */
export const MAX_SUFFIX_ATTEMPTS = 100;

/**
 * Reduce a display name to a safe handle base.
 *
 *   "Ana María"  -> "anamaria"
 *   "José Ñoño"  -> "jono"      (NFD strips the accents)
 *   "  ---  "    -> "user"      (fallback when nothing survives)
 */
export function sanitizeTagBase(input: string): string {
  const normalized = String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  return (normalized.length > 0 ? normalized : FALLBACK_BASE).slice(0, TAG_MAX_LENGTH);
}

/** Strip a leading @ so a user-typed tag normalises the same way. */
export function normalizeTag(tag: string): string {
  return sanitizeTagBase(String(tag ?? '').replace(/^@+/, ''));
}

export function toDisplayTag(normalized: string): string {
  return `@${normalized}`;
}

/** The recommended handle for a first name: sanitised, truncated. */
export function suggestTag(firstName: string): string {
  return normalizeTag(firstName);
}

/** Candidate handles for a name, in priority order: ana, ana2, ana3, ... */
export function candidateTags(base: string): string[] {
  const clean = normalizeTag(base);
  const out = [clean];
  for (let n = 2; n <= MAX_SUFFIX_ATTEMPTS; n += 1) out.push(`${clean}${n}`.slice(0, TAG_MAX_LENGTH));
  return out;
}

/** Shape a user-typed tag for display, or '' when it is unusable. */
export function formatTagInput(value: string): string {
  const clean = normalizeTag(value);
  return clean;
}

export function isValidTag(tag: string): boolean {
  const clean = normalizeTag(tag);
  return clean.length >= 3 && clean.length <= TAG_MAX_LENGTH;
}
