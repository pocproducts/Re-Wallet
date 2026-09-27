/**
 * The onboarding profile, on the wire.
 *
 * ── What this file is for ───────────────────────────────────────────────────
 *
 * The onboarding screen collected a name, an email, a phone and a tag, and then
 * wrote all four into the local store and called it done. Nothing was sent. The
 * database kept `name = 'ReWallet'`, an empty `first_name`, and the provisional
 * `@u…` tag, while the phone showed a real name and a real handle that existed
 * nowhere but its own `localStorage`.
 *
 * That is not a cosmetic bug. A tag is a public identity: the one a payer types,
 * the one the uniqueness constraint protects. Deriving it on the client and
 * hoping is exactly what the backend's `PATCH /me/profile` exists to prevent, and
 * it is the only place that knows whether `@ana` was already taken.
 *
 * So the flow becomes: send it, take the user's answer, and paint THAT. Not the
 * local guess — the returned row. The tag the screen ends up showing is the one
 * that is in the database, which is the only tag that means anything.
 *
 * ── Two calls, and why not one ──────────────────────────────────────────────
 *
 * The name and the recovery contacts are different concerns on the server: the
 * name allocates a unique tag, the recovery fields must not be able to touch it.
 * `PATCH /me/profile` derives the tag; `PATCH /me/recovery` refuses a body with
 * nothing in it and never writes a tag. One request would let the recovery step
 * allocate a handle.
 *
 * ── What is NOT latched here ────────────────────────────────────────────────
 *
 * `onboardingComplete` is set by `Flow.completeOnboarding()`, and only the caller
 * sets it, after both calls have succeeded. A half-saved profile is the state
 * this file exists to prevent: a name on the phone that exists nowhere else.
 */

import { requestJson, WalletApiError } from './wallet';
import { toUser, type ApiUser } from './mapper';
import type { AppState } from '../types';

/** What the name step sends. Mirrors `profileBody` in `routes/auth.ts`. */
export interface ProfileNameInput {
  firstName: string;
  lastName: string;
}

/** What the recovery step sends. Every field optional; a body with none is a 400. */
export interface RecoveryInput {
  email?: string;
  phone?: string;
  country?: string;
}

/** `{ user }` — the shape both endpoints answer with. */
interface UserEnvelope {
  user: ApiUser;
}

/**
 * The store fields a user row decides.
 *
 * The tag comes from the RESPONSE, not from what the client derived and sent.
 * The server appends a suffix when the derived handle is taken, so a client that
 * kept its own guess would show a tag that belongs to somebody else — and would
 * be one race away from showing two users on the same handle.
 */
const patchFor = (user: ApiUser): Partial<AppState> => {
  const mapped = toUser(user);
  return {
    userName: mapped.name,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    bpTag: mapped.tag,
    // null is a value the store has no shape for: its fields are strings, and
    // "no recovery email" is the empty string, never the word "null".
    recoveryEmail: user.email ?? '',
    recoveryPhone: user.phone ?? '',
  };
};

const patchUser = async (path: string, body: unknown): Promise<Partial<AppState>> => {
  const { status, envelope } = await requestJson<UserEnvelope>(path, { method: 'PATCH', body });
  if (!envelope.ok) {
    // The `error` slug is what the UI branches on (`validation_failed`,
    // `invalid_tag`, `unauthorized`); the message is for the log, never for the
    // user.
    console.warn('[rewallet] profile: rechazado', path, status, envelope.error, envelope.code);
    throw new WalletApiError('profile write failed', status, envelope.error);
  }
  const user = envelope.data?.user;
  if (!user) {
    // A 200 with no user is the shape the old `/me/recovery` stub answered with.
    // Treating that as success is how the previous version of this flow lost a
    // recovery email without a single error: the client painted its own guess and
    // moved on.
    throw new WalletApiError('the server did not return a user', status, 'no_user_in_response');
  }
  return patchFor(user);
};

/** Save the name. This is the call that allocates the real tag. */
export const saveProfileName = (input: ProfileNameInput): Promise<Partial<AppState>> =>
  patchUser('/me/profile', input);

/** Save the recovery email and phone. */
export const saveRecovery = (input: RecoveryInput): Promise<Partial<AppState>> =>
  patchUser('/me/recovery', input);
