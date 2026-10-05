/**
 * `POST /api/send/prepare`, over HTTP.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **The session is the door.** No cookie, nothing read and nothing written —
 *      the same 401 body every other route answers with.
 *   2. **The browser learns nothing it could misuse.** It gets a transaction to
 *      sign, a movement id and a status. Not the sender's balance, not the
 *      catalog.
 *   3. **Every refusal is a bounded code, and the status says what happened.**
 *      400 for a refused send, 409 for a replay, 401 for no session, 502 for
 *      rows that could not be read.
 */
import { describe, expect, it } from 'vitest';

import { prepareSend, SendRejected, SendReplay, SendInFlight } from '../../src/application/send/prepareSend';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { SolanaTransferPreparer } from '../../src/domain/ports/solana-transfer-preparer';
import { SOLANA_MAINNET_NETWORK } from '../../src/domain/send/transfer';
import type { WalletStore } from '../../src/domain/ports/wallet-store';
import type { MovementStore } from '../../src/domain/ports/movement-store';
import { idempotencyKeyFor, type IdempotencyStore } from '../../src/domain/ports/idempotency-store';
import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createApp } from '../../src/interface/http/app';
import { recordingLogger, USER_ID } from '../support/fixtures';

const EXPIRY = new Date('2030-01-01T00:00:00Z');
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=rw1.super.secret`;
const REQUEST_ID = '3b6f1f2e-6a6d-4a2f-9a44-9f2b1c9d0e11';
const EVM_SENDER = '0x1234567890abcdef1234567890abcdef12345678';
const SOLANA_SENDER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const RECIPIENT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SOLANA_RECIPIENT = SOLANA_SENDER;

const wallets: WalletStore = {
  findByUserId: async () => [
    { address: EVM_SENDER, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
    { address: SOLANA_SENDER, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
  ],
  save: async () => {},
};

const evm: EvmBalanceReader = {
  nativeBalance: async () => 5_000_000_000_000_000_000n,
  erc20Balance: async () => 10_000_000n,
};
const solana: SolanaBalanceReader = {
  lamports: async () => 4_000_000_000n,
  tokenAmount: async () => 10_000_000n,
};

/**
 * The Solana message builder, stubbed at the port.
 *
 * The bytes are the adapter's business and are asserted where the adapter is, in
 * `test/infrastructure/solanaTransferPreparer.http.test.ts`. Over HTTP what
 * matters is that the route carries a `kind: 'solana'` transaction with a
 * serialized message and no EVM chain id.
 */
const solanaTransfers: SolanaTransferPreparer = {
  prepare: async () => ({ serializedTransaction: 'AQID', network: SOLANA_MAINNET_NETWORK }),
};

const harness = () => {
  const movements: string[] = [];
  const rows = new Map<string, { userId: string; endpoint: string; response: unknown; statusCode: number; complete: boolean }>();

  const movementStore: MovementStore = {
    createPending: async (_userId, _walletChain, movement) => {
      movements.push(movement.title);
      return { id: `movement-${movements.length}`, status: 'pending' };
    },
  };
  const idempotency: IdempotencyStore = {
    find: async ({ key, userId, endpoint }) => {
      const row = rows.get(key);
      return row !== undefined && row.userId === userId && row.endpoint === endpoint && row.complete
        ? { response: row.response, statusCode: row.statusCode }
        : null;
    },
    reserve: async ({ key, userId, endpoint }) => {
      if (rows.has(key)) return false;
      rows.set(key, { userId, endpoint, response: {}, statusCode: 0, complete: false });
      return true;
    },
    complete: async ({ key, response, statusCode }) => {
      const row = rows.get(key);
      if (row !== undefined) rows.set(key, { ...row, response, statusCode, complete: true });
    },
    release: async ({ key }) => {
      rows.delete(key);
    },
  };

  const app = createApp({
    mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: 'did:privy:2test' }),
    sessions: {
      issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
      read: async (token) => (token === 'rw1.super.secret' ? { userId: USER_ID, privyDid: 'did:privy:2test' } : null),
    },
    prepareSend: prepareSend({
      wallets,
      evm,
      solana,
      solanaTransfers,
      movements: movementStore,
      idempotency,
      log: recordingLogger(),
    }),
    log: recordingLogger(),
    now: () => new Date('2026-10-04T05:00:00.000Z'),
  });

  return { app, movements, rows };
};

const post = (app: ReturnType<typeof harness>['app'], body: unknown, cookie: string | null = SESSION_COOKIE) =>
  app.request('/api/send/prepare', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === null ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });

const validBody = {
  requestId: REQUEST_ID,
  chain: 'monad',
  asset: { symbol: 'USDC', decimals: 6 },
  recipient: RECIPIENT,
  amountRaw: '1500000',
};

describe('POST /api/send/prepare', () => {
  it('is absent when the use case is not wired', async () => {
    const app = createApp({
      mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: 'did:privy:2test' }),
      sessions: {
        issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
        read: async () => null,
      },
      log: recordingLogger(),
    });

    const response = await post(app, validBody);

    expect(response.status).toBe(404);
  });

  it('refuses a request without a session', async () => {
    const { app } = harness();

    const response = await post(app, validBody, null);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('answers with the chain, the unsigned transaction and the pending movement', async () => {
    const { app } = harness();

    const response = await post(app, validBody);
    const body = (await response.json()) as {
      chainId: number;
      network: string;
      transactions: { purpose: string; to: string; data: string; value: string; chainId: number }[];
      movement: { id: string; status: string };
    };

    expect(response.status).toBe(200);
    expect(body.chainId).toBe(143);
    expect(body.network).toBe('eip155:143');
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]?.purpose).toBe('transfer');
    expect(body.transactions[0]?.chainId).toBe(143);
    expect(body.transactions[0]?.value).toBe('0');
    expect(body.movement).toEqual({ id: 'movement-1', status: 'pending' });
  });

  it('answers with the address the balance was read for, and nothing else for the browser to guess', async () => {
    const { app } = harness();

    const response = await post(app, validBody);
    const body = (await response.json()) as Record<string, unknown>;

    // The row's address — not the recipient, and not one from the body.
    expect(body.address).toBe(EVM_SENDER);
    expect(body.address).not.toBe(RECIPIENT);
    // Same name the deposit answers with, so one screen learns both routes.
    expect(Object.keys(body).sort()).toEqual([
      'address',
      'chain',
      'chainId',
      'movement',
      'network',
      'requestId',
      'transactions',
    ]);
  });

  it('keeps the address out of the answer when the send is refused', async () => {
    const { app } = harness();

    const response = await post(app, { ...validBody, amountRaw: '10000001' });

    // A refusal says what was wrong and nothing else: no address, no transaction.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'AMOUNT_EXCEEDS_BALANCE' } });
  });

  it('answers a Solana send with a serialized message and no EVM chain id', async () => {
    const { app } = harness();

    const response = await post(app, {
      ...validBody,
      chain: 'solana',
      asset: { symbol: 'SOL', decimals: 9 },
      recipient: SOLANA_SENDER,
      amountRaw: '1500000000',
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    // The discriminant the screen switches on, and the shape it switches to.
    expect(body.transactions).toEqual([
      { purpose: 'transfer', kind: 'solana', serializedTransaction: 'AQID', chain: 'solana' },
    ]);
    // No number that no cluster ever gave.
    expect('chainId' in body).toBe(false);
    expect(body.network).toMatch(/^solana:/);
    expect(body.address).toBe(SOLANA_SENDER);
  });

  it('carries the address in the stored answer a replay hands back', async () => {
    const { app, rows } = harness();

    const first = await post(app, validBody);
    expect((await first.json()) as { address: string }).toMatchObject({ address: EVM_SENDER });

    // The replay travels from the stored response, so the browser gets the same
    // trusted address on the second tap as on the first.
    const stored = [...rows.values()].find((row) => row.complete);
    expect(stored?.response).toMatchObject({ address: EVM_SENDER });

    const replay = await post(app, validBody);
    expect(replay.status).toBe(409);
    const body = (await replay.json()) as { replay: { address: string } };
    expect(body.replay.address).toBe(EVM_SENDER);
  });

  it('refuses each broken rule with its own code and a 400', async () => {
    const { app } = harness();

    const cases: readonly [unknown, string][] = [
      [{ ...validBody, requestId: undefined }, 'REQUEST_ID_INVALID'],
      [{ ...validBody, chain: 'base' }, 'CHAIN_UNKNOWN'],
      [{ ...validBody, asset: { symbol: 'DOGE', decimals: 8 } }, 'ASSET_NOT_ON_CHAIN'],
      [{ ...validBody, asset: { symbol: 'USDC', decimals: 18 } }, 'INVALID_AMOUNT'],
      [{ ...validBody, recipient: '0x123' }, 'INVALID_RECIPIENT'],
      [{ ...validBody, recipient: '0x5aAeb6053f3E94C9b9A09f33669435E7Ef1BeAed' }, 'INVALID_RECIPIENT'],
      [{ ...validBody, amountRaw: '0' }, 'INVALID_AMOUNT'],
      [{ ...validBody, amountRaw: '-1' }, 'INVALID_AMOUNT'],
      [{ ...validBody, amountRaw: '1.5' }, 'INVALID_AMOUNT'],
      [{ ...validBody, amountRaw: '1e6' }, 'INVALID_AMOUNT'],
      [{ ...validBody, amountRaw: '10000001' }, 'AMOUNT_EXCEEDS_BALANCE'],
    ];

    for (const [body, code] of cases) {
      const response = await post(app, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      const refused = (await response.json()) as { error: { code: string } };
      expect(refused.error.code, JSON.stringify(body)).toBe(code);
      expect(SendRejected.codes).toContain(refused.error.code);
    }
  });

  it('refuses a token send from a wallet with no gas, and one whose balance cannot be read', async () => {
    const app = (reads: { native?: bigint; erc20?: bigint | 'fail' }) =>
      createApp({
        mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: 'did:privy:2test' }),
        sessions: {
          issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
          read: async () => ({ userId: USER_ID, privyDid: 'did:privy:2test' }),
        },
        prepareSend: prepareSend({
          wallets,
          evm: {
            nativeBalance: async () => reads.native ?? 5_000_000_000_000_000_000n,
            erc20Balance: async () => {
              if (reads.erc20 === 'fail') throw new Error('node down');
              return reads.erc20 ?? 10_000_000n;
            },
          },
          solana,
          solanaTransfers,
          movements: { createPending: async () => ({ id: 'm1', status: 'pending' }) },
          idempotency: {
            find: async () => null,
            reserve: async () => true,
            complete: async () => {},
            release: async () => {},
          },
          log: recordingLogger(),
        }),
        log: recordingLogger(),
      });

    const noGas = await post(app({ native: 0n }), validBody);
    expect(noGas.status).toBe(400);
    expect(await noGas.json()).toEqual({ error: { code: 'NO_GAS' } });

    const unreadable = await post(app({ erc20: 'fail' }), validBody);
    expect(unreadable.status).toBe(400);
    expect(await unreadable.json()).toEqual({ error: { code: 'BALANCE_UNREADABLE' } });
  });

  it('answers 409 with the stored response when the same requestId comes back', async () => {
    const { app, movements } = harness();

    const first = await (await post(app, validBody)).json();
    const second = await post(app, validBody);
    const replay = (await second.json()) as { error: { code: string }; replay: unknown };

    expect(second.status).toBe(409);
    expect(replay.error.code).toBe('IDEMPOTENT_REPLAY');
    expect(replay.replay).toEqual(first);
    // One movement, one prepared transaction, one signature's worth of work.
    expect(movements).toHaveLength(1);
  });

  it('answers 409 when the claim for that requestId is still in flight', async () => {
    const { app, rows } = harness();
    rows.set(idempotencyKeyFor(USER_ID, '/api/send/prepare', REQUEST_ID), {
      userId: USER_ID,
      endpoint: '/api/send/prepare',
      response: {},
      statusCode: 0,
      complete: false,
    });

    const response = await post(app, validBody);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'IDEMPOTENT_IN_FLIGHT' } });
  });

  it('answers 502 when the wallet rows cannot be read', async () => {
    const app = createApp({
      mint: async () => ({ token: 'x', expiresAt: EXPIRY, userId: USER_ID, privyDid: 'did:privy:2test' }),
      sessions: {
        issue: async () => ({ token: 'rw1.super.secret', expiresAt: EXPIRY }),
        read: async () => ({ userId: USER_ID, privyDid: 'did:privy:2test' }),
      },
      prepareSend: prepareSend({
        wallets: {
          findByUserId: async () => {
            throw new Error('connection reset');
          },
          save: async () => {},
        },
        evm,
        solana,
        solanaTransfers,
        movements: { createPending: async () => ({ id: 'm1', status: 'pending' }) },
        idempotency: {
          find: async () => null,
          reserve: async () => true,
          complete: async () => {},
          release: async () => {},
        },
        log: recordingLogger(),
      }),
      log: recordingLogger(),
    });

    const response = await post(app, validBody);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'WALLETS_UNAVAILABLE' } });
  });

  it('answers 400 for a body that is not JSON at all, without a 500', async () => {
    const { app } = harness();

    const response = await app.request('/api/send/prepare', {
      method: 'POST',
      headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toEqual({ error: { code: 'REQUEST_ID_INVALID' } });
  });

  it('never leaks a balance, and never the internal reason of a refusal', async () => {
    const { app } = harness();

    // The answer carries `address` — the requester's **own** wallet, returned to
    // the session that owns it, because the browser has to sign for it. What it
    // must never carry is how much money that wallet has.
    const ok = await (await post(app, validBody)).text();
    expect(ok).toContain(EVM_SENDER);
    expect(ok).not.toContain('10000000');
    expect(ok).not.toContain('5000000000000000000');

    const refused = await (
      await post(app, { ...validBody, requestId: 'another-request', recipient: '0x123' })
    ).text();
    expect(refused).toContain('INVALID_RECIPIENT');
    // A refusal names a code and nothing else: not the address, not the reason.
    expect(refused).not.toContain('40 hex');
    expect(refused).not.toContain(EVM_SENDER);
  });
});

describe('the two non-happy answers', () => {
  it('both name a code a browser can switch on', () => {
    expect(SendRejected.codes).toContain('INVALID_RECIPIENT');
    expect(new SendReplay({ movement: { id: 'm', status: 'pending' } } as never).name).toBe('SendReplay');
    expect(new SendInFlight(REQUEST_ID).name).toBe('SendInFlight');
  });
});
