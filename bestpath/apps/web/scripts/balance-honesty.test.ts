import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * The balance must not move on its own.
 *
 * This file exists because of the single worst thing the frontend ever did. The
 * home screen ran a nine-second timer that added `U.rand(0.008, 0.024)` — a
 * random number between 1% and 3% — to the balance, wrote a "Rendimiento"
 * movement into the store and redrew the figure. It never asked the chain or
 * the API. On a balance of 0.83 the number multiplied while you watched.
 *
 * A wallet app that invents its own balance is not a wallet app with a bug. So
 * the property is pinned here rather than left to review: after any amount of
 * time with nobody touching anything, the balance is still the one the server
 * said, and there is no movement that no server sent.
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
await import('../src/screens/home');
await import('../src/screens/passkey');
await import('../src/wire/wallet');
await import('../src/wire/privy');
await import('../src/flow');
await import('../src/actions');

const Store = () => BP.store;
const Flow = () => BP.flow;

/** What the server says the balance is. The only version of the truth here. */
const SERVER_BALANCE = '12.500000';

const apiWallet = () => ({
  id: 'w_1',
  address: '0x6c9F272E77A84fe90E83372c37Bfd6Da05aB7ae1',
  balance: SERVER_BALANCE,
  currency: 'USD',
  firstFundsAt: '2026-09-27T10:00:00.000Z',
  yieldStartedAt: null,
});

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, data }),
});

/** Counts the polls, so "it re-read" and "it invented" are distinguishable. */
const stubApi = () => {
  let walletCalls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    const path = String(url);
    if (path.includes('/wallet/movements')) return ok({ items: [], cursor: null });
    if (path.includes('/wallet')) {
      walletCalls += 1;
      return ok(apiWallet());
    }
    throw new Error(`sin ruta para ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, walletCalls: () => walletCalls };
};

beforeEach(() => {
  Store().reset();
  // A funded, signed-in user: the exact state the old ticker keyed on.
  Store().set({ session: true, balance: 12.5, movements: [] });
  Flow().stopYieldTicker();
});

afterEach(() => {
  Flow().stopYieldTicker();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Let every pending promise in the timer callback settle. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await Promise.resolve();
};

describe('the balance never invents itself', () => {
  it('after many ticks the balance is still exactly what the server said', async () => {
    stubApi();
    vi.useFakeTimers();
    Flow().startYieldTicker();

    // Nine seconds used to be one tick; the poll is 30s. Run well past the old
    // cadence, because the old bug was most visible over time: at 9s ticks,
    // [0.008, 0.024] per tick compounds.
    for (let t = 0; t < 12; t += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
      await settle();
    }

    expect(Store().get().balance).toBe(12.5);
  });

  it('and no movement appears that the server did not send', async () => {
    // The other half of the old bug: it invented a "Rendimiento" row too, so the
    // activity list showed yield that never happened.
    stubApi();
    vi.useFakeTimers();
    Flow().startYieldTicker();

    for (let t = 0; t < 6; t += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
      await settle();
    }

    expect(Store().get().movements).toHaveLength(0);
    expect(Store().get().movements.some((m) => m.type === 'yield')).toBe(false);
  });

  it('the balance it shows is the one the API answered', async () => {
    // Proves the timer READS rather than merely avoiding writing: the number
    // comes from `GET /wallet`, which is the mirror the cron reconciles.
    const api = stubApi();
    vi.useFakeTimers();
    Store().set({ balance: 999 });
    Flow().startYieldTicker();

    await vi.advanceTimersByTimeAsync(30_000);
    await settle();

    expect(api.walletCalls()).toBeGreaterThan(0);
    expect(Store().get().balance).toBe(12.5);
  });

  it('a failed poll keeps the last known balance instead of zeroing it', async () => {
    // Showing `$0` for a wallet that holds money is the one outcome this whole
    // change exists to prevent, so the failure path is asserted, not assumed.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
    Flow().startYieldTicker();

    await vi.advanceTimersByTimeAsync(30_000);
    await settle();

    expect(Store().get().balance).toBe(12.5);
  });

  it('a signed-out or empty wallet starts no timer at all', async () => {
    const api = stubApi();
    vi.useFakeTimers();

    Store().set({ session: false, balance: 12.5 });
    Flow().startYieldTicker();
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(api.walletCalls()).toBe(0);

    Store().set({ session: true, balance: 0 });
    Flow().startYieldTicker();
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(api.walletCalls()).toBe(0);
  });
});
