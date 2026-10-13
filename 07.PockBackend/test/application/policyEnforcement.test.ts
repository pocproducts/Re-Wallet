/**
 * LA POLITICA SE IMPONE: los dos caminos que mueven plata, y la puerta por la que
 * se los frena.
 *
 * ── Qué se está protegiendo ──────────────────────────────────────────────────
 *
 * Una politica que el cliente puede ignorar no es una politica. Estos tests
 * corren las **reglas de verdad** (`createEvaluateSendPolicy`, no un fake) contra
 * los dos caminos que mueven plata, y atraviesan HTTP —no el caso de uso— porque
 * el ataque que motiva el cambio es un `curl` con una cookie de sesión:
 *
 *   1. un envío que se pasa del tope por hora se rechaza **aunque el cliente no
 *      haya consultado nunca la politica**;
 *   2. un pago de cobro se rechaza por la misma puerta, porque llama a
 *      `prepareSend` por dentro;
 *   3. un `deny` no se levanta con ninguna bandera del cuerpo;
 *   4. un `confirm` sin el gesto explícito frena, y con él sigue;
 *   5. la decisión exigida queda escrita en `policy_decisions`.
 *
 * ── Por qué la historia se siembra como decisiones ───────────────────────────
 *
 * El store real (`policyStore.pg.ts`) lee `rewallet.policy_decisions`: lo que se
 * envió en la última hora es lo que la política **anotó**, no lo que hay en
 * `movements`. Sembrar decisiones es entonces sembrar la historia tal como el
 * servidor la ve, y es lo que hace que la regla de ritmo se evalúe de verdad.
 */
import { describe, expect, it } from 'vitest';

import { prepareSend, type SendRejectionCode } from '../../src/application/send/prepareSend';
import { createPaymentRequest } from '../../src/application/payment-requests/createPaymentRequest';
import { readPaymentRequest } from '../../src/application/payment-requests/readPaymentRequest';
import {
  PaymentRefused,
  payPaymentRequest,
  type PayPaymentRequestCode,
} from '../../src/application/payment-requests/payPaymentRequest';
import { createEvaluateSendPolicy } from '../../src/application/policy/evaluateSendPolicyUseCase';
import type {
  PolicyDecisionRecord,
  PolicyStore,
} from '../../src/domain/ports/policy-store';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { SolanaTransferPreparer } from '../../src/domain/ports/solana-transfer-preparer';
import type { ReachableWalletStore } from '../../src/domain/ports/wallet-store';
import type { MovementStore, PendingSendMovement } from '../../src/domain/ports/movement-store';
import type { IdempotencyStore } from '../../src/domain/ports/idempotency-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { recordingLogger, USER_ID } from '../support/fixtures';
import { inMemoryPaymentRequests } from '../support/paymentRequests';

const PAYER = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const SENDER = '0x1234567890abcdef1234567890abcdef12345678';
const PAYER_ADDRESS = '0x00000000000000000000000000000000000000aa';
const OWNER_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const RECIPIENT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

/** One moment, shared by the clock of every collaborator. */
const NOW = new Date('2026-10-04T05:00:00.000Z');
/** Half an hour before it: inside the one-hour window of the velocity rule. */
const RECENT = new Date(NOW.getTime() - 30 * 60 * 1000);

/** A charge id: 32 characters, the width the table's CHECK allows. */
const CHARGE_ID = 'kQ3v7pZ2mR8tY5wB1nF4hJ6sLdC9xGa';

/**
 * Dollars in the smallest unit of a 6-decimal asset.
 *
 * Written as dollars on purpose: a test that wrote `900` would be comparing 900
 * against a 1.000.000.000 limit and the rule would never fire — a false negative
 * silencioso, que es el peor bug posible en un control de riesgo.
 */
const usd = (amount: number): bigint => BigInt(amount) * 1_000_000n;

const wallets: ReachableWalletStore = {
  findByTag: async () => ({ kind: 'nobody' }),
  findByUserId: async (userId) =>
    userId === PAYER
      ? [{ address: PAYER_ADDRESS, providerWalletId: 'wallet-payer', chain: 'ethereum', evmNetwork: 'eip155:1' }]
      : userId === OWNER
        ? [{ address: OWNER_ADDRESS, providerWalletId: 'wallet-owner', chain: 'ethereum', evmNetwork: 'eip155:1' }]
        : [{ address: SENDER, providerWalletId: 'wallet-sender', chain: 'ethereum', evmNetwork: 'eip155:1' }],
  save: async () => {},
};

const balances = (): { evm: EvmBalanceReader; solana: SolanaBalanceReader } => ({
  // Funded for anything these tests send, and with gas: this suite is about the
  // policy, and a short balance would be a different refusal in the way.
  evm: {
    nativeBalance: async () => 5_000_000_000_000_000_000n,
    erc20Balance: async () => 100_000_000_000n,
  },
  solana: {
    lamports: async () => 4_000_000_000n,
    tokenAmount: async () => 10_000_000n,
    mintBalance: async () => 10_000_000n,
  },
});

const solanaTransfers: SolanaTransferPreparer = {
  prepare: async () => ({ serializedTransaction: 'AQID', network: 'solana:5eykt4FsF39zoS6r8aazuL5Nz1x2pmU3BvWvhfaAZcSx' }),
};

/**
 * The decisions on file, and the reads the real store answers with them.
 *
 * Same two reads as `policyStore.pg.ts`, same semantics: `sendsSince` filters the
 * window and `hasEverSentTo` compares the destination string. A second
 * implementation here would be a second opinion about what the rules know.
 */
const policyStoreOf = (history: readonly PolicyDecisionRecord[] = []) => {
  const decisions: PolicyDecisionRecord[] = [...history];
  const store: PolicyStore = {
    async sendsSince(userId, since) {
      return decisions
        .filter((row) => row.userId === userId && row.at.getTime() >= since.getTime() && row.amount > 0n)
        .sort((left, right) => right.at.getTime() - left.at.getTime())
        .map((row) => ({ amount: row.amount, recipient: row.recipient, at: row.at }));
    },
    async hasEverSentTo(userId, recipient) {
      return decisions.some((row) => row.userId === userId && row.recipient === recipient && row.amount > 0n);
    },
    async record(decision) {
      decisions.push(decision);
    },
  };
  return { store, decisions };
};

const movementStoreOf = () => {
  const written: PendingSendMovement[] = [];
  const store: MovementStore = {
    createPending: async (_userId, _walletChain, movement) => {
      written.push(movement);
      return { id: `movement-${written.length}`, status: 'pending' };
    },
  };
  return { store, written };
};

const idempotencyStoreOf = () => {
  const rows = new Map<string, unknown>();
  const store: IdempotencyStore = {
    find: async () => null,
    reserve: async ({ key }) => {
      if (rows.has(key)) return false;
      rows.set(key, {});
      return true;
    },
    complete: async () => {},
    release: async ({ key }) => {
      rows.delete(key);
    },
  };
  return { store, rows };
};

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly sendCookie: string;
  readonly payerCookie: string;
  /** Every decision the rules wrote, in order. */
  readonly decisions: readonly PolicyDecisionRecord[];
  /** Every movement the send flow wrote, in order. */
  readonly movements: readonly PendingSendMovement[];
  /** The idempotency rows still held — a refused send holds none. */
  readonly claims: ReadonlyMap<string, unknown>;
  readonly chargeStatus: () => string;
}

const harness = (
  options: {
    /** What the rules already know about the payer's last hour. */
    readonly history?: readonly PolicyDecisionRecord[];
    /** The amount of the charge to pay, in dollars. */
    readonly chargeAmount?: string;
  } = {},
): Harness => {
  const readers = balances();
  const policy = policyStoreOf(options.history ?? []);
  const movements = movementStoreOf();
  const idempotency = idempotencyStoreOf();
  const log = recordingLogger();

  /*
   * The real use case, over the fake store: the three rules that ship in
   * `evaluateSendPolicy.ts` are the ones deciding here, and every verdict —
   * including this enforced one — is written through the same `record` the
   * advisory endpoint writes.
   */
  const evaluateSendPolicy = createEvaluateSendPolicy({
    policy: policy.store,
    now: () => NOW,
    log,
  });

  const send = prepareSend({
    wallets,
    evm: readers.evm,
    solana: readers.solana,
    solanaTransfers,
    movements: movements.store,
    idempotency: idempotency.store,
    policy: evaluateSendPolicy,
    log,
    now: () => NOW,
  });

  const charges = inMemoryPaymentRequests([
    {
      id: CHARGE_ID,
      userId: OWNER,
      amount: options.chargeAmount ?? '300',
      chain: 'monad',
      assetSymbol: 'USDC',
      assetDecimals: 6,
      note: null,
      status: 'pending',
      createdAt: RECENT,
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      requesterTag: 'quiencobra',
    },
  ]);

  const pay = payPaymentRequest({
    requests: charges.store,
    wallets,
    prepareSend: send,
    now: () => NOW,
    log,
  });

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: new Date('2030-01-01T00:00:00Z'), userId: USER_ID, privyDid: 'did:privy:2test' }),
    sessions: {
      issue: async () => ({ token: 'rw1.token', expiresAt: new Date('2030-01-01T00:00:00Z') }),
      read: async (token) =>
        token === 'rw1.sender'
          ? { userId: USER_ID, privyDid: 'did:privy:2test' }
          : token === 'rw1.payer'
            ? { userId: PAYER, privyDid: 'did:privy:2test' }
            : null,
    },
    prepareSend: send,
    createPaymentRequest: createPaymentRequest({ requests: charges.store, log }),
    readPaymentRequest: readPaymentRequest({ requests: charges.store, log }),
    payPaymentRequest: pay,
    log,
    now: () => NOW,
  });

  return {
    app,
    sendCookie: `${SESSION_COOKIE_NAME}=rw1.sender`,
    payerCookie: `${SESSION_COOKIE_NAME}=rw1.payer`,
    decisions: policy.decisions,
    movements: movements.written,
    claims: idempotency.rows,
    chargeStatus: () => charges.rows()[0]?.status ?? 'gone',
  };
};

const sendBody = (over: Record<string, unknown> = {}) => ({
  requestId: '9f1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c8f10',
  chain: 'monad',
  asset: { symbol: 'USDC', decimals: 6 },
  recipient: RECIPIENT,
  amountRaw: usd(300).toString(),
  ...over,
});

const post = (h: Harness, path: string, body: unknown, cookie = h.sendCookie) =>
  h.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

/** The code a refused answer carries, or `null` when it was accepted. */
const codeOf = async (response: Response): Promise<PayPaymentRequestCode | SendRejectionCode | null> => {
  if (response.status < 400) return null;
  const body = (await response.json()) as { error?: { code?: string } };
  const code = body.error?.code;
  if (code === undefined) throw new Error(`no code in ${response.status} answer`);
  return code as PayPaymentRequestCode;
};

describe('the send, refused by a rule the client never asked about', () => {
  it('refuses a send over the hourly cap with no consultation at all', async () => {
    /*
     * $900 already left this wallet half an hour ago. $300 more is $1.200 in the
     * hour, over the cap, and the request never calls
     * `POST /api/wallet/policy/evaluate` — nothing about the policy is consulted
     * by the client, exactly like a `curl` with a stolen cookie would be.
     */
    const h = harness({
      history: [
        { userId: USER_ID, amount: usd(900), recipient: RECIPIENT, verdict: 'allow', rule: null, at: RECENT },
      ],
    });

    const response = await post(h, '/api/send/prepare', sendBody());

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('POLICY_DENIED');

    // Nothing was built, nothing was written, and the key was never taken: a
    // refused send leaves the database as it found it.
    expect(h.movements).toHaveLength(0);
    expect(h.claims.size).toBe(0);
  });

  it('writes the refusal down, even though nobody asked first', async () => {
    const h = harness({
      history: [
        { userId: USER_ID, amount: usd(900), recipient: RECIPIENT, verdict: 'allow', rule: null, at: RECENT },
      ],
    });

    await post(h, '/api/send/prepare', sendBody());

    const last = h.decisions.at(-1);
    expect(last?.userId).toBe(USER_ID);
    expect(last?.amount).toBe(usd(300));
    // The destination the rules were asked about is the **resolved** one: the
    // transfer was going there, so that is what the rules had to decide about.
    expect(last?.recipient).toBe(RECIPIENT);
    expect(last?.verdict).toBe('deny');
    expect(last?.rule).toBe('velocity_per_hour');
  });
});

describe('a `deny` is a wall', () => {
  // A hard cap that some body field could lift is not a cap. Every one of these
  // is what a client would try.
  it('is not lifted by any flag in the body', async () => {
    const history: readonly PolicyDecisionRecord[] = [
      { userId: USER_ID, amount: usd(900), recipient: RECIPIENT, verdict: 'allow', rule: null, at: RECENT },
    ];

    for (const flag of [
      { policyConfirmed: true },
      { policyConfirmed: 'true' },
      { confirmed: true },
      { force: true },
      { override: 'velocity_per_hour' },
      { skipPolicy: true },
      { acceptedRisk: true },
    ]) {
      const h = harness({ history });

      const response = await post(h, '/api/send/prepare', sendBody(flag));

      expect(response.status, JSON.stringify(flag)).toBe(400);
      expect(await codeOf(response), JSON.stringify(flag)).toBe('POLICY_DENIED');
      expect(h.movements, JSON.stringify(flag)).toHaveLength(0);
    }
  });
});

describe('a `confirm` costs an explicit gesture', () => {
  it('stops the send when the body carries no gesture', async () => {
    /*
     * $600 to a destination this wallet has never used: over the single-send
     * limit and new, so two rules ask. Nothing was ever consulted, no gesture
     * came, and the operation stops here with its reason on file.
     */
    const h = harness();

    const response = await post(h, '/api/send/prepare', sendBody({ amountRaw: usd(600).toString() }));

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('POLICY_CONFIRM_REQUIRED');
    expect(h.movements).toHaveLength(0);
    expect(h.claims.size).toBe(0);

    // The reason travels as the rule that decided, which is what the screen
    // renders from the advisory answer it asked for.
    expect(h.decisions.at(-1)?.verdict).toBe('confirm');
    expect(h.decisions.at(-1)?.rule).toBe('max_single_send');
  });

  it('does not accept an improvised gesture either', async () => {
    const h = harness();

    const response = await post(
      h,
      '/api/send/prepare',
      sendBody({ amountRaw: usd(600).toString(), policyConfirmed: 'true' }),
    );

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('POLICY_CONFIRM_REQUIRED');
  });

  it('lets the send through when the gesture is exactly true, and records it', async () => {
    const h = harness();

    const response = await post(
      h,
      '/api/send/prepare',
      sendBody({ amountRaw: usd(600).toString(), policyConfirmed: true }),
    );

    expect(response.status).toBe(200);
    expect(h.movements).toHaveLength(1);

    const last = h.decisions.at(-1);
    expect(last?.verdict).toBe('confirm');
    expect(last?.amount).toBe(usd(600));
    expect(last?.recipient).toBe(RECIPIENT);
  });
});

describe('an allowed send is unchanged', () => {
  it('still prepares, and still writes its movement', async () => {
    /*
     * $100 to this destination was already sent half an hour ago, so the
     * destination is known; $200 more is under the single-send limit and the
     * hour adds up to $300 of the $1.000 cap. The three rules let it through,
     * which is the control working and not the control being absent.
     */
    const h = harness({
      history: [
        { userId: USER_ID, amount: usd(100), recipient: RECIPIENT, verdict: 'allow', rule: null, at: RECENT },
      ],
    });

    const response = await post(h, '/api/send/prepare', sendBody({ amountRaw: usd(200).toString() }));

    expect(response.status).toBe(200);
    const prepared = (await response.json()) as { transactions: unknown[]; movement: { status: string } };
    expect(prepared.transactions).toHaveLength(1);
    expect(prepared.movement.status).toBe('pending');
    expect(h.movements).toHaveLength(1);
    expect(h.decisions.at(-1)?.verdict).toBe('allow');
  });
});

describe('paying a charge, through the same door', () => {
  it('is refused when the payer is over the hourly cap', async () => {
    // The payer already moved $900 this hour. A $300 charge would take the hour
    // to $1.200, so the payment is refused — and the charge stays `pending`,
    // because nothing was paid.
    const h = harness({
      history: [
        { userId: PAYER, amount: usd(900), recipient: OWNER_ADDRESS, verdict: 'allow', rule: null, at: RECENT },
      ],
      chargeAmount: '300',
    });

    const response = await post(h, `/api/payment-requests/${CHARGE_ID}/pay`, {}, h.payerCookie);

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('POLICY_DENIED');
    expect(h.movements).toHaveLength(0);
    expect(h.chargeStatus()).toBe('pending');
  });

  it('is refused for a missing gesture', async () => {
    /*
     * A first payment to this payee is a new destination, so the rules ask. The
     * charge does not care that a link was involved: no gesture, no transfer.
     */
    const h = harness({ chargeAmount: '300' });

    const refused = await post(h, `/api/payment-requests/${CHARGE_ID}/pay`, {}, h.payerCookie);

    expect(refused.status).toBe(400);
    expect(await codeOf(refused)).toBe('POLICY_CONFIRM_REQUIRED');
    expect(h.movements).toHaveLength(0);
    expect(h.chargeStatus()).toBe('pending');
    expect(h.decisions.at(-1)?.verdict).toBe('confirm');
  });

  it('is paid when the pay body carries the gesture', async () => {
    /*
     * The same starting point, with the gesture: the payment goes through and
     * the rules' answer —`confirm`, for a destination this payer had never
     * paid— is the one written down. Two harnesses rather than one, on purpose:
     * the first attempt already wrote a decision for this destination, and a
     * second call over the same store would be answering a **different**
     * question ("is this destination new?") than the one this test is about.
     */
    const h = harness({ chargeAmount: '300' });

    const paid = await post(
      h,
      `/api/payment-requests/${CHARGE_ID}/pay`,
      { policyConfirmed: true },
      h.payerCookie,
    );

    expect(paid.status).toBe(200);
    expect(h.chargeStatus()).toBe('paid');
    expect(h.movements).toHaveLength(1);
    expect(h.decisions.at(-1)?.verdict).toBe('confirm');
    expect(h.decisions.at(-1)?.recipient).toBe(OWNER_ADDRESS);
    expect(h.decisions.at(-1)?.amount).toBe(usd(300));
  });

  it('cannot redirect the payment with any other field of the body', async () => {
    const h = harness({ chargeAmount: '300' });

    const response = await post(
      h,
      `/api/payment-requests/${CHARGE_ID}/pay`,
      { policyConfirmed: true, chain: 'base', asset: { symbol: 'USDT', decimals: 6 }, recipient: RECIPIENT },
      h.payerCookie,
    );

    expect(response.status).toBe(200);
    const paid = (await response.json()) as { chain: string; movement: { id: string } };
    expect(paid.chain).toBe('monad');
    expect(h.movements[0]?.meta.recipient).toBe(OWNER_ADDRESS);
  });
});
