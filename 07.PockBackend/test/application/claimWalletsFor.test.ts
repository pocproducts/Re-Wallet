/**
 * THE ORDER OF THE WALLETS, ON THE WRITE SIDE.
 *
 * The EVM wallet is stored before the Solana one. That is not a detail of the
 * adapter, it is a product rule, and it lives in `WALLET_CHAIN_ORDER`. These tests
 * assert it by name so a refactor cannot quietly reverse it — the same guarantee
 * the deleted `provisionWalletsFor` had, kept where the write now happens.
 *
 * The second thing these tests hold is the **trust boundary**: a claim is only
 * ever written after the provider's own record for that person confirms it.
 */
import { describe, expect, it } from 'vitest';

import {
  claimWalletsFor,
  OwnershipUnavailable,
  WalletClaimRejected,
  type ClaimedWallet,
} from '../../src/application/wallet-claim/claimWalletsFor';
import type { DirectoryUser, UserDirectory } from '../../src/domain/ports/user-directory';
import type { OwnedWallet, WalletOwnershipVerifier } from '../../src/domain/ports/wallet-ownership-verifier';
import type { NewUserProfile } from '../../src/domain/ports/user-store';
import type { KnownWallet, WalletStore } from '../../src/domain/ports/wallet-store';
import { FIRST_CHAIN, SECOND_CHAIN, WALLET_CHAIN_ORDER } from '../../src/domain/wallet/chains';
import {
  DEFAULT_EVM_NETWORK,
  ETHEREUM_MAINNET_NETWORK_ID,
} from '../../src/domain/wallet/evmNetwork';
import { DID, EVM_ADDRESS, recordingLogger, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';
import { inMemoryUserStore, seedUser } from '../support/userStore';

const EVM_WALLET_ID = 'wallet-ethereum-1';
const SOLANA_WALLET_ID = 'wallet-solana-1';

/** The two wallets Privy reports for the person. The proof the claim is checked against. */
const ownedByPrivy = (overrides: Partial<OwnedWallet>[] = []): OwnedWallet[] => [
  { providerWalletId: EVM_WALLET_ID, address: EVM_ADDRESS, chain: 'ethereum', ...(overrides[0] ?? {}) },
  { providerWalletId: SOLANA_WALLET_ID, address: SOLANA_ADDRESS, chain: 'solana', ...(overrides[1] ?? {}) },
];

/** A valid two-wallet claim. Reordered, mis-stated or trimmed per test. */
const claim = (overrides: Partial<ClaimedWallet>[] = []): ClaimedWallet[] => [
  { chain: 'ethereum', walletId: EVM_WALLET_ID, address: EVM_ADDRESS, ...(overrides[0] ?? {}) },
  { chain: 'solana', walletId: SOLANA_WALLET_ID, address: SOLANA_ADDRESS, ...(overrides[1] ?? {}) },
];

/** The store backed by an array. It is the whole database, for these tests. */
const createStore = () => {
  const rows: KnownWallet[] = [];
  const writes: KnownWallet[] = [];
  const store: WalletStore = {
    findByUserId: async () => [...rows],
    save: async (_userId, wallet) => {
      rows.push(wallet);
      writes.push(wallet);
    },
  };
  return { store, rows, writes };
};

const createOwnership = (owned: readonly OwnedWallet[] = ownedByPrivy()) => {
  const asked: string[] = [];
  const ownership: WalletOwnershipVerifier = {
    ownedBy: async (privyDid) => {
      asked.push(privyDid);
      return owned;
    },
  };
  return { ownership, asked };
};

const createDirectory = (): UserDirectory & { readonly asked: string[] } => {
  const asked: string[] = [];
  const user: DirectoryUser = { privyDid: DID, email: 'ana@example.com', displayName: null };
  return {
    asked,
    lookup: async (privyDid) => {
      asked.push(privyDid);
      return user;
    },
  };
};

const createUsers = () => {
  // The same account the session already wrote, so this use case resolves the row
  // the wallets are keyed on instead of creating one of its own.
  const store = inMemoryUserStore([seedUser({ id: USER_ID, privyDid: DID, email: 'ana@example.com' })]);
  return { users: store.users, profiles: store.profiles, rows: store.rows };
};

/** Everything wired, so a test only states the part it is actually about. */
const harness = (options: { owned?: readonly OwnedWallet[]; ownership?: WalletOwnershipVerifier } = {}) => {
  const { store, rows, writes } = createStore();
  const { ownership, asked } = options.ownership
    ? { ownership: options.ownership, asked: [] as string[] }
    : createOwnership(options.owned);

  return {
    rows,
    writes,
    asked,
    claim: claimWalletsFor({ directory: createDirectory(), users: createUsers().users, ownership, store }),
  };
};

describe('WALLET_CHAIN_ORDER', () => {
  it('is ethereum then solana', () => {
    expect([...WALLET_CHAIN_ORDER]).toEqual(['ethereum', 'solana']);
    expect(FIRST_CHAIN).toBe('ethereum');
    expect(SECOND_CHAIN).toBe('solana');
  });
});

describe('claimWalletsFor', () => {
  // ── The trust boundary ───────────────────────────────────────────────────────

  it('REJECTS a wallet the person does not own and writes NOTHING', async () => {
    // Privy reports only the EVM wallet. The browser also claims a Solana one.
    const { claim: run, rows, writes } = harness({ owned: ownedByPrivy([{}, {}]).slice(0, 1) });

    await expect(run({ privyDid: DID, claimed: claim() })).rejects.toBeInstanceOf(WalletClaimRejected);

    // Not even the wallet that IS proven: a partial write is worse than none.
    expect(rows).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('rejects a claim carrying somebody else\'s wallet id', async () => {
    const { claim: run, writes } = harness();

    await expect(
      run({
        privyDid: DID,
        claimed: claim([{}, { walletId: 'wallet-belonging-to-someone-else' }]),
      }),
    ).rejects.toBeInstanceOf(WalletClaimRejected);

    expect(writes).toEqual([]);
  });

  it('rejects a claim whose address is not the one Privy reports', async () => {
    const { claim: run, writes } = harness();

    await expect(
      run({
        privyDid: DID,
        // Right id, somebody else's address.
        claimed: claim([{ address: '0x0000000000000000000000000000000000000001' }, {}]),
      }),
    ).rejects.toBeInstanceOf(WalletClaimRejected);

    expect(writes).toEqual([]);
  });

  it('rejects a chain swap: an ethereum wallet claimed as solana', async () => {
    const { claim: run, writes } = harness();

    await expect(
      run({
        privyDid: DID,
        claimed: [{ chain: 'solana', walletId: EVM_WALLET_ID, address: EVM_ADDRESS }],
      }),
    ).rejects.toBeInstanceOf(WalletClaimRejected);

    expect(writes).toEqual([]);
  });

  it('accepts an EVM address that differs only in hex case', async () => {
    const { claim: run, writes } = harness();

    // The same address, checksummed differently. Storing the browser's spelling
    // would still be right, but requiring bit-identical text would reject a
    // legitimate login for nothing.
    await run({ privyDid: DID, claimed: claim([{ address: EVM_ADDRESS.toLowerCase() }, {}]) });

    // What is stored is always Privy's own spelling.
    expect(writes.map((wallet) => wallet.address)).toEqual([EVM_ADDRESS, SOLANA_ADDRESS]);
  });

  it('rejects an unknown chain and two wallets for one chain', async () => {
    const { claim: run, writes } = harness();

    await expect(
      run({ privyDid: DID, claimed: [{ chain: 'bitcoin', walletId: 'x', address: 'bc1q' }] }),
    ).rejects.toBeInstanceOf(WalletClaimRejected);

    await expect(
      run({
        privyDid: DID,
        claimed: [
          { chain: 'ethereum', walletId: EVM_WALLET_ID, address: EVM_ADDRESS },
          { chain: 'ethereum', walletId: 'wallet-other', address: EVM_ADDRESS },
        ],
      }),
    ).rejects.toBeInstanceOf(WalletClaimRejected);

    expect(writes).toEqual([]);
  });

  it('does not turn "could not check" into "not yours"', async () => {
    const outage: WalletOwnershipVerifier = {
      ownedBy: async () => {
        throw new Error('provider unreachable');
      },
    };
    const { claim: run, writes } = harness({ ownership: outage });

    // A refusal would lock a legitimate person out of their own wallet.
    await expect(run({ privyDid: DID, claimed: claim() })).rejects.toBeInstanceOf(OwnershipUnavailable);
    expect(writes).toEqual([]);
  });

  it('checks ownership against the DID the token proved', async () => {
    const { claim: run, asked } = harness();

    await run({ privyDid: DID, claimed: claim() });

    expect(asked).toEqual([DID]);
  });

  // ── The write ───────────────────────────────────────────────────────────────

  it('persists a valid claim in ethereum-then-solana order', async () => {
    const log = recordingLogger();
    const { store, writes } = createStore();
    const { ownership } = createOwnership();
    const run = claimWalletsFor({
      directory: createDirectory(),
      users: createUsers().users,
      ownership,
      store,
      log,
    });

    const result = await run({ privyDid: DID, claimed: claim() });

    expect(writes.map((wallet) => wallet.chain)).toEqual(['ethereum', 'solana']);
    expect(writes).toEqual([
      {
        chain: 'ethereum',
        address: EVM_ADDRESS,
        providerWalletId: EVM_WALLET_ID,
        evmNetwork: ETHEREUM_MAINNET_NETWORK_ID,
      },
      { chain: 'solana', address: SOLANA_ADDRESS, providerWalletId: SOLANA_WALLET_ID, evmNetwork: null },
    ]);
    expect(result.written).toBe(2);
    expect(result.wallets.map((wallet) => wallet.chain)).toEqual(['ethereum', 'solana']);

    // And the log says VERIFIED. A reader must never be able to mistake this path
    // for the old one that minted wallets the app owned.
    expect(log.lines).toContain('wallets.verified');
    expect(log.lines.some((line) => line.includes('provision'))).toBe(false);
  });

  it('stores what Privy reports, in chain order, whatever order the claim arrived in', async () => {
    const { store, writes } = createStore();
    const { ownership } = createOwnership();
    const run = claimWalletsFor({ directory: createDirectory(), users: createUsers().users, ownership, store });

    await run({ privyDid: DID, claimed: [claim()[1] as ClaimedWallet, claim()[0] as ClaimedWallet] });

    // The browser's ordering does not decide the product's ordering.
    expect(writes.map((wallet) => wallet.chain)).toEqual(['ethereum', 'solana']);
  });

  it('persists nothing new when the same wallets are claimed twice', async () => {
    const { store, rows, writes } = createStore();
    const { ownership } = createOwnership();
    const run = claimWalletsFor({ directory: createDirectory(), users: createUsers().users, ownership, store });

    const first = await run({ privyDid: DID, claimed: claim() });
    const second = await run({ privyDid: DID, claimed: claim() });

    expect(first.written).toBe(2);
    expect(second.written).toBe(0);
    // Two rows, and the second claim did not even attempt a write.
    expect(rows).toHaveLength(2);
    expect(writes).toHaveLength(2);
    expect(second.wallets).toEqual(first.wallets);
  });

  it('claims a single chain on its own without inventing the other', async () => {
    const { store, writes } = createStore();
    const { ownership } = createOwnership();
    const run = claimWalletsFor({ directory: createDirectory(), users: createUsers().users, ownership, store });

    await run({ privyDid: DID, claimed: [claim()[1] as ClaimedWallet] });

    expect(writes.map((wallet) => wallet.chain)).toEqual(['solana']);
  });

  it('records the EVM network in use as Ethereum mainnet, and claims no network for Solana', async () => {
    // Nobody chose a network at login, so the EVM row is written on the default
    // the owner decided: Ethereum stays, Monad is added. The Solana row records
    // no EVM network at all, because it has none.
    const { claim: run, writes } = harness();

    await run({ privyDid: DID, claimed: claim() });

    expect(DEFAULT_EVM_NETWORK).toBe(ETHEREUM_MAINNET_NETWORK_ID);
    expect(writes.map((wallet) => wallet.evmNetwork)).toEqual(['eip155:1', null]);
  });

  it('resolves the same users row the session wrote, instead of a second one', async () => {
    const { users, profiles } = createUsers();
    const { store } = createStore();
    const { ownership } = createOwnership();
    const run = claimWalletsFor({ directory: createDirectory(), users, ownership, store });

    await run({ privyDid: DID, claimed: claim() });
    await run({ privyDid: DID, claimed: claim() });

    // `upsert` on `privy_did`: the row is looked up, not inserted again.
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.privyDid).toBe(DID);
    expect(profiles[0]?.email).toBe('ana@example.com');
  });
});
