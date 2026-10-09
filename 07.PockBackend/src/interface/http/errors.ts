/**
 * The failure bodies both authenticated routes can produce, in one place.
 *
 * ── Why these live here and not in a route ────────────────────────────────────
 *
 * `/api/auth/session` and `/api/wallets/claim` both resolve an account through
 * `resolveAccount`, so both can hit the same two conditions. Two routes that each
 * spelled the answer out would be two definitions of "what a conflict looks like
 * to a browser", and they would drift.
 *
 * ── Why a conflict is 409 and not 401 ────────────────────────────────────────
 *
 * 401 says "we do not believe you", and the browser's answer to that is to log in
 * again. Here the person *is* believed: the token verified and the mailbox was
 * read from Privy's own record. What we have is two verified facts that contradict
 * each other — a DID on file whose mailbox is not the one that just logged in — and
 * no amount of retrying resolves a contradiction. 409 says exactly that: this is
 * not going to get better on its own.
 *
 * The bodies carry a code and nothing else. Which DID was involved, which
 * constraint fired, what the store was asked to do: all of that is in the log,
 * where it can be read by the operator and shipped nowhere.
 */
import type { Context } from 'hono';

import { IdentityConflict } from '../../application/user/resolveAccount';
import { UserStoreConflict } from '../../domain/ports/user-store';

/** A DID that is on file, whose mailbox is not the mailbox that just logged in. */
export const IDENTITY_CONFLICT_BODY = { error: { code: 'IDENTITY_CONFLICT' } } as const;

/**
 * A `UNIQUE` constraint raced the write — two logins for one mailbox arriving at
 * once, most likely.
 *
 * Distinct from `IDENTITY_CONFLICT` because the causes are different: that one is
 * data that disagrees with itself, this one is a timing collision between two
 * correct requests. A support conversation needs to tell them apart.
 */
export const ACCOUNT_CONFLICT_BODY = { error: { code: 'ACCOUNT_CONFLICT' } } as const;

/**
 * The 409 response for `error`, or `null` when it is not a conflict at all.
 *
 * Returning `null` rather than an `undefined` response keeps each route's own
 * branch readable: `const conflict = accountConflict(error, c); if (conflict)
 * return conflict;`.
 */
export const accountConflict = (
  error: unknown,
  c: Context,
  log: { error: (message: string, detail?: unknown) => void },
): Response | null => {
  if (error instanceof IdentityConflict) {
    log.error('refused: the DID on file and the verified mailbox disagree', error);
    return c.json(IDENTITY_CONFLICT_BODY, 409);
  }

  if (error instanceof UserStoreConflict) {
    // The constraint name goes to the log and never to the client.
    log.error(`refused: ${error.constraint} raced the account write`, error);
    return c.json(ACCOUNT_CONFLICT_BODY, 409);
  }

  return null;
};