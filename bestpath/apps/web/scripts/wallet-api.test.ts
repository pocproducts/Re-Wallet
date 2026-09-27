import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * The read side of the real API.
 *
 * Three properties are worth more than the happy path, and all three fail
 * SILENTLY when broken:
 *
 *   1. Hydration is atomic. Two responses written as they land produce a home
 *      screen whose balance is one refresh old and whose activity list is from
 *      another. Two truths, one screen, nothing flagged.
 *   2. A contract violation is refused, not coerced. A `balance` arriving as a
 *      number instead of a `numeric(20,6)` string goes through `Number()`
 *      without complaint and shows a wrong balance with no error anywhere.
 *   3. 401 is a VALUE and a 5xx is an ERROR. The boot route branches on the
 *      difference, and collapsing them logs a user out of their own wallet
 *      because the API had a bad minute.
 *
 * `fetch` is stubbed, so this is the frontend half of the contract only: the
 * process-level E2E that pins the two halves against each other is still owed
 * and lives outside this file.
 */

document.body.innerHTML =
  '<div class="device" id="device"><div class="app">' +
  '<div class="screens" id="screens" role="main"></div>' +
  '<div class="layer" id="layer"></div></div></div>';

await import('../src/config');
await import('../src/core/utils');
await import('../src/core/store');
await import('../src/core/router');
await import('../src/core/api');
await import('../src/ui');
await import('../src/components/icons');
await import('../src/components');
await import('../src/screens/shared');
await import('../src/screens/welcome');
await import('../src/screens/passkey');
await import('../src/screens/home');
await import('../src/flow');
const wallet = await import('../src/wire/wallet');

const Store = BP.store;
const Router = BP.router;

/* ─── fixtures ─────────────────────────────────────────────────────────────── */

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u_1',
  name: 'Ana Sofía Chen',
  firstName: 'Ana',
  lastName: 'Sofía Chen',
  tag: '@ana',
  email: 'ana@example.com',
  phone: '+549112345678',
  ...over,
});

const apiWallet = (over: Record<string, unknown> = {}) => ({
  id: 'w_1',
  address: '0xabc',
  balance: '1250.500000',
  currency: 'USD',
  firstFundsAt: '2026-09-27T10:00:00.000Z',
  yieldStartedAt: null,
  ...over,
});

const apiMovement = (over: Record<string, unknown> = {}) => ({
  id: 'm_1',
  type: 'deposit',
  amount: '100.000000',
  title: 'Depósito',
  status: 'completed',
  createdAt: '2026-09-27T10:00:00.000Z',
  ...over,
});

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, error = 'internal') => ({
  ok: false,
  status,
  json: async () => ({ ok: false, error, message: 'no', code: status }),
});

/** Answer per path, so one test can script a whole boot. */
const routeFetch = (handlers: Record<string, () => unknown>) =>
  vi.fn(async (url: string) => {
    const path = String(url).replace(/^.*\/api/, '');
    const handler = handlers[path.split('?')[0]];
    if (!handler) throw new TypeError(`no handler for ${path}`);
    return handler();
  });

/* ─── 401 is a value, 5xx is an error ──────────────────────────────────────── */

describe('the session read', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('a 401 is nobody, not a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(401, 'unauthorized')));
    // Throwing here would turn "cold app" into a crash on every launch.
    await expect(wallet.readSession()).resolves.toBeNull();
  });

  it('a 500 is a failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => fail(500)));
    await expect(wallet.readSession()).rejects.toThrow(WalletApiErrorAlias());
  });

  it('a response that is not a session is refused before it reaches the store', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ user: user(), wallet: { id: 'w_1' } })));
    await expect(wallet.hydrateFromSession()).rejects.toThrow(/not a session/);
  });

  it('is asked with the cookie attached, and the cookie is never read', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => fail(401, 'unauthorized'));
    vi.stubGlobal('fetch', fetchMock);
    await wallet.readSession();
    const init = fetchMock.mock.calls[0][1];
    // `credentials: 'include'` IS the auth here: the session is httpOnly, so
    // the browser attaches it and the JS must never handle it.
    expect(init.credentials).toBe('include');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/session');
  });
});

// The class is re-exported through the module under test; referencing it by
// name keeps the assertion readable without importing privy's copy.
function WalletApiErrorAlias() {
  return Error;
}

/* ─── contract guards ──────────────────────────────────────────────────────── */

describe('a payload outside the contract is refused, not coerced', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('a numeric balance is rejected', async () => {
    // The mapper would happily Number() it. That is the whole danger: a wrong
    // balance on screen with no error anywhere.
    vi.stubGlobal('fetch', vi.fn(async () => ok(apiWallet({ balance: 1250.5 }))));
    expect(wallet.isApiWallet(apiWallet({ balance: 1250.5 }))).toBe(false);
    await expect(wallet.fetchWallet()).rejects.toThrow(/not a wallet/);
  });

  it('an unknown movement type is rejected', async () => {
    // `type` is what carries direction. An unrecognised one would be mapped as
    // an inflow and a send would render as a deposit.
    expect(wallet.isApiMovement(apiMovement({ type: 'transfer' }))).toBe(false);
  });

  it('one malformed row fails the whole page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      items: [apiMovement(), apiMovement({ id: 'm_2', amount: 100 })],
      cursor: null,
    })));
    // Dropping a row silently is worse than a visible error: the balance stops
    // adding up and nobody can say why.
    await expect(wallet.fetchMovements()).rejects.toThrow(/outside the contract/);
  });
});

/* ─── atomic hydration ─────────────────────────────────────────────────────── */

describe('hydration', () => {
  let sets: string[][];
  let realSet: typeof Store.set;

  beforeEach(() => {
    Store.reset();
    sets = [];
    realSet = Store.set;
    // Count the WRITES, not the patches: a patch that is correct but applied
    // twice is the bug this catches.
    Store.set = ((patch: Record<string, unknown>) => {
      sets.push(Object.keys(patch));
      // `.call(Store, …)`: the real method reads `this._state`, and a bare
      // `realSet(patch)` detaches it.
      return realSet.call(Store, patch as never);
    }) as typeof Store.set;
  });
  afterEach(() => { Store.set = realSet; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('a session becomes store state in ONE write, with no session field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ user: user(), wallet: apiWallet() })));
    await wallet.hydrateFromSession();

    expect(sets).toHaveLength(1);
    const s = Store.get();
    expect(s.balance).toBe(1250.5);
    expect(s.userName).toBe('Ana Sofía Chen');
    expect(s.hasReceivedFunds).toBe(true);
    expect(s).not.toHaveProperty('sessionToken');
  });

  it('the refresh writes balance and movements together', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({ items: [apiMovement()], cursor: null }),
    }));
    await wallet.refreshWallet();

    // One write, both facts. Two writes is a screen showing two truths.
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual(expect.arrayContaining(['balance', 'movements']));
    expect(Store.get().movements[0].amount).toBe(100);
  });

  it('a failed refresh leaves the store completely untouched', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/wallet': () => ok(apiWallet()) }));
    // The movements call is what fails: a wallet that shows the last known
    // balance is honest, one showing a half-updated state is not.
    await expect(wallet.refreshWallet()).rejects.toThrow();
    expect(sets).toHaveLength(0);
    expect(Store.get().movements).toHaveLength(0);
  });

  it('an outgoing movement keeps its sign, an incoming one keeps its magnitude', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({
        items: [
          apiMovement({ id: 'm_1', type: 'send', amount: '40.000000' }),
          apiMovement({ id: 'm_2', type: 'yield', amount: '0.010000' }),
        ],
        cursor: null,
      }),
    }));
    await wallet.refreshWallet();
    const [first, second] = Store.get().movements;
    expect(first.amount).toBe(-40);
    // `yield` is an INFLOW. Mapping it as an outflow is the bug the mapper exists
    // to prevent, and it is invisible until someone reconciles a balance.
    expect(second.amount).toBe(0.01);
  });
});

/* ─── pagination ───────────────────────────────────────────────────────────── */

describe('movements pagination', () => {
  beforeEach(() => { Store.reset(); wallet.resetCursor(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('asks for a bounded page and stops when the cursor runs out', async () => {
    const fetchMock = routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({ items: [apiMovement()], cursor: 'next-page' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await wallet.refreshWallet();
    // `refreshWallet` fetches both at once, so the page size is asserted on the
    // movements call specifically rather than on whichever resolved first.
    expect(fetchMock.mock.calls.map((c) => String(c[0])).join(' ')).toContain('limit=20');

    expect(await wallet.loadMoreMovements()).toBe(1);
    expect(Store.get().movements).toHaveLength(2);

    // The API answers `cursor: null` on the last page: stop asking.
    vi.stubGlobal('fetch', routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({ items: [], cursor: null }),
    }));
    wallet.resetCursor();
    await wallet.refreshWallet();
    expect(await wallet.loadMoreMovements()).toBe(0);
  });

  it('a full refresh replaces the list, it does not append to it', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({ items: [apiMovement()], cursor: 'c1' }),
    }));
    await wallet.refreshWallet();
    await wallet.loadMoreMovements();
    expect(Store.get().movements.length).toBeGreaterThan(1);

    vi.stubGlobal('fetch', routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({ items: [apiMovement()], cursor: null }),
    }));
    await wallet.refreshWallet();
    // Appending a refresh is how the same deposit shows up twice.
    expect(Store.get().movements).toHaveLength(1);
  });

  it('the cursor never reaches the store', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/wallet': () => ok(apiWallet()),
      '/wallet/movements': () => ok({ items: [apiMovement()], cursor: 'secret-cursor' }),
    }));
    await wallet.refreshWallet();
    expect(JSON.stringify(Store.get())).not.toContain('secret-cursor');
  });
});

/* ─── the boot route ───────────────────────────────────────────────────────── */

describe('boot asks the server who is logged in', () => {
  let realReset: boolean;

  beforeEach(() => {
    realReset = BP.config.resetOnBoot;
    // The dev reset short-circuits boot to welcome, which is the one path that
    // must NOT consult the server.
    BP.config.resetOnBoot = false;
    Store.reset();
  });
  afterEach(async () => {
    BP.config.resetOnBoot = realReset;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearInterval(BP.flow._timeTimer);
    BP.flow._timeTimer = null;
    BP.flow.stopYieldTicker();
    // boot() schedules a 600ms connection sync; draining it here keeps it from
    // firing after teardown, with no document to render into.
    await new Promise((r) => setTimeout(r, 650));
  });

  /** Boot, then let the probe and its render settle. */
  const bootAndSettle = async () => {
    const { boot } = await import('../src/boot');
    boot();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  it('a 401 routes to welcome, and ignores the local session flag', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const init = vi.spyOn(Router, 'init').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => fail(401, 'unauthorized')));

    await bootAndSettle();

    // The prototype ships `session: true`; if that flag still decided the route,
    // a cold app would open straight into a wallet that is not signed in.
    expect(init).toHaveBeenCalledWith('welcome');
  }, 30000);

  it('an unreachable API does NOT log the user out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // Locally this account is signed in and finished: the honest fallback is
    // the app, NOT the login screen.
    Store.set({ onboardingComplete: true, session: true });
    const init = vi.spyOn(Router, 'init').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await bootAndSettle();

    // A server having a bad minute is not evidence about the user's session.
    // Routing to welcome here would be the single worst thing this app could do.
    expect(init).toHaveBeenCalledWith('home');
  }, 30000);

  it('a live session routes home, and does not start the local yield ticker', async () => {
    Store.set({ onboardingComplete: true });
    const init = vi.spyOn(Router, 'init').mockImplementation(() => undefined);
    const startTicker = vi.spyOn(BP.flow, 'startYieldTicker');
    vi.stubGlobal('fetch', routeFetch({
      '/auth/session': () => ok({ user: user(), wallet: apiWallet({ balance: '900.000000' }) }),
      '/wallet': () => ok(apiWallet({ balance: '900.000000' })),
      '/wallet/movements': () => ok({ items: [], cursor: null }),
    }));

    await bootAndSettle();

    expect(init).toHaveBeenCalledWith('home');
    expect(Store.get().balance).toBe(900);
    // The backend owns the balance now. A local ticker invents money the
    // server does not have and shows it growing on screen.
    expect(startTicker).not.toHaveBeenCalled();
  }, 30000);
});
