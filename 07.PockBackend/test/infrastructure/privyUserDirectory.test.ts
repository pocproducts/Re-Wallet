/**
 * The Privy user lookup, offline.
 *
 * The adapter is only injectable because its client is a structural interface, so
 * every case here is a real assertion about what it sends and what it refuses to
 * invent — with no network and no database.
 */
import { describe, expect, it } from 'vitest';

import {
  createPrivyUserDirectory,
  PrivyIdentityUnavailable,
  type PrivyUsersClient,
} from '../../src/infrastructure/privy/privyUserDirectory';
import { DID } from '../support/fixtures';

const ID_TOKEN = 'id.a.b';

/** A user with one linked email, which is what a Privy email login produces. */
const stubClient = (user: unknown, onGet?: (input: unknown) => void): PrivyUsersClient => ({
  users: () => ({
    get: async (input) => {
      onGet?.(input);
      return user as never;
    },
  }),
});

const withEmail = {
  id: DID,
  linked_accounts: [
    { type: 'wallet', address: '0x1234567890abcdef1234567890abcdef12345678' },
    { type: 'email', address: 'ana@example.com', first_verified_at: null, latest_verified_at: null, verified_at: 1 },
  ],
};

describe('privyUserDirectory', () => {
  it('reads the email out of the linked accounts', async () => {
    const directory = createPrivyUserDirectory(stubClient(withEmail));

    const found = await directory.lookup(ID_TOKEN);

    expect(found).toEqual({ privyDid: DID, email: 'ana@example.com', displayName: null });
  });

  it('sends the id token under the key the SDK documents', async () => {
    let sent: unknown;
    const directory = createPrivyUserDirectory(stubClient(withEmail, (input) => { sent = input; }));

    await directory.lookup(ID_TOKEN);

    // `PrivyUsersService.GetInput = { id_token: string }` — snake_case, not `idToken`.
    expect(sent).toEqual({ id_token: ID_TOKEN });
  });

  it('preserves the mailbox exactly as the provider reports it', async () => {
    const directory = createPrivyUserDirectory(
      stubClient({ ...withEmail, linked_accounts: [{ type: 'email', address: 'Persona.Real@Example.COM' }] }),
    );

    expect((await directory.lookup(ID_TOKEN)).email).toBe('Persona.Real@Example.COM');
  });

  it('REFUSES a user with no linked email instead of inventing one', async () => {
    const directory = createPrivyUserDirectory(
      stubClient({ id: DID, linked_accounts: [{ type: 'wallet', address: '0x00' }] }),
    );

    // Fails closed. There is no reserved-TLD fallback anywhere in this file.
    await expect(directory.lookup(ID_TOKEN)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });

  it('fails closed when the provider rejects the token', async () => {
    const directory = createPrivyUserDirectory({
      users: () => ({ get: async () => { throw new Error('401 Unauthorized'); } }),
    });

    await expect(directory.lookup(ID_TOKEN)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });

  it('rejects a token that does not look like a JWT before calling the provider', async () => {
    let called = false;
    const directory = createPrivyUserDirectory(stubClient(withEmail, () => { called = true; }));

    await expect(directory.lookup('not-a-jwt')).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
    expect(called).toBe(false);
  });

  it('treats an empty linked email as no email', async () => {
    const directory = createPrivyUserDirectory(stubClient({ id: DID, linked_accounts: [{ type: 'email', address: '  ' }] }));

    await expect(directory.lookup(ID_TOKEN)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });
});
