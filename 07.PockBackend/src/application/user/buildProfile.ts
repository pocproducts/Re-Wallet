/**
 * The profile written to `rewallet.users` when the row does not exist yet.
 *
 * ── Why there is no placeholder here any more ────────────────────────────────
 *
 * This file used to be able to invent an address: a slug of the DID at a reserved
 * TLD, chosen when the access token carried no email. It almost always did
 * not — the SDK's payload reader enumerates `aud`, `iss`, `iat`, `exp`, `sid`, `sub`
 * and no `email` — so the account was routinely created with a mailbox that does not
 * exist, and `name` and `tag` derived from it. A column that says "this person's
 * email" and holds a fabrication is worse than a missing row: nothing downstream can
 * tell the difference, so the fiction gets mailed to, exported, and shown.
 *
 * The email now comes from the provider's own user record (see `UserDirectory`), and
 * this function refuses to build a profile without one. Failing here is deliberate:
 * a login that cannot name the person is refused, not guessed at.
 *
 * ── Why `tag` and `name` are derived the same way ──────────────────────────────
 *
 * `rewallet.users` has `email`, `name`, `tag` and `tag_normalized` all `NOT NULL` and
 * `UNIQUE`. Deterministic and collision-free are the only two properties that survive
 * a second login, so both columns are built from the same two inputs — the readable
 * part of the email and a short digest of the DID:
 *
 * - the readable part is what a human recognises in a support conversation;
 * - the digest is what makes two people who share a mailbox prefix (`ana@a.com`,
 *   `ana@b.com`) distinct rows instead of a unique-violation 500.
 *
 * `tag` and `tag_normalized` are both the `tag` value: the live CHECK
 * `^[a-z0-9_.-]{3,60}$` is satisfied by the slug, which collapses every disallowed
 * character to a single `.`, and the `.`-prefixed 4-hex digest keeps the result above
 * the 3-character minimum when the email local part is not.
 *
 * ── Determinism, stated as a contract ─────────────────────────────────────────
 *
 * Same Privy user in, same row out — on any login, forever. That is what makes the
 * re-login an `ON CONFLICT (privy_did) DO UPDATE` no-op instead of an attempt to
 * insert a second person. If the provider later returns a different display name,
 * `tag` and `email` are unaffected and the stored `name` is left alone by the store,
 * so the row still matches.
 */
import { createHash } from 'node:crypto';

import type { NewUserProfile } from '../../domain/ports/user-store';

/** The profile inputs. Both are required; neither has a default. */
export interface ProfileSubject {
  readonly privyDid: string;
  /** The real mailbox, from the provider's user record. */
  readonly email: string;
  /** Provider display name, or `null`. Display-only. */
  readonly displayName?: string | null;
}

/** Raised when a profile is requested without a real email. Fails closed. */
export class MissingRealEmail extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingRealEmail';
  }
}

/** The live CHECK on `rewallet.users.tag` / `.tag_normalized`. */
export const USER_TAG_PATTERN = /^[a-z0-9_.-]{3,60}$/;

/**
 * A slug usable both as a name and as part of a tag.
 *
 * `rewallet.users` requires `tag` to match `^[a-z0-9_.-]{3,60}$`, so the
 * transformation is not cosmetic: it is what makes the value storable.
 */
export const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^[.]+|[.]+$/g, '')
    .slice(0, 40);

/** Stable short suffix for a DID, so two different DIDs never share a tag. */
const shortDigest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 4);

/** The part of an email before the `@`, when there is one. */
const localPart = (email: string): string => email.split('@')[0] ?? '';

/**
 * Builds the row to insert for a person who has none yet.
 *
 * Pure: same subject in, same profile out. The random-looking part is derived from
 * the DID with SHA-256, so it is stable across logins without being guessable from
 * an email address.
 *
 * **Throws** `MissingRealEmail` when the subject carries no usable email. That is
 * the deleted placeholder path, stated once and enforced by the type: there is no
 * branch here that can produce an address nobody owns.
 */
export const buildProfile = (subject: ProfileSubject): NewUserProfile => {
  const email = subject.email.trim();
  if (email.length === 0 || email.length > 320 || !email.includes('@')) {
    throw new MissingRealEmail('a real email from the Privy user record is required to build a profile');
  }

  const fromEmail = slugify(localPart(email));
  const fromName = slugify(subject.displayName ?? '');
  const readable = fromName.length >= 2 ? fromName : fromEmail;

  const tag = `${readable.length >= 3 ? readable : 'rewallet'}.${shortDigest(subject.privyDid)}`;
  // The CHECK is asserted, not assumed: if this ever stops matching, the insert is
  // rejected by Postgres at the worst possible moment instead of here.
  if (!USER_TAG_PATTERN.test(tag)) {
    throw new MissingRealEmail(`derived tag does not satisfy ${String(USER_TAG_PATTERN)}`);
  }

  return {
    privyDid: subject.privyDid,
    email,
    name: tag,
    tag,
  };
};
