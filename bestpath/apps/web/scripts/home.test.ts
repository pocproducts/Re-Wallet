import { describe, it, expect, beforeAll } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * Home: two rows + contextual primary action.
 *
 * These pin product behaviour that is easy to regress silently: the "Recibir"
 * emphasis is driven by a latch, not by the balance, so a user who spends down
 * to zero must NOT be re-onboarded.
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
await import('../src/screens/home');
await import('../src/flow');
await import('../src/actions');

const render = (overrides: Record<string, unknown> = {}) => {
  const Store = BP.store;
  Store.reset();
  const s = Store.load();
  s.onboardingComplete = true;
  s.session = true;
  s.userName = 'Ana';
  Object.assign(s, overrides);
  Store.save();
  return BP.router.routes['home'].render({}) as string;
};

beforeAll(() => {
  if (typeof BP.store.reset === 'function') BP.store.reset();
});

describe('home: two rows', () => {
  it('always shows the balance area and the recent-movements area', () => {
    const html = render({ balance: 0, hasReceivedFunds: false, movements: [] });
    expect(html).toContain('data-balance');
    expect(html).toContain('Movimientos recientes');
    expect(html).toContain('data-movements');
  });

  it('renders the movements row even with $0 balance', () => {
    const html = render({ balance: 0, hasReceivedFunds: false, movements: [] });
    expect(html).toContain('$0.00');
    expect(html).not.toContain('Ganando');
  });

  // The badge used to appear from the ledger balance alone, and it carried a
  // hardcoded "4.2% anual" that no code could verify. It now appears from the
  // CHAIN, and says what is actually earning instead of a rate we do not have.
  it('shows what is earning when the chain has been read', () => {
    const html = render({
      balance: 0,
      hasReceivedFunds: true,
      movements: [],
      position: { earning: 400, available: 100, total: 500, readAt: Date.now() },
      positionStatus: 'ok',
    });
    expect(html).toContain('ganando');
    expect(html).toContain('$400.00');
    // Idle money is surfaced, not folded into the headline.
    expect(html).toContain('$100.00');
    expect(html).toContain('disponible sin rendimiento');
  });

  it('the headline is the CHAIN total, not the ledger', () => {
    const html = render({
      balance: 0,
      hasReceivedFunds: true,
      movements: [],
      position: { earning: 826, available: 0, total: 826, readAt: Date.now() },
      positionStatus: 'ok',
    });
    // The ledger says zero. The chain says 826. The chain wins, because that is
    // where the money is.
    expect(html).toContain('$826.00');
  });

  it('does NOT invent a yield rate it cannot verify', () => {
    const html = render({
      balance: 0,
      hasReceivedFunds: true,
      movements: [],
      position: { earning: 400, available: 0, total: 400, readAt: Date.now() },
      positionStatus: 'ok',
    });
    expect(html).not.toContain('%');
  });

  it('before the first chain read, the ledger number shows and no failure is claimed', () => {
    const html = render({ balance: 500, hasReceivedFunds: true, movements: [] });
    expect(html).toContain('$500.00');
    // `unknown` is the first paint, not a failed read. Claiming a verification
    // failure here would invent one.
    expect(html).not.toContain('No pudimos verificar');
    expect(html).not.toContain('ganando');
  });

  it('a failed chain read says so, and keeps the ledger number', () => {
    const html = render({
      balance: 500,
      hasReceivedFunds: true,
      movements: [],
      position: null,
      positionStatus: 'error',
    });
    expect(html).toContain('$500.00');
    expect(html).toContain('No pudimos verificar');
  });

  it('caps the recent list at six movements', () => {
    const movements = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      type: 'send',
      title: `Mov ${i}`,
      amount: -1,
      at: 1_757_000_000_000 - i * 1000,
    }));
    const html = render({ balance: 100, hasReceivedFunds: true, movements });
    expect(html.match(/class="movement"/g) ?? []).toHaveLength(6);
  });
});

describe('home: contextual primary action', () => {
  it('a brand new user gets a prominent "Recibir dinero"', () => {
    const html = render({ balance: 0, hasReceivedFunds: false, movements: [] });
    expect(html).toContain('Recibir dinero');
    expect(html).toContain('btn--primary');
    // and it is the only action button offered
    expect(html).not.toContain('data-action="send"');
  });

  it('explains why receiving matters on first run', () => {
    const html = render({ balance: 0, hasReceivedFunds: false, movements: [] });
    expect(html).toContain('rendimiento automático');
  });

  it('a user who already has funds gets Enviar as primary plus Recibir', () => {
    const html = render({ balance: 500, hasReceivedFunds: true, movements: [] });
    expect(html).toContain('data-action="send"');
    expect(html).toContain('data-action="receive"');
    expect(html).not.toContain('Recibir dinero');
  });

  it('spending the balance to zero does NOT bring back the new-user state', () => {
    // The latch is what matters, not the balance. This is the regression this
    // test exists for.
    const html = render({ balance: 0, hasReceivedFunds: true, movements: [] });
    expect(html).toContain('data-action="send"');
    expect(html).not.toContain('Recibir dinero');
  });

  it('a zero balance with no history is the only state that shows "Recibir dinero"', () => {
    const newUser = render({ balance: 0, hasReceivedFunds: false, movements: [] });
    const returning = render({ balance: 0, hasReceivedFunds: true, movements: [] });
    expect(newUser).toContain('Recibir dinero');
    expect(returning).not.toContain('Recibir dinero');
  });
});

describe('home: empty state copy', () => {
  it('invites a new user to share their link', () => {
    const html = render({ balance: 0, hasReceivedFunds: false, movements: [] });
    expect(html).toContain('link');
  });

  it('tells a returning user movements will show up here', () => {
    const html = render({ balance: 0, hasReceivedFunds: true, movements: [] });
    expect(html).toContain('Aquí verás tus movimientos');
  });
});
