/**
 * `POST /api/send/prepare` with a destination named as a **ReWALLET identity**.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **A tag resolves, and the address does not come back.** The whole feature
 *      is one sentence of `docs/contrato-dinero.md:26` — *"ReWALLET resuelve la
 *      dirección por detrás y nadie escribe una dirección ni la ve"* — and the
 *      way a sentence like that gets broken is not by writing an obvious address
 *      into a field. It is broken by a `userId`, a truncated address in a
 *      movement title, a `recipient` echoed in a debug field. So the assertion
 *      here walks **every string in the answer** rather than checking one field.
 *   2. **A tag that belongs to nobody is a bounded refusal**, in the same
 *      vocabulary as the other refusals, before the claim is taken — and it
 *      cannot be guessed into existence, because nothing on this path creates
 *      anything.
 *   3. **"I do not know that tag" and "that person has no wallet here" are
 *      different sentences**, because they are different facts and the person can
 *      act on only one of them.
 *   4. **The address path is untouched.** Everything this file adds is on a
 *      second door; the first one answers exactly what it answered before.
 *
 * ── Why the tag is resolved in this use case and not in the route ────────────
 *
 * Because a route that resolved it would hand the address to a function that
 * takes an address, and the only thing between that address and the browser
 * would be a promise. Here the address is a local of `resolveRecipient`, it is
 * consumed by the transaction builder three steps later, and there is no code
 * path by which it could be returned even by accident.
 */
import { describe, expect, it } from 'vitest';
import { toFunctionSelector } from 'viem';

import { prepareSend, normalizeRecipientTag, SendRejected } from '../../src/application/send/prepareSend';
import type { EvmBalanceReader } from '../../src/domain/ports/evm-balance-reader';
import type { SolanaBalanceReader } from '../../src/domain/ports/solana-balance-reader';
import type { SolanaTransferPreparer } from '../../src/domain/ports/solana-transfer-preparer';
import type { ReachableWalletStore, TaggedPerson } from '../../src/domain/ports/wallet-store';
import type { WalletChain } from '../../src/domain/wallet/chains';
import type { MovementStore } from '../../src/domain/ports/movement-store';
import type { IdempotencyStore } from '../../src/domain/ports/idempotency-store';
import { isSolanaTransaction, SOLANA_MAINNET_NETWORK } from '../../src/domain/send/transfer';
import { DEPOSIT_NETWORKS } from '../../src/domain/deposit/catalog';
import { USER_ID } from '../support/fixtures';

const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '9f1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c8f10';

/** The sender: the person asking for the money, and the wallet that signs. */
const SENDER = '0x1234567890abcdef1234567890abcdef12345678';

/**
 * The payee, whose address this whole file exists to keep out of the answer.
 *
 * A valid EIP-55 mixed-case address, so it passes `recipientForChain` exactly
 * like one typed by hand would. If a test here ever passes because the address
 * was *invalid*, it would be proving nothing.
 */
const PAYEE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SOLANA_PAYEE = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

/** The handle the live account is filed under. */
const TAG = 'cortezjoaquin205.2d14';

const MONAD_USDC = DEPOSIT_NETWORKS.find((network) => network.chain === 'monad')
  ?.assets.find((asset) => asset.symbol === 'USDC')?.token as string;

/** Who a handle belongs to, and what they can be paid on. */
interface Directory {
  readonly [tag: string]: Partial<Record<WalletChain, string>>;
}

const harness = (directory: Directory = { [TAG]: { ethereum: PAYEE } }) => {
  const reads: string[] = [];
  const movements: string[] = [];
  const releases: string[] = [];

  /** Every lookup the send made, so a test can assert the tag was asked about. */
  const asked: { readonly tag: string; readonly chain: WalletChain }[] = [];

  const wallets: ReachableWalletStore = {
    findByTag: async (tag, chain): Promise<TaggedPerson> => {
      asked.push({ tag, chain });
      // Exact match on a normalized handle, and `undefined` for a miss: this is
      // the same thing a `citext` comparison on a `UNIQUE` column does, and no
      // more forgiving than it.
      const entry = directory[tag];
      if (entry === undefined) return { kind: 'nobody' };
      const address = entry[chain];
      return address === undefined
        ? { kind: 'person', tag, wallet: null }
        : {
            kind: 'person',
            tag,
            wallet: {
              address,
              providerWalletId: `wallet-${tag}-${chain}`,
              chain,
              evmNetwork: chain === 'ethereum' ? 'eip155:1' : null,
            },
          };
    },
    findByUserId: async (userId) =>
      userId === USER_ID
        ? [
            { address: SENDER, providerWalletId: 'wallet-evm-1', chain: 'ethereum', evmNetwork: 'eip155:1' },
            {
              address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
              providerWalletId: 'wallet-sol-1',
              chain: 'solana',
              evmNetwork: null,
            },
          ]
        : [],
    save: async () => {},
  };

  const evm: EvmBalanceReader = {
    nativeBalance: async () => 5_000_000_000_000_000_000n,
    erc20Balance: async () => 10_000_000n,
  };
  const solana: SolanaBalanceReader = {
    lamports: async () => 4_000_000_000n,
    tokenAmount: async () => 10_000_000n,
    mintBalance: async () => 10_000_000n,
  };
  const solanaTransfers: SolanaTransferPreparer = {
    prepare: async () => {
      reads.push('solana:prepared');
      return { serializedTransaction: 'AQID', network: SOLANA_MAINNET_NETWORK };
    },
  };

  const movementStore: MovementStore = {
    createPending: async (_userId, _walletChain, movement) => {
      movements.push(movement.title);
      return { id: `movement-${movements.length}`, status: 'pending' };
    },
  };

  const rows = new Map<string, { response: unknown; complete: boolean }>();
  const idempotency: IdempotencyStore = {
    find: async ({ key }) => {
      const row = rows.get(key);
      return row === undefined || !row.complete ? null : { response: row.response, statusCode: 200 };
    },
    reserve: async ({ key }) => {
      if (rows.has(key)) return false;
      rows.set(key, { response: {}, complete: false });
      return true;
    },
    complete: async ({ key, response }) => {
      const row = rows.get(key);
      if (row !== undefined) rows.set(key, { response, complete: true });
    },
    release: async ({ key }) => {
      releases.push(key);
      rows.delete(key);
    },
  };

  const prepare = prepareSend({
    wallets,
    evm,
    solana,
    solanaTransfers,
    movements: movementStore,
    idempotency,
  });

  return { prepare, asked, movements, releases, rows };
};

const byTag = (tag: unknown, over: Record<string, unknown> = {}) => ({
  requestId: REQUEST_ID,
  chain: 'monad',
  asset: { symbol: 'USDC', decimals: 6 },
  recipientTag: tag,
  amountRaw: '1500000',
  ...over,
});

const codeOf = async (work: Promise<unknown>): Promise<string | null> => {
  try {
    await work;
    return null;
  } catch (error) {
    if (error instanceof SendRejected) return error.code;
    throw error;
  }
};

/**
 * Every string anywhere in the answer, keys included.
 *
 * The prohibition is not "there is no field called `recipientAddress`" — it is
 * *"nadie ve la dirección"*. So the assertion walks the whole structure and
 * compares against the address itself, rather than trusting a field list that a
 * later edit could quietly grow a hole in.
 */
const stringsIn = (value: unknown, into: string[] = []): string[] => {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringsIn(entry, into));
  else if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, entry]) => {
      into.push(key);
      stringsIn(entry, into);
    });
  }
  return into;
};

describe('sending to a ReWALLET identity', () => {
  it('prepares the transfer when the tag resolves to a wallet on this chain', async () => {
    const { prepare, asked } = harness();

    const prepared = await prepare(USER_ID, byTag(`@${TAG}`));

    expect(prepared.chainId).toBe(143);
    expect(prepared.transactions).toHaveLength(1);

    const [raw] = prepared.transactions;
    expect(raw).toBeDefined();
    if (raw === undefined || isSolanaTransaction(raw)) throw new Error('expected an EVM transaction');
    expect(raw.to).toBe(MONAD_USDC);
    expect(raw.data.startsWith(toFunctionSelector('transfer(address,uint256)'))).toBe(true);
    // The address really is in the transaction: this is not a preparation that
    // quietly went nowhere.
    expect(raw.data).toContain(PAYEE.slice(2).toLowerCase());
    expect(raw.data.endsWith((1_500_000n).toString(16).padStart(64, '0'))).toBe(true);

    // The `@` and the casing are the caller's; the lookup is normalized once.
    expect(asked).toEqual([{ tag: TAG, chain: 'ethereum' }]);
    expect(prepared.recipientIdentity).toEqual({ tag: TAG });
  });

  it('resolves on the chain the send is on, not on a chain the handle names', async () => {
    // `monad` and `ethereum` are the same EVM row for a person, so a send of
    // Monad reaches `ethereum`; a send of Solana reaches `solana`.
    const { prepare, asked } = harness({
      [TAG]: { ethereum: PAYEE, solana: SOLANA_PAYEE },
    });

    await prepare(USER_ID, byTag(TAG));
    await prepare(
      USER_ID,
      byTag(TAG, {
        requestId: '7b1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c8f11',
        chain: 'solana',
        asset: { symbol: 'USDC', decimals: 6 },
      }),
    );

    expect(asked).toEqual([
      { tag: TAG, chain: 'ethereum' },
      { tag: TAG, chain: 'solana' },
    ]);
  });

  it('does not put the resolved address anywhere in the answer', async () => {
    const { prepare } = harness();

    const prepared = await prepare(USER_ID, byTag(TAG));
    const bare = PAYEE.slice(2);

    /*
     * Structurally, not by reading a comment: every string in the answer — field
     * names and values alike — is compared against the address that was
     * resolved, both as written and in the two casings it could be abbreviated
     * to.
     */
    const found = stringsIn(prepared).filter((text) => {
      return (
        text.includes(PAYEE) ||
        text.toLowerCase().includes(PAYEE.toLowerCase()) ||
        text.includes(`${PAYEE.slice(0, 6)}…${PAYEE.slice(-4)}`) ||
        text.includes(bare.slice(0, 6)) ||
        text.includes(bare.slice(-4))
      );
    });
    expect(found).toEqual([]);

    // And the one address that IS in there is the sender's own, to sign for.
    expect(prepared.address).toBe(SENDER);

    // The transaction's calldata carries it as hex, which is a hash of the
    // address and not the string — asserted so the walk above cannot pass by
    // the address having never reached the transaction at all.
    const [raw] = prepared.transactions;
    if (raw === undefined || isSolanaTransaction(raw)) throw new Error('expected an EVM transaction');
    expect(raw.data.toLowerCase()).toContain(bare.toLowerCase());
  });

  it('names the person, not the handle it was typed as, in the answer', async () => {
    const { prepare } = harness();

    const prepared = await prepare(USER_ID, byTag(`@${TAG.toUpperCase()}   `));

    // The canonical handle from the row: something a person can read out loud and
    // check against whoever is asking for the money.
    expect(prepared.recipientIdentity).toEqual({ tag: TAG });
  });

  it('files the pending movement against the handle, with no address fragment', async () => {
    const { prepare, movements } = harness();

    await prepare(USER_ID, byTag(TAG));

    expect(movements).toHaveLength(1);
    expect(movements[0]).toContain(`@${TAG}`);
    expect(movements[0]).not.toContain(PAYEE.slice(-4));
    expect(movements[0]).not.toContain(PAYEE.slice(2, 8));
  });
});

describe('a tag that cannot be paid', () => {
  it('refuses an unknown tag with a bounded code and writes nothing', async () => {
    const { prepare, movements, asked } = harness();

    const code = await codeOf(prepare(USER_ID, byTag('nadie.tiene.este')));

    expect(code).toBe('RECIPIENT_NOT_FOUND');
    expect(asked).toEqual([{ tag: 'nadie.tiene.este', chain: 'ethereum' }]);
    expect(movements).toEqual([]);
  });

  it('refuses with the same code a handle that is not a handle at all', async () => {
    const { prepare } = harness();

    // A malformed handle and an absent one answer identically: telling them
    // apart would hand out an oracle for measuring which handles exist.
    const cases = ['ab', 'no spaces here', '@'.repeat(4), '', '   ', 42, { tag: TAG }];

    for (const [index, value] of cases.entries()) {
      const code = await codeOf(
        prepare(USER_ID, byTag(value, { requestId: `3b1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c${index}` })),
      );
      expect(code).toBe('RECIPIENT_NOT_FOUND');
    }
  });

  it('never turns a tag that belongs to nobody into somebody who can be paid', async () => {
    const { prepare, movements, releases, rows } = harness();

    /*
     * The enumeration question: does a handle nobody owns create a slot that a
     * later send can fill? Nothing on this path writes — the store is read-only
     * here, the claim is released, and no movement is created — so the same
     * nonsense handle answered twice behaves exactly like the first time.
     */
    await codeOf(prepare(USER_ID, byTag('nadie.tiene.este')));
    const second = await codeOf(
      prepare(USER_ID, byTag('nadie.tiene.este', { requestId: '5c1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c8f22' })),
    );

    expect(second).toBe('RECIPIENT_NOT_FOUND');
    expect(movements).toEqual([]);
    /*
     * Stronger than "nothing was created": **the claim was never taken**. Tag
     * resolution runs before `reserve`, so a handle nobody owns does not even
     * burn the `requestId` — the same protection a bad address has always had,
     * and the reason a refusal here leaves the retry possible.
     */
    expect(rows.size).toBe(0);
    expect(releases).toEqual([]);
  });

  it('refuses when the person has no wallet on the chain in play, and says which chain', async () => {
    // Solved for EVM only: this person has an Ethereum wallet and no Solana one.
    const { prepare, movements } = harness({ [TAG]: { ethereum: PAYEE } });

    let detail = '';
    try {
      await prepare(
        USER_ID,
        byTag(TAG, {
          requestId: '2a1c0d5a-6b2e-4f3a-9c1d-2b7e5a4c8f33',
          chain: 'solana',
          asset: { symbol: 'USDC', decimals: 6 },
        }),
      );
    } catch (error) {
      if (!(error instanceof SendRejected)) throw error;
      expect(error.code).toBe('RECIPIENT_NO_WALLET_ON_CHAIN');
      detail = error.message;
    }

    /*
     * The detail is for the operator's log and names both chains: the one the
     * send is on and the kind of wallet that is missing. The browser only ever
     * receives the bounded code.
     */
    expect(detail).toContain('solana');
    expect(detail).toContain(TAG);
    expect(movements).toEqual([]);
  });

  it('refuses a destination named twice, as an address and as a tag', async () => {
    const { prepare, asked } = harness();

    const code = await codeOf(prepare(USER_ID, byTag(TAG, { recipient: PAYEE })));

    expect(code).toBe('INVALID_RECIPIENT');
    // It never chose one of them: a request with two destinations has not said
    // where the money goes, and this is not the place to guess.
    expect(asked).toEqual([]);
  });

  it('refuses a stored address that is not valid on the chain in play', async () => {
    // Bad data in our own row, not in the person's request: the same code as a
    // bad address in the body, because it is the same fact.
    const { prepare } = harness({ [TAG]: { ethereum: 'no-es-una-direccion' } });

    const code = await codeOf(prepare(USER_ID, byTag(TAG)));

    expect(code).toBe('INVALID_RECIPIENT');
  });
});

describe('the address path, which this feature must not change', () => {
  it('still answers exactly what it answered before for a pasted address', async () => {
    const { prepare, asked, movements } = harness();

    const prepared = await prepare(USER_ID, {
      requestId: REQUEST_ID,
      chain: 'monad',
      asset: { symbol: 'USDC', decimals: 6 },
      recipient: PAYEE,
      amountRaw: '1500000',
    });

    // Same fields, same values, same shapes as before this feature existed.
    expect(prepared).toEqual({
      requestId: REQUEST_ID,
      chain: 'monad',
      address: SENDER,
      chainId: 143,
      network: 'eip155:143',
      transactions: [
        {
          purpose: 'transfer',
          to: MONAD_USDC,
          data: prepared.transactions[0] === undefined ? '' : evmData(prepared.transactions[0]),
          value: '0',
          chainId: 143,
        },
      ],
      movement: { id: 'movement-1', status: 'pending' },
    });
    // No identity block: nobody named a tag, so there is nothing to name.
    expect('recipientIdentity' in prepared).toBe(false);
    // And the reachability read was never consulted.
    expect(asked).toEqual([]);
    // The movement is filed the way it always was: an abbreviated address.
    expect(movements[0]).toBe('Send 1.5 USDC to 0x5aAe…eAed');
  });
});

/** The EVM transaction's `data`, with a message that is not one. */
function evmData(transaction: unknown): string {
  const candidate = transaction as { readonly data?: unknown };
  if (typeof candidate.data !== 'string') throw new Error('this preparation is not an EVM transaction');
  return candidate.data;
}

describe('normalizeRecipientTag', () => {
  it('accepts a handle with or without the @, in any casing, and refuses the rest', () => {
    expect(normalizeRecipientTag('@cortezjoaquin205.2d14')).toBe(TAG);
    expect(normalizeRecipientTag('  CORTEZJOAQUIN205.2D14 ')).toBe(TAG);
    expect(normalizeRecipientTag('ab')).toBeNull();
    expect(normalizeRecipientTag('@@cortezjoaquin205.2d14')).toBeNull();
    expect(normalizeRecipientTag('con espacio')).toBeNull();
    expect(normalizeRecipientTag(7)).toBeNull();
  });
});