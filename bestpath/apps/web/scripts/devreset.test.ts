import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BP } from '../src/core/bp';
import { shouldResetOnBoot } from '../src/config';

/**
 * Dev convenience: every `pnpm dev` must start the first-run flow from zero.
 *
 * Without this, testing the onboarding from scratch means opening devtools to
 * clear localStorage every time. The risk is the opposite direction: a reset
 * that also fires in a production build would wipe real user state, so the
 * guard is pinned here as well as in config.
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
await import('../src/screens/shared');
await import('../src/screens/welcome');
await import('../src/screens/onboarding');
await import('../src/flow');
await import('../src/actions');

describe('dev reset', () => {
  it('is enabled by default', () => {
    expect(BP.config.resetOnBoot).toBe(true);
  });

  it('shouldResetOnBoot reads the config in a dev build', () => {
    // vitest runs as a dev build, so this is the branch that matters locally
    expect(shouldResetOnBoot()).toBe(BP.config.resetOnBoot === true);
  });

  it('is false when the flag is off', () => {
    const original = BP.config.resetOnBoot;
    BP.config.resetOnBoot = false;
    expect(shouldResetOnBoot()).toBe(false);
    BP.config.resetOnBoot = original;
  });
});

describe('boot: always starts at welcome in dev', () => {
  it('is wired to the dev reset, not to stored state', async () => {
    const src = readFileSync(resolve(process.cwd(), 'src/boot.ts'), 'utf8');
    // The welcome jump must be inside the shouldResetOnBoot() guard, so a
    // production build keeps the resume behaviour.
    const guarded = src.indexOf('if (shouldResetOnBoot()){');
    const welcome = src.indexOf("Router.go('welcome'", guarded);
    expect(guarded).toBeGreaterThan(-1);
    expect(welcome, 'welcome jump must live inside the dev guard').toBeGreaterThan(guarded);
  });

  it('a reset store has onboardingComplete false, which is what routes to welcome', () => {
    BP.store.reset();
    const s = BP.store.load();
    expect(s.onboardingComplete).toBe(false);
  });
});

describe('store: reset really clears', () => {
  it('wipes the persisted state and reloads the defaults', () => {
    const Store = BP.store;
    Store.reset();
    const s = Store.load();
    s.userName = 'Prueba';
    s.bpTag = '@prueba';
    s.balance = 999;
    s.hasReceivedFunds = true;
    Store.save();

    Store.reset();
    const fresh = Store.load();
    expect(fresh.userName).not.toBe('Prueba');
    expect(fresh.bpTag).not.toBe('@prueba');
    expect(fresh.balance).toBe(0);
    expect(fresh.hasReceivedFunds).toBe(false);
  });

  it('starts onboarding-complete as false, so the first-run flow shows', () => {
    BP.store.reset();
    expect(BP.store.load().onboardingComplete).toBe(false);
  });

  it('starts with no movements and the default contacts', () => {
    BP.store.reset();
    const s = BP.store.load();
    expect(s.movements).toHaveLength(0);
    expect(s.contacts.length).toBeGreaterThan(0);
  });
});

describe('store: avatar palette migration', () => {
  it('remaps legacy avatar colours on 0.5 -> 0.6', () => {
    const Store = BP.store;
    Store.reset();
    const s = Store.load();
    s.contacts = [
      { id: 'a', name: 'Ana', tag: '@ana', initials: 'A', color: '#5B4DFF' }, // purple
      { id: 'b', name: 'Beto', tag: '@beto', initials: 'B', color: '#34C759' }, // apple green
      { id: 'c', name: 'Caro', tag: '@caro', initials: 'C', color: '#FF6BAE' }, // kept
    ];
    Store.set({ contacts: s.contacts });

    // simulate a persisted 0.5 state
    localStorage.setItem(
      BP.config.storageKey,
      JSON.stringify({ ...Store.get(), version: '0.5' }),
    );

    const reloaded = Store.load();
    const byId = Object.fromEntries(reloaded.contacts.map((c) => [c.id, c.color]));
    expect(byId['a'], 'legacy purple should be remapped').not.toBe('#5B4DFF');
    expect(byId['b'], 'legacy green should be remapped').not.toBe('#34C759');
    expect(byId['c'], 'a colour outside the legacy map is kept').toBe('#FF6BAE');
    expect(reloaded.version).toBe(BP.config.version);
  });
});
