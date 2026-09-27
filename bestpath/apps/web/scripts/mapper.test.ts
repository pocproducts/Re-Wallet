import { describe, it, expect } from 'vitest';
import {
  toMovement,
  toUser,
  toContact,
  toHasReceivedFunds,
  toBalance,
  toTimestamp,
  toYieldStartedAt,
  toAmountString,
  stripSessionOwned,
  type ApiMovement,
  type ApiWallet,
} from '../src/wire/mapper';

/**
 * Contract tests for the mapper.
 *
 * These exist because the store↔API mismatch is silent. Nothing throws when a
 * send renders as a deposit — it just quietly tells the user the wrong thing
 * about their own money. So the direction rule is pinned here, hard.
 */

const apiMovement = (over: Partial<ApiMovement> = {}): ApiMovement => ({
  id: 'm1',
  type: 'deposit',
  amount: '100.000000',
  title: 'Depósito',
  status: 'completed',
  createdAt: '2026-09-27T10:00:00.000Z',
  ...over,
});

describe('movement direction — the one that bites', () => {
  it('a send becomes NEGATIVE in the store', () => {
    const m = toMovement(apiMovement({ type: 'send', amount: '120.000000' }));
    expect(m.amount).toBe(-120);
  });

  it('a deposit becomes POSITIVE', () => {
    expect(toMovement(apiMovement({ type: 'deposit' })).amount).toBe(100);
  });

  it('yield is an INFLOW, not an outflow', () => {
    // This is the subtle one: yield is a credit, so a naive "not a deposit = send"
    // rule would render the user's earnings as money leaving.
    expect(toMovement(apiMovement({ type: 'yield', amount: '3.190000' })).amount).toBe(3.19);
  });

  it('receive is an inflow', () => {
    expect(toMovement(apiMovement({ type: 'receive' })).amount).toBe(100);
  });

  it('a NEGATIVE amount from a misbehaving API still renders with the right sign', () => {
    // The DB promises positive, but if one ever arrives negative the sign the UI
    // reads must still match the type, not the number.
    const m = toMovement(apiMovement({ type: 'send', amount: '-50.000000' }));
    expect(m.amount).toBe(-50);
    const d = toMovement(apiMovement({ type: 'deposit', amount: '-50.000000' }));
    expect(d.amount).toBe(50);
  });

  it('every movement type resolves to a deterministic sign', () => {
    const signs = (['deposit', 'send', 'receive', 'yield'] as const).map(
      (type) => Math.sign(toMovement(apiMovement({ type })).amount),
    );
    expect(signs).toEqual([1, -1, 1, 1]);
  });
});

describe('timestamps', () => {
  it('ISO string becomes epoch ms', () => {
    const iso = '2026-09-27T10:00:00.000Z';
    expect(toMovement(apiMovement({ createdAt: iso })).at).toBe(new Date(iso).getTime());
  });

  it('a null timestamp is 0, not NaN', () => {
    expect(toTimestamp(null)).toBe(0);
    expect(Number.isNaN(toTimestamp(null))).toBe(false);
  });
});

describe('user and wallet', () => {
  it('user maps to the fields the UI already uses', () => {
    const u = toUser({
      id: 'u1', name: 'Ana Sofía Chen', firstName: 'Ana', lastName: 'Sofía Chen',
      tag: '@ana', email: 'a@b.c', phone: null,
    });
    expect(u).toEqual({ firstName: 'Ana', lastName: 'Sofía Chen', name: 'Ana Sofía Chen', tag: '@ana' });
  });

  it('balance arrives as a string and leaves as a number', () => {
    const w: ApiWallet = {
      id: 'w1', address: '0xabc', balance: '1250.500000', currency: 'USD',
      firstFundsAt: null, yieldStartedAt: null,
    };
    expect(typeof w.balance).toBe('string');
    expect(toBalance(w)).toBe(1250.5);
  });

  it('amounts serialise back to 6 decimals, never float noise', () => {
    expect(toAmountString(120)).toBe('120.000000');
    expect(toAmountString(0.1 + 0.2)).toBe('0.300000'); // not 0.30000000000000004
  });
});

describe('hasReceivedFunds is a latch, not a balance', () => {
  const wallet = (firstFundsAt: string | null): ApiWallet => ({
    id: 'w1', address: '0xabc', balance: '0', currency: 'USD', firstFundsAt, yieldStartedAt: null,
  });

  it('is false before the first credit', () => {
    expect(toHasReceivedFunds(wallet(null))).toBe(false);
  });

  it('stays TRUE once funds have landed, even at a zero balance', () => {
    // The regression this exists for: deriving it from the balance would
    // re-onboard anyone who spent down to zero.
    expect(toHasReceivedFunds(wallet('2026-09-27T10:00:00.000Z'))).toBe(true);
  });
});

describe('yieldStartedAt is a timestamp or nothing, never zero', () => {
  const withYield = (yieldStartedAt: string | null): ApiWallet => ({
    id: 'w1', address: '0xabc', balance: '0', currency: 'USD',
    firstFundsAt: null, yieldStartedAt,
  });

  it('is null before the user ever held a position', () => {
    // toTimestamp() answers 0 for null because the store's number fields are
    // epoch ms and 0 is a legitimate value for them. yieldStartedAt is typed
    // `number | null` precisely so "never" stays distinguishable from the
    // epoch: a 0 here would render as a position that started in 1970.
    expect(toYieldStartedAt(withYield(null))).toBeNull();
  });

  it('maps a real ISO timestamp to epoch ms', () => {
    expect(toYieldStartedAt(withYield('2026-09-27T10:00:00.000Z'))).toBe(1790503200000);
  });
});

describe('contacts', () => {
  it('falls back when optional fields are null', () => {
    const c = toContact({ id: 'c1', name: 'Ana', tag: '@ana', color: null, initials: null });
    expect(c.initials).toBe('');
    expect(c.color).toBeTruthy();
  });
});

describe('session is backend-owned', () => {
  it('is stripped before the store is persisted', () => {
    const stripped = stripSessionOwned({ session: true, firstName: 'Ana' } as never);
    expect(stripped).not.toHaveProperty('session');
    expect(stripped).toHaveProperty('firstName', 'Ana');
  });

  it('does not mutate the input', () => {
    const state = { session: true, firstName: 'Ana' } as never;
    stripSessionOwned(state);
    expect(state).toHaveProperty('session', true);
  });
});
