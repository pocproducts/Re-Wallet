import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BP } from '../src/core/bp';

/**
 * A money button must not move money.
 *
 * Both money flows used to move the balance ON THE CLIENT, from a mock, with no
 * request to any server:
 *
 *   - `addMoney` awaited `BP.api.addMoney` → `{ ok: true, amount }` and then
 *     `Store.set({ balance: balance + amount })` plus a "deposit" movement. So
 *     pressing "Recibir" printed money.
 *   - `sendMoney` did the same downward, with a "send" movement. So pressing
 *     "Enviar" lowered the balance.
 *
 * The backend was asked nothing that mattered: `POST /wallet/deposit-intent`
 * answered `200 { ok: true, address: null }` and nobody branched on it. It now
 * answers `501 not_implemented`, and these tests pin the half that matters on the
 * client: the balance is never written by a button.
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
await import('../src/screens/processing');
await import('../src/screens/receive');
await import('../src/screens/passkey');
await import('../src/wire/wallet');
await import('../src/wire/privy');
await import('../src/flow');
await import('../src/actions');

const Store = () => BP.store;
const Flow = () => BP.flow;
const Router = () => BP.router;

/** The envelope the API sends for a route that does not exist yet. */
const notBuilt = () => ({
  ok: false,
  status: 501,
  json: async () => ({
    ok: false,
    error: 'not_implemented',
    message: 'todavía no',
    code: 501,
  }),
});

/** A server that claims success, which is the case that used to do the damage. */
const lyingOk = (amount: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, data: { amount, newBalance: 999, movement: {} } }),
});

const stubFetch = (handler: () => unknown) => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return handler();
  }));
  return calls;
};

beforeEach(() => {
  Store().reset();
  Store().set({ session: true, balance: 10, movements: [] });
  Router().busy = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('depositing never invents a balance', () => {
  it('a 501 leaves the balance and the movements exactly as they were', async () => {
    stubFetch(notBuilt);
    await Flow().addMoney(500, 'USDC');

    expect(Store().get().balance).toBe(10);
    expect(Store().get().movements).toHaveLength(0);
  });

  it('EVEN IF the server claims success, the client writes no balance', async () => {
    // The important half. A balance that appears because a button was pressed is
    // a number nobody earned, and "the mock said ok" is not a receipt. When the
    // real deposit lands it will arrive through `GET /wallet` — the mirror the
    // cron reconciles — not through this call.
    const calls = stubFetch(() => lyingOk(500));
    await Flow().addMoney(500, 'USDC');

    expect(Store().get().balance).toBe(10);
    expect(Store().get().movements).toHaveLength(0);
    // It DID ask, which is the behaviour worth keeping.
    expect(calls.some((u) => u.includes('/wallet/deposit-intent'))).toBe(true);
  });

  it('and the user is told the truth instead of a fake progress bar', async () => {
    stubFetch(notBuilt);
    await Flow().addMoney(500, 'USDC');

    const sub = document.querySelector('[data-processing-sub]');
    expect(sub?.innerHTML).toMatch(/todavía no/i);
    // "Todo listo" and a moving bar are what this used to show.
    expect(sub?.innerHTML).not.toMatch(/Todo listo/i);
  });

  it('a network failure does not zero the balance either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await Flow().addMoney(500, 'USDC');
    expect(Store().get().balance).toBe(10);
  });
});

describe('sending never invents a balance', () => {
  it('a 501 leaves the balance alone', async () => {
    stubFetch(notBuilt);
    await Flow()._processSend({ name: 'Carlos', tag: '@carlos', type: 'tag' }, 3);

    expect(Store().get().balance).toBe(10);
    expect(Store().get().movements).toHaveLength(0);
  });

  it('and a server that claims success still does not move the client balance', async () => {
    // Pressing "Enviar" used to SUBTRACT the amount, so the balance went down
    // with nothing having happened.
    const calls = stubFetch(() => lyingOk(-3));
    await Flow()._processSend({ name: 'Carlos', tag: '@carlos', type: 'tag' }, 3);

    expect(Store().get().balance).toBe(10);
    expect(calls.some((u) => u.includes('/wallet/send'))).toBe(true);
  });
});

describe('the mock boundary has no money left in it', () => {
  it('none of the inventing functions is reachable', () => {
    // The next person wiring a button should get a `TypeError` in the first
    // minute, not a feature that quietly lies.
    for (const name of ['addMoney', 'sendMoney', 'accrueYield', 'createPaymentRequest', 'checkTag']) {
      expect(BP.api, `BP.api.${name} should be gone`).not.toHaveProperty(name);
    }
  });
});
