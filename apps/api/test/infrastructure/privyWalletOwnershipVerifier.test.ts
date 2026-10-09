/**
 * What the ownership verifier actually reads out of Privy.
 *
 * The whole security claim of this project is one line: **a wallet appears in this
 * list if and only if Privy holds it against that person.** So the list is read
 * from the record (`linked_accounts`), not computed, and the tests here assert
 * both halves — what it includes and, more importantly, what it refuses to include.
 */
import { describe, expect, it } from 'vitest';

import type { User } from '@privy-io/node';

import {
  createPrivyWalletOwnershipVerifier,
  PrivyOwnershipUnavailable,
  type PrivyUsersClient,
} from '../../src/infrastructure/privy/privyWalletOwnershipVerifier';
import { DID, EVM_ADDRESS, SOLANA_ADDRESS } from '../support/fixtures';

const EVM_WALLET_ID = 'o2oxert46wgndsi2x2gcu7ze';

/** The shape `LinkedAccountEthereumEmbeddedWallet` / `…Solana…` have (`users.d.ts:587`, `:840`). */
const embeddedWallet = (overrides: Record<string, unknown> = {}) => ({
  id: EVM_WALLET_ID,
  address: EVM_ADDRESS,
  chain_type: 'ethereum',
  connector_type: 'embedded',
  wallet_client: 'privy',
  wallet_client_type: 'privy',
  wallet_index: 0,
  imported: false,
  delegated: false,
  recovery_method: 'privy-v2',
  type: 'wallet',
  ...overrides,
});

const recordingClient = (linkedAccounts: unknown[], userId: string = DID) => {
  const asked: string[] = [];
  const client: PrivyUsersClient = {
    users: () => ({
      _get: async (id: string) => {
        asked.push(id);
        return { id: userId, linked_accounts: linkedAccounts } as unknown as Pick<User, 'id' | 'linked_accounts'>;
      },
    }),
  };
  return { client, asked };
};

describe('privyWalletOwnershipVerifier', () => {
  it('reports the embedded wallets the user record carries', async () => {
    const { client, asked } = recordingClient([
      embeddedWallet(),
      embeddedWallet({
        id: 'wallet-solana-1',
        address: SOLANA_ADDRESS,
        chain_type: 'solana',
        public_key: '3n1k…',
      }),
      { type: 'email', address: 'ana@example.com' },
    ]);

    const owned = await createPrivyWalletOwnershipVerifier(client).ownedBy(DID);

    expect(asked).toEqual([DID]);
    expect(owned).toEqual([
      { providerWalletId: EVM_WALLET_ID, address: EVM_ADDRESS, chain: 'ethereum' },
      { providerWalletId: 'wallet-solana-1', address: SOLANA_ADDRESS, chain: 'solana' },
    ]);
  });

  it('reports NOTHING for the app-owned wallets this project used to create', async () => {
    /*
     * The production evidence, reproduced as a fixture: the user record lists no
     * wallets at all. A claim naming one of the app-owned ids is rejected by this,
     * and that is not a rule somebody wrote — it is the record.
     */
    const { client } = recordingClient([{ type: 'email', address: 'ana@example.com' }]);

    const owned = await createPrivyWalletOwnershipVerifier(client).ownedBy(DID);

    expect(owned).toEqual([]);
  });

  it('ignores an embedded wallet entry that carries no id', async () => {
    // `id` is `string | null` in the SDK type. A null id is not proof of anything.
    const { client } = recordingClient([embeddedWallet({ id: null })]);

    expect(await createPrivyWalletOwnershipVerifier(client).ownedBy(DID)).toEqual([]);
  });

  it('ignores an external wallet, which has no Privy id to check', async () => {
    const { client } = recordingClient([
      { address: EVM_ADDRESS, chain_type: 'ethereum', type: 'wallet', connector_type: 'injected' },
    ]);

    expect(await createPrivyWalletOwnershipVerifier(client).ownedBy(DID)).toEqual([]);
  });

  it('ignores chains this product does not support', async () => {
    const { client } = recordingClient([
      embeddedWallet({ id: 'btc-1', chain_type: 'bitcoin-segwit', address: 'bc1q…' }),
    ]);

    expect(await createPrivyWalletOwnershipVerifier(client).ownedBy(DID)).toEqual([]);
  });

  it('fails closed when the record could not be read', async () => {
    const client: PrivyUsersClient = {
      users: () => ({
        _get: async () => {
          throw new Error('503');
        },
      }),
    };

    // An unknown answer is not an empty answer.
    await expect(createPrivyWalletOwnershipVerifier(client).ownedBy(DID)).rejects.toBeInstanceOf(
      PrivyOwnershipUnavailable,
    );
  });

  it('fails closed when the fetched record belongs to somebody else', async () => {
    const { client } = recordingClient([embeddedWallet()], 'did:privy:2someoneelse0000000000000000000000000');

    await expect(createPrivyWalletOwnershipVerifier(client).ownedBy(DID)).rejects.toBeInstanceOf(
      PrivyOwnershipUnavailable,
    );
  });

  it('never asks Privy about an identifier that is not a DID', async () => {
    const { client, asked } = recordingClient([embeddedWallet()]);
    const verifier = createPrivyWalletOwnershipVerifier(client);

    await expect(verifier.ownedBy('not-a-did')).rejects.toBeInstanceOf(PrivyOwnershipUnavailable);

    expect(asked).toEqual([]);
  });
});
