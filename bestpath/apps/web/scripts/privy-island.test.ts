import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BP } from '../src/core/bp';

/**
 * Integration contract of the Privy island ⇄ vanilla wiring.
 *
 * `scripts/privy.test.ts` proves the seam is safe in isolation. This file pins
 * the two things that are only observable once the seam is actually PLUGGED IN,
 * and that fail silently — a login button that animates and does nothing, or a
 * logout that never reaches the backend:
 *
 *   1. `boot()` mounts the island on BOTH of its return paths. A mount missing
 *      from the dev path is a login that is dead in exactly the flow a developer
 *      exercises daily, and it typechecks fine.
 *   2. `data-action="biometric"` delegates to the island when there is one, and
 *      runs the local mock when there is not. The second half matters as much:
 *      172 tests and every dev without a Privy App ID depend on it.
 *
 * No React is mounted here. The island is a black box reachable only through
 * `setPrivyIslandHandle`, which is exactly the surface the vanilla side uses.
 */

document.body.innerHTML =
  '<div class="device" id="device"><div class="app">' +
  '<div class="screens" id="screens" role="main"></div>' +
  '<div class="layer" id="layer"></div></div></div>';

await import('../src/config');
await import('../src/core/utils');
await import('../src/core/store');
await import('../src/core/router');
await import('../src/components/icons');
await import('../src/components');
await import('../src/screens/shared');
await import('../src/screens/welcome');
await import('../src/screens/passkey');
await import('../src/flow');
await import('../src/actions');
const privy = await import('../src/wire/privy');

const Store = BP.store;
const Router = BP.router;
const Actions = BP.actions;
const Flow = BP.flow;

/** A `data-action="biometric"` element, built the way the screen builds it. */
const biometricButton = (mode: 'onboarding' | 'login' = 'onboarding') => {
  const el = document.createElement('button');
  el.dataset.action = 'biometric';
  el.dataset.label = 'Face ID';
  el.dataset.mode = mode;
  document.body.appendChild(el);
  return el;
};

/** A mounted island, and the handle that puts it back the way it was. */
const withIsland = () => {
  const calls: string[] = [];
  const release = privy.setPrivyIslandHandle({
    login: async () => { calls.push('login'); },
    register: async () => { calls.push('register'); },
    logout: async () => { calls.push('logout'); },
  });
  return { calls, release };
};

/* ─── the mount itself ─────────────────────────────────────────────────────── */

describe('the island is mounted by boot, on every path', () => {
  it('the mount is a DYNAMIC import, so a build with no App ID never loads the SDK', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/boot.ts'), 'utf8');
    // A static import would put Preact + @privy-io/react-auth in the boot graph
    // of an app that has no Privy configured: a login nobody can use, billed as
    // startup cost. The build proves the chunk exists and is separate; this
    // proves nothing pulls it in eagerly.
    expect(src).toMatch(/import\(['"]\.\/wire\/privy-island['"]\)/);
    expect(src).not.toMatch(/^import .*privy-island/m);
  });

  it('is called once, from a helper both return paths share', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/boot.ts'), 'utf8');
    // Exactly one call site: a second one would re-mount the island behind
    // Preact's back and orphan the first tree mid-ceremony.
    const callSites = src.match(/void mountPrivyIslandOnce\(\)/g) ?? [];
    expect(callSites).toHaveLength(1);
    // It must sit BEFORE the dev-reset early return, which is the path that is
    // easy to forget.
    expect(src.indexOf('void mountPrivyIslandOnce()')).toBeLessThan(src.indexOf('if (shouldResetOnBoot()){', src.indexOf('void mountPrivyIslandOnce()')));
  });

  it('boot actually reaches the mount', async () => {
    // Behavioural, not textual: with no VITE_PRIVY_APP_ID the island declines to
    // mount and says so. If boot stopped calling the helper, that line goes
    // quiet. The import is dynamic AND the module graph behind it is the whole
    // Privy SDK, so this polls instead of assuming one tick is enough — and the
    // test carries an explicit timeout because in a full parallel run that
    // graph takes seconds to transform, which is not what is under test.
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { boot } = await import('../src/boot');
      boot();
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
        if (info.mock.calls.some((c) => String(c[0]).includes('sin VITE_PRIVY_APP_ID'))) break;
        if (warn.mock.calls.some((c) => String(c[0]).includes('la isla de passkey no se montó'))) break;
      }

      /* WHAT THIS TEST PROVES, AND WHAT IT DELIBERATELY DOES NOT.
       *
       * It proves boot REACHED the mount and that a mount failure cannot take the
       * app down — which is the invariant that lives in boot.
       *
       * It does NOT prove the island renders. It cannot: vitest externalizes
       * node_modules, so the `react` → `preact/compat` alias does not apply to
       * the SDK and React 18's hooks run with a null dispatcher. That failure is
       * an artefact of the test environment, not the browser, where the alias
       * does apply (the production build resolves the island into its own chunk).
       *
       * Which means the real render is still UNPROVEN, and the honest place to
       * prove it is a browser smoke with a real Privy App ID — not a unit test
       * that would be asserting a lie either way. Both endings are accepted here
       * precisely because this test is not the one that decides.
       */
      const attempted = info.mock.calls.some((c) => String(c[0]).includes('sin VITE_PRIVY_APP_ID'))
        || warn.mock.calls.some((c) => String(c[0]).includes('la isla de passkey no se montó'));
      expect(attempted, 'boot must reach the island mount').toBe(true);

      // The app came up anyway, which is the part that has to hold in every
      // environment: a login that cannot mount is not a reason to fail to start.
      // The route renders through a transition, so this waits for the DOM rather
      // than assuming the screen is there the instant boot returns.
      await new Promise((r) => setTimeout(r, 700));
      expect(document.querySelector('#screens')?.children.length ?? 0).toBeGreaterThan(0);
    } finally {
      // boot() owns timers this test must not leak: the 600ms connection sync
      // and the 30s time refresher would otherwise fire after teardown, with no
      // document to render into.
      await new Promise((r) => setTimeout(r, 650));
      clearInterval(Flow._timeTimer);
      Flow._timeTimer = null;
      Flow.stopYieldTicker();
      info.mockRestore();
      warn.mockRestore();
    }
  }, 30000);
});

describe('the island container', () => {
  it('is never parented to a screen, because the router destroys those', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/wire/privy-island.tsx'), 'utf8');
    // The guard exists in the island; this pins the host CHOICE in boot, which
    // is where the mistake would actually be made.
    expect(src).toContain("closest('section.screen')");
    const boot = readFileSync(resolve(process.cwd(), 'src/boot.ts'), 'utf8');
    expect(boot).toContain("querySelector<HTMLElement>('.app')");
    expect(boot).not.toContain("getElementById('screens')");
  });
});

/* ─── the login button ─────────────────────────────────────────────────────── */

describe('the biometric button', () => {
  let biometric: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Store.reset();
    // The mock ceremony is a real 4s animation. What is under test is WHICH
    // branch runs, not how the animation looks, and an animation that outlives
    // the test would make the assertion a timeout instead of a failure.
    biometric = vi.spyOn(BP.ui, 'biometric').mockImplementation(async () => true);
  });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('delegates to the island and runs NO local login when one is mounted', async () => {
    const { calls, release } = withIsland();
    const go = vi.spyOn(Router, 'go').mockImplementation(() => undefined);
    try {
      await Actions['biometric'](biometricButton('login'));
      expect(calls).toEqual(['login']);
      // The mock branch would have animated and navigated. The bridge owns both
      // decisions, and it makes them from the BACKEND's answer.
      expect(biometric).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('falls back to the local mock when no island is mounted', async () => {
    expect(privy.hasPrivyIsland()).toBe(false);
    const go = vi.spyOn(Router, 'go').mockImplementation(() => undefined);
    await Actions['biometric'](biometricButton('login'));
    // This is the path 172 tests and any dev without a Privy App ID depend on.
    expect(biometric).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('home', expect.objectContaining({ transition: 'fade' }));
  });

  it('without an island, onboarding still routes to onboarding and not to home', async () => {
    const go = vi.spyOn(Router, 'go').mockImplementation(() => undefined);
    await Actions['biometric'](biometricButton('onboarding'));
    // The two modes are different journeys, and the mock has to keep telling
    // them apart even though the island branch is the one under test here.
    expect(go).toHaveBeenCalledWith('onboarding', expect.objectContaining({ transition: 'forward' }));
  });

  it('ONBOARDING asks the island to SIGN UP, not to sign in', async () => {
    // The regression this whole file exists for. `loginWithPasskey()` asserts a
    // credential that already exists; on a device that has never registered it
    // fails as `passkey_not_allowed`, which the user sees as a broken Face ID
    // when it is actually a sign-in asked where only a sign-up is true.
    const { calls, release } = withIsland();
    const go = vi.spyOn(Router, 'go').mockImplementation(() => undefined);
    try {
      await Actions['biometric'](biometricButton('onboarding'));
      expect(calls).toEqual(['register']);
      expect(calls).not.toContain('login');
      expect(go).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('a handle that cannot sign up cannot pass the island contract', async () => {
    // A handle with no `register` is not a valid island. Asserted on the TYPE,
    // not on behaviour, because the failure it prevents is a crash the first
    // time somebody taps "create account" — the one journey that has never run.
    const src = readFileSync(resolve(process.cwd(), 'src/wire/privy.ts'), 'utf8');
    const iface = src.slice(src.indexOf('export interface PrivyIslandHandle'));
    expect(iface.slice(0, iface.indexOf('}'))).toMatch(/\bregister\(\):\s*Promise<void>;/);
  });

  it('a rejected SIGN-UP ceremony reports it and writes nothing', async () => {
    // The signup branch needs its own failure test: the sign-in one passing
    // says nothing about the path a new user actually takes.
    const toast = vi.spyOn(BP.ui, 'toast').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const go = vi.spyOn(Router, 'go').mockImplementation(() => undefined);
    const release = privy.setPrivyIslandHandle({
      login: async () => undefined,
      register: async () => { throw new Error('no credential'); },
      logout: async () => undefined,
    });
    try {
      await Actions['biometric'](biometricButton('onboarding'));
      expect(toast).toHaveBeenCalledTimes(1);
      expect(go).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('a rejected ceremony reports it and writes nothing', async () => {
    // `login` mode, because that is the ceremony whose rejection this handle
    // throws. It used to be `onboarding`, which only exercised the throw by
    // accident: onboarding called login before, and now calls signup, so the
    // handle below and the button above would disagree about which ceremony
    // even runs. A test that reaches its assertion for the wrong reason is
    // worse than no test.
    const toast = vi.spyOn(BP.ui, 'toast').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const go = vi.spyOn(Router, 'go').mockImplementation(() => undefined);
    const release = privy.setPrivyIslandHandle({
      login: async () => { throw new Error('user cancelled'); },
      register: async () => undefined,
      logout: async () => undefined,
    });
    try {
      await Actions['biometric'](biometricButton('login'));
      // A silent failure here is a button that animates and does nothing.
      expect(toast).toHaveBeenCalledTimes(1);
      // The user must NOT be walked into the mock onboarding as if it worked.
      expect(go).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
});

/* ─── logout ───────────────────────────────────────────────────────────────── */

describe('logout', () => {
  beforeEach(() => { Store.reset(); Store.set({ session: true, onboardingComplete: true }); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ends the server session BEFORE the local state is wiped', async () => {
    const order: string[] = [];
    vi.spyOn(BP.ui, 'confirm').mockImplementation(async () => true);
    const release = privy.setPrivyIslandHandle({
      login: async () => undefined,
      register: async () => undefined,
      logout: async () => { order.push(Store.get().session ? 'logout' : 'logout-after-wipe'); },
    });
    try {
      await Flow.logout();
      // A logout that runs after the wipe can no longer be traced to a session.
      expect(order).toEqual(['logout']);
      expect(Store.get().session).toBe(false);
    } finally {
      release();
    }
  });

  it('still tears the user down locally when the backend never answers', async () => {
    vi.spyOn(BP.ui, 'confirm').mockImplementation(async () => true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const release = privy.setPrivyIslandHandle({
      login: async () => undefined,
      register: async () => undefined,
      logout: async () => { throw new Error('offline'); },
    });
    try {
      await Flow.logout();
      // Stranding someone in a UI that claims to be signed in is worse than a
      // stale server session, which expires on its own.
      expect(Store.get().session).toBe(false);
    } finally {
      release();
    }
  });

  it('does not call the island when none is mounted', async () => {
    vi.spyOn(BP.ui, 'confirm').mockImplementation(async () => true);
    const request = vi.spyOn(privy, 'requestPrivyLogout');
    try {
      await Flow.logout();
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });
});
