import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * Why a real user could not get back in.
 *
 * The chain, all of it in this repo: `logout` asked a flag that lives in the
 * browser, `onboardingComplete`; that flag was false for anyone whose profile
 * save never happened; false routed to `welcome`; `welcome`'s main button carries
 * `data-mode="onboarding"`, which starts a REGISTRATION ceremony; and Privy
 * refuses to register a passkey that already exists. The account was real, the
 * passkey worked, and the user was told their fingerprint reader was broken.
 *
 * Two places could regress this, and both are pinned below. The screen's default
 * ceremony matters on its own: any navigation to `passkey` that forgot to name
 * its ceremony used to get "register" by default — the default that can only
 * ever fail.
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
await import('../src/screens/welcome');
await import('../src/screens/passkey');
await import('../src/screens/home');
await import('../src/flow');
await import('../src/actions');
await import('../src/wire/privy');

const { setPrivyIslandHandle } = await import('../src/wire/privy');

const Router = () => BP.router;

/** The screen the router is on, read the way the router stores it. */
const currentScreen = (): string | undefined => Router().current?.dataset.screen;

/** The HTML a screen produces, without navigating to it. */
const renderOf = (name: string, params: Record<string, unknown> = {}): string =>
  Router().routes[name].render(params) as string;

beforeEach(() => {
  BP.store.reset();
  BP.router.stack = [];
  // The router refuses to navigate while `busy` is true and clears the flag on a
  // 420ms timer, so without this the first `go` of a test is silently ignored.
  BP.router.busy = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('logging out always lands on the LOGIN ceremony', () => {
  // Both values, because the flag used to decide this and it is false for anyone
  // whose profile save failed — which is how a real account ended up behind a
  // "you are new here" screen.
  for (const onboardingComplete of [true, false]) {
    it(`routes to passkey/login with onboardingComplete=${onboardingComplete}`, async () => {
      BP.store.set({ onboardingComplete });
      // The confirm dialog is a UI modal; what is under test is where the user
      // ends up, not the modal.
      vi.spyOn(BP.ui, 'confirm').mockResolvedValue(true);

      await BP.flow.logout();

      expect(currentScreen()).toBe('passkey');
      expect(Router().stack.at(-1)).toBe('passkey');
    });
  }

  it('never routes to welcome, which offers registration', async () => {
    // Asserted as a negative because `welcome` is not wrong in itself: it is
    // wrong as a destination for somebody who just logged out of an account.
    BP.store.set({ onboardingComplete: false });
    vi.spyOn(BP.ui, 'confirm').mockResolvedValue(true);

    await BP.flow.logout();

    expect(currentScreen()).not.toBe('welcome');
  });

  it('a cancelled confirm does not navigate at all', async () => {
    const before = currentScreen();
    vi.spyOn(BP.ui, 'confirm').mockResolvedValue(false);

    await BP.flow.logout();

    expect(currentScreen()).toBe(before);
  });
});

describe('the passkey screen defaults to login, not to registration', () => {
  const renderMode = (params: Record<string, unknown>) =>
    /data-mode="([^"]+)"/.exec(renderOf('passkey', params))?.[1];

  it('without a mode it asks to SIGN IN', () => {
    // The regression in one line: the default used to be 'onboarding'.
    expect(renderMode({})).toBe('login');
  });

  it('an explicit onboarding mode still registers', () => {
    expect(renderMode({ mode: 'onboarding' })).toBe('onboarding');
  });

  it('a nonsense mode falls back to login, not to register', () => {
    // The default has to be the ceremony that cannot lock anyone out.
    expect(renderMode({ mode: 'wat' })).toBe('login');
  });
});

describe('a failed ceremony does not blame the fingerprint', () => {
  // A handle is installed rather than an island mounted: `hasPrivyIsland()` is
  // what selects the branch, and registering a handle is enough to take it
  // without pulling in Preact and the whole Privy SDK.
  const install = () => {
    const toasts: string[] = [];
    vi.spyOn(BP.ui, 'toast').mockImplementation((message: string) => {
      toasts.push(message);
    });
    return {
      toasts,
      uninstall: setPrivyIslandHandle({
        login: async () => { throw new Error('privy: no credential'); },
        register: async () => { throw new Error('privy: not allowed'); },
        logout: async () => {},
      } as never),
    };
  };

  const tap = async (mode: string) => {
    const host = document.createElement('div');
    host.innerHTML = `<button data-action="biometric" data-mode="${mode}" data-label="Face ID">x</button>`;
    await BP.actions['biometric']!(host.querySelector('button')!, host);
  };

  it('tells someone who pressed "Empezar" that they may already have an account', async () => {
    // A person with an account pressing the register button is indistinguishable
    // from a broken reader unless the copy says otherwise. This is the exact case
    // the logout routing used to create.
    const { toasts, uninstall } = install();
    try {
      await tap('onboarding');
    } finally {
      uninstall();
    }
    expect(toasts.join(' | ')).toMatch(/si ya (tenías|tenes) una/i);
  });

  it('does not tell a signing-in user to create an account', async () => {
    const { toasts, uninstall } = install();
    try {
      await tap('login');
    } finally {
      uninstall();
    }
    expect(toasts.join(' | ')).not.toMatch(/si ya (tenías|tenes) una/i);
  });
});
