/**
 * THE ORDER OF THE WALLETS.
 *
 * The EVM wallet is created before the Solana one. That is not a detail of the
 * adapter, it is a product rule, and it lives in `WALLET_CHAIN_ORDER`. These tests
 * assert it by name so a refactor cannot quietly reverse it.
 */
import { describe, expect, it } from 'vitest';

import { provisionWalletsFor } from '../../src/application/provision-wallet/provisionWalletsFor';
import type { ProvisionWalletInput, WalletProvisioner } from '../../src/domain/ports/wallet-provisioner';
import { FIRST_CHAIN, SECOND_CHAIN, WALLET_CHAIN_ORDER } from '../../src/domain/wallet/chains';
import type { KnownWallet, WalletStore } from '../../src/domain/ports/wallet-store';
import { DID, EVM_ADDRESS, SOLANA_ADDRESS, USER_ID } from '../support/fixtures';

/** A store backed by an array. It is the whole database, for these tests. */
const createStore = () => {
  const rows: KnownWallet[] = [];
  const store: WalletStore = {
    findByUserId: async () => [...rows],
    save: async (_userId, wallet) => {
      rows.push(wallet);
    },
  };
  return { store, rows };
};

/** A provisioner that records the order it was called in. */
const createProvisioner = () => {
  const calls: ProvisionWalletInput[] = [];
  const provisioner: WalletProvisioner = {
    provision: async (input) => {
      calls.push(input);
      return {
        providerWalletId: `wallet-${input.chain}`,
        address: input.chain === 'ethereum' ? EVM_ADDRESS : SOLANA_ADDRESS,
        chain: input.chain,
      };
    },
  };
  return { provisioner, calls };
};

describe('WALLET_CHAIN_ORDER', () => {
  it('is ethereum then solana', () => {
    expect([...WALLET_CHAIN_ORDER]).toEqual(['ethereum', 'solana']);
    expect(FIRST_CHAIN).toBe('ethereum');
    expect(SECOND_CHAIN).toBe('solana');
  });
});

describe('provisionWalletsFor', () => {
  it('provisions ethereum BEFORE solana', async () => {
    const { store } = createStore();
    const { provisioner, calls } = createProvisioner();

    const wallets = await provisionWalletsFor(provisioner, store)({ ownerDid: DID, userId: USER_ID });

    // The order of the calls, asserted explicitly and not inferred.
    expect(calls.map((call) => call.chain)).toEqual(['ethereum', 'solana']);
    expect(wallets.map((wallet) => wallet.chain)).toEqual(['ethereum', 'solana']);
  });

  it('generates the idempotency key in the use case, not in the adapter', async () => {
    const { store } = createStore();
    const { provisioner, calls } = createProvisioner();

    await provisionWalletsFor(provisioner, store)({ ownerDid: DID, userId: USER_ID });

    expect(calls.map((call) => call.idempotencyKey)).toEqual([`${DID}:ethereum`, `${DID}:solana`]);
  });

  it('creates no extra wallet when the same person logs in again', async () => {
    const { store, rows } = createStore();
    const { provisioner, calls } = createProvisioner();
    const provision = provisionWalletsFor(provisioner, store);

    const first = await provision({ ownerDid: DID, userId: USER_ID });
    const second = await provision({ ownerDid: DID, userId: USER_ID });

    // Two wallets were requested from Privy in total, across both logins.
    expect(calls).toHaveLength(2);
    expect(rows).toHaveLength(2);

    // The second login returns the same wallets and provisions nothing new.
    expect(second).toEqual(first);
    expect(second.map((wallet) => wallet.address)).toEqual([EVM_ADDRESS, SOLANA_ADDRESS]);
  });

  it('does not ask the adapter to create a chain it already has', async () => {
    const { store } = createStore();
    const { provisioner, calls } = createProvisioner();

    // Only the EVM wallet is already on file.
    await store.save(USER_ID, { chain: 'ethereum', address: EVM_ADDRESS, providerWalletId: 'wallet-ethereum' });

    const wallets = await provisionWalletsFor(provisioner, store)({ ownerDid: DID, userId: USER_ID });

    expect(calls.map((call) => call.chain)).toEqual(['solana']);
    expect(wallets.map((wallet) => wallet.chain)).toEqual(['ethereum', 'solana']);
  });
});