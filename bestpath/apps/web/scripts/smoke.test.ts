import { describe, it, expect, beforeAll } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * Phase 0 smoke test.
 *
 * The point is not to test the product — it is to prove the extraction did not
 * break the module graph: every screen registered, and every renderer produces
 * real markup for a representative state. A render that returns '' or throws
 * means the wiring lost a dependency, which is the actual regression risk of
 * splitting one file into twenty-five.
 */

// The app boots against the real DOM shell. This must run before any module is
// imported: core/dom.ts resolves #layer and #screens at import time, and
// beforeAll would run too late.
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
await import('../src/screens/shared');
await import('../src/screens/welcome');
await import('../src/screens/passkey');
await import('../src/screens/recovery');
await import('../src/screens/home');
await import('../src/screens/activity');
await import('../src/screens/processing');
await import('../src/screens/receive');
await import('../src/screens/yield-detail');
await import('../src/screens/settings');
await import('../src/screens/contacts');
await import('../src/flow');
await import('../src/actions');

const SCREENS = [
  'welcome',
  'passkey',
  'recovery',
  'home',
  'activity',
  'processing',
  'receive',
  'yield-detail',
  'settings',
  'contacts',
] as const;

const seed = () => {
  const Store = BP.store;
  // boot() normally loads this; the smoke test drives the store directly.
  const s = Store.load();
  s.balance = 1250.5;
  s.movements = [
    { id: 'm1', type: 'deposit', title: 'Depósito', amount: 1000, at: Date.now() },
    { id: 'm2', type: 'send', title: 'Envío a Carlos', amount: -120, at: Date.now() - 86400000 },
    { id: 'm3', type: 'yield', title: 'Rendimiento', amount: 3.2, at: Date.now() - 604800000 },
  ];
  s.userName = 'Ana';
  s.bpTag = '@ana';
  s.onboardingComplete = true;
  s.session = true;
  Store.save();
};

describe('module graph', () => {
  it('exposes every namespace member on BP', () => {
    for (const key of ['config', 'utils', 'store', 'api', 'ui', 'router', 'flow', 'actions']) {
      expect(BP[key], `BP.${key} missing`).toBeTruthy();
    }
  });
});

describe('router registration', () => {
  it('registered all 9 screens plus no strays', () => {
    expect(Object.keys(BP.router.routes).sort()).toEqual([...SCREENS].sort());
  });
});

describe('screen renderers', () => {
  beforeAll(seed);

  for (const name of SCREENS) {
    it(`renders non-empty markup for "${name}"`, () => {
      const route = BP.router.routes[name];
      let html: string;
      // processing/receive read store state; params cover the branches
      const params = name === 'passkey' ? { mode: 'login' } : name === 'processing' ? { type: 'deposit' } : {};
      expect(() => {
        html = route.render(params);
      }, `${name} threw while rendering`).not.toThrow();
      expect(typeof html).toBe('string');
      expect(html.length, `${name} rendered nothing`).toBeGreaterThan(0);
    });
  }
});

describe('data boundary', () => {
  it('exposes the mock api surface the wiring phase will replace', () => {
    for (const m of ['addMoney', 'sendMoney', 'accrueYield', 'createPaymentRequest']) {
      expect(typeof BP.api[m], `BP.api.${m} missing`).toBe('function');
    }
  });
});
