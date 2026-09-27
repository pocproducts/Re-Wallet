import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * The onboarding profile, on the wire.
 *
 * The screen collected a name, an email, a phone and a tag, wrote all four into
 * the local store, and called it done. Nothing was sent: the database kept
 * `name = 'ReWallet'` and the provisional `@u…` tag while the phone showed a real
 * identity that existed nowhere but its own `localStorage`.
 *
 * The tag is the sharp end of it — it is public, it is what a payer types, and
 * only the server knows whether the derived handle was taken. So what matters
 * below is not "a fetch happened" but that the store ends up holding the tag that
 * came BACK.
 *
 * `save-profile` used to write four fields into the local store and call it done.
 * Nothing was sent, so the database kept `name = 'ReWallet'` and the provisional
 * `@u…` tag while the phone showed a real identity. The tag is the sharp end of
 * it: it is public, it is what a payer types, and only the server knows whether
 * the derived handle was taken. So what matters here is not "a fetch happened" —
 * it is that the store ends up holding the tag that came BACK.
 */

document.body.innerHTML =
  '<div class="device" id="device"><div class="app">' +
  '<div class="screens" id="screens" role="main"></div>' +
  '<div class="layer" id="layer"></div></div></div>';

await import('../src/config');
await import('../src/core/utils');
await import('../src/core/store');
await import('../src/core/api');
await import('../src/ui');
await import('../src/core/router');
await import('../src/components/icons');
await import('../src/components');
await import('../src/components/countries');
await import('../src/screens/shared');
await import('../src/screens/onboarding');
await import('../src/screens/passkey');
await import('../src/flow');
await import('../src/actions');
await import('../src/wire/privy');
await import('../src/wire/profile');

const Store = () => BP.store;

/** The API envelope, with a user the backend would have returned. */
const okUser = (over: Record<string, unknown> = {}) => ({
  user: {
    id: 'u_1',
    name: 'Ana Sofía Chen',
    firstName: 'Ana',
    lastName: 'Sofía Chen',
    tag: '@ana',
    email: 'ana@example.com',
    phone: '+549112345678',
    ...over,
  },
});

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, data }),
});

const bad = (status: number, error: string) => ({
  ok: false,
  status,
  json: async () => ({ ok: false, error, message: 'nope', code: status }),
});

/** Route by method+path, the two things the profile writes are distinguished by. */
const routeFetch = (routes: Record<string, () => unknown>) => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => k.endsWith(path) || path.endsWith(k));
    if (!key) throw new Error(`sin ruta para ${method} ${path}`);
    return routes[key]!();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
};

/** The onboarding form, filled in, as a container the action can be handed. */
const filledScreen = () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <input id="inp-first" value="Ana">
    <input id="inp-last" value="Sofía Chen">
    <input id="inp-email" value="ana@example.com">
    <input id="inp-phone" value="11 2345-6789">
    <button data-action="save-profile">Guardar</button>
  `;
  return { el: root.querySelector('button')!, root };
};

beforeEach(() => {
  BP.store.reset();
  BP.router.stack = [];
  // The router refuses to navigate while `busy` is true, and it clears the flag
  // on a 420ms timer. Without this, the first `go` in a test is silently ignored.
  BP.router.busy = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ─── the half-saved profile ───────────────────────────────────────────────── */

describe('saving the profile goes to the API', () => {
  it('writes the name and the recovery contacts, in that order', async () => {
    const { calls } = routeFetch({
      '/me/profile': () => ok(okUser()),
      '/me/recovery': () => ok(okUser()),
    });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PATCH /api/me/profile',
      'PATCH /api/me/recovery',
    ]);
    // The name is what allocates the tag, so it goes first.
    expect(calls[0]?.body).toMatchObject({ firstName: 'Ana', lastName: 'Sofía Chen' });
    expect(calls[1]?.body).toMatchObject({ email: 'ana@example.com' });
  });

  it('the tag in the store is the one the SERVER returned, not the local guess', async () => {
    // The sharp end of the whole bug. The server appends a suffix when the
    // derived handle is taken; a client that keeps its own guess shows a tag that
    // belongs to somebody else.
    routeFetch({
      '/me/profile': () => ok(okUser({ tag: '@ana2' })),
      '/me/recovery': () => ok(okUser({ tag: '@ana2' })),
    });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    expect(Store().get().bpTag).toBe('@ana2');
    expect(Store().get().userName).toBe('Ana Sofía Chen');
  });

  it('latches onboardingComplete only after the server agreed', async () => {
    routeFetch({
      '/me/profile': () => ok(okUser()),
      '/me/recovery': () => ok(okUser()),
    });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    expect(Store().get().onboardingComplete).toBe(true);
  });

  it('a failed save does NOT latch, and does not fake the name into the store', async () => {
    // The flag the logout routing used to trust. Setting it on a failed save is
    // how a user gets told they finished onboarding for a profile the server
    // never saw.
    //
    // `@servidor` is deliberately NOT the store's default `@ana`: the assertion
    // has to be able to tell "the write landed" from "nothing happened", and
    // `Store.reset()` restores a demo state that already carries a name and a tag.
    routeFetch({ '/me/profile': () => bad(500, 'internal') });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    expect(Store().get().onboardingComplete).toBe(false);
    expect(Store().get().bpTag).not.toBe('@servidor');
  });

  it('a failed RECOVERY does not undo the name that was already saved', async () => {
    // Otherwise the user is sent back to a form for an account that is already
    // named, and the tag gets allocated a second time.
    const { calls } = routeFetch({
      '/me/profile': () => ok(okUser({ tag: '@servidor' })),
      '/me/recovery': () => bad(400, 'validation_failed'),
    });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    // Both calls were made, in order: the name is not rolled back client-side.
    expect(calls).toHaveLength(2);
    expect(Store().get().onboardingComplete).toBe(false);
    // The store gets no half-state pretending to be saved.
    expect(Store().get().bpTag).not.toBe('@servidor');
  });

  it('a 200 with no user is a failure, not a success', async () => {
    // This is the exact shape the old `/me/recovery` stub answered with. Treating
    // it as success is how the first version of this flow lost a recovery email
    // without a single error.
    routeFetch({ '/me/profile': () => ok({ user: null }) });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    expect(Store().get().onboardingComplete).toBe(false);
  });

  it('the save button is not left spinning when the write fails', async () => {
    routeFetch({ '/me/profile': () => bad(500, 'internal') });

    const { el, root } = filledScreen();
    await BP.actions['save-profile']!(el, root);

    expect(el.classList.contains('is-loading')).toBe(false);
  });
});
