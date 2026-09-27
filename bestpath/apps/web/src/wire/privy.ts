/**
 * Privy ⇄ vanilla bridge.
 *
 * WHY THIS FILE EXISTS
 *
 * The passkey island (`privy-island.tsx`) speaks Privy's language: hooks,
 * `CustomEvent`s, a provider. The rest of the app speaks the project's: a
 * `Store` of plain values and a `Router` of screen names. Neither side can be
 * rewritten to meet the other — the island is React because `@privy-io/react-
 * auth` is React, and the UI is vanilla because it is 139 passing tests of
 * vanilla.
 *
 * So this file is the seam, and it is deliberately the ONLY place where the
 * two are allowed to meet. The seam is deliberately dumb:
 *
 *   island  ──►  CustomEvent on window  ──►  here  ──►  Store.set / Router.go
 *
 * No props, no shared store, no import of Preact in this file. That is what
 * lets the island be deleted later without touching a single screen.
 *
 * ── The one rule that outranks everything else ────────────────────────────
 *
 * THIS MODULE NEVER WRITES A SESSION INTO THE STORE.
 *
 * The session is an httpOnly cookie. The frontend cannot read it, so a
 * `session: true` in the store is a claim the browser is not in a position to
 * back — and localStorage is readable by any script that ever lands on the
 * page. The store is therefore hydrated from what the BACKEND decided
 * (`{ user, wallet }`), and the token dies in the request that carried it.
 *
 * `toStorePatch` runs every patch through `stripSessionOwned` AND through an
 * explicit credential audit, so a future field cannot quietly reintroduce the
 * leak. The audit is not paranoia: the SDK response objects are large, and
 * `Object.assign`-ing one into the store is the obvious mistake.
 *
 * Everything below the "pure" banner is a pure function. The pure half is
 * where the tests live, because mounting React to assert "a failed login left
 * the store untouched" would test the test runner, not the code.
 */

import { Store } from '../core/store';
import { Router } from '../core/router';
import {
  assertNoCredentials,
  isApiSession,
  normalizeStage,
  PrivyBridgeError,
  toStorePatch,
  type PrivyStage,
} from './session-envelope';
import type { ApiSession } from './mapper';
import type { AppState } from '../types';

/**
 * The envelope rules — the credential audit, the stage set, the envelope guard
 * and the store projection — live in `wire/session-envelope.ts`, which has no
 * DOM in its import graph. They are re-exported here because this module is
 * where the rest of the app reaches for them, and changing that would touch
 * every consumer for no gain.
 *
 * The split exists so the API's test suite can import the frontend's REAL guard
 * and run a REAL backend response through it. It could not do that from here:
 * this module imports the Router, and that reaches `window` at load time.
 */
export {
  assertNoCredentials,
  isApiSession,
  toStorePatch,
  PrivyBridgeError,
  PRIVY_STAGES,
  isPrivyStage,
  normalizeStage,
  type PrivyStage,
} from './session-envelope';

/* ─── event contract ───────────────────────────────────────────────────────── */

/**
 * The public API of the island. Names are namespaced under `bp:privy:` so a
 * `CustomEvent` on `window` can never collide with a library or with a future
 * vanilla module of ours.
 *
 * These four names are a CONTRACT, not a convenience: the vanilla side listens
 * to them by string, so renaming one silently unbinds the login flow. That is
 * why they are frozen in a const object instead of being typed out at each
 * dispatch site.
 */
export const PRIVY_EVENTS = {
  ready: 'bp:privy:ready',
  authenticated: 'bp:privy:authenticated',
  error: 'bp:privy:error',
  logout: 'bp:privy:logout',
} as const;

export type PrivyEventName = (typeof PRIVY_EVENTS)[keyof typeof PRIVY_EVENTS];

export interface PrivyReadyDetail {
  appId: string;
}

export interface PrivyAuthenticatedDetail {
  userId: string;
  isNewUser: boolean;
}

export interface PrivyErrorDetail {
  stage: PrivyStage;
  /** Spanish, user-facing. Never an API code, a stack, or a raw SDK error. */
  message: string;
}

export interface PrivyLogoutDetail {
  /** True when the backend also dropped the session cookie. */
  serverAcknowledged: boolean;
}

/**
 * Where a failure happened.
 *
 * A closed set on purpose. `stage` is read by vanilla code to decide whether
 * to offer a retry ("token" → send them back to passkey) or to show a dead
 * end ("init" → reload). A free-form string would make that switch silently
 * fall through, and the failure would surface as "nothing happened" — the
 * worst bug shape, because it is invisible until a user hits it.
 */
/* ─── pure: user-facing copy ───────────────────────────────────────────────── */

/**
 * Spanish, user-facing text per stage.
 *
 * The message is a lookup, never a template. Interpolating the caught error
 * would be more informative for whoever is debugging and strictly worse for
 * whoever is holding the phone: Privy error codes, HTTP bodies and JS stack
 * traces are all things we have decided the user does not need. The technical
 * detail goes to the console, which is where a developer will actually look.
 */
const STAGE_MESSAGES: Readonly<Record<PrivyStage, string>> = {
  init: 'No pudimos iniciar el acceso seguro. Recargá la página e intentá de nuevo.',
  login: 'No pudimos verificar tu passkey. Revisá que esté disponible e intentá de nuevo.',
  token: 'Tu sesión no se pudo renovar. Volvé a iniciar sesión.',
};

/**
 * The ONLY way a user-visible Privy error message is produced.
 *
 * Takes the thrown value only to log it, never to render it. Returns the
 * copy for `stage`; an out-of-contract stage is normalized rather than
 * rejected, because a bad stage must not be able to suppress the error.
 */
export const formatPrivyError = (error: unknown, stage: unknown = 'init'): string => {
  const resolved = normalizeStage(stage);
  // console.warn, not throw: a logging call must not be able to change what the
  // user sees.
  console.warn(`[rewallet] privy (${resolved})`, error);
  return STAGE_MESSAGES[resolved];
};

/**
 * Build a `bp:privy:error` detail, enforcing the contract on the way out.
 *
 * Two guarantees, both needed: `stage` is always a member of the closed set,
 * and `message` is always a string. A `CustomEvent` detail is a public object —
 * anything a caller puts in it is a promise we made to every listener.
 */
export const buildErrorDetail = (stage: unknown, message?: unknown): PrivyErrorDetail => {
  const resolved = normalizeStage(stage);
  return {
    stage: resolved,
    message: typeof message === 'string' && message.trim().length > 0
      ? message
      : STAGE_MESSAGES[resolved],
  };
};

/* ─── impure: transport ────────────────────────────────────────────────────── */

/**
 * Where the API lives. Same-origin by default, so the cookie is sent without
 * CORS and without SameSite=None gymnastics. A single env knob is enough: the
 * value is a deployment decision, not a code one.
 *
 * THE DEFAULT IS `/api`, NOT EMPTY, and that is load-bearing. Empty used to mean
 * "same origin, path as-is", which was only true while nothing called the API.
 * Now every call goes under the `/api` prefix that the dev proxy rewrites to the
 * API root (see `server.proxy` in vite.config.ts), which is also the prefix a
 * production reverse proxy serves. Overriding it to an absolute origin is only
 * correct for a genuinely split deployment — and that one pays the CORS bill.
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

/**
 * One HTTP call to the auth API, normalised into "a value or a throw".
 *
 * `credentials: 'include'` is the whole point: the session cookie is httpOnly,
 * so the browser attaches it and the JS never sees it. Anything else — sending
 * the Privy token as a bearer header on later calls, mirroring the cookie into
 * a header — would re-create the exact leak this module exists to prevent.
 */
const requestAuth = async <T>(path: string, body: unknown, stage: PrivyStage): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      // THE session travels here and nowhere else.
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network failure, DNS, CORS, offline. `err` is logged and dropped: a fetch
    // TypeError carries a message ("Failed to fetch") that would confuse a user
    // into blaming their own connection.
    console.warn('[rewallet] privy transport failed', err);
    throw new PrivyBridgeError(stage, 'auth request failed');
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (err) {
    // A 502 from a proxy in front of the API is HTML, not JSON. Not our bug,
    // still not the user's to debug.
    console.warn('[rewallet] privy non-JSON response', response.status, err);
    throw new PrivyBridgeError(stage, 'auth response was not JSON');
  }

  if (!response.ok || !envelope.ok) {
    // The envelope's `message` and `code` are for the LOG, not for the user:
    // `already_registered` / `not_registered` / a 409 are routing decisions the
    // UI layer has to make deliberately, and it has to make them from the
    // `reason` slug, not from a string we render.
    console.warn('[rewallet] privy rejected', response.status, envelope.error, envelope.code);
    throw new PrivyBridgeError(stage, envelope.error ?? 'auth rejected', {
      reason: envelope.error,
    });
  }

  if (envelope.data === undefined) {
    throw new PrivyBridgeError(stage, 'auth response carried no data');
  }
  return envelope.data;
};

/**
 * Logout, which has no response body to read.
 *
 * `POST /auth/logout` answers `204 No Content` — there is no envelope, because
 * there is nothing to say. Reusing `requestAuth` here would make every logout
 * look like a failure: `response.json()` on an empty 204 rejects, and the user
 * would be told the session survived when the server had already dropped it.
 */
const requestLogout = async (): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  } catch (err) {
    console.warn('[rewallet] privy logout transport failed', err);
    throw new PrivyBridgeError('token', 'logout request failed');
  }
  if (!response.ok) {
    console.warn('[rewallet] privy logout rejected', response.status);
    throw new PrivyBridgeError('token', 'logout rejected');
  }
};

interface AuthFinishData {
  user: ApiSession['user'];
  wallet: ApiSession['wallet'];
  isNewUser?: boolean;
}

/**
 * Register-or-login, in one call.
 *
 * The backend splits the two on purpose: `register/finish` 409s on a passkey
 * that already exists (silently creating a second identity is worse than an
 * explicit conflict) and `login/finish` 409s on one that does not (treating a
 * first-time passkey as a login would skip the profile step). So the client
 * walks the pair: try to register, and retry as a login ONLY on the specific
 * `already_registered` slug.
 *
 * Retrying on any other failure would be the bug: a 500 or a network blip
 * re-sent to `login/finish` turns an outage into a `not_registered` error the
 * user cannot act on.
 */
const finishAuth = async (
  accessToken: string,
  stage: PrivyStage,
): Promise<{ session: ApiSession; isNewUser: boolean }> => {
  const read = (data: AuthFinishData): { session: ApiSession; isNewUser: boolean } => {
    const session: ApiSession = { user: data.user, wallet: data.wallet };
    if (!isApiSession(session)) {
      throw new PrivyBridgeError(stage, 'auth response is not a session envelope');
    }
    return { session, isNewUser: data.isNewUser === true };
  };

  try {
    return read(await requestAuth<AuthFinishData>('/auth/register/finish', { idToken: accessToken }, stage));
  } catch (err) {
    const isAlreadyRegistered = err instanceof PrivyBridgeError && err.reason === 'already_registered';
    if (!isAlreadyRegistered) throw err;
    return read(await requestAuth<AuthFinishData>('/auth/login/finish', { idToken: accessToken }, stage));
  }
};

/* ─── impure: navigation ───────────────────────────────────────────────────── */

/**
 * Where a user lands after the backend accepted them.
 *
 * A first registration has no name and no tag yet — the backend literally
 * inserts empty strings — so onboarding is the only screen that can be right.
 * Everything else is home.
 */
const routeAfterAuth = (isNewUser: boolean): void => {
  Router.go(isNewUser ? 'onboarding' : 'home', { transition: 'fade' });
};

/* ─── dispatch ─────────────────────────────────────────────────────────────── */

const emit = <T>(name: PrivyEventName, detail: T): void => {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
};

export const emitPrivyReady = (appId: string): void => {
  emit(PRIVY_EVENTS.ready, { appId } satisfies PrivyReadyDetail);
};

/**
 * Announce a successful login.
 *
 * Fired only AFTER the store has been updated and the route has changed. The
 * alternative — firing it on WebAuthn success, before the backend has agreed —
 * tells the rest of the app that the user is logged in while the store is
 * still empty, and every listener that reads the store on this event then
 * reads a lie.
 */
export const emitPrivyAuthenticated = (detail: PrivyAuthenticatedDetail): void => {
  emit(PRIVY_EVENTS.authenticated, detail);
};

export const emitPrivyLogout = (detail: PrivyLogoutDetail): void => {
  emit(PRIVY_EVENTS.logout, detail);
};

export const emitPrivyError = (stage: unknown, message?: unknown): void => {
  emit(PRIVY_EVENTS.error, buildErrorDetail(stage, message));
};

/* ─── the bridge itself ────────────────────────────────────────────────────── */

/**
 * The imperative half of the seam.
 *
 * Events carry state island → vanilla. Commands have to travel the other way
 * (a vanilla `data-action="passkey"` button has to be able to START a WebAuthn
 * ceremony), and they travel through this registry rather than through another
 * DOM event.
 *
 * The registry lives HERE, on the vanilla side of the boundary, so that a
 * screen can call `requestPrivyLogin()` while importing nothing but
 * `wire/privy.ts`. If the handle were exported from the island, every screen
 * that wanted login would pull Preact and the whole SDK into its import graph —
 * and the "island" would stop being optional.
 */
export interface PrivyIslandHandle {
  login(): Promise<void>;
  /**
   * The SIGN-UP ceremony, as opposed to `login`.
   *
   * Both exist because WebAuthn treats them as different operations and
   * refuses to guess: a login asserts a credential that already exists, and a
   * signup creates one. Collapsing them into a single call that "does the
   * right thing" is how an app ends up able to sign in and unable to register,
   * because the only call it makes asks for a credential nothing has produced
   * yet.
   */
  register(): Promise<void>;
  logout(): Promise<void>;
}

let island: PrivyIslandHandle | null = null;

/** Called by the island on mount. Returns the unsubscribe. */
export const setPrivyIslandHandle = (handle: PrivyIslandHandle): (() => void) => {
  island = handle;
  return () => {
    // Identity check, not a bare null: React runs effect cleanup for an
    // unmounted tree AFTER a replacement tree has already registered, and a
    // bare `null` would tear down the live island.
    if (island === handle) island = null;
  };
};

export const hasPrivyIsland = (): boolean => island !== null;

/** Start a passkey SIGN-IN ceremony. Throws if the island is not mounted. */
export const requestPrivyLogin = async (): Promise<void> => {
  if (!island) throw new PrivyBridgeError('init', 'privy island is not mounted');
  return island.login();
};

/**
 * Start a passkey SIGN-UP ceremony. Throws if the island is not mounted.
 *
 * The mirror of `requestPrivyLogin`, and separate on purpose: the caller knows
 * from `data-mode` whether this person is new, and collapsing the two here
 * would throw that away at the boundary.
 */
export const requestPrivyRegister = async (): Promise<void> => {
  if (!island) throw new PrivyBridgeError('init', 'privy island is not mounted');
  return island.register();
};

/** End the Privy session and the backend session. Throws if not mounted. */
export const requestPrivyLogout = async (): Promise<void> => {
  if (!island) throw new PrivyBridgeError('init', 'privy island is not mounted');
  return island.logout();
};

/**
 * Exchange a Privy access token for a session, and hydrate the store.
 *
 * The token enters here and does not come out: it is the body of exactly one
 * POST, and the value the store ends up with is the backend's `{ user, wallet }`
 * projected through the mapper.
 *
 * ATOMIC ON PURPOSE. The patch is built and audited completely before a single
 * `Store.set` runs, and `Store.set` is called exactly once with it. There is
 * no "update the balance, then the name, then discover the wallet was missing"
 * path — a half-hydrated store is a logged-in-looking screen showing a stale
 * balance, which is the failure a wallet app must never have.
 */
export const exchangePrivyToken = async (accessToken: string): Promise<void> => {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new PrivyBridgeError('token', 'empty access token');
  }

  const { session, isNewUser } = await finishAuth(accessToken, 'token');

  // Throws before touching the store if the response is not a session.
  const patch = toStorePatch(session);

  Store.set(patch);
  routeAfterAuth(isNewUser);

  emitPrivyAuthenticated({ userId: session.user.id, isNewUser });
};

/**
 * End the session everywhere at once.
 *
 * The island ends the Privy session (so the passkey is no longer usable) and
 * this calls the backend so the httpOnly cookie is dropped. The STORE IS NOT
 * TOUCHED HERE, and that is not an oversight: the existing `Flow.logout()` in
 * `src/flow/index.ts` already owns the "wipe the UI and go to passkey"
 * decision, and it is the piece that will be replaced when the session stops
 * being a local flag. Two owners of that decision would be one too many.
 */
export const endPrivySession = async (): Promise<void> => {
  let serverAcknowledged = false;
  try {
    await requestLogout();
    serverAcknowledged = true;
  } catch (err) {
    // A logout that did not reach the server still has to tear down the local
    // Privy session, and the user still has to end up back on the passkey
    // screen. Failing loudly here would strand them in a UI that claims to be
    // signed in.
    console.warn('[rewallet] privy logout not acknowledged by the server', err);
  }
  emitPrivyLogout({ serverAcknowledged });
};
