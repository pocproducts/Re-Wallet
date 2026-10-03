/**
 * What the provisioner actually sends to Privy.
 *
 * The owner field is the difference between a wallet the person controls and a
 * wallet the *app* controls, and it is invisible until somebody tries to withdraw
 * from the wrong one. So it is asserted here rather than left to a comment.
 */
import { describe, expect, it } from 'vitest';

import {
  createPrivyWalletProvisioner,
  type PrivyWalletsClient,
} from '../../src/infrastructure/privy/privyWalletProvisioner';
import { DID, EVM_ADDRESS, SOLANA_ADDRESS } from '../support/fixtures';

interface CreateCall {
  chain_type: string;
  owner?: { user_id: string };
  owner_id?: string;
  idempotency_key: string;
}

const recordingClient = (address: string) => {
  const calls: CreateCall[] = [];
  const client: PrivyWalletsClient = {
    wallets: () => ({
      create: async (params) => {
        calls.push(params as unknown as CreateCall);
        return { id: 'wallet-1', address } as never;
      },
    }),
  };
  return { client, calls };
};

describe('privyWalletProvisioner', () => {
  it('assigns the wallet to the USER through `owner.user_id`', async () => {
    const { client, calls } = recordingClient(EVM_ADDRESS);
    const provisioner = createPrivyWalletProvisioner(client);

    const wallet = await provisioner.provision({ ownerDid: DID, chain: 'ethereum', idempotencyKey: `${DID}:ethereum` });

    // `owner: { user_id }` is the form the SDK documents for a Privy *user*
    // (`resources/shared.d.ts:70` → `OwnerInputUser` at `…:83-85`).
    expect(calls[0]?.owner).toEqual({ user_id: DID });
    // And `owner_id` — documented there as the KEY QUORUM id — is not used.
    expect(calls[0]?.owner_id).toBeUndefined();
    expect(wallet).toEqual({ providerWalletId: 'wallet-1', address: EVM_ADDRESS, chain: 'ethereum' });
  });

  it('translates the chain and carries the idempotency key', async () => {
    const { client, calls } = recordingClient(SOLANA_ADDRESS);
    const provisioner = createPrivyWalletProvisioner(client);

    await provisioner.provision({ ownerDid: DID, chain: 'solana', idempotencyKey: `${DID}:solana` });

    expect(calls[0]?.chain_type).toBe('solana');
    expect(calls[0]?.idempotency_key).toBe(`${DID}:solana`);
  });
});
