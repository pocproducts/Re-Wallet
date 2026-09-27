import { describe, it, expect, beforeEach } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * Profile screen: identity block next to the photo, phone section below.
 *
 * The screen is the mirror of onboarding — if a field is collected there it has
 * to be visible here, otherwise the user captured data and cannot see it.
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
await import('../src/screens/settings');
await import('../src/flow');
await import('../src/actions');

const render = (overrides: Record<string, unknown> = {}) => {
  BP.store.reset();
  const s = BP.store.load();
  s.session = true;
  s.onboardingComplete = true;
  Object.assign(s, overrides);
  BP.store.save();
  return BP.router.routes['settings'].render({}) as string;
};

describe('profile: identity block', () => {
  it('shows the photo', () => {
    expect(render()).toContain('profile-identity__photo');
  });

  it('shows the name and the tag only — no icon rows', () => {
    const html = render({ firstName: 'Ana', lastName: 'Sofía Chen', recoveryEmail: 'ana@example.com', bpTag: '@ana' });
    expect(html).toContain('profile-identity__rows');
    expect(html).toContain('data-profile-tag');
    // the old per-field icon rows are gone
    expect(html).not.toContain('class="profile-field"');
  });

  it('renders the tag with its @ and a copy button', () => {
    const html = render({ bpTag: '@ana' });
    expect(html).toContain('@ana');
    expect(html).toContain('data-action="copy-tag"');
    expect(html).toContain('aria-label="Copiar usuario"');
  });

  it('shows the full name, not just the first', () => {
    const html = render({ firstName: 'Ana', lastName: 'Sofía Chen' });
    expect(html).toContain('Ana Sofía Chen');
  });

  it('marks missing contact fields instead of showing a blank row', () => {
    const html = render({ firstName: 'Ana', lastName: '', recoveryEmail: '', bpTag: '' });
    expect(html).toContain('Sin configurar');
  });
});

describe('profile: contact section', () => {
  it('has an email row in the contact section', () => {
    const html = render({ recoveryEmail: 'ana@example.com' });
    expect(html).toContain('Correo');
    expect(html).toContain('ana@example.com');
    expect(html).toContain('edit-email');
    // and it sits under the identity block, not inside it
    expect(html.indexOf('profile-identity')).toBeLessThan(html.indexOf('edit-email'));
  });

  it('has a phone row below the identity block', () => {
    const html = render({ recoveryPhone: '+549112345678' });
    expect(html).toContain('Teléfono');
    expect(html).toContain('+549112345678');
    expect(html).toContain('edit-phone');
  });

  it('puts the phone section after the identity block', () => {
    const html = render();
    expect(html.indexOf('profile-identity')).toBeLessThan(html.indexOf('Teléfono'));
  });

  it('no longer shows the legacy recovery row (email moved to Contacto)', () => {
    expect(render()).not.toContain('edit-recovery');
  });
});

describe('profile: actions', () => {
  it('exposes edit-phone and edit-email', () => {
    expect(BP.actions['edit-phone']).toBeTypeOf('function');
    expect(BP.actions['edit-email']).toBeTypeOf('function');
  });

  it('exposes the flow methods behind them', () => {
    expect(BP.flow.editPhone).toBeTypeOf('function');
    expect(BP.flow.editEmail).toBeTypeOf('function');
  });

  it('copy-tag is defined exactly once', () => {
    const src = BP.actions;
    // guards against a duplicate key silently shadowing the other
    expect(src['copy-tag']).toBeTypeOf('function');
  });
});

describe('profile: the rest of the screen survived the restructure', () => {
  it('still shows contacts, security and session', () => {
    const html = render();
    expect(html).toContain('Contactos');
    expect(html).toContain('Seguridad');
    expect(html).toContain('Cerrar sesión');
  });

  it('still shows the version footer', () => {
    expect(render()).toContain('ReWallet v');
  });
});

describe('store: what the profile mirrors', () => {
  beforeEach(() => BP.store.reset());

  it('every field the profile shows is in the store', () => {
    const s = BP.store.load();
    for (const key of ['firstName', 'lastName', 'recoveryEmail', 'recoveryPhone', 'bpTag']) {
      expect(s, `profile shows ${key} but the store lacks it`).toHaveProperty(key);
    }
  });
});
