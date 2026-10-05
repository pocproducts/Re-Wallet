/**
 * `POST /api/payment-requests`, `GET /api/payment-requests/:id` and
 * `POST /api/payment-requests/:id/pay`, over HTTP.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **A charge is a row, and the id is the secret.** The link travels in the
 *      clear; what makes it a *charge* rather than a favour is that the row says
 *      who asked for how much, and the id is the only thing standing between an
 *      outsider and that row.
 *   2. **The payee's address never leaves the server.** Not in the read, not in
 *      the create, not in the pay. What the pay answers with is the **payer's**
 *      own `address` — the one they must sign for — and the payee is nowhere in
 *      it, not even hex-encoded inside calldata.
 *   3. **One link, one payment.** Paying twice is a refusal, not a second
 *      movement, and an expired charge is a refusal too.
 *   4. **Every refusal is a bounded code.** A wrong id is a 404 with one code —
 *      never a 500, and never an empty 200 that a screen would draw as a charge.
 */
import { describe, expect, it } from 'vitest';

import { createPaymentRequest } from '../../src/application/payment-requests/createPaymentRequest';
import { readPaymentRequest } from '../../src/application/payment-requests/readPaymentRequest';
import { payPaymentRequest } from '../../src/application/payment-requests/payPaymentRequest';
import { prepareSend } from '../../src/application/send/prepareSend';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { SolanaTransferPreparer } from '../../src/domain/ports/solana-transfer-preparer';
import { SOLANA_MAINNET_NETWORK } from '../../src/domain/send/transfer';
import type { ReachableWalletStore } from '../../src/domain/ports/wallet-store';
import type { MovementStore, PendingSendMovement } from '../../src/domain/ports/movement-store';
import type { IdempotencyStore } from '../../src/domain/ports/idempotency-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { recordingLogger } from '../support/fixtures';
import { inMemoryPaymentRequests } from '../support/paymentRequests';

const EXPIRY = new Date('2030-01-01T00:00:00.000Z');
const NOW = new Date('2026-10-04T05:00:00.000Z');

const OWNER = '11111111-1111-4111-8111-111111111111';
const PAYER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

/** The payee's real address. It must never appear in any answer. */
const PAYEE_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const PAYER_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const THIRD_ADDRESS = '0x9999999999999999999999999999999999999999';

const OWNER_COOKIE = `${SESSION_COOKIE_NAME}=rw1.owner`;
const PAYER_COOKIE = `${SESSION_COOKIE_NAME}=rw1.payer`;
const THIRD_COOKIE = `${SESSION_COOKIE_NAME}=rw1.third`;
const NO_COOKIE = null;

/** A chain+asset pair the catalog knows, so the payment can be prepared. */
const PAYABLE = { chain: 'monad', asset: { symbol: 'USDC', decimals: 6 } } as const;

const OWNER_ROW = {
  address: PAYEE_ADDRESS,
  providerWalletId: 'wallet-owner-1',
  chain: 'ethereum' as const,
  evmNetwork: 'eip155:1' as const,
};

const wallets: ReachableWalletStore = {
  // A charge resolves its payee by id, never by tag: nothing here is reachable by one.
  findByTag: async () => ({ kind: 'nobody' }),
  findByUserId: async (userId) => {
    if (userId === OWNER) return [OWNER_ROW];
    return [
      {
        address: userId === THIRD ? THIRD_ADDRESS : PAYER_ADDRESS,
        providerWalletId: `wallet-${userId}`,
        chain: 'ethereum' as const,
        evmNetwork: 'eip155:1' as const,
      },
    ];
  },
  save: async () => {},
};

/** The claims this harness knows, by cookie value. */
const sessionOf = (token: string) => {
  if (token === 'rw1.owner') return { userId: OWNER, privyDid: 'did:privy:2owner' };
  if (token === 'rw1.payer') return { userId: PAYER, privyDid: 'did:privy:2payer' };
  if (token === 'rw1.third') return { userId: THIRD, privyDid: 'did:privy:2third' };
  return null;
};

const evm: EvmBalanceReader = {
  nativeBalance: async () => 5_000_000_000_000_000_000n,
  // 1000 USDC, so the 150.25 charge below is payable and a charge of 15025 is not.
  erc20Balance: async () => 1_000_000_000n,
};
const solana: SolanaBalanceReader = {
  lamports: async () => 4_000_000_000n,
  tokenAmount: async () => 10_000_000n,
};
const solanaTransfers: SolanaTransferPreparer = {
  prepare: async () => ({ serializedTransaction: 'AQID', network: SOLANA_MAINNET_NETWORK }),
};

const noIdempotency: IdempotencyStore = {
  find: async () => null,
  reserve: async () => true,
  complete: async () => {},
  release: async () => {},
};

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly requests: ReturnType<typeof inMemoryPaymentRequests>;
  readonly movements: PendingSendMovement[];
}

const harness = (options: { expiresInMs?: number } = {}): Harness => {
  const requests = inMemoryPaymentRequests();
  const movements: PendingSendMovement[] = [];
  const movementStore: MovementStore = {
    createPending: async (_userId, _walletChain, movement) => {
      movements.push(movement);
      return { id: `movement-${movements.length}`, status: 'pending' };
    },
  };

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: OWNER, privyDid: 'did:privy:2test' }),
    sessions: {
      issue: async () => ({ token: 'rw1.owner', expiresAt: EXPIRY }),
      read: async (token) => sessionOf(token),
    },
    createPaymentRequest: createPaymentRequest({ requests: requests.store, now: () => NOW }),
    readPaymentRequest: readPaymentRequest({ requests: requests.store, now: () => NOW }),
    payPaymentRequest: payPaymentRequest({
      requests: requests.store,
      wallets,
      now: () => NOW,
      prepareSend: prepareSend({
        wallets,
        evm,
        solana,
        solanaTransfers,
        movements: movementStore,
        idempotency: noIdempotency,
      }),
    }),
    log: recordingLogger(),
    now: () => NOW,
  });

  return { app, requests, movements };
};

const post = (
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  cookie: string | null = OWNER_COOKIE,
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify(body),
  });

const get = (app: ReturnType<typeof createApp>, path: string, cookie: string | null = OWNER_COOKIE) =>
  app.request(path, { headers: cookie === null ? {} : { cookie } });

interface CreatedCharge {
  readonly id: string;
  readonly amount: string;
  readonly status: string;
  readonly note: string | null;
  readonly expiresAt: string;
}

const create = async (h: Harness, body: unknown = { amount: '150.25', note: 'la vuelta' }) => {
  const response = await post(h.app, '/api/payment-requests', body);
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedCharge;
};

describe('POST /api/payment-requests — creating a charge', () => {
  it('is absent when the use cases are not wired', async () => {
    const app = createApp({
      mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: OWNER, privyDid: 'did:privy:2test' }),
      sessions: { issue: async () => ({ token: 't', expiresAt: EXPIRY }), read: async () => null },
      log: recordingLogger(),
    });

    const response = await post(app, '/api/payment-requests', { amount: '1' });

    expect(response.status).toBe(404);
  });

  it('answers with the shareable id, the amount, the note and when it dies', async () => {
    const h = harness();

    const response = await post(h.app, '/api/payment-requests', { amount: '150.25', note: 'la vuelta' });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(Object.keys(body).sort()).toEqual([
      'amount',
      'createdAt',
      'expiresAt',
      'id',
      'note',
      'requesterTag',
      'status',
    ]);
    expect(body.amount).toBe('150.25');
    expect(body.note).toBe('la vuelta');
    expect(body.status).toBe('pending');
    expect(body.requesterTag).toBeNull();
    // 24 hours, the one deadline the contract fixes for both ways of charging.
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it('reads the charge back by id, and it is the same row', async () => {
    const h = harness();
    const created = await create(h);

    const response = await get(h.app, `/api/payment-requests/${created.id}`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.id).toBe(created.id);
    expect(body.amount).toBe('150.25');
    expect(body.note).toBe('la vuelta');
    expect(body.status).toBe('pending');
    expect(body.expiresAt).toBe(created.expiresAt);
  });

  it('lets somebody else read it: the payer is not the person who created it', async () => {
    const h = harness();
    const created = await create(h);

    const response = await get(h.app, `/api/payment-requests/${created.id}`, PAYER_COOKIE);

    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe(created.id);
  });

  it('refuses a session-less request on every verb, and reads nothing', async () => {
    const h = harness();
    const created = await create(h);

    for (const response of [
      await post(h.app, '/api/payment-requests', { amount: '1' }, NO_COOKIE),
      await get(h.app, `/api/payment-requests/${created.id}`, NO_COOKIE),
      await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, NO_COOKIE),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    }
  });

  it('accepts a decimal amount in whole units, written as text', async () => {
    const h = harness();

    // The charge is an amount of **dollars**, not an integer of the smallest
    // unit: which asset it will be paid in is chosen at payment time, and the
    // table has no column to remember that scale in. So this is the one place
    // where a decimal string is the honest shape, and it is a string in and a
    // string out — there is no float anywhere in the path.
    const cases: readonly [string, string][] = [
      ['1', '1'],
      ['1.5', '1.5'],
      ['0.01', '0.01'],
      ['10', '10'],
      ['150.250000', '150.25'],
      ['1234567890.123456', '1234567890.123456'],
    ];

    for (const [amount, canonical] of cases) {
      const response = await post(h.app, '/api/payment-requests', { amount });
      expect(response.status, amount).toBe(201);
      const body = (await response.json()) as { amount: string };
      // Canonical: no trailing zeroes in the fraction, no exponent, no float.
      expect(body.amount, amount).toBe(canonical);
    }
  });

  it('refuses each broken rule with its own code, and a 400', async () => {
    const h = harness();

    const cases: readonly [unknown, string][] = [
      [{ amount: undefined }, 'AMOUNT_INVALID'],
      [{ amount: 0 }, 'AMOUNT_INVALID'],
      [{ amount: '0.00' }, 'AMOUNT_INVALID'],
      [{ amount: '-1' }, 'AMOUNT_INVALID'],
      [{ amount: '1e6' }, 'AMOUNT_INVALID'],
      [{ amount: '.5' }, 'AMOUNT_INVALID'],
      [{ amount: '1.' }, 'AMOUNT_INVALID'],
      [{ amount: '1.1234567' }, 'AMOUNT_INVALID'],
      [{ amount: '1,25' }, 'AMOUNT_INVALID'],
      [{ amount: '12345678901234567890' }, 'AMOUNT_INVALID'],
      [{ amount: '1', note: 42 }, 'NOTE_INVALID'],
      [{ amount: '1', note: 'x'.repeat(281) }, 'NOTE_INVALID'],
      [{ amount: '1', expiresInMs: 1000 }, 'EXPIRY_OUT_OF_RANGE'],
      [{ amount: '1', expiresInMs: 365 * 24 * 60 * 60 * 1000 }, 'EXPIRY_OUT_OF_RANGE'],
    ];

    for (const [body, code] of cases) {
      const response = await post(h.app, '/api/payment-requests', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json(), JSON.stringify(body)).toEqual({ error: { code } });
    }
    // Nothing was written for any of them.
    expect(h.requests.rows()).toHaveLength(0);
  });

  it('answers 502 when the rows cannot be read, never an empty charge', async () => {
    const h = harness();
    h.requests.failing = true;

    const response = await post(h.app, '/api/payment-requests', { amount: '1' });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'PAYMENT_REQUESTS_UNAVAILABLE' } });
  });
});

describe('GET /api/payment-requests/:id — a wrong id is a refusal', () => {
  it('answers 404 with one bounded code for an id that does not exist', async () => {
    const h = harness();

    const response = await get(h.app, '/api/payment-requests/AAAAAAAAAAAAAAAAAAAAAAAAAAA');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'REQUEST_NOT_FOUND' } });
  });

  it('answers 404, and never a 500, for an id that is not even shaped like one', async () => {
    const h = harness();

    for (const id of ['corto', "'; drop table rewallet.payment_requests; --", 'x'.repeat(33), 'con%20espacios']) {
      const response = await get(h.app, `/api/payment-requests/${encodeURIComponent(id)}`);
      expect(response.status, id).toBe(404);
      expect(await response.json(), id).toEqual({ error: { code: 'REQUEST_NOT_FOUND' } });
    }
  });

  it('never answers a missing charge as an empty success', async () => {
    const h = harness();

    // The dangerous shape: 200 with nothing in it, which a screen would draw as
    // "a charge of no money". The status here is the fact, and it is a refusal.
    const response = await get(h.app, '/api/payment-requests/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

    expect(response.status).not.toBe(200);
    expect(response.status).not.toBe(204);
  });

  it('answers the same for a malformed id and an unknown one, so it is not an oracle', async () => {
    const h = harness();

    const malformed = await get(h.app, '/api/payment-requests/nope');
    const unknown = await get(h.app, '/api/payment-requests/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');

    expect(malformed.status).toBe(unknown.status);
    expect(await malformed.json()).toEqual(await unknown.json());
  });
});

describe('POST /api/payment-requests/:id/pay — one link, one payment', () => {
  it('links the movement, moves the status, and names the payer', async () => {
    const h = harness();
    const created = await create(h);

    const response = await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE);
    const body = (await response.json()) as {
      movement: { id: string; status: string };
      paymentRequest: { id: string; status: string; paidAt: string };
      address: string;
    };

    expect(response.status).toBe(200);
    expect(body.paymentRequest).toEqual({
      id: created.id,
      status: 'paid',
      paidAt: NOW.toISOString(),
    });
    // The movement is the one the send wrote, and it is pending until a hash.
    expect(body.movement).toEqual({ id: 'movement-1', status: 'pending' });
    // The payer signs for their own wallet, as on every other send.
    expect(body.address).toBe(PAYER_ADDRESS);

    // The row says who paid, and the row is the record of the charge.
    const stored = h.requests.rows()[0];
    expect(stored?.status).toBe('paid');
    expect(stored?.paidByUserId).toBe(PAYER);
    expect(stored?.paidAt).toEqual(NOW);
    expect(h.requests.payments).toEqual([
      { id: created.id, paidByUserId: PAYER, movementId: 'movement-1', paidAt: NOW },
    ]);
  });

  it('refuses a second payment without preparing a second transfer', async () => {
    const h = harness();
    const created = await create(h);

    const first = await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE);
    expect(first.status).toBe(200);

    const second = await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE);

    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: { code: 'ALREADY_PAID' } });
    // One movement, one payment row: the second tap moved nothing.
    expect(h.movements).toHaveLength(1);
    expect(h.requests.payments).toHaveLength(1);
  });

  it('reads as paid afterwards, to the payer as well', async () => {
    const h = harness();
    const created = await create(h);
    await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE);

    const response = await get(h.app, `/api/payment-requests/${created.id}`, PAYER_COOKIE);

    expect(((await response.json()) as { status: string }).status).toBe('paid');
  });

  it('refuses to pay a charge whose deadline passed, and moves nothing', async () => {
    const h = harness();
    const created = await create(h, { amount: '10' });

    // A second application over the same rows, one second after the deadline.
    const late = harnessAt(new Date(created.expiresAt).getTime() + 1000, h);
    const response = await post(late.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: { code: 'REQUEST_EXPIRED' } });
    // Nothing moved: no transaction, no movement, no payment row.
    expect(h.movements).toHaveLength(0);
    expect(h.requests.payments).toHaveLength(0);
    expect(h.requests.rows()[0]?.status).toBe('pending');
  });

  it('reads as expired after its deadline, on the row that still says pending', async () => {
    const h = harness();
    const created = await create(h, { amount: '10' });

    const late = harnessAt(new Date(created.expiresAt).getTime() + 1000, h);
    const response = await get(late.app, `/api/payment-requests/${created.id}`, PAYER_COOKIE);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    // The row on disk never changed: `status` is still `pending`, and what the
    // person reads is `expired`. Both facts are asserted, because the difference
    // between them is the whole decision.
    expect(body.status).toBe('expired');
    expect(h.requests.rows()[0]?.status).toBe('pending');
  });

  it('still reads as live one second before the deadline', async () => {
    const h = harness();
    const created = await create(h, { amount: '10' });

    const almost = harnessAt(new Date(created.expiresAt).getTime() - 1000, h);
    const response = await get(almost.app, `/api/payment-requests/${created.id}`, PAYER_COOKIE);

    expect(((await response.json()) as { status: string }).status).toBe('pending');
  });

  it('refuses a person paying their own charge', async () => {
    const h = harness();
    const created = await create(h);

    const response = await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, OWNER_COOKIE);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'SELF_PAYMENT_REFUSED' } });
    expect(h.movements).toHaveLength(0);
  });

  it('refuses a chain or an asset the catalog does not have, with the send codes', async () => {
    const h = harness();
    const created = await create(h);

    const cases: readonly [unknown, string][] = [
      [{ chain: 'base', asset: { symbol: 'USDC', decimals: 6 } }, 'CHAIN_UNKNOWN'],
      [{ chain: 'monad', asset: { symbol: 'DOGE', decimals: 8 } }, 'ASSET_NOT_ON_CHAIN'],
      [{ chain: 'monad', asset: { symbol: 'USDC', decimals: 18 } }, 'INVALID_AMOUNT'],
    ];

    for (const [body, code] of cases) {
      const response = await post(h.app, `/api/payment-requests/${created.id}/pay`, body, PAYER_COOKIE);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json(), JSON.stringify(body)).toEqual({ error: { code } });
    }
    expect(h.movements).toHaveLength(0);
  });

  it('answers 404 for a charge that does not exist, before any chain work', async () => {
    const h = harness();

    const response = await post(
      h.app,
      '/api/payment-requests/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD/pay',
      PAYABLE,
      PAYER_COOKIE,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'REQUEST_NOT_FOUND' } });
    expect(h.movements).toHaveLength(0);
  });

  it('answers 404 for an id that is not shaped like one, without reading anything', async () => {
    const h = harness();

    const response = await post(h.app, '/api/payment-requests/corto/pay', PAYABLE, PAYER_COOKIE);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'REQUEST_NOT_FOUND' } });
    expect(h.movements).toHaveLength(0);
  });

  it('moves the charge once when two payments arrive at the same instant', async () => {
    // The second tap of the ordinary case is stopped before any chain work, but
    // two requests that arrive together both read `pending` — a derived status is
    // an answer, not a lock. The guarantee is the conditional `UPDATE`, so this
    // is the test that pins the guarantee rather than the fast path.
    const h = harness();
    const created = await create(h);

    const [first, second] = await Promise.all([
      post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE),
      post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = (await (statuses[0] === 409 ? first : second).json()) as { error: { code: string } };
    expect(refused.error.code).toBe('ALREADY_PAID');

    // One payment row, one payer, one movement attached to the charge.
    expect(h.requests.payments).toHaveLength(1);
    expect(h.requests.rows()[0]?.paidByUserId).toBe(PAYER);
    expect(h.requests.rows()[0]?.paidAt).toEqual(NOW);
  });

  it('refuses to pay a charge for a second person once it is paid', async () => {
    const h = harness();
    const created = await create(h);
    await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE);

    // Another person, same link: a link is one payment whoever holds it, and the
    // refusal arrives before any transfer is prepared.
    const response = await post(
      h.app,
      `/api/payment-requests/${created.id}/pay`,
      PAYABLE,
      THIRD_COOKIE,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'ALREADY_PAID' } });
    expect(h.movements).toHaveLength(1);
    expect(h.requests.payments).toHaveLength(1);
    expect(h.requests.rows()[0]?.paidByUserId).toBe(PAYER);
  });
});

describe('the payee address does not exist outside the server', () => {
  it('appears in no answer this surface can produce', async () => {
    const h = harness();

    const createdResponse = await post(h.app, '/api/payment-requests', { amount: '150.25', note: 'la vuelta' });
    const createdText = await createdResponse.text();
    const createdBody = JSON.parse(createdText) as CreatedCharge;

    const readText = await (await get(h.app, `/api/payment-requests/${createdBody.id}`, PAYER_COOKIE)).text();
    const payText = await (
      await post(h.app, `/api/payment-requests/${createdBody.id}/pay`, PAYABLE, PAYER_COOKIE)
    ).text();

    for (const [label, text] of [
      ['the create', createdText],
      ['the read', readText],
      ['the pay', payText],
    ] as const) {
      expect(text, label).not.toContain(PAYEE_ADDRESS);
      // Not the checksummed form either, and not in lower case.
      expect(text.toLowerCase(), label).not.toContain(PAYEE_ADDRESS.toLowerCase());
    }

    // And the pay really did go to them: the payer's own wallet is named, the
    // payee's is not, and the transaction is the token contract's transfer.
    const pay = JSON.parse(payText) as { address: string; transactions: { to: string }[] };
    expect(pay.address).toBe(PAYER_ADDRESS);
    expect(pay.transactions[0]?.to).toBe('0x754704Bc059F8C67012fEd69BC8A327a5aafb603');
  });

  it('never leaks a balance or the internal reason of a refusal', async () => {
    const h = harness();
    // 15 025 dollars against a 1000 balance: refused before anything is signed.
    const created = await create(h, { amount: '15025' });

    const refused = await (
      await post(h.app, `/api/payment-requests/${created.id}/pay`, PAYABLE, PAYER_COOKIE)
    ).text();

    expect(refused).toContain('AMOUNT_EXCEEDS_BALANCE');
    // The balance, in the smallest unit and as the account holds it, is in
    // neither the answer nor the refusal.
    expect(refused).not.toContain('1000000000');
    expect(refused).not.toContain('1000');
    expect(refused).not.toContain(PAYEE_ADDRESS);
    expect(refused).not.toContain('erc20Balance');
  });
});

/**
 * A second application over the **same** rows, with the clock moved.
 *
 * Expiry is a fact about a deadline, and a test that can only run at one instant
 * cannot see it. This wires a second clock over one store, which is exactly what
 * "an hour later" means to a server.
 */
function harnessAt(when: number, shared: Harness): Harness {
  const requests = shared.requests;
  const movements = shared.movements;
  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: OWNER, privyDid: 'did:privy:2test' }),
    sessions: {
      issue: async () => ({ token: 'rw1.owner', expiresAt: EXPIRY }),
      read: async (token) => sessionOf(token),
    },
    createPaymentRequest: createPaymentRequest({ requests: requests.store }),
    readPaymentRequest: readPaymentRequest({ requests: requests.store, now: () => new Date(when) }),
    payPaymentRequest: payPaymentRequest({
      requests: requests.store,
      wallets,
      now: () => new Date(when),
      prepareSend: prepareSend({
        wallets,
        evm,
        solana,
        solanaTransfers,
        movements: {
          createPending: async (_userId, _walletChain, movement) => {
            movements.push(movement);
            return { id: `movement-${movements.length}`, status: 'pending' };
          },
        },
        idempotency: noIdempotency,
      }),
    }),
    log: recordingLogger(),
    now: () => new Date(when),
  });

  return { app, requests, movements };
}
