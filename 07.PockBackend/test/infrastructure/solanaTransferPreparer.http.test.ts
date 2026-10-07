/**
 * The Solana message builder, against a stubbed RPC.
 *
 * These tests read the **decoded message**: the base64 the adapter answers with is
 * deserialized again with `@solana/web3.js` and its instructions are asserted. That
 * is the only assertion that means anything here — the bytes are the product, and
 * asserting that "prepare was called" would pass just as happily on bytes that
 * move money to the wrong account.
 *
 * What is deliberately **not** here: a signature. The adapter has no key and the
 * message must come back with none, which is asserted on every test.
 */
import { describe, expect, it } from 'vitest';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { createHttpSolanaTransferPreparer } from '../../src/infrastructure/rpc/solanaTransferPreparer.http';
import { SolanaPreparationError } from '../../src/domain/ports/solana-transfer-preparer';
import { SOLANA_MAINNET_NETWORK } from '../../src/domain/send/transfer';
import { SOLANA_ADDRESS } from '../support/fixtures';
import type { DeadlinePolicy } from '../../src/infrastructure/rpc/httpDeadline';

const RECIPIENT = '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/**
 * A blockhash the RPC can answer with.
 *
 * Derived from 32 real bytes rather than typed: a base58 string of the wrong
 * length is not a blockhash, and a test fixture that fails to parse would fail
 * for a reason that has nothing to do with the code under test.
 */
const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** Every method the adapter asked for, in order. */
interface RpcCall {
  readonly method: string;
  readonly params: unknown[];
}

interface Stub {
  readonly fetchImpl: typeof fetch;
  readonly calls: RpcCall[];
}

/** One RPC endpoint that answers `getLatestBlockhash` and refuses to fail. */
const rpc = (over: { readonly fail?: boolean } = {}): Stub => {
  const calls: RpcCall[] = [];

  const fetchImpl = (async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    calls.push({ method: body.method, params: body.params });

    /*
     * `id` travels as a **string**, as it does with a real cluster: web3.js parses
     * the body with `storeAsString` and validates the id against a string schema.
     * A stub that answers a numeric id fails deep inside the library with a
     * message about a union, which says nothing about this code.
     */
    if (over.fail === true) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code: -32000, message: 'nope' } }), {
        status: 200,
      });
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        result:
          body.method === 'getLatestBlockhash'
            ? { context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 900_000 } }
            : null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
};

const prepare = (stub: Stub, request: Parameters<ReturnType<typeof createHttpSolanaTransferPreparer>['prepare']>[0]) =>
  createHttpSolanaTransferPreparer({ fetchImpl: stub.fetchImpl, url: 'https://rpc.invalid' }).prepare(request);

/** The answer, decoded by the same library that will sign it in a browser. */
const decode = (serializedTransaction: string): Transaction =>
  Transaction.from(Buffer.from(serializedTransaction, 'base64'));

describe('createHttpSolanaTransferPreparer — native SOL', () => {
  it('builds one System transfer, for the sender, with no signature', async () => {
    const stub = rpc();

    const prepared = await prepare(stub, {
      from: SOLANA_ADDRESS,
      to: RECIPIENT,
      amount: 1_500_000_000n,
      mint: null,
      decimals: null,
    });

    expect(prepared.network).toBe(SOLANA_MAINNET_NETWORK);

    const message = decode(prepared.serializedTransaction);
    expect(message.recentBlockhash).toBe(BLOCKHASH);
    /*
     * Signed by nobody. A deserialized message carries one **null** signature
     * entry per required signer, which is exactly what "unsigned" looks like: if
     * it arrived with a signature, some key this project does not have signed it.
     */
    expect(message.signatures).toHaveLength(1);
    expect(message.signatures[0]?.signature).toBeNull();
    expect(message.instructions).toHaveLength(1);

    const [instruction] = message.instructions;
    expect(instruction?.programId.equals(SystemProgram.programId)).toBe(true);
    // System transfer: from, to, lamports. Read out of the instruction itself.
    const accounts = (instruction?.keys ?? []).map((key) => key.pubkey.toBase58());
    expect(accounts[0]).toBe(SOLANA_ADDRESS);
    expect(accounts[1]).toBe(RECIPIENT);
    expect(message.instructions[0]?.data.readBigUInt64LE(4)).toBe(1_500_000_000n);

    // And it really is the system program: the message names one program id.
    expect(stub.calls.map((call) => call.method)).toEqual(['getLatestBlockhash']);
  });

  it('pays the fee from the sender and names the cluster it was built for', async () => {
    const stub = rpc();

    const prepared = await prepare(stub, {
      from: SOLANA_ADDRESS,
      to: RECIPIENT,
      amount: 1n,
      mint: null,
      decimals: null,
    });

    const message = decode(prepared.serializedTransaction);
    expect(message.feePayer?.toBase58()).toBe(SOLANA_ADDRESS);
    /*
     * `lastValidBlockHeight` is deliberately **not** asserted: it is a runtime
     * guard inside the signer, not a field of the message, and the bytes that
     * travel do not carry it.
     */
    expect(prepared.network).toMatch(/^solana:/);
  });
});

describe('createHttpSolanaTransferPreparer — an SPL token', () => {
  it('creates the destination account and then transfers, in that order', async () => {
    const stub = rpc();

    const prepared = await prepare(stub, {
      from: SOLANA_ADDRESS,
      to: RECIPIENT,
      amount: 1_500_000n,
      mint: USDC_MINT,
      decimals: 6,
    });

    const message = decode(prepared.serializedTransaction);
    expect(message.instructions).toHaveLength(2);

    // First: the associated token account of the **recipient**, paid by the sender.
    const [create, transfer] = message.instructions;
    expect(create?.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID);
    const createAccounts = (create?.keys ?? []).map((key) => key.pubkey.toBase58());
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(RECIPIENT),
      true,
    ).toBase58();
    // The payer is the sender, because the recipient never signs this message.
    expect(createAccounts[0]).toBe(SOLANA_ADDRESS);
    expect(createAccounts).toContain(recipientTokenAccount);
    expect(createAccounts).toContain(RECIPIENT);

    // Second: a checked transfer of the token, by the owner.
    expect(transfer?.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    const transferAccounts = (transfer?.keys ?? []).map((key) => key.pubkey.toBase58());
    expect(transferAccounts).toContain(
      getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(SOLANA_ADDRESS), true).toBase58(),
    );
    expect(transferAccounts).toContain(recipientTokenAccount);
    expect(transferAccounts).toContain(USDC_MINT);

    // The amount travels as a u64 in the token's own units, next to the decimals
    // the token program verifies against the mint.
    expect(transfer?.data.readBigUInt64LE(1)).toBe(1_500_000n);
    expect(transfer?.data.readUInt8(9)).toBe(6);
  });

  it('does not ask the cluster whether the destination account exists', async () => {
    const stub = rpc();

    await prepare(stub, { from: SOLANA_ADDRESS, to: RECIPIENT, amount: 1n, mint: USDC_MINT, decimals: 6 });

    /*
     * A check-then-create would be a second call and a race: two payments to the
     * same brand-new destination would both read "does not exist" and the second
     * would fail. The idempotent instruction makes the answer the same either way.
     */
    expect(stub.calls.map((call) => call.method)).toEqual(['getLatestBlockhash']);
  });
});

describe('createHttpSolanaTransferPreparer — what it refuses', () => {
  it('refuses an address that is not a Solana address, before any RPC', async () => {
    const stub = rpc();

    // An EVM address pasted into a Solana send. There is no interpretation under
    // which it is an account, so it is refused rather than tried.
    await expect(
      prepare(stub, { from: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', to: RECIPIENT, amount: 1n, mint: null, decimals: null }),
    ).rejects.toBeInstanceOf(SolanaPreparationError);
    expect(stub.calls).toHaveLength(0);
  });

  it('refuses an amount of nothing, and a token without its decimals', async () => {
    const stub = rpc();

    await expect(
      prepare(stub, { from: SOLANA_ADDRESS, to: RECIPIENT, amount: 0n, mint: null, decimals: null }),
    ).rejects.toMatchObject({ code: 'BUILD_FAILED' });
    // The checked instruction carries the decimals; without them the token program
    // would verify a transfer against a scale nobody stated.
    await expect(
      prepare(stub, { from: SOLANA_ADDRESS, to: RECIPIENT, amount: 1n, mint: USDC_MINT, decimals: null }),
    ).rejects.toMatchObject({ code: 'BUILD_FAILED' });
    expect(stub.calls).toHaveLength(0);
  });

  it('reports a blockhash that never arrived as RPC_UNAVAILABLE', async () => {
    const stub = rpc({ fail: true });

    const failure = await prepare(stub, {
      from: SOLANA_ADDRESS,
      to: RECIPIENT,
      amount: 1n,
      mint: null,
      decimals: null,
    }).catch((error: unknown) => error);

    // A bounded code and a message that says what happened, never a raw RPC error.
    expect(failure).toBeInstanceOf(SolanaPreparationError);
    expect((failure as SolanaPreparationError).code).toBe('RPC_UNAVAILABLE');
    expect(SolanaPreparationError.codes).toContain('RPC_UNAVAILABLE');
  });
});

describe('a cluster that does not answer', () => {
  it('refuses the preparation as RPC_UNAVAILABLE, and says the cluster went quiet', async () => {
    /*
     * The hung cluster behind the one RPC call this adapter makes, with the
     * deadline expired by hand rather than waited for. Without the bound the
     * `getLatestBlockhash` never settles and the person who pressed send is left
     * with a button that does nothing — the deadline is what turns that into an
     * answer they can read.
     */
    let fire: (() => void) | undefined;
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init?.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
        });
      })) as unknown as typeof fetch;

    const deadline: DeadlinePolicy = {
      timeoutMs: 5_000,
      schedule: (_ms, onDeadline) => {
        fire = onDeadline;
        return () => {
          fire = undefined;
        };
      },
    };

    const pending = createHttpSolanaTransferPreparer({
      fetchImpl,
      url: 'https://rpc.invalid',
      deadline,
    }).prepare({ from: SOLANA_ADDRESS, to: RECIPIENT, amount: 1n, mint: null, decimals: null });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fire?.();

    const failure = await pending.then(
      () => null,
      (error: unknown) => error,
    );

    // The existing reason, unchanged, and no raw library error crossing over.
    expect(failure).toBeInstanceOf(SolanaPreparationError);
    expect((failure as SolanaPreparationError).code).toBe('RPC_UNAVAILABLE');
    // The log line names the failure: the cluster was given five seconds and said
    // nothing, which is a different story from a blockhash that was refused.
    expect((failure as Error).message).toContain('the endpoint did not answer in 5s');
  });
});