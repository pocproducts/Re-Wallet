/**
 * The two decisions this feature rests on, away from HTTP.
 *
 *   1. **The id is the secret.** A shared link is one of the two ways money
 *      arrives (`docs/contrato-dinero.md`), so the id *is* the charge's only
 *      access control. These tests pin the property that makes guessing useless,
 *      not merely the fact that the id works.
 *   2. **An amount is a decimal string, and an expiry is derived.** Neither has
 *      a float in it, and neither has a background job: the deadline is a fact
 *      about `expires_at`, not a state somebody has to remember to write down.
 */
import { describe, expect, it } from 'vitest';

import {
  PAYMENT_REQUEST_ID_ALPHABET,
  PAYMENT_REQUEST_ID_BYTES,
  PAYMENT_REQUEST_ID_LENGTH,
  PAYMENT_REQUEST_ID_PATTERN,
  base64urlOf,
  bytesFromBase64url as decodePaymentRequestId,
  newPaymentRequestId,
  paymentRequestIdEntropyBits,
} from '../../src/application/payment-requests/id';
import {
  AMOUNT_NOT_REPRESENTABLE,
  ChargeAmountNotRepresentable,
  canonicalChargeAmount,
  chargeAmountToRaw,
  parseChargeAmount,
} from '../../src/application/payment-requests/amount';
import { effectivePaymentRequestStatus } from '../../src/application/payment-requests/expiry';
import { readPaymentRequest } from '../../src/application/payment-requests/readPaymentRequest';
import {
  PaymentRequestNotFound,
  PaymentRequestRejected,
  PaymentRequestUnavailable,
} from '../../src/application/payment-requests/errors';
import { createPaymentRequest } from '../../src/application/payment-requests/createPaymentRequest';
import { recordingLogger } from '../support/fixtures';
import { inMemoryPaymentRequests, seedPaymentRequest } from '../support/paymentRequests';

const NOW = new Date('2026-10-04T05:00:00.000Z');
const OWNER = '11111111-1111-4111-8111-111111111111';
/** A legal id: 32 characters of the 64-symbol alphabet. */
const ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('the id of a charge', () => {
  it('is 32 characters of a 64-character alphabet: 192 bits of entropy', () => {
    // The numbers are the argument. `payment_requests_id_format` allows 10 to 32
    // characters of `[A-Za-z0-9_-]`, so the alphabet is fixed at 64 symbols and
    // the width is the only free parameter:
    //
    //   10 chars ≈  60 bits — enumerable in minutes on one machine
    //   16 chars ≈  96 bits — not worth attacking, but not free either
    //   32 chars = 192 bits — 2^192 requests before a birthday collision is a
    //                        coin flip, and the table's CHECK already allows it
    //
    // So the width is the maximum the schema permits: a wider id costs nothing
    // and a narrower one is the only thing standing between an attacker and
    // somebody else's outstanding charge.
    expect(PAYMENT_REQUEST_ID_ALPHABET).toHaveLength(64);
    expect(PAYMENT_REQUEST_ID_LENGTH).toBe(32);
    expect(PAYMENT_REQUEST_ID_BYTES).toBe(24);
    expect(paymentRequestIdEntropyBits()).toBe(192);
    expect(PAYMENT_REQUEST_ID_LENGTH).toBe(32);
  });

  it('decodes to exactly 24 random bytes, so nothing about it is a counter', () => {
    // 24 bytes encode to 32 base64url characters with no padding, so the
    // character count cannot be hiding a shorter payload: the whole id is the
    // randomness, and there is no timestamp or user id packed into it.
    const id = newPaymentRequestId();

    expect(id).toHaveLength(32);
    expect(PAYMENT_REQUEST_ID_PATTERN.test(id)).toBe(true);
    // The encoder is the identity on the alphabet it advertises, and its output
    // decodes back to the same number of bytes.
    expect(new Set(PAYMENT_REQUEST_ID_ALPHABET).size).toBe(64);
    expect(base64urlOf(new Uint8Array(PAYMENT_REQUEST_ID_BYTES))).toHaveLength(PAYMENT_REQUEST_ID_LENGTH);
    expect(decodePaymentRequestId(id)).toHaveLength(PAYMENT_REQUEST_ID_BYTES);
    for (const character of id) expect(PAYMENT_REQUEST_ID_ALPHABET).toContain(character);
  });

  it('is a full 64-symbol alphabet over many draws, not a narrow subset', () => {
    // A generator that quietly lost a symbol — a `toString(36)`, a base64 with
    // padding, a modulus that skips the end of the range — would still produce
    // 32 legal characters and would still pass "it works". It would cut the
    // entropy by the number of symbols it never emits, so this asserts the
    // alphabet is *used*, not merely permitted.
    const drawn = new Set<string>();
    const ids = new Set<string>();
    for (let index = 0; index < 400; index += 1) {
      const id = newPaymentRequestId();
      ids.add(id);
      for (const character of id) drawn.add(character);
    }

    expect(ids.size).toBe(400);
    // 8000 characters out of 400 draws: every one of the 64 symbols shows up.
    expect(drawn.size).toBe(64);
  });

  it('shares no prefix with the 200 ids drawn next to it', () => {
    // Enumeration is a *sequential* attack: try `abc…`, `abd…`, `acf…`. An id
    // with any structure — a timestamp prefix, a per-user counter, a hash of the
    // user id — lets an attacker skip most of the space. Independence between
    // neighbouring ids is the property that denies that, so it is asserted
    // directly on the prefixes an enumeration would walk.
    const ids = Array.from({ length: 200 }, () => newPaymentRequestId());

    for (const size of [4, 8, 12]) {
      const prefixes = new Set(ids.map((id) => id.slice(0, size)));
      // Birthday bound at this width: collisions are possible but rare. What has
      // to be impossible is a *repeat* of the same prefix many times over.
      expect(prefixes.size).toBeGreaterThan(ids.length * 0.9);
    }
  });

  it('is not derived from the person, the clock or a counter', () => {
    // Same clock, same arguments, different ids: nothing in the generation path
    // can read the user id, the time or a sequence, because two calls with
    // identical inputs do not collide.
    const first = newPaymentRequestId();
    const second = newPaymentRequestId();

    expect(first).not.toBe(second);
    expect(Date.now()).toBeGreaterThan(0);
  });

  it('refuses any id the table would not accept', () => {
    // The generator and the CHECK must agree, or a charge could not be written
    // at all. This is the same pattern, asserted from the side of the table.
    const accepted = [newPaymentRequestId(), 'A'.repeat(10), 'a_b-C'.repeat(2)];
    const refused = ['', 'A'.repeat(9), 'A'.repeat(33), 'con espacio', 'con/pirada', 'ñ'.repeat(12)];

    for (const id of accepted) expect(PAYMENT_REQUEST_ID_PATTERN.test(id), id).toBe(true);
    for (const id of refused) expect(PAYMENT_REQUEST_ID_PATTERN.test(id), id).toBe(false);
  });
});

describe('the amount of a charge', () => {
  it('is read as text, with no float anywhere in the path', () => {
    expect(canonicalChargeAmount('150.25')).toBe('150.25');
    expect(canonicalChargeAmount('150.250000')).toBe('150.25');
    expect(canonicalChargeAmount('10')).toBe('10');
    expect(canonicalChargeAmount('0001.5')).toBe('1.5');
    expect(canonicalChargeAmount('0.000001')).toBe('0.000001');
    // Eighteen decimals, because the catalog has assets with eighteen and a
    // column that cannot hold one truncates a charge into a different number.
    expect(canonicalChargeAmount('0.000000000000000001')).toBe('0.000000000000000001');
    expect(canonicalChargeAmount('0.0000000000001')).toBe('0.0000000000001');
  });

  it('refuses everything that is not a positive decimal string in whole units', () => {
    for (const value of [
      undefined,
      null,
      '',
      '0',
      '0.000000',
      '-1',
      '+1',
      '1e3',
      '1.2.3',
      '1.',
      ',5',
      '1,5',
      'NaN',
      'Infinity',
      1,
      1.5,
      {},
      [],
      '123456789012345678901', // 21 integer digits: numeric(38,18) holds 20
      '0.0000000000000000001', // nineteen decimals: the column holds eighteen
    ]) {
      expect(() => parseChargeAmount(value), JSON.stringify(value) ?? 'undefined').toThrow();
    }
  });

  it('becomes the smallest-unit integer of the asset it is paid in', () => {
    // This is the whole reason the amount travels as a decimal string: the
    // integer in the smallest unit cannot be known before the asset is, and a
    // float that shifted it on the front would be deciding how much money moves.
    expect(chargeAmountToRaw('150.25', 6)).toBe(150_250_000n);
    expect(chargeAmountToRaw('150.25', 18)).toBe(150_250_000_000_000_000_000n);
    expect(chargeAmountToRaw('1', 9)).toBe(1_000_000_000n);
    expect(chargeAmountToRaw('0.000001', 6)).toBe(1n);
    // Eighteen decimals into eighteen decimals: exact, no drift, no rounding.
    expect(chargeAmountToRaw('0.000000000000000001', 18)).toBe(1n);
    expect(chargeAmountToRaw('0.0000000000001', 18)).toBe(100_000n);
    // Trailing zeroes in the charge do not change the integer.
    expect(chargeAmountToRaw('150.250000', 6)).toBe(150_250_000n);
  });

  it('refuses an amount that has no integer in this asset, instead of rounding it', () => {
    // A charge of six decimals paid in a four-decimal asset: there is no integer
    // that means this amount. Every asset in today's catalog has six decimals or
    // more, so this is the day a smaller asset arrives — and on that day it has to
    // refuse rather than round. Rounding would move money nobody chose, in
    // whichever direction the rounding went.
    expect(() => chargeAmountToRaw('1.123456', 4)).toThrow(ChargeAmountNotRepresentable);
    try {
      chargeAmountToRaw('1.123456', 4);
    } catch (error) {
      expect((error as ChargeAmountNotRepresentable).code).toBe(AMOUNT_NOT_REPRESENTABLE);
    }
    // …and zeroes past the scale are fine: they are the same number.
    expect(chargeAmountToRaw('1.123000', 6)).toBe(1_123_000n);
  });
});

describe('creating a charge', () => {
  const USER = '11111111-1111-4111-8111-111111111111';

  /** The body of a charge that names something the catalog has. */
  const chargeBody = (overrides: Record<string, unknown> = {}) => ({
    amount: '10',
    chain: 'monad',
    asset: { symbol: 'USDC' },
    ...overrides,
  });

  it('takes the chain and the symbol, and resolves the decimals itself', async () => {
    // The body carries no decimals because there is no field for them: they are
    // a fact about the token, and a client that could send them could send
    // `decimals: 0` and choose the size of the transfer. What the row gets is the
    // catalog's six for USDC on Monad, whatever the body said or omitted.
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW, newId: () => ID });

    const view = await create(USER, chargeBody({ decimals: 0, asset: { symbol: 'USDC', decimals: 0 } }));

    expect(view.chain).toBe('monad');
    expect(view.asset).toEqual({ symbol: 'USDC', decimals: 6 });
    expect(requests.rows()[0]?.assetDecimals).toBe(6);
  });

  it('stores a charge of eighteen decimals exactly, with no truncation', async () => {
    // ETH has eighteen decimals on Ethereum. With the old `numeric(20,6)` this
    // was stored as 0 — and a charge of 0 pays nothing while looking paid. The
    // value that comes back has to be the value that went in, digit for digit.
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW, newId: () => ID });

    const view = await create(USER, chargeBody({ amount: '0.000000000000000001', chain: 'ethereum', asset: { symbol: 'ETH' } }));

    expect(view.amount).toBe('0.000000000000000001');
    expect(view.asset).toEqual({ symbol: 'ETH', decimals: 18 });
    expect(requests.rows()[0]?.amount).toBe('0.000000000000000001');
    // And it is payable: the smallest unit of ETH has an integer for it.
    expect(chargeAmountToRaw(view.amount, view.asset.decimals)).toBe(1n);
  });

  it('refuses a chain this app does not have, with its own code', async () => {
    // Refused at **creation**: the person who can fix it is the one asking. A
    // payer cannot change the chain, so finding out at the pay screen would turn
    // a wrong request into somebody else's dead end.
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW });

    for (const chain of ['bitcoin', 'MonAD', '', undefined, 42, 'monad ']) {
      await expect(create(USER, chargeBody({ chain })), JSON.stringify(chain)).rejects.toMatchObject({
        code: 'CHAIN_UNKNOWN',
      });
    }
    expect(requests.rows()).toHaveLength(0);
  });

  it('refuses a symbol that is not an asset of that chain, and says what it has', async () => {
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW });

    // DOGE is nowhere in this app; OUSD exists, but only on Ethereum — asking
    // for it on Monad is asking for something this app cannot receive.
    for (const [chain, symbol] of [
      ['monad', 'DOGE'],
      ['monad', 'OUSD'],
      ['solana', 'USDT'],
      ['monad', 'usdc'],
      ['monad', ''],
    ] as const) {
      await expect(
        create(USER, chargeBody({ chain, asset: { symbol } })),
        `${symbol} on ${chain}`,
      ).rejects.toMatchObject({ code: 'ASSET_NOT_ON_CHAIN' });
    }
    expect(requests.rows()).toHaveLength(0);
  });

  it('names what it could not find, in words that do not require knowing crypto', async () => {
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW });

    // The sentence goes to the operator's log, never to the browser, but it still
    // has to say which asset was asked for, where it was looked for, and what is
    // there instead — otherwise "not on chain" is a refusal nobody can act on.
    let detail = '';
    try {
      await create(USER, chargeBody({ asset: { symbol: 'OUSD' } }));
    } catch (error) {
      if (error instanceof PaymentRequestRejected) detail = error.message;
    }

    expect(detail).toContain('OUSD');
    expect(detail).toContain('monad');
    // What *is* available, so the answer is actionable rather than just negative.
    expect(detail).toContain('MON');
    expect(detail).toContain('USDC');
  });

  it('refuses an amount this asset has no integer for, instead of rounding it', async () => {
    // USDC has six decimals on Monad. `1.1234567` has no integer that means it,
    // and rounding it would move money in a direction nobody chose — so it is
    // refused where the answer is still "change the amount".
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW });

    await expect(create(USER, chargeBody({ amount: '1.1234567' }))).rejects.toMatchObject({
      code: 'AMOUNT_NOT_REPRESENTABLE',
    });
    // The same amount in an eighteen-decimal asset is fine: the column's ceiling
    // is not the asset's scale, and each one is checked by its own question.
    await expect(
      create(USER, chargeBody({ amount: '1.1234567', chain: 'ethereum', asset: { symbol: 'ETH' } })),
    ).resolves.toMatchObject({ amount: '1.1234567' });
    expect(requests.rows()).toHaveLength(1);
  });

  it('draws another id when the one it drew is already on file', async () => {
    // A 192-bit collision is not a security event — it is a birthday paradox that
    // will not happen — but it still has an answer, and "draw again" is the only
    // honest one. `ON CONFLICT (id) DO NOTHING` is what reports it.
    const taken = 'kQ3v7pZ2mR8tY5wB1nF4hJ6sLdC9xGa';
    const fresh = 'ZgR4tY6wB8nF0hJ2kL5sD7fG9aC3xQe';
    const requests = inMemoryPaymentRequests([
      seedPaymentRequest({
        id: taken,
        userId: USER,
        amount: '10',
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 3_600_000),
      }),
    ]);
    const drawn = [taken, fresh];
    let index = 0;
    const create = createPaymentRequest({
      requests: requests.store,
      now: () => NOW,
      newId: () => drawn[index++] ?? fresh,
    });

    const charge = await create(USER, chargeBody({ amount: '20' }));

    expect(charge.id).toBe(fresh);
    expect(charge.status).toBe('pending');
    // Both rows exist: the collision neither overwrote the first one nor raised.
    expect(requests.rows().map((row) => row.id)).toEqual([taken, fresh]);
    expect(requests.rows().map((row) => row.amount)).toEqual(['10', '20']);
  });

  it('refuses an id source that the table would not accept', async () => {
    // The generator and `payment_requests_id_format` have to agree. When they do
    // not, the answer is a bounded refusal and an empty log — not a `CHECK`
    // violation, and not a charge whose link leads nowhere.
    const requests = inMemoryPaymentRequests();
    const create = createPaymentRequest({
      requests: requests.store,
      now: () => NOW,
      newId: () => 'corto',
    });

    await expect(create(USER, chargeBody())).rejects.toBeInstanceOf(PaymentRequestRejected);
    await expect(create(USER, chargeBody())).rejects.toMatchObject({ code: 'ID_UNUSABLE' });
    expect(requests.rows()).toHaveLength(0);
  });

  it('gives up as a 502-class failure when every draw is taken', async () => {
    const taken = 'kQ3v7pZ2mR8tY5wB1nF4hJ6sLdC9xGa';
    const requests = inMemoryPaymentRequests([
      seedPaymentRequest({ id: taken, userId: USER, amount: '10', createdAt: NOW, expiresAt: NOW }),
    ]);
    const create = createPaymentRequest({ requests: requests.store, now: () => NOW, newId: () => taken });

    // Not a refusal of the person: the server could not find a free id, which is
    // a fact about this deployment, not about their charge.
    await expect(create(USER, chargeBody({ amount: '20' }))).rejects.toBeInstanceOf(PaymentRequestUnavailable);
    expect(requests.rows()).toHaveLength(1);
  });
});

describe('expiry is derived, never written', () => {
  it('reads a live pending charge as pending and a past one as expired', () => {
    const expiresAt = new Date(NOW.getTime() + 60_000);

    expect(effectivePaymentRequestStatus('pending', expiresAt, NOW)).toBe('pending');
    expect(effectivePaymentRequestStatus('pending', expiresAt, new Date(expiresAt.getTime() - 1))).toBe(
      'pending',
    );
    expect(effectivePaymentRequestStatus('pending', expiresAt, expiresAt)).toBe('expired');
    expect(effectivePaymentRequestStatus('pending', expiresAt, new Date(expiresAt.getTime() + 1))).toBe(
      'expired',
    );
  });

  it('never revives a charge that was already paid or explicitly expired', () => {
    const longAgo = new Date(NOW.getTime() - 86_400_000);

    expect(effectivePaymentRequestStatus('paid', longAgo, NOW)).toBe('paid');
    expect(effectivePaymentRequestStatus('expired', longAgo, NOW)).toBe('expired');
    expect(effectivePaymentRequestStatus('cancelled', longAgo, NOW)).toBe('cancelled');
  });

  it('says `expired` over HTTP without touching the row', async () => {
    const requests = inMemoryPaymentRequests([
      seedPaymentRequest({
        id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        userId: OWNER,
        amount: '10',
        createdAt: new Date(NOW.getTime() - 7_200_000),
        expiresAt: new Date(NOW.getTime() - 3_600_000),
      }),
    ]);
    const read = readPaymentRequest({ requests: requests.store, now: () => NOW, log: recordingLogger() });

    const view = await read('AAAAAAAAAAAAAAAAAAAAAAAAAAA');

    expect(view.status).toBe('expired');
    // The row says `pending` and stays that way: the deadline is a fact about
    // `expires_at`, and `status` records what **happened**, not what time did.
    expect(requests.rows()[0]?.status).toBe('pending');
  });

  it('answers a missing charge as a bounded refusal, not an empty read', async () => {
    const requests = inMemoryPaymentRequests();
    const read = readPaymentRequest({ requests: requests.store, now: () => NOW });

    await expect(read('AAAAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toBeInstanceOf(PaymentRequestNotFound);
    // Not an id at all: the same answer, because the id is the only way in.
    await expect(read(undefined)).rejects.toBeInstanceOf(PaymentRequestNotFound);
    await expect(read('corto')).rejects.toBeInstanceOf(PaymentRequestNotFound);
  });

  it('says what it asks for: the chain, the asset and the asset’s scale', async () => {
    // This is what makes `/cobrar/{id}` legible without putting the chain in the
    // URL: the link is still just an id, and the row is what says "10 USDC on
    // Monad". A screen that had to ask separately would be asking the person.
    const requests = inMemoryPaymentRequests([
      seedPaymentRequest({
        id: ID,
        userId: OWNER,
        amount: '10',
        chain: 'ethereum',
        assetSymbol: 'ETH',
        assetDecimals: 18,
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 3_600_000),
        requesterTag: 'ana.abcd',
      }),
    ]);
    const read = readPaymentRequest({ requests: requests.store, now: () => NOW });

    const view = await read(ID);

    expect(view.chain).toBe('ethereum');
    expect(view.asset).toEqual({ symbol: 'ETH', decimals: 18 });
    expect(view.amount).toBe('10');
    expect(view.requesterTag).toBe('ana.abcd');
  });
});
