import { describe, it, expect, beforeEach } from 'vitest';
import { BP } from '../src/core/bp';
// Store/U are reached through BP, not imported statically: store.ts reads
// BP.config at module-evaluation time, and the config module is only pulled in
// by the dynamic imports below.

/**
 * Onboarding v2 as a single screen: name row, email, phone, tag.
 *
 * The interesting behaviour is the tag. It is user-editable, but the SERVER owns
 * availability — the client sanitises, recommends, and asks; it never invents a
 * handle. So the tests pin what the client is allowed to decide and what it
 * must leave to the API.
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
await import('../src/screens/recovery');
await import('../src/flow');
await import('../src/actions');

const Store = () => BP.store;
const U = () => BP.utils;

const render = () => {
  BP.store.reset();
  return BP.router.routes['onboarding'].render({}) as string;
};

describe('onboarding: single screen', () => {
  it('is registered', () => {
    expect(BP.router.routes['onboarding']).toBeDefined();
  });

  it('the three separate steps are gone from the first-run flow', () => {
    for (const name of ['onboarding-profile', 'onboarding-email', 'onboarding-phone']) {
      expect(BP.router.routes[name], `${name} should no longer exist`).toBeUndefined();
    }
  });

  it('keeps the legacy recovery screen for editing', () => {
    expect(BP.router.routes['recovery']).toBeDefined();
  });
});

describe('onboarding: layout — the four rows', () => {
  it('row 1 has first and last name in a two-column grid', () => {
    const html = render();
    expect(html).toContain('grid-2');
    expect(html).toContain('inp-first');
    expect(html).toContain('inp-last');
  });

  it('row 2 has the email below the names', () => {
    const html = render();
    const iNames = html.indexOf('inp-first');
    const iEmail = html.indexOf('inp-email');
    expect(iEmail).toBeGreaterThan(iNames);
  });

  it('row 3 has the country picker and the phone number', () => {
    const html = render();
    expect(html).toContain('pick-country');
    expect(html).toContain('inp-phone');
  });

  it('row 3 shows the tag, generated rather than typed', () => {
    const html = render();
    expect(html).toContain('data-tag-value');
    expect(html).toContain('Tu usuario');
    // There is NO input: the user does not choose their handle.
    expect(html).not.toContain('inp-tag');
  });

  it('the four inputs use placeholders, not floating labels', () => {
    const html = render();
    for (const ph of ['Nombre', 'Apellido', 'Tu correo', 'Número']) {
      expect(html, `missing placeholder ${ph}`).toContain(`placeholder="${ph}"`);
    }
    // no <label for=...> captions on those four
    expect(html).not.toMatch(/<label[^>]*for="inp-(first|last|email|phone)"/);
  });

  it('row 4 has the flag, the area code and the number side by side', () => {
    const html = render();
    expect(html).toContain('phone-row__country');
    expect(html).toContain('data-country-flag');
    expect(html).toContain('phone-row__dial');
    expect(html).toContain('inp-phone');
  });

  it('defaults to Argentina', () => {
    expect(render()).toContain('+54');
  });

  it('the area code sits beside the number, not inside it', () => {
    // Prepending the dial to an already-prefixed number breaks E.164, so the
    // number field itself must stay national-only.
    const html = render();
    expect(html).toContain('phone-row__dial');
    expect(html).toContain('placeholder="Número"');
  });
});

describe('onboarding: the tag field', () => {
  it('renders a read-only handle with a state slot', () => {
    const html = render();
    expect(html).toContain('data-tag-value');
    expect(html).toContain('data-tag-state');
    expect(html).toContain('tag-readonly');
  });

  it('derives the handle from first AND last name', () => {
    expect(BP.shared.suggestTag('Ana Sofía Chen')).toBe('anasofiachen'); // accents go, letters stay
    expect(BP.shared.suggestTag('Ana')).toBe('ana');
  });

  it('starts disabled until everything is valid', () => {
    expect(render()).toMatch(/data-action="save-profile"[^>]*disabled/);
  });

  it('the recommendation comes from the first name, sanitised', () => {
    expect(BP.shared.suggestTag('Ana María')).toBe('anamaria');
    expect(BP.shared.suggestTag('José')).toBe('jose');
    expect(BP.shared.suggestTag('---')).toBe('user');
  });

  it('strips junk from what the user types as they type', () => {
    expect(BP.shared.normalizeTag('@Ana María!')).toBe('anamaria');
    expect(BP.shared.normalizeTag('  ana__maria  ')).toBe('anamaria');
    expect(BP.shared.normalizeTag('ÁÉÍ')).toBe('aei');
  });

  it('NO LONGER claims to check tag availability from the client', () => {
    // It used to: `checkTag` slept 180ms and answered from a hardcoded set of
    // five strings, and these three tests pinned that. The onboarding screen then
    // showed a real-looking availability verdict that came from a demo — it could
    // tell a user `@ana` was free with the database holding it.
    //
    // The client now derives the suggestion from the name and says nothing about
    // availability, because only the server knows that: `PATCH /me/profile`
    // allocates the final handle and returns it, and the store takes that one.
    expect(BP.api.checkTag).toBeUndefined();
  });

  it('does not claim verification it does not perform', () => {
    const html = render();
    expect(html).not.toMatch(/verificad|código de confirmación/i);
  });
});

describe('onboarding: actions', () => {
  it('has one save action for the whole screen', () => {
    expect(BP.actions['save-profile']).toBeTypeOf('function');
  });

  it('the old per-step actions are gone', () => {
    for (const action of ['save-email', 'save-phone', 'skip-email', 'skip-phone']) {
      expect(BP.actions[action], `${action} should no longer exist`).toBeUndefined();
    }
  });
});

describe('store: profile fields', () => {
  beforeEach(() => BP.store.reset());

  it('carries the fields the screen writes', () => {
    const s = BP.store.load();
    for (const key of ['firstName', 'lastName', 'recoveryEmail', 'recoveryPhone', 'recoveryPhoneCountry', 'bpTag', 'hasReceivedFunds']) {
      expect(s, `missing ${key}`).toHaveProperty(key);
    }
  });

  it('name validation accepts accented letters and rejects punctuation', () => {
    const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' -]{0,49}$/u;
    expect(NAME_RE.test('José María')).toBe(true);
    expect(NAME_RE.test("O'Brien")).toBe(true);
    expect(NAME_RE.test('Ana-María')).toBe(true);
    expect(NAME_RE.test('Ana123')).toBe(false);
    expect(NAME_RE.test('')).toBe(false);
  });

  it('email validation is reused from utils', () => {
    expect(BP.utils.isEmail('ana@example.com')).toBe(true);
    expect(BP.utils.isEmail('nope')).toBe(false);
  });
});
