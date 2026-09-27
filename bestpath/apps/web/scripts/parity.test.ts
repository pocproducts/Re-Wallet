import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { BP } from '../src/core/bp';

/**
 * DOM parity with an approved-changes list.
 *
 * The new app is compared screen by screen against the original single-file
 * prototype, booted in its own JSDOM (isolated window, document and localStorage).
 * Both stores are seeded with identical state and every screen is rendered twice.
 *
 * When the product deliberately changes a screen, the new markup is recorded in
 * APPROVED_DIFFS rather than the test being deleted or the baseline replaced.
 * That distinction matters: a deleted parity test is indistinguishable from a
 * broken one, whereas an approved diff is a reviewable record of "we meant to
 * change this".
 *
 * Each entry records the screen and what changed. Adding a screen to this list
 * without changing the product is exactly the regression this test exists to
 * catch — so entries carry a reason.
 */

const ORIGINAL = '/home/lordbitcoin/Projects Web3/ReWALLET/bestpath-wallet.html';

/**
 * Screens whose markup is intentionally allowed to differ from the original.
 * Keep this list short and justify every entry — it is the only place where a
 * real regression can hide.
 */
const APPROVED_DIFFS: Record<string, string> = {
  home:
    'onboarding-v2/F7-F8: home reorganizada en dos filas explicitas (saldo / movimientos ' +
    'recientes), y el boton principal pasa a ser contextual: "Recibir dinero" destacado ' +
    'para un usuario nuevo, Enviar una vez que llego la primera plata.',
  welcome:
    'design-system-v2: el wordmark BESTPATH se reemplazo por el de ReWallet ("Re" neutro + ' +
    '"Wallet" en verde de marca, seccion 2 del design system) y el logo SVG paso de hex a token.',
  passkey:
    'design-system-v2: el trazo del icono Face ID paso de #7A6EFF a var(--rw-brand-500) (verde de marca).',
  receive:
    'design-system-v2: "Tu identificador BestPath" -> "ReWallet", y un var(--color-*) inline -> --rw-*.',
  'yield-detail':
    'design-system-v2: renombre de tokens en estilos inline (--color-text-secondary -> --rw-text-secondary). Sin cambio visual.',
  contacts:
    'design-system-v2: renombre de tokens en estilos inline (--color-text-secondary -> --rw-text-secondary). Sin cambio visual.',
  settings:
    'onboarding-v2: el perfil paso a mostrar nombre, correo y tag en tres filas junto a la foto, ' +
    'y agrego una seccion de contacto con el telefono (antes solo habia foto+nombre y un item de ' +
    'recuperacion). Ademas el pie muestra BP.config.version, que subio de 0.4 a 0.5 cuando se ' +
    'encadenaron las migraciones del store.',
};

const T = 1_757_000_000_000;
const STATE = {
  version: '0.5',
  onboardingComplete: true,
  session: true,
  userName: 'Ana',
  firstName: 'Ana',
  lastName: 'Sofía Chen',
  bpTag: '@ana',
  recoveryEmail: 'ana@example.com',
  recoveryPhone: '+549112345678',
  recoveryPhoneCountry: 'AR',
  hasReceivedFunds: true,
  balance: 1250.5,
  movements: [
    { id: 'm1', type: 'deposit', title: 'Depósito', amount: 1000, at: T },
    { id: 'm2', type: 'send', title: 'Envío a Carlos', amount: -120.25, at: T - 86_400_000 },
    { id: 'm3', type: 'yield', title: 'Rendimiento', amount: 3.19, at: T - 3 * 86_400_000 },
    { id: 'm4', type: 'send', title: 'Envío a María', amount: -80, at: T - 20 * 86_400_000 },
  ],
  contacts: [
    { id: 'c1', name: 'Carlos Méndez', tag: '@carlos', initials: 'CM', color: '#FF6B5B' },
    { id: 'c2', name: 'María López', tag: '@maria', initials: 'ML', color: '#34C759' },
  ],
  settings: { biometricEnabled: true, notificationsEnabled: true },
  yieldStartedAt: T - 604_800_000,
  createdAt: T,
  lastYieldAt: T,
};

const normalise = (s: string) =>
  s
    .replace(/hace \d+[ smhd]/g, 'hace <t>')
    .replace(/[a-z0-9]{8}\b/g, '<id>');

// The app boots against the real DOM shell. This must run before any module is
// imported: core/dom.ts resolves #layer and #screens at import time.
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

const dom = new JSDOM(readFileSync(ORIGINAL, 'utf8'), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const OLD = (dom.window as any).BP;

const SCREENS: [string, Record<string, unknown>][] = [
  ['welcome', {}],
  ['passkey', { mode: 'login' }],
  ['recovery', {}],
  ['home', {}],
  ['activity', {}],
  ['processing', { type: 'deposit' }],
  ['receive', {}],
  ['yield-detail', {}],
  ['settings', {}],
  ['contacts', {}],
];

const NEW_SCREENS = [
  'onboarding-profile',
  'onboarding-email',
  'onboarding-phone',
];

describe('parity harness', () => {
  it('booted the original prototype', () => {
    expect(OLD, 'original did not expose window.BP').toBeTruthy();
    expect(OLD.router, 'original router missing').toBeTruthy();
  });

  it('registers the original 9 screens plus any new ones', () => {
    const original = ['welcome', 'passkey', 'recovery', 'home', 'activity', 'processing', 'receive', 'yield-detail', 'settings', 'contacts'];
    const registered = Object.keys(BP.router.routes).sort();
    for (const name of original) expect(registered).toContain(name);
    // Anything beyond the original set must be a deliberate new screen.
    const extra = registered.filter((n) => !original.includes(n));
    for (const name of extra) {
      expect(NEW_SCREENS, `screen "${name}" is new and not declared as intentional`).toContain(name);
    }
  });
});

describe('approved-diff list', () => {
  it('every entry names a screen that actually exists', () => {
    for (const name of Object.keys(APPROVED_DIFFS)) {
      expect(BP.router.routes[name], `approved diff for unknown screen "${name}"`).toBeDefined();
    }
  });

  it('every entry carries a reason', () => {
    for (const [name, reason] of Object.entries(APPROVED_DIFFS)) {
      expect(reason.trim().length, `approved diff for "${name}" has no reason`).toBeGreaterThan(10);
    }
  });
});

describe('screens still compared against the original', () => {
  for (const [name, params] of SCREENS) {
    const approved = name in APPROVED_DIFFS;

    it(`"${name}" ${approved ? 'differs (approved)' : 'renders identical markup'}`, () => {
      OLD.store.reset();
      BP.store.reset();
      OLD.store.set(structuredClone(STATE));
      BP.store.set(structuredClone(STATE));

      const before = OLD.router.routes[name].render(structuredClone(params));
      const after = BP.router.routes[name].render(structuredClone(params));

      // Guard against a vacuous pass: a diff of two empty strings is green and
      // proves nothing.
      expect(after.length, `"${name}" rendered almost nothing`).toBeGreaterThan(200);

      if (approved) {
        // Still pinned: the change is allowed, but the screen must keep
        // rendering real markup and must not be identical any more.
        expect(normalise(after), `"${name}" is on the approved list but did not change`).not.toBe(
          normalise(before),
        );
        return;
      }
      expect(normalise(after)).toBe(normalise(before));
    });
  }
});
