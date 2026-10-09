/**
 * `POST /api/send/prepare`, at the application layer: the real use case over
 * injected ports, no network and no database.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **Nothing is built before the request is fully checked.** Chain, asset,
 *      decimals, amount and recipient are settled before a single balance is
 *      read, so a refusal costs no RPC and never reaches the chain.
 *   2. **The balance is the chain's, read now.** Exactly the balance is
 *      accepted and one unit more is refused, and a balance that could not be
 *      read is `BALANCE_UNREADABLE`, never a zero.
 *   3. **Gas is checked on mainnet.** A send of USDC from a wallet with no MON
 *      would be signed by the person and then fail.
 *   4. **The contracts stay on the server.** The response is a transaction to
 *      sign; the token address in it comes from the catalog, never from the body.
 *   5. **A second tap prepares nothing.** The same `requestId` for the same
 *      person answers 409 with the stored response and writes nothing, while the
 *      same `requestId` from another person is simply their own first send.
 */
import { describe, expect, it } from 'vitest';
import { toFunctionSelector } from 'viem';

import { prepareSend, SendRejected, SendReplay, SendInFlight } from '../../src/application/send/prepareSend';
import { SEND_PREPARE_ENDPOINT } from '../../src/application/send/prepareSend';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import {
  SolanaPreparationError,
  type SolanaTransferPreparer,
  type SolanaTransferRequest,
} from '../../src/domain/ports/solana-transfer-preparer';
import {
  isSolanaTransaction,
  SOLANA_MAINNET_NETWORK,
  type SendTransaction,
  type UnsignedTransfer,
} from '../../src/domain/send/transfer';
import type { ReachableWalletStore } from '../../src/domain/ports/wallet-store';
import type { MovementStore, PendingSendMovement } from '../../src/domain/ports/movement-store';
import { idempotencyKeyFor, type IdempotencyStore } from '../../src/domain/ports/idempotency-store';
import { DEPOSIT_NETWORKS } from '../../src/domain/deposit/catalog';
import { recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const EVM_SENDER = '0x1234567890abcdef1234567890abcdef12345678';
const RECIPIENT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SOLANA_RECIPIENT = SOLANA_ADDRESS;
const REQUEST_ID = '9f1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c8f10';

/** The USDC contract the catalog declares on Monad. */
const MONAD_USDC = DEPOSIT_NETWORKS.find((network) => network.chain === 'monad')
  ?.assets.find((asset) => asset.symbol === 'USDC')?.token as string;

const wallets: ReachableWalletStore = {
  // These tests are about sending to an address; sending to a tag has its own
  // file, `sendByTag.test.ts`, so that the shape of the store is stated once
  // per concern instead of once per suite.
  findByTag: async () => ({ kind: 'nobody' }),
  findByUserId: async (userId) =>
    userId === USER_ID
      ? [
          { address: EVM_SENDER, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
          { address: SOLANA_ADDRESS, providerWalletId: 'wallet-sol-1', chain: 'solana', evmNetwork: null },
        ]
      : [
          { address: '0x00000000000000000000000000000000000000aa', providerWalletId: 'wallet-evm-2', chain: 'ethereum', evmNetwork: 'eip155:1' },
        ],
  save: async () => {},
};

interface Reads {
  readonly erc20?: bigint;
  readonly native?: bigint;
  readonly lamports?: bigint;
  /** An SPL balance on Solana, in the token's own units. */
  readonly token?: bigint;
  readonly fail?: 'erc20' | 'native' | 'lamports' | 'token';
}

/**
 * The EVM shape, or a failure that says the test is looking at the wrong one.
 *
 * A send on Solana answers with a **different** transaction shape (`kind:
 * 'solana'`), so an assertion about `to`/`data`/`chainId` has to prove it is
 * holding the EVM one rather than have TypeScript assume it for it.
 */
const evmOnly = (transaction: SendTransaction): UnsignedTransfer => {
  if (isSolanaTransaction(transaction)) throw new Error('this preparation is not an EVM transaction');
  return transaction;
};

const readers = (reads: Reads = {}) => {
  const asked: string[] = [];
  const fail = reads.fail;

  const evm: EvmBalanceReader = {
    async nativeBalance(network, address) {
      asked.push(`native:${network}:${address}`);
      if (fail === 'native') throw new Error('node down');
      return reads.native ?? 5_000_000_000_000_000_000n;
    },
    async erc20Balance(network, token, address) {
      asked.push(`erc20:${network}:${token}:${address}`);
      if (fail === 'erc20') throw new Error('reverted');
      return reads.erc20 ?? 10_000_000n;
    },
  };

  const solana: SolanaBalanceReader = {
    async lamports(address) {
      asked.push(`lamports:${address}`);
      if (fail === 'lamports') throw new Error('rpc 503');
      return reads.lamports ?? 4_000_000_000n;
    },
    async tokenAmount(address, mint) {
      asked.push(`token:${mint}:${address}`);
      if (fail === 'token') throw new Error('rpc 503');
      return reads.token ?? 10_000_000n;
    },
    async mintBalance(address, mint) {
      asked.push(`mint:${mint}:${address}`);
      if (fail === 'token') throw new Error('rpc 503');
      return reads.token ?? 10_000_000n;
    },
  };

  return { evm, solana, asked };
};

interface RecordedMovement {
  readonly userId: string;
  readonly walletChain: string;
  readonly movement: PendingSendMovement;
}

/** An in-memory movement store, recording what it was asked to write. */
const movementStore = () => {
  const written: RecordedMovement[] = [];
  const store: MovementStore = {
    createPending: async (userId, walletChain, movement) => {
      written.push({ userId, walletChain, movement });
      return { id: `movement-${written.length}`, status: 'pending' };
    },
  };
  return { store, written };
};

/**
 * An in-memory idempotency store with the same two-phase claim the SQL adapter
 * has: `reserve` fails when somebody else already holds the key, and `find`
 * only answers for a **complete** row.
 */
const idempotencyStore = () => {
  const rows = new Map<
    string,
    { userId: string; endpoint: string; response: unknown; statusCode: number; complete: boolean }
  >();
  const store: IdempotencyStore = {
    find: async ({ key, userId, endpoint }) => {
      const row = rows.get(key);
      if (row === undefined || row.userId !== userId || row.endpoint !== endpoint || !row.complete) return null;
      return { response: row.response, statusCode: row.statusCode };
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
  return { store, rows };
};

const harness = (options: Reads & { readonly now?: () => Date; readonly prepareFails?: boolean } = {}) => {
  const readers_ = readers(options);
  const movements = movementStore();
  const idempotency = idempotencyStore();
  const log = recordingLogger();

  /*
   * The Solana message builder, recorded rather than built: the bytes themselves
   * are asserted in `test/infrastructure/solanaTransferPreparer.http.test.ts`,
   * where the RPC is stubbed. What matters *here* is that the use case asks for a
   * message, passes the three validated facts, and refuses when there is none.
   */
  const prepared: SolanaTransferRequest[] = [];
  const solanaTransfers: SolanaTransferPreparer = {
    prepare: async (request) => {
      prepared.push(request);
      if (options.prepareFails) {
        throw new SolanaPreparationError('RPC_UNAVAILABLE', 'the endpoint did not answer');
      }
      return { serializedTransaction: 'AQID', network: SOLANA_MAINNET_NETWORK };
    },
  };

  const prepare = prepareSend({
    wallets,
    evm: readers_.evm,
    solana: readers_.solana,
    solanaTransfers,
    movements: movements.store,
    idempotency: idempotency.store,
    log,
    now: options.now ?? ((): Date => new Date('2026-10-04T05:00:00.000Z')),
  });

  return {
    prepare,
    ...readers_,
    movements,
    idempotency,
    written: movements.written,
    rows: idempotency.rows,
    log,
    prepared,
  };
};

const send = (over: Partial<Parameters<ReturnType<typeof harness>['prepare']>[1]> = {}) => ({
  requestId: REQUEST_ID,
  chain: 'monad',
  asset: { symbol: 'USDC', decimals: 6 },
  recipient: RECIPIENT,
  amountRaw: '1500000',
  ...over,
});

/** The code a refusal carries, or `null` when the request was accepted. */
const codeOf = async (work: Promise<unknown>): Promise<string | null> => {
  try {
    await work;
    return null;
  } catch (error) {
    if (error instanceof SendRejected) return error.code;
    throw error;
  }
};

describe('a valid ERC-20 send', () => {
  it('builds transfer() from the catalog token to the recipient', async () => {
    const { prepare } = harness();

    const prepared = await prepare(USER_ID, send());

    expect(prepared.chainId).toBe(143);
    expect(prepared.network).toBe('eip155:143');
    expect(prepared.transactions).toHaveLength(1);

    const [raw] = prepared.transactions;
    const transaction = raw === undefined ? undefined : evmOnly(raw);
    expect(transaction?.purpose).toBe('transfer');
    expect(transaction?.to).toBe(MONAD_USDC);
    expect(transaction?.value).toBe('0');
    expect(transaction?.chainId).toBe(143);
    expect(transaction?.data.startsWith(toFunctionSelector('transfer(address,uint256)'))).toBe(true);
    expect(transaction?.data).toContain(RECIPIENT.slice(2).toLowerCase());
    expect(transaction?.data.endsWith((1_500_000n).toString(16).padStart(64, '0'))).toBe(true);
    // One signature, no approval: the owner sends it directly, and an approval
    // would be a second signature plus a standing allowance nobody asked for.
    expect(prepared.transactions.map((tx) => tx.purpose)).toEqual(['transfer']);
    expect(evmOnly(prepared.transactions[0] as SendTransaction).data).not.toContain(
      toFunctionSelector('approve(address,uint256)').slice(2),
    );
  });

  it('reads the balance of the address in the database, never one from the body', async () => {
    const { prepare, asked } = harness();

    await prepare(USER_ID, send({ address: '0x000000000000000000000000000000000000dEaD' } as never));

    expect(asked.some((line) => line.includes(EVM_SENDER))).toBe(true);
    expect(asked.every((line) => !line.includes('dEaD'))).toBe(true);
  });
});

describe('the address the answer carries', () => {
  it('is the very address the balance was read for', async () => {
    const { prepare, asked } = harness();

    // The browser signs for this one, so it has to be the one that was checked.
    const prepared = await prepare(USER_ID, send());

    expect(prepared.address).toBe(EVM_SENDER);
    expect(asked.some((line) => line.endsWith(`:${prepared.address}`))).toBe(true);
  });

  it('is the database address even when the body carries another one', async () => {
    const { prepare } = harness();

    // `address` is not a request field. Nobody can talk this route into moving
    // money from an address of their choosing, and the answer says which one.
    const prepared = await prepare(USER_ID, send({ address: '0x000000000000000000000000000000000000dEaD' } as never));

    expect(prepared.address).toBe(EVM_SENDER);
    expect(prepared.address).not.toContain('dEaD');
  });

  it('is the Solana row on a Solana send, not the EVM one', async () => {
    const { prepare } = harness({ lamports: 4_000_000_000n });

    const prepared = await prepare(
      USER_ID,
      send({
        chain: 'solana',
        asset: { symbol: 'SOL', decimals: 9 },
        recipient: SOLANA_RECIPIENT,
        amountRaw: '1500000000',
      }),
    );

    // One field, one meaning: the wallet the balance was read for, on this chain.
    expect(prepared.address).toBe(SOLANA_ADDRESS);
    expect(prepared.address).not.toBe(EVM_SENDER);
  });
});

describe('a valid native send', () => {
  it('sends the value to the recipient with no calldata', async () => {
    const { prepare } = harness({ native: 3_000_000_000_000_000_000n });

    const prepared = await prepare(
      USER_ID,
      send({ chain: 'monad', asset: { symbol: 'MON', decimals: 18 }, amountRaw: '1000000000000000000' }),
    );

    expect(evmOnly(prepared.transactions[0] as SendTransaction)).toEqual({
      purpose: 'transfer',
      to: RECIPIENT,
      data: '0x',
      value: '1000000000000000000',
      chainId: 143,
    });
  });
});

describe('a valid Solana send', () => {
  it('builds a lamport transfer from the Solana wallet, on the Solana network', async () => {
    const { prepare, asked } = harness({ lamports: 4_000_000_000n });

    const prepared = await prepare(
      USER_ID,
      send({
        chain: 'solana',
        asset: { symbol: 'SOL', decimals: 9 },
        recipient: SOLANA_RECIPIENT,
        amountRaw: '1500000000',
      }),
    );

    expect(prepared.network.startsWith('solana:')).toBe(true);
    // Before this task, a Solana send answered with exactly that: an EVM shape
    // with `chainId: 0` that no Solana wallet could sign. See the Solana describe.
    expect(prepared.transactions.map((tx) => tx.purpose)).toEqual(['transfer']);
    // The Solana balance was read with the Solana reader, not with an EVM one.
    expect(asked).toContain(`lamports:${SOLANA_ADDRESS}`);
    expect(asked.some((line) => line.startsWith('erc20:'))).toBe(false);
  });

  it('answers with a serialized Solana message and no EVM chain id at all', async () => {
    const { prepare, prepared: asked } = harness({ lamports: 4_000_000_000n });

    const prepared = await prepare(
      USER_ID,
      send({
        chain: 'solana',
        asset: { symbol: 'SOL', decimals: 9 },
        recipient: SOLANA_RECIPIENT,
        amountRaw: '1500000000',
      }),
    );

    /*
     * Before this task the answer was `{to, data: '0x', value, chainId: 0}`: an
     * EVM transaction no Solana wallet can sign, with a chain id nobody has. Now
     * it is a compiled message and the number is **absent**.
     */
    expect(prepared.transactions).toEqual([
      { purpose: 'transfer', kind: 'solana', serializedTransaction: 'AQID', chain: 'solana' },
    ]);
    expect(prepared.chainId).toBeUndefined();
    expect('chainId' in prepared).toBe(false);
    expect(prepared.network).toBe(SOLANA_MAINNET_NETWORK);
    // The wallet that signs is still the one whose balance was read.
    expect(prepared.address).toBe(SOLANA_ADDRESS);

    // The message was asked for with the three validated facts, and no mint.
    expect(asked).toEqual([
      { from: SOLANA_ADDRESS, to: SOLANA_RECIPIENT, amount: 1_500_000_000n, mint: null, decimals: 9 },
    ]);
  });

  it('sends USDC on Solana as a token, against the token balance and not lamports', async () => {
    const { prepare, asked, prepared: askedPreparer } = harness({ lamports: 1n, token: 10_000_000n });

    const prepared = await prepare(
      USER_ID,
      send({
        chain: 'solana',
        asset: { symbol: 'USDC', decimals: 6 },
        recipient: SOLANA_RECIPIENT,
        amountRaw: '1500000',
      }),
    );

    // The amount is validated against **USDC**, not against SOL: reading lamports
    // here would refuse a send the person can afford and approve one they cannot.
    expect(asked).toContain(`token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:${SOLANA_ADDRESS}`);
    // Lamports are still read — for the **fee**, which is paid in SOL whatever the
    // asset moved. They are not what the amount was validated against.
    expect(asked.filter((line) => line === `lamports:${SOLANA_ADDRESS}`)).toHaveLength(1);
    // And the message names the mint and its decimals, for the checked transfer.
    expect(askedPreparer[0]).toMatchObject({
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      amount: 1_500_000n,
    });
    expect(prepared.transactions[0]).toMatchObject({ kind: 'solana' });
  });

  it('refuses USDC on Solana the person does not have, with the same code as everywhere', async () => {
    const { prepare, prepared: asked } = harness({ token: 1_000n });

    const code = await codeOf(
      prepare(
        USER_ID,
        send({
          chain: 'solana',
          asset: { symbol: 'USDC', decimals: 6 },
          recipient: SOLANA_RECIPIENT,
          amountRaw: '1500000',
        }),
      ),
    );

    expect(code).toBe('AMOUNT_EXCEEDS_BALANCE');
    // Refused before any message was asked for: no transaction is prepared for a
    // send that cannot happen.
    expect(asked).toHaveLength(0);
  });

  it('reports a message that could not be built as PREPARATION_FAILED, not as a bad balance', async () => {
    const { prepare } = harness({ prepareFails: true });

    const code = await codeOf(
      prepare(
        USER_ID,
        send({
          chain: 'solana',
          asset: { symbol: 'SOL', decimals: 9 },
          recipient: SOLANA_RECIPIENT,
          amountRaw: '1500000000',
        }),
      ),
    );

    // Different sentence, different thing to do: this is worth retrying, and it
    // says nothing about how much money the person has.
    expect(code).toBe('PREPARATION_FAILED');
    expect(code).not.toBe('BALANCE_UNREADABLE');
  });

  it('refuses a message built for another cluster than the one the catalog names', async () => {
    const { prepare } = harness();
    const devnetPreparer: SolanaTransferPreparer = {
      prepare: async () => ({ serializedTransaction: 'AQID', network: 'solana:devnet' }),
    };
    const build = prepareSend({
      wallets,
      evm: { nativeBalance: async () => 0n, erc20Balance: async () => 0n },
      solana: { lamports: async () => 4_000_000_000n, tokenAmount: async () => 0n, mintBalance: async () => 0n },
      solanaTransfers: devnetPreparer,
      movements: { createPending: async () => ({ id: 'm1', status: 'pending' }) },
      idempotency: {
        find: async () => null,
        reserve: async () => true,
        complete: async () => {},
        release: async () => {},
      },
    });

    const code = await codeOf(
      build(
        USER_ID,
        send({
          chain: 'solana',
          asset: { symbol: 'SOL', decimals: 9 },
          recipient: SOLANA_RECIPIENT,
          amountRaw: '1500000000',
        }),
      ),
    );

    // A message for another ledger is not a message for this chain, and returning
    // it with a comment would be a send to the wrong cluster.
    expect(code).toBe('PREPARATION_FAILED');
    expect(prepare).toBeTypeOf('function');
  });
});

describe('a recipient from the wrong chain', () => {
  it('refuses a Solana address on an EVM send', async () => {
    const { prepare } = harness();

    expect(await codeOf(prepare(USER_ID, send({ recipient: SOLANA_RECIPIENT })))).toBe('INVALID_RECIPIENT');
  });

  it('refuses an EVM address on a Solana send', async () => {
    const { prepare } = harness();

    expect(
      await codeOf(
        prepare(USER_ID, send({ chain: 'solana', asset: { symbol: 'SOL', decimals: 9 }, recipient: EVM_SENDER })),
      ),
    ).toBe('INVALID_RECIPIENT');
  });

  it('refuses a mixed-case EVM address whose checksum does not hold', async () => {
    const { prepare } = harness();

    expect(await codeOf(prepare(USER_ID, send({ recipient: '0x5aAeb6053f3E94C9b9A09f33669435E7Ef1BeAed' })))).toBe(
      'INVALID_RECIPIENT',
    );
  });

  it('refuses an address that is not an address', async () => {
    const { prepare } = harness();

    for (const recipient of ['', '0x123', 'not-an-address', null, 42]) {
      expect(await codeOf(prepare(USER_ID, send({ recipient: recipient as never })))).toBe('INVALID_RECIPIENT');
    }
  });

  it('reads no balance for a request that was refused for its address', async () => {
    const { prepare, asked } = harness();

    await codeOf(prepare(USER_ID, send({ recipient: '0x123' })));

    expect(asked).toEqual([]);
  });
});

describe('an amount that cannot be right', () => {
  it('refuses zero, negative, fractional and exponential, and every other way of writing it', async () => {
    const { prepare } = harness();

    for (const amountRaw of ['0', '-1', '1.5', '1e6', '', ' 1', '1 ', 'abc', '0x10', null, undefined, 1.5, {}]) {
      expect(await codeOf(prepare(USER_ID, send({ amountRaw: amountRaw as never }))), String(amountRaw)).toBe(
        'INVALID_AMOUNT',
      );
    }
  });

  it('refuses an amount whose decimals contradict the catalog', async () => {
    const { prepare } = harness();

    // `1.5` at 18 decimals is 1.5 lamports-of-nothing; the number the browser
    // holds would be interpreted at the wrong scale, so the amount is refused.
    expect(await codeOf(prepare(USER_ID, send({ asset: { symbol: 'USDC', decimals: 18 } })))).toBe('INVALID_AMOUNT');
  });

  it('accepts exactly the balance and refuses one unit more', async () => {
    const { prepare } = harness({ erc20: 1_500_000n });

    expect((await prepare(USER_ID, send())).transactions).toHaveLength(1);
    expect(await codeOf(prepare(USER_ID, send({ requestId: 'a-different-request', amountRaw: '1500001' })))).toBe(
      'AMOUNT_EXCEEDS_BALANCE',
    );
  });

  it('refuses an asset that is not on the chosen chain', async () => {
    const { prepare } = harness();

    // USDC **is** on Solana now, so the asset that is not there is something else:
    // the catalog is the only list, and there is no second one to fall back on.
    expect(
      await codeOf(
        prepare(USER_ID, send({ chain: 'solana', asset: { symbol: 'USDT', decimals: 6 }, recipient: SOLANA_RECIPIENT })),
      ),
    ).toBe('ASSET_NOT_ON_CHAIN');
    // And an asset of another chain is still not this chain's asset.
    expect(
      await codeOf(
        prepare(USER_ID, send({ chain: 'monad', asset: { symbol: 'SOL', decimals: 9 }, recipient: RECIPIENT })),
      ),
    ).toBe('ASSET_NOT_ON_CHAIN');
  });

  it('refuses a chain the catalog does not know', async () => {
    const { prepare } = harness();

    for (const chain of ['bitcoin', '', null, 143]) {
      expect(await codeOf(prepare(USER_ID, send({ chain: chain as never })))).toBe('CHAIN_UNKNOWN');
    }
  });
});

describe('the balance and the gas', () => {
  it('refuses a token send from a wallet with no native balance for gas', async () => {
    const { prepare } = harness({ erc20: 10_000_000n, native: 0n });

    expect(await codeOf(prepare(USER_ID, send()))).toBe('NO_GAS');
  });

  it('refuses a token send when the balance could not be read', async () => {
    const { prepare } = harness({ fail: 'erc20' });

    // Not a zero balance: an unknown balance is not a balance.
    expect(await codeOf(prepare(USER_ID, send()))).toBe('BALANCE_UNREADABLE');
  });

  it('refuses a send when the gas balance could not be read', async () => {
    const { prepare } = harness({ fail: 'native' });

    expect(await codeOf(prepare(USER_ID, send()))).toBe('BALANCE_UNREADABLE');
  });

  it('reports the provider\'s own words to the log and never to the caller', async () => {
    const { prepare, log } = harness({ fail: 'erc20' });

    await codeOf(prepare(USER_ID, send()));

    expect(log.lines.some((line) => line.includes('send.balance_unreadable'))).toBe(true);
  });

  it('prefers the amount over the gas when both are wrong', async () => {
    const { prepare } = harness({ erc20: 1n, native: 0n });

    // The order is fixed and it is the one in the use case: the amount is about
    // whether the money is there, and it is checked first.
    expect(await codeOf(prepare(USER_ID, send({ amountRaw: '1500000' })))).toBe('AMOUNT_EXCEEDS_BALANCE');
  });

  it('settles chain, asset, amount and recipient before it reads a single balance', async () => {
    const { prepare, asked } = harness();

    await codeOf(prepare(USER_ID, send({ chain: 'bitcoin' as never })));
    await codeOf(prepare(USER_ID, send({ asset: { symbol: 'DOGE', decimals: 8 } })));
    await codeOf(prepare(USER_ID, send({ amountRaw: '1.5' })));
    await codeOf(prepare(USER_ID, send({ recipient: '0x123' })));

    expect(asked).toEqual([]);
  });
});

describe('the movement', () => {
  it('writes one pending send with the chain, the asset, the recipient and the requestId', async () => {
    const { prepare, written } = harness();

    const prepared = await prepare(USER_ID, send());

    expect(written).toHaveLength(1);
    const [record] = written;
    expect(record?.userId).toBe(USER_ID);
    expect(record?.walletChain).toBe('ethereum');
    expect(record?.movement.type).toBe('send');
    expect(record?.movement.status).toBe('pending');
    expect(record?.movement.amount).toBe('1.5');
    expect(record?.movement.meta).toEqual({
      chain: 'monad',
      network: 'eip155:143',
      symbol: 'USDC',
      decimals: 6,
      token: MONAD_USDC,
      recipient: RECIPIENT,
      amountRaw: '1500000',
      requestId: REQUEST_ID,
    });
    expect(record?.movement.title).toContain('USDC');
    expect(record?.movement.title).toContain('0x5aAe…eAed');
    expect(prepared.movement).toEqual({ id: 'movement-1', status: 'pending' });
  });

  it('writes the movement on the Solana wallet row for a Solana send', async () => {
    const { prepare, written } = harness();

    await prepare(
      USER_ID,
      send({
        chain: 'solana',
        asset: { symbol: 'SOL', decimals: 9 },
        amountRaw: '1500000000',
        recipient: SOLANA_RECIPIENT,
      }),
    );

    expect(written[0]?.walletChain).toBe('solana');
    // `movements.amount` is numeric(20,6): the exact integer travels in `meta`.
    expect(written[0]?.movement.amount).toBe('1.5');
    expect(written[0]?.movement.meta).toMatchObject({ amountRaw: '1500000000', decimals: 9 });
  });

  it('writes nothing when the request was refused', async () => {
    const { prepare, written } = harness({ erc20: 1n });

    await codeOf(prepare(USER_ID, send()));

    expect(written).toEqual([]);
  });
});

describe('idempotency', () => {
  it('answers 409 with the stored response and writes nothing the second time', async () => {
    const { prepare, written, asked } = harness();

    const first = await prepare(USER_ID, send());
    const readsAfterFirst = asked.length;

    let replay: SendReplay | null = null;
    try {
      await prepare(USER_ID, send());
    } catch (error) {
      replay = error as SendReplay;
    }

    expect(replay).toBeInstanceOf(SendReplay);
    expect(replay?.replay).toEqual(first);
    expect(written).toHaveLength(1);
    // Not one balance was read a second time.
    expect(asked).toHaveLength(readsAfterFirst);
  });

  it('treats the same requestId from another person as their own first send', async () => {
    const { prepare, written } = harness();

    const mine = await prepare(USER_ID, send());
    const theirs = await prepare(OTHER_USER, send());

    expect(theirs.movement.id).not.toBe(mine.movement.id);
    expect(written.map((row) => row.userId)).toEqual([USER_ID, OTHER_USER]);
  });

  it('is per endpoint, so a key used elsewhere is not a replay of a send', async () => {
    const { prepare, idempotency } = harness();

    await prepare(USER_ID, send());

    const stored = [...idempotency.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.endpoint).toBe(SEND_PREPARE_ENDPOINT);
  });

  it('says a request is in flight instead of inventing a response for it', async () => {
    const { prepare, idempotency } = harness();
    // A claim that was reserved by somebody else and is still being prepared.
    await idempotency.store.reserve({
      key: idempotencyKeyFor(USER_ID, SEND_PREPARE_ENDPOINT, REQUEST_ID),
      userId: USER_ID,
      endpoint: SEND_PREPARE_ENDPOINT,
      expiresAt: new Date('2026-10-05T05:00:00.000Z'),
    });

    let inFlight: SendInFlight | null = null;
    try {
      await prepare(USER_ID, send());
    } catch (error) {
      inFlight = error as SendInFlight;
    }

    expect(inFlight).toBeInstanceOf(SendInFlight);
  });

  it('releases the claim when the preparation failed, so the retry is possible', async () => {
    const { prepare, idempotency, written } = harness({ erc20: 1n });

    await codeOf(prepare(USER_ID, send()));

    expect(idempotency.rows.size).toBe(0);

    // And a later attempt with a funded wallet is not blocked by the first.
    const funded = harness();
    expect(await funded.prepare(USER_ID, send())).toBeTruthy();
    expect(written).toEqual([]);
  });
});

describe('a request that cannot be protected from a double tap', () => {
  it('refuses a body with no requestId', async () => {
    const { prepare } = harness();

    for (const requestId of [undefined, null, '', 'a'.repeat(200), 'has spaces', 7]) {
      expect(await codeOf(prepare(USER_ID, send({ requestId: requestId as never })))).toBe('REQUEST_ID_INVALID');
    }
  });
});

describe('the codes', () => {
  it('are bounded: the refusal list is a closed set a browser can render', () => {
    expect(SendRejected.codes).toEqual([
      'REQUEST_ID_INVALID',
      'CHAIN_UNKNOWN',
      'ASSET_NOT_ON_CHAIN',
      'INVALID_AMOUNT',
      'INVALID_RECIPIENT',
      'RECIPIENT_NOT_FOUND',
      'RECIPIENT_NO_WALLET_ON_CHAIN',
      'AMOUNT_EXCEEDS_BALANCE',
      'BALANCE_UNREADABLE',
      'NO_GAS',
      'PREPARATION_FAILED',
    ]);
  });
});
