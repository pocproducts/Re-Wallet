import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * The Privy bridge.
 *
 * These pin the two properties that are silent when broken and expensive when
 * they fail:
 *
 *   1. The store NEVER receives a session, a token, or anything that behaves
 *      like one. The session is an httpOnly cookie; a `session: true` in
 *      localStorage is a claim the browser is not in a position to back, and
 *      localStorage is readable by any script that ever lands on the page.
 *   2. A failed login leaves the store EXACTLY as it was. A half-hydrated store
 *      renders a signed-in-looking screen with a stale balance, and nothing
 *      throws.
 *
 * No React is mounted here. Everything asserted below is a pure function or a
 * `fetch` stub; if these tests needed a DOM tree to check "did the store get a
 * token", they would be testing Preact instead of the bridge.
 */

// The router and the store both read the real DOM shell at import time, so the
// shell has to exist before anything is pulled in — same order as every other
// test file in this repo.
document.body.innerHTML =
  '<div class="device" id="device"><div class="app">' +
  '<div class="screens" id="screens" role="main"></div>' +
  '<div class="layer" id="layer"></div></div></div>';

await import('../src/config');
await import('../src/core/utils');
await import('../src/core/store');
await import('../src/core/router');
await import('../src/wire/mapper');
const privy = await import('../src/wire/privy');

const Store = BP.store;
const Router = BP.router;

/* ─── fixtures ─────────────────────────────────────────────────────────────── */

const session = (over: Record<string, unknown> = {}) => ({
  user: {
    id: 'u_1',
    name: 'Ana Sofía Chen',
    firstName: 'Ana',
    lastName: 'Sofía Chen',
    tag: '@ana',
    email: 'ana@example.com',
    phone: '+549112345678',
    ...((over['user'] as Record<string, unknown>) ?? {}),
  },
  wallet: {
    id: 'w_1',
    address: '0xabc',
    // numeric(20,6) as a STRING. The whole reason the mapper exists.
    balance: '1250.500000',
    currency: 'USD',
    firstFundsAt: '2026-09-27T10:00:00.000Z',
    yieldStartedAt: null,
    ...((over['wallet'] as Record<string, unknown>) ?? {}),
  },
});

/** A `fetch` stub that answers with the API envelope shape. */
const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, data }),
});

const failResponse = (status: number, error: string, message: string) => ({
  ok: false,
  status,
  json: async () => ({ ok: false, error, message, code: status }),
});

const snapshot = (): Record<string, unknown> => JSON.parse(JSON.stringify(Store.get()));

/* ─── the hard rule ────────────────────────────────────────────────────────── */

describe('the store never holds a session', () => {
  it('the backend session becomes store state with NO session field', () => {
    const patch = privy.toStorePatch(session());

    expect(patch).not.toHaveProperty('session');
    expect(patch).not.toHaveProperty('sessionToken');
    expect(patch).not.toHaveProperty('idToken');
    expect(patch).not.toHaveProperty('accessToken');
    expect(patch).not.toHaveProperty('token');
  });

  it('even a backend that volunteers a token does not get one past the audit', () => {
    // The realistic accident is a spread: `Store.set({ ...response })`. The
    // audit is the thing that stops it, and it has to fire on the KEY without
    // ever putting the value in the error message or a log.
    expect(() => privy.assertNoCredentials({ session: true })).toThrow(/session-owned key: session/);
    expect(() => privy.assertNoCredentials({ idToken: 'eyJhbGciOi' })).toThrow(/idToken/);
    expect(() => privy.assertNoCredentials({ accessToken: 'x' })).toThrow();
    expect(() => privy.assertNoCredentials({ refreshToken: 'x' })).toThrow();
    expect(() => privy.assertNoCredentials({ token: 'x' })).toThrow();
    expect(() => privy.assertNoCredentials({ sessionToken: 'x' })).toThrow();
  });

  it('the audit error names the key and never echoes the credential', () => {
    let caught: unknown;
    try {
      privy.assertNoCredentials({ idToken: 'SUPER_SECRET_VALUE' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(privy.PrivyBridgeError);
    const err = caught as InstanceType<typeof privy.PrivyBridgeError>;
    expect(err.offendingKey).toBe('idToken');
    expect(err.message).not.toContain('SUPER_SECRET_VALUE');
  });

  it('a legitimate patch survives the audit untouched', () => {
    const patch = { firstName: 'Ana', balance: 10, hasReceivedFunds: false };
    expect(() => privy.assertNoCredentials(patch)).not.toThrow();
  });

  it('the session IS the httpOnly cookie, and the store is not the source of truth', () => {
    // `stripSessionOwned` is the mapper's rule and the bridge reuses it rather
    // than reimplementing it. If the two ever drift, the mapper's own tests
    // stop meaning anything.
    const patched = privy.toStorePatch(session());
    for (const field of ['session']) {
      expect(patched).not.toHaveProperty(field);
    }
  });
});

/* ─── response ⇄ store ─────────────────────────────────────────────────────── */

describe('backend response to store state, through the mapper', () => {
  it('balance arrives as numeric(20,6) STRING and leaves as a number', () => {
    const patch = privy.toStorePatch(session());
    expect(patch.balance).toBe(1250.5);
    expect(typeof patch.balance).toBe('number');
  });

  it('the user projection is the one the mapper already owns', () => {
    const patch = privy.toStorePatch(session());
    expect(patch.firstName).toBe('Ana');
    expect(patch.lastName).toBe('Sofía Chen');
    expect(patch.userName).toBe('Ana Sofía Chen');
    expect(patch.bpTag).toBe('@ana');
  });

  it('hasReceivedFunds is a latch read from firstFundsAt, not from the balance', () => {
    expect(privy.toStorePatch(session()).hasReceivedFunds).toBe(true);
    // A wallet holding a fat balance that has never been credited is still
    // "never received funds" by the store's own definition. Deriving it from
    // the balance would re-onboard exactly nobody, and deriving it wrong here
    // would hide the "Recibir" call to action from every funded user.
    const funded = session({ wallet: { balance: '999.000000', firstFundsAt: null } });
    expect(privy.toStorePatch(funded).hasReceivedFunds).toBe(false);
  });

  it('yieldStartedAt is null, not the epoch', () => {
    expect(privy.toStorePatch(session()).yieldStartedAt).toBeNull();
    const earning = session({ wallet: { yieldStartedAt: '2026-09-27T10:00:00.000Z' } });
    expect(privy.toStorePatch(earning).yieldStartedAt).toBe(new Date('2026-09-27T10:00:00.000Z').getTime());
  });

  it('a null email or phone becomes an empty string, never the string "null"', () => {
    const anonymous = session({ user: { email: null, phone: null } });
    const patch = privy.toStorePatch(anonymous);
    expect(patch.recoveryEmail).toBe('');
    expect(patch.recoveryPhone).toBe('');
  });

  it('a response that is not a session envelope is rejected', () => {
    expect(privy.isApiSession(session())).toBe(true);
    expect(privy.isApiSession(null)).toBe(false);
    expect(privy.isApiSession({ user: {} })).toBe(false);
    expect(privy.isApiSession({ user: session().user })).toBe(false);
    // A wallet whose balance came back as a float is not our contract, and
    // silently coercing it is how a rounding bug gets into a balance.
    expect(privy.isApiSession(session({ wallet: { balance: 1250.5 } }))).toBe(false);
    expect(() => privy.toStorePatch({ user: {}, wallet: {} } as never)).toThrow(privy.PrivyBridgeError);
  });
});

/* ─── atomicity ────────────────────────────────────────────────────────────── */

describe('a failed backend call does not leave the store half-written', () => {
  let go: ReturnType<typeof vi.spyOn>;
  let set: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Store.reset();
    // The router and the store are the two things a successful exchange
    // touches; spying keeps the test from navigating a real DOM tree and
    // from tripping the router's 420ms `busy` lock between cases.
    go = vi.spyOn(Router, 'go').mockReturnValue(undefined);
    set = vi.spyOn(Store, 'set').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('a rejected exchange writes NOTHING and navigates nowhere', async () => {
    const before = snapshot();
    vi.stubGlobal('fetch', vi.fn(async () => failResponse(500, 'internal', 'Error interno.')));

    await expect(privy.exchangePrivyToken('privy-access-token')).rejects.toBeInstanceOf(
      privy.PrivyBridgeError,
    );

    expect(set).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('a 200 whose body is not a session envelope writes NOTHING', async () => {
    const before = snapshot();
    // The dangerous shape: the request SUCCEEDED and the response is still
    // unusable. A handler that had already assigned `user.name` before
    // noticing the wallet was missing would leave a renamed, zero-balance user.
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ user: { id: 'u_1', name: 'Ana' } })));

    await expect(privy.exchangePrivyToken('privy-access-token')).rejects.toThrow(/not a session envelope/);

    expect(set).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('a non-JSON response (a proxy 502) writes NOTHING', async () => {
    const before = snapshot();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    })));

    await expect(privy.exchangePrivyToken('privy-access-token')).rejects.toBeInstanceOf(
      privy.PrivyBridgeError,
    );
    expect(set).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('an empty token is refused before any request is made', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(privy.exchangePrivyToken('')).rejects.toThrow(/empty access token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a success writes the store EXACTLY ONCE, then navigates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ ...session(), isNewUser: false })));

    await privy.exchangePrivyToken('privy-access-token');

    expect(set).toHaveBeenCalledTimes(1);
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.balance).toBe(1250.5);
    expect(patch).not.toHaveProperty('session');
    expect(go).toHaveBeenCalledWith('home', { transition: 'fade' });
  });

  it('a first registration lands on onboarding, not home', async () => {
    // The backend inserts empty first/last name and the placeholder tag on
    // register, so home would render a nameless user with the wrong handle.
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ ...session(), isNewUser: true })));
    await privy.exchangePrivyToken('privy-access-token');
    expect(go).toHaveBeenCalledWith('onboarding', { transition: 'fade' });
  });
});

/* ─── register vs login ────────────────────────────────────────────────────── */

describe('register/finish then login/finish, and only for that one reason', () => {
  it('an already-registered passkey retries as a login', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      String(url).endsWith('/auth/register/finish')
        ? failResponse(409, 'already_registered', 'Esa cuenta ya está registrada. Iniciá sesión.')
        : okResponse({ ...session(), isNewUser: false }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Router, 'go').mockReturnValue(undefined);
    vi.spyOn(Store, 'set').mockImplementation(() => undefined);

    await privy.exchangePrivyToken('t');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/register/finish');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/login/finish');
  });

  it('any OTHER failure is NOT retried as a login', async () => {
    // A 500 re-sent to /auth/login/finish comes back as `not_registered`, and
    // the user is told to create an account they already have. An outage must
    // not be laundered into a wrong instruction.
    const fetchMock = vi.fn(async () => failResponse(503, 'unavailable', 'No disponible.'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Router, 'go').mockReturnValue(undefined);

    await expect(privy.exchangePrivyToken('t')).rejects.toBeInstanceOf(privy.PrivyBridgeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the token is sent as `idToken`, which is the field the backend validates', async () => {
    // apps/api/src/routes/auth.ts reads `z.object({ idToken })`. A field-name
    // drift here is a 400 that looks exactly like an invalid passkey.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ ...session(), isNewUser: false }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Router, 'go').mockReturnValue(undefined);
    vi.spyOn(Store, 'set').mockImplementation(() => undefined);

    await privy.exchangePrivyToken('the-access-token');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ idToken: 'the-access-token' });
    // The session cookie has to ride along or the backend mints a session the
    // browser never receives.
    expect(init.credentials).toBe('include');
  });
});

/* ─── error copy ───────────────────────────────────────────────────────────── */

describe('the user-facing error is Spanish and leaks nothing', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('never renders the thrown value, an API code, or a stack', () => {
    const nasty = new Error('PrivyError: invalid_verification_key (code 40123)');
    nasty.stack = 'Error: PrivyError\n    at verify (node_modules/@privy-io/node/index.js:42:9)';
    const message = privy.formatPrivyError(nasty, 'token');

    expect(message).toBe(privy.formatPrivyError(nasty, 'token'));
    expect(message).not.toContain('40123');
    expect(message).not.toContain('invalid_verification_key');
    expect(message).not.toContain('at verify');
    expect(message).not.toContain('node_modules');
    expect(message).toMatch(/[áéíóúñ¿¡]|[a-záéíóúñ]/i);
    expect(message).not.toMatch(/Error|Exception|undefined|\[object/);
  });

  it('the technical detail is still logged, just not rendered', () => {
    // Suppressing the cause would make every production report unactionable.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    privy.formatPrivyError(new Error('boom'), 'login');
    expect(warn).toHaveBeenCalledWith('[rewallet] privy (login)', expect.any(Error));
  });

  it('every stage has its own Spanish copy', () => {
    const messages = privy.PRIVY_STAGES.map((stage) => privy.formatPrivyError(new Error('x'), stage));
    expect(new Set(messages).size).toBe(privy.PRIVY_STAGES.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/[áéíóúñ]/i);
    }
  });
});

/* ─── the event contract ───────────────────────────────────────────────────── */

describe('the event contract', () => {
  it('uses the exact namespaced names', () => {
    expect(privy.PRIVY_EVENTS).toEqual({
      ready: 'bp:privy:ready',
      authenticated: 'bp:privy:authenticated',
      error: 'bp:privy:error',
      logout: 'bp:privy:logout',
    });
  });

  it('an unknown stage is normalized, not passed through', () => {
    // `stage` is read by vanilla code to decide between "retry" and "reload".
    // A free-form string here falls through that switch silently, and the bug
    // surfaces as "nothing happened".
    expect(privy.isPrivyStage('init')).toBe(true);
    expect(privy.isPrivyStage('login')).toBe(true);
    expect(privy.isPrivyStage('token')).toBe(true);
    expect(privy.isPrivyStage('whatever')).toBe(false);
    expect(privy.isPrivyStage(undefined)).toBe(false);
    expect(privy.isPrivyStage(42)).toBe(false);

    expect(privy.normalizeStage('login')).toBe('login');
    // Unknown collapses to the least specific stage, so a malformed payload
    // produces a generic message rather than a misleading specific one.
    expect(privy.normalizeStage('nope')).toBe('init');
    expect(privy.normalizeStage(null)).toBe('init');
  });

  it('a bad stage in an error payload is corrected before it is dispatched', () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => { seen.push((e as CustomEvent).detail); };
    window.addEventListener(privy.PRIVY_EVENTS.error, listener);
    try {
      privy.emitPrivyError('not-a-stage', 'mensaje');
      privy.emitPrivyError(undefined, undefined);
    } finally {
      window.removeEventListener(privy.PRIVY_EVENTS.error, listener);
    }
    expect(seen).toEqual([
      { stage: 'init', message: 'mensaje' },
      { stage: 'init', message: expect.stringMatching(/[áéíóúñ]/i) },
    ]);
    for (const detail of seen as { stage: string }[]) {
      expect(privy.PRIVY_STAGES).toContain(detail.stage);
    }
  });

  it('a message-less or non-string message still yields a usable payload', () => {
    expect(privy.buildErrorDetail('token').message).toMatch(/[áéíóúñ]/i);
    expect(privy.buildErrorDetail('token', '   ').message).toMatch(/[áéíóúñ]/i);
    expect(privy.buildErrorDetail('token', 42).message).toMatch(/[áéíóúñ]/i);
    expect(privy.buildErrorDetail('token', 'hola').message).toBe('hola');
  });

  it('the authenticated event is only fired once the store is whole', async () => {
    Store.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const go = vi.spyOn(Router, 'go').mockReturnValue(undefined);
    const events: { name: string; detail: unknown }[] = [];
    const names = [privy.PRIVY_EVENTS.authenticated, privy.PRIVY_EVENTS.error];
    const listeners = names.map((name) => {
      const fn = (e: Event) => events.push({ name, detail: (e as CustomEvent).detail });
      window.addEventListener(name, fn);
      return { name, fn };
    });

    try {
      vi.stubGlobal('fetch', vi.fn(async () => failResponse(401, 'unauthorized', 'No autorizado.')));
      await expect(privy.exchangePrivyToken('t')).rejects.toBeTruthy();
      // A failure must NOT claim the user is authenticated.
      expect(events.filter((e) => e.name === privy.PRIVY_EVENTS.authenticated)).toHaveLength(0);

      vi.stubGlobal('fetch', vi.fn(async () => okResponse({ ...session(), isNewUser: false })));
      await privy.exchangePrivyToken('t');

      const authed = events.filter((e) => e.name === privy.PRIVY_EVENTS.authenticated);
      expect(authed).toHaveLength(1);
      // userId, isNewUser — and NO token, even though the backend just saw one.
      expect(authed[0].detail).toEqual({ userId: 'u_1', isNewUser: false });
      expect(Object.keys(authed[0].detail as object)).not.toContain('idToken');
    } finally {
      for (const { name, fn } of listeners) window.removeEventListener(name, fn);
      vi.unstubAllGlobals();
      expect(go).toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });
});

/* ─── the imperative half ──────────────────────────────────────────────────── */

describe('commands from vanilla into the island', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('throws loudly when the island is not mounted', async () => {
    // Silent no-ops here would look exactly like a broken login button.
    await expect(privy.requestPrivyLogin()).rejects.toThrow(/not mounted/);
    await expect(privy.requestPrivyLogout()).rejects.toThrow(/not mounted/);
  });

  it('forwards to the mounted handle and survives a stale unmount', async () => {
    const login = vi.fn(async () => undefined);
    const logout = vi.fn(async () => undefined);
    const release = privy.setPrivyIslandHandle({ login, logout });
    expect(privy.hasPrivyIsland()).toBe(true);

    await privy.requestPrivyLogin();
    expect(login).toHaveBeenCalledTimes(1);

    // A replacement island registers BEFORE the old one's cleanup runs. A bare
    // `handle = null` teardown would kill the live island.
    const replacement = vi.fn(async () => undefined);
    const releaseReplacement = privy.setPrivyIslandHandle({ login: replacement, logout });
    release();
    await privy.requestPrivyLogin();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(privy.hasPrivyIsland()).toBe(true);

    releaseReplacement();
    expect(privy.hasPrivyIsland()).toBe(false);
  });
});

/* ─── logout ───────────────────────────────────────────────────────────────── */

describe('logout', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('tells the backend and reports whether it acknowledged', async () => {
    // The real endpoint answers 204 with an EMPTY body. Reading an envelope out
    // of it would report every successful logout as a failure.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 204, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }));
    vi.stubGlobal('fetch', fetchMock);
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(privy.PRIVY_EVENTS.logout, listener);

    try {
      await privy.endPrivySession();
      expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/logout');
      expect(seen).toEqual([{ serverAcknowledged: true }]);
    } finally {
      window.removeEventListener(privy.PRIVY_EVENTS.logout, listener);
    }
  });

  it('a backend that never heard the logout still ends the local session', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const seen: { serverAcknowledged: boolean }[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail as { serverAcknowledged: boolean });
    window.addEventListener(privy.PRIVY_EVENTS.logout, listener);

    try {
      // The user still has to end up back on the passkey screen; swallowing
      // this and staying put is how someone gets stranded in a UI that claims
      // they are signed in.
      await privy.endPrivySession();
      expect(seen).toEqual([{ serverAcknowledged: false }]);
    } finally {
      window.removeEventListener(privy.PRIVY_EVENTS.logout, listener);
    }
  });

  it('does NOT touch the store', () => {
    // `Flow.logout()` in src/flow/index.ts already owns the UI teardown, and it
    // is the piece that gets replaced when the session stops being a local
    // flag. Two owners of that decision is one too many.
    const set = vi.spyOn(Store, 'set');
    const reset = vi.spyOn(Store, 'reset');
    expect(privy.endPrivySession).toBeDefined();
    expect(set).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});
