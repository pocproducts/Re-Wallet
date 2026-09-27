/**
 * Tag allocation — the server side.
 *
 * The sanitisation rules live in @bestpath/shared so the recommended tag the UI
 * shows and the tag allocated here can never drift apart. What stays here is
 * the part that needs a database: knowing whether a candidate is free.
 */

import { nanoid } from 'nanoid';
import {
  MAX_SUFFIX_ATTEMPTS,
  FALLBACK_BASE,
  candidateTags,
  normalizeTag,
  sanitizeTagBase,
  suggestTag,
  toDisplayTag,
  isValidTag,
} from '@bestpath/shared/tag';

export { sanitizeTagBase, normalizeTag, toDisplayTag, candidateTags, suggestTag, isValidTag };

export interface TagAllocator {
  /** True when the normalised handle is already taken. */
  isTaken: (normalized: string) => Promise<boolean>;
  /** The user's stable sequence, used for the last-resort fallback. */
  userSeq: number;
}

/**
 * A handle for a user who does not have a NAME yet.
 *
 * Register used to hardcode `@rewallet` for everybody, which means the second
 * account created in a fresh database dies on `users_tag_unique` — a raw 500, not
 * a conflict. Found by the auth E2E test, not by reading the code.
 *
 * Why random instead of `allocateTag`: at register time there is no name to
 * derive a handle from, and an allocation query would be a check-then-insert race
 * against another registration doing the same. Randomness sidesteps the race, and
 * it is safe BECAUSE this handle is provisional: onboarding replaces it with the
 * name-derived one through `PATCH /me/profile`, which is where the real product
 * rule ("your handle comes from your name") already lives.
 *
 * `u` + 8 chars keeps it short and obviously not a real name, so a half-finished
 * account is not mistaken for a completed one.
 */
export function provisionalTag(): string {
  // The length VARIES (6-9 chars) and that is not a bug: nanoid's alphabet
  // includes `-` and `_`, and `normalizeTag` strips both. Worth knowing before
  // anyone writes a test that asserts a fixed width.
  return normalizeTag(`u${nanoid(8).toLowerCase()}`);
}

/**
 * Pick a free handle.
 *
 * Sequential rather than random on purpose: for a given name and a given set of
 * taken handles, the result is deterministic. That makes it testable and it makes
 * a user retry after a conflict land on the same handle rather than a random one.
 */
export async function allocateTag(firstName: string, alloc: TagAllocator): Promise<string> {
  const candidates = candidateTags(firstName);
  for (const candidate of candidates) {
    if (!(await alloc.isTaken(candidate))) return candidate;
  }
  // Exhausted the suffix space for this name. Fall back to the sequence, which
  // is unique by construction.
  return `${FALLBACK_BASE}${alloc.userSeq}`;
}
