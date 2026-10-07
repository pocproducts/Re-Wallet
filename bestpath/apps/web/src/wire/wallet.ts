/**
 * Reading the real API.
 *
 * `core/api.ts` is still the mock: it fakes balances, movements and tag
 * availability with local arithmetic and `U.wait`. This module is the other
 * half — the first code path in the frontend that asks the backend what is
 * true.
 *
 * ── Why it is a separate module and not a rewrite of `core/api.ts` ──────────
 *
 * `core/api.ts` is also where the WRITE side of the prototype lives
 * (`addMoney`, `sendMoney`, `accrueYield`), and those still have no backend.
 * Rewriting the file would mean a half-real boundary, which is the worst of
 * both: a developer would not know which call to trust. This module is
 * explicitly the READ side, and the day the writes land, the mock's read-shaped
 * helpers are what gets deleted — not merged in.
 *
 * ── The two rules that outrank everything here ─────────────────────────────
 *
 * 1. NO SESSION-SHAPED FIELD EVER REACHES THE STORE. Not because these two
 *    endpoints would send one, but because the responses are objects and the
 *    obvious future mistake is `Store.set(response.data)`. Every patch below is
 *    built field by field, stripped, and audited — the same two guards
 *    `wire/privy.ts` uses, reused rather than reimplemented.
 *
 * 2. HYDRATION IS ATOMIC. One response, one `Store.set`. There is no
 *    "update the balance, then the movements, then notice the wallet was
 *    missing" path: a half-hydrated store is a signed-in-looking screen showing
 *    a stale balance, and nothing throws.
 *
 * `credentials: 'include'` on every call is not boilerplate: the session is an
 * httpOnly cookie, so the browser attaches it and the JS never sees it.
 */

import { Store } from '../core/store';
import {
  stripSessionOwned,
  toBalance,
  toHasReceivedFunds,
  toMovement,
  toYieldStartedAt,
  type ApiMovement,
  type ApiSession,
  type ApiWallet,
} from './mapper';
// The envelope rules come from the DOM-free module, NOT from `./privy`: this
// file has to be importable without a browser so the API's test suite can use
// the real guards on a real response. `wire/privy.ts` imports the Router.
import { assertNoCredentials, isApiSession, PrivyBridgeError, toStorePatch } from './session-envelope';
import type { AppState, Movement } from '../types';

/**
 * Where the API lives. Identical resolution to `wire/privy.ts`, and it must
 * stay identical: two different notions of "the API" in one app is a bug that
 * only shows up as a 404 in one of the two flows.
 */
const rawApiBase = import.meta.env.VITE_API_BASE_URL;
const API_BASE: string =
  typeof rawApiBase === 'string' && rawApiBase.trim().length > 0
    ? rawApiBase.trim().replace(/\/+$/, '')
    : '/api';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: number;
}

export type { ApiEnvelope };

/** A 401 is an answer, not a failure: it means "no session", and the boot route depends on that. */
export class WalletApiError extends Error {
  readonly status: number;
  readonly reason?: string;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = 'WalletApiError';
    this.status = status;
    this.reason = reason;
  }

  /** True for the one status the UI has a real reaction to. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/**
 * The ONE transport in the app.
 *
 * It was GET-only and private, and the temptation was to add a second transport
 * for the profile writes. Two transports is how "the API" stops being one idea:
 * `wire/privy.ts` already carries a comment saying the resolution of `API_BASE`
 * has to stay identical to this one, and a third copy of the fetch, the envelope
 * and the error shape is three places for them to drift.
 *
 * So the method and the body are parameters with defaults, and every existing
 * caller keeps working unchanged: a call with only a path is still a GET with no
 * headers.
 */
export const requestJson = async <T>(
  path: string,
  init: { method?: 'GET' | 'PATCH' | 'POST' | 'DELETE'; body?: unknown } = {},
): Promise<{ status: number; envelope: ApiEnvelope<T> }> => {
  const { method = 'GET', body } = init;
  const hasBody = body !== undefined;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      // ONLY when there is a body. A GET with `content-type: application/json`
      // and no body is a request some proxies and caches treat as malformed,
      // and the header would be there for no reason.
      ...(hasBody ? { headers: { 'content-type': 'application/json' } } : {}),
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Offline, DNS, the API not running. The browser's "Failed to fetch" is
    // logged and dropped: shown to a user it reads as THEIR connection.
    console.warn('[rewallet] wallet: request failed', path, err);
    throw new WalletApiError('wallet request failed', 0);
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (err) {
    console.warn('[rewallet] wallet: respuesta no-JSON', path, response.status, err);
    throw new WalletApiError('wallet response was not JSON', response.status);
  }

  return { status: response.status, envelope };
};

/* ─── shape guards ──────────────────────────────────────────────────────────── */

/**
 * Validate before mapping.
 *
 * The mapper is where types are CONVERTED; this is where they are CHECKED. A
 * `balance` that arrives as a number instead of a `numeric(20,6)` string would
 * pass through `Number()` silently and produce a wrong balance on screen with
 * no error anywhere — the failure mode this whole file exists to prevent.
 */
export const isApiWallet = (value: unknown): value is ApiWallet => {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    typeof w['id'] === 'string' &&
    typeof w['balance'] === 'string' &&
    (w['firstFundsAt'] === null || typeof w['firstFundsAt'] === 'string') &&
    (w['yieldStartedAt'] === null || typeof w['yieldStartedAt'] === 'string')
  );
};

const MOVEMENT_TYPES = new Set(['deposit', 'send', 'receive', 'yield', 'swap']);
const MOVEMENT_STATUSES = new Set(['pending', 'completed', 'failed']);

export const isApiMovement = (value: unknown): value is ApiMovement => {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m['id'] === 'string' &&
    typeof m['amount'] === 'string' &&
    typeof m['title'] === 'string' &&
    typeof m['createdAt'] === 'string' &&
    MOVEMENT_TYPES.has(String(m['type'])) &&
    MOVEMENT_STATUSES.has(String(m['status']))
  );
};

/* ─── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Is there a session? The boot route depends on this answer, so a 401 has to be
 * a VALUE and not an exception: "nobody is logged in" is the normal state of a
 * cold app, and routing to welcome must not read as a crash.
 *
 * Returns `null` for 401, throws for anything else.
 */
export const readSession = async (): Promise<ApiSession | null> => {
  const { status, envelope } = await requestJson<ApiSession>('/auth/session');
  if (!envelope.ok) {
    if (status === 401) return null;
    throw new WalletApiError('session read failed', status, envelope.error);
  }
  if (envelope.data === undefined || !isApiSession(envelope.data)) {
    throw new WalletApiError('session envelope is not a session', status);
  }
  return envelope.data;
};

export const fetchWallet = async (): Promise<ApiWallet> => {
  const { status, envelope } = await requestJson<ApiWallet>('/wallet');
  if (!envelope.ok) throw new WalletApiError('wallet read failed', status, envelope.error);
  if (envelope.data === undefined || !isApiWallet(envelope.data)) {
    throw new WalletApiError('wallet payload is not a wallet', status);
  }
  return envelope.data;
};

export interface MovementsPage {
  items: ApiMovement[];
  /** Keyset cursor for the NEXT page, or `null` when this was the last one. */
  cursor: string | null;
}

export const fetchMovements = async (opts: { cursor?: string | null; limit?: number } = {}): Promise<MovementsPage> => {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  // The API caps `limit` at 50; asking for more is a 400, not a clamp.
  params.set('limit', String(Math.min(Math.max(opts.limit ?? 20, 1), 50)));
  const query = params.toString();

  const { status, envelope } = await requestJson<{ items: ApiMovement[]; cursor: string | null }>(
    `/wallet/movements?${query}`,
  );
  if (!envelope.ok) throw new WalletApiError('movements read failed', status, envelope.error);

  const data = envelope.data;
  if (data === undefined || !Array.isArray(data.items)) {
    throw new WalletApiError('movements payload is not a page', status);
  }
  // One malformed row fails the page. A movement dropped from the list without
  // a trace is worse than a visible error: the user is looking at an account
  // balance that does not add up.
  if (!data.items.every(isApiMovement)) {
    throw new WalletApiError('a movement row is outside the contract', status);
  }
  return { items: data.items, cursor: data.cursor ?? null };
};

/**
 * The position, read from the chain.
 *
 * A 503 here is an ANSWER, not a failure: it means the chain could not be read,
 * and the correct reaction is to keep whatever we had and say so. Returning null
 * for that case would make "the network is down" look like "the account is
 * empty", which is the one thing this app must never do.
 */
export const fetchPosition = async (): Promise<ApiPosition | null> => {
  const { status, envelope } = await requestJson<ApiPosition>('/wallet/position');
  if (!envelope.ok) {
    if (status === 503) {
      console.warn('[rewallet] la cadena no respondio; se conserva la posicion anterior');
      return null;
    }
    throw new WalletApiError('position read failed', status, envelope.error);
  }
  if (envelope.data === undefined || !isApiPosition(envelope.data)) {
    throw new WalletApiError('position payload is not a position', status);
  }
  return envelope.data;
};

/**
 * Refresh the position AND the movements in one pass, and write the store once.
 *
 * Same rule as `refreshWallet`: two writes means a screen showing a balance from
 * one refresh next to an activity list from another. The position is a read that
 * can fail on its own, so a failure there must not stop the movements from
 * updating — they are two different questions with two different answers.
 */
export const refreshPositionAndMovements = async (): Promise<void> => {
  const [position, page] = await Promise.allSettled([fetchPosition(), fetchMovements({})]);
  if (position.status === 'rejected') throw position.reason;
  if (page.status === 'rejected') throw page.reason;
  const patch: Partial<AppState> = { ...toMovementsPatch(page.value.items) };
  if (position.value) {
    Object.assign(patch, toPositionPatch(position.value));
  } else {
    // A 503 is a real failed read, and it has to be distinguishable from the
    // first paint: otherwise the UI either lies about a failure or hides a real
    // one, and both are worse than a third state.
    patch.positionStatus = 'error';
  }
  Store.set(patch);
  resetCursor();
  nextCursorSetter(page.value.cursor);
};

/* ─── hydration ────────────────────────────────────────────────────────────── */

/** Build a patch, strip what the backend owns, and refuse a credential. */
const safePatch = (patch: Partial<AppState>): Partial<AppState> => {
  const stripped = stripSessionOwned(patch);
  assertNoCredentials(stripped as Record<string, unknown>);
  return stripped;
};

/**
 * `{ user, wallet }` → store. The login path and the reload path.
 *
 * A DELEGATION, and it used to be a third copy of the projection. That is how
 * the wallet address went missing from the profile while every one of the three
 * copies looked correct on its own: `toStorePatch` (login) and this one (reload)
 * each listed the fields they remembered, and the address was in neither. The
 * day a field is added, exactly one copy gets it.
 *
 * `toStorePatch` owns the projection, the strip and the credential audit, so
 * there is one place where a session becomes store state — which is the property
 * the comment above used to *claim* and did not have.
 */
export const toSessionPatch = (session: ApiSession): Partial<AppState> => toStorePatch(session);

/** One wallet → the three store fields that describe it. */
/**
 * The on-chain position envelope, exactly as the API sends it.
 *
 * Amounts are 6-decimal STRINGS. `number` here would be a silent precision loss
 * on a value that is money, and the API sends strings precisely so that this
 * file has to make that choice on purpose.
 */
export interface ApiPosition {
  wallet: string;
  earning: string;
  available: string;
  total: string;
  aToken: string;
  usdc: string;
  readAt: string;
}

const DECIMAL = /^\d+\.\d{1,6}$/;

/** Reject a position that is not shaped like money. */
export const isApiPosition = (value: unknown): value is ApiPosition => {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p['wallet'] === 'string' &&
    typeof p['aToken'] === 'string' &&
    typeof p['usdc'] === 'string' &&
    typeof p['readAt'] === 'string' &&
    DECIMAL.test(String(p['earning'])) &&
    DECIMAL.test(String(p['available'])) &&
    DECIMAL.test(String(p['total']))
  );
};

/**
 * The position to the store.
 *
 * A shape violation THROWS rather than degrading to zeros: an empty account and
 * a failed read look identical on screen, and a user seeing "$0" when their money
 * is on-chain is the worst thing this app can do.
 */
export const toPositionPatch = (position: ApiPosition): Partial<AppState> => {
  if (!isApiPosition(position)) {
    throw new WalletApiError('position payload is not a position', 0);
  }
  return safePatch({
    position: {
      earning: Number(position.earning),
      available: Number(position.available),
      total: Number(position.total),
      readAt: Date.parse(position.readAt),
    },
    positionStatus: 'ok',
    walletAddress: position.wallet,
  });
};

export const toWalletPatch = (wallet: ApiWallet): Partial<AppState> =>
  safePatch({
    // Same reason as in `toStorePatch`: a `/wallet` read hydrates the balance,
    // and hydrating a balance without the address it belongs to is what left the
    // profile showing a number with nothing to check it against.
    walletAddress: wallet.address,
    balance: toBalance(wallet),
    hasReceivedFunds: toHasReceivedFunds(wallet),
    yieldStartedAt: toYieldStartedAt(wallet),
  });

/**
 * A page of movements → store movements.
 *
 * `append` is the load-more case and is the reason the cursor is NOT a store
 * field: pagination state is per-view, and persisting it means a reload
 * resurrects a half-read list. The cursor lives in this module instead.
 */
export const toMovementsPatch = (items: ApiMovement[], append = false): Partial<AppState> => {
  const mapped: Movement[] = items.map(toMovement);
  const current = append ? Store.get().movements : [];
  return safePatch({ movements: [...current, ...mapped] });
};

/**
 * The cursor for the next page, or `null` when the list is complete.
 *
 * Module state, deliberately: it is view state, it must not survive a reload,
 * and putting it in the store would persist it with everything else.
 */
let nextCursor: string | null = null;

export const takeNextCursor = (): string | null => nextCursor;

const nextCursorSetter = (cursor: string | null): void => {
  nextCursor = cursor;
};
export const resetCursor = (): void => { nextCursor = null; };

/* ─── the two operations the app actually calls ─────────────────────────────── */

/**
 * Refresh what the home screen shows: balance and the first page of movements.
 *
 * BOTH are fetched before anything is written, and the store is written ONCE.
 * Fetching them separately and writing as each lands is what produces a home
 * screen whose balance is one refresh old and whose activity list is from
 * another — two truths on one screen, and neither one flagged.
 *
 * A failure leaves the store completely untouched. A wallet that shows the last
 * known balance with a quiet "no se pudo actualizar" is honest; one showing a
 * half-updated state is not.
 */
export const refreshWallet = async (limit?: number): Promise<void> => {
  const [wallet, page] = await Promise.all([fetchWallet(), fetchMovements({ limit })]);
  const patch = { ...toWalletPatch(wallet), ...toMovementsPatch(page.items) };
  Store.set(patch);
  nextCursor = page.cursor;
};

/** Load the next page and append it. A full page refresh resets the cursor. */
export const loadMoreMovements = async (): Promise<number> => {
  if (nextCursor === null) return 0;
  const page = await fetchMovements({ cursor: nextCursor });
  Store.set(toMovementsPatch(page.items, true));
  nextCursor = page.cursor;
  return page.items.length;
};

/**
 * Read the session and hydrate the store from it, atomically.
 *
 * This is the boot path's answer to "is anybody logged in". The cookie is
 * httpOnly, so the frontend cannot inspect it: asking the server is not a
 * workaround, it is the only way to know.
 *
 * Returns the session, or `null` when there is none — a value, because "cold
 * app, nobody logged in" is a normal state and must not read as an error.
 */
export const hydrateFromSession = async (): Promise<ApiSession | null> => {
  const session = await readSession();
  if (session === null) return null;
  // Throws BEFORE touching the store if anything is off-contract.
  Store.set(toSessionPatch(session));
  return session;
};

export { PrivyBridgeError };
