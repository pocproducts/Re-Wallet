/**
 * The session envelope, and the rules about it. NO DOM.
 *
 * This file was extracted out of `wire/privy.ts`, which said in its own header
 * that everything below the "pure" banner is a pure function — and then kept the
 * envelope guard, the credential audit and the store projection in the same
 * module as the transport and the Router. Being pure is not a comment; being
 * importable without a browser is.
 *
 * WHY THAT MATTERS IN PRACTICE
 *
 * `wire/privy.ts` imports `core/store` and `core/router`, and those reach
 * `window` at module load. So the frontend's own guard for "is this a valid
 * session envelope" could not be run against a REAL backend response anywhere
 * outside a browser: the API's test suite is node, and importing it there dies
 * with `ReferenceError: window is not defined`.
 *
 * Which is precisely the gap that let both halves stay green while the real
 * login could not work: the API tests built their own fixtures and the frontend
 * tests stubbed `fetch`, and nothing ever handed one side's output to the other
 * side's validator. With this module the API integration test imports the real
 * guard and the real projection and runs the real response through them.
 *
 * The rule that survives the move: this module must never import the Store, the
 * Router, or anything that touches `window`.
 */

import {
  stripSessionOwned,
  toBalance,
  toHasReceivedFunds,
  toUser,
  toYieldStartedAt,
  type ApiSession,
} from './mapper';
import type { AppState } from '../types';

/* ─── stages ────────────────────────────────────────────────────────────────── */

/**
 * Where a failure happened.
 *
 * A closed set on purpose. `stage` is read by vanilla code to decide whether to
 * offer a retry ("token" → send them back to passkey) or to show a dead end
 * ("init" → reload). A free-form string would make that switch silently fall
 * through, and the failure would surface as "nothing happened" — the worst bug
 * shape, because it is invisible until a user hits it.
 */
export const PRIVY_STAGES = ['init', 'login', 'token'] as const;
export type PrivyStage = (typeof PRIVY_STAGES)[number];

const STAGE_SET: ReadonlySet<string> = new Set<string>(PRIVY_STAGES);

export const isPrivyStage = (value: unknown): value is PrivyStage =>
  typeof value === 'string' && STAGE_SET.has(value);

/**
 * Coerce anything into a valid stage. Unknown values become `'init'`: the least
 * specific and least privileged stage, so a malformed payload produces a generic
 * message rather than a misleading specific one.
 */
export const normalizeStage = (value: unknown): PrivyStage =>
  isPrivyStage(value) ? value : 'init';

/* ─── errors ────────────────────────────────────────────────────────────────── */

/**
 * Keys that must never reach the store, whatever the reason.
 *
 * `session` covers the field the store itself declares as backend-owned. The
 * rest cover the SDK/response shapes that would smuggle a credential in through
 * a spread, which is the failure mode an audit catches and a comment does not.
 */
const FORBIDDEN_STORE_KEYS: readonly string[] = [
  'session',
  'idToken',
  'accessToken',
  'refreshToken',
  'token',
  'sessionToken',
  'cookie',
  'privyDid',
];

/** Thrown when a patch would put a credential in the store. Never swallowed. */
export class PrivyBridgeError extends Error {
  readonly stage: PrivyStage;
  /** Set for audit failures only: which key tripped the audit, never its value. */
  readonly offendingKey?: string;
  /**
   * The API's machine-readable `error` slug, e.g. `already_registered`.
   *
   * Carried as data and never rendered: it is what lets the bridge make a
   * routing decision (register → fall back to login) without parsing Spanish
   * copy or a status code.
   */
  readonly reason?: string;

  constructor(stage: PrivyStage, message: string, extra?: { offendingKey?: string; reason?: string }) {
    super(message);
    this.name = 'PrivyBridgeError';
    this.stage = stage;
    this.offendingKey = extra?.offendingKey;
    this.reason = extra?.reason;
  }
}

/**
 * Reject a patch that carries anything session-shaped.
 *
 * Reports the KEY and never the value: this error can reach a log, and a log
 * that says `idToken=eyJhbGci...` has just become a credential store.
 */
export const assertNoCredentials = (patch: Record<string, unknown>): void => {
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_STORE_KEYS.includes(key)) {
      throw new PrivyBridgeError('init', `patch carries a session-owned key: ${key}`, { offendingKey: key });
    }
  }
};

/* ─── the envelope ──────────────────────────────────────────────────────────── */

/** The subset of the register/login response we are willing to trust. */
export const isApiSession = (value: unknown): value is ApiSession => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { user?: unknown; wallet?: unknown };
  if (typeof candidate.user !== 'object' || candidate.user === null) return false;
  if (typeof candidate.wallet !== 'object' || candidate.wallet === null) return false;
  const user = candidate.user as { id?: unknown; name?: unknown; firstName?: unknown; tag?: unknown };
  const wallet = candidate.wallet as { id?: unknown; balance?: unknown };
  return (
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    typeof user.firstName === 'string' &&
    typeof user.tag === 'string' &&
    typeof wallet.id === 'string' &&
    typeof wallet.balance === 'string'
  );
};

/**
 * `{ user, wallet }` → the store patch. Everything type-shifted goes through
 * `wire/mapper.ts`, never through inline arithmetic: the balance is a
 * `numeric(20,6)` STRING on the wire and an epoch-ms timestamp is an ISO
 * string, and re-deriving either here is how the two sides drift apart.
 *
 * Note what is NOT in the output: `session`. The backend proved who the user is
 * by answering; it did not hand the browser a flag to keep.
 */
export const toStorePatch = (session: ApiSession): Partial<AppState> => {
  if (!isApiSession(session)) {
    throw new PrivyBridgeError('token', 'backend response is not a session envelope');
  }

  const user = toUser(session.user);
  const wallet = session.wallet;

  const patch = stripSessionOwned({
    userName: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    bpTag: user.tag,
    // null is a value the store has no shape for; the store's fields are
    // strings and "no email yet" is the empty string here, not the word null.
    recoveryEmail: session.user.email ?? '',
    recoveryPhone: session.user.phone ?? '',
    balance: toBalance(wallet),
    hasReceivedFunds: toHasReceivedFunds(wallet),
    yieldStartedAt: toYieldStartedAt(wallet),
  });

  assertNoCredentials(patch as Record<string, unknown>);
  return patch;
};
