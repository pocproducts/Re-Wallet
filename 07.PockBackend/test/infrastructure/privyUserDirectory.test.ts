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

const OTHER_DID = 'did:privy:2someoneelse0000000000000000000000000';

/**
 * A client that records the identifier it was asked for and answers with `user`.
 *
 * `_get` is the SDK's own documented-by-example path for a single user by Privy
 * user id (`resources/users/users.d.ts`); it is underscore-prefixed in the package
 * because it shadows the older token-based `users().get({ id_token })`.
 */
const stubClient = (user: unknown, onGet?: (userId: string) => void): PrivyUsersClient => ({
  users: () => ({
    _get: async (userId) => {
      onGet?.(userId);
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

    const found = await directory.lookup(DID);

    expect(found).toEqual({ privyDid: DID, email: 'ana@example.com', displayName: null });
  });

  it('asks the provider for the user by DID, with no token of any kind', async () => {
    let sent: string | undefined;
    const directory = createPrivyUserDirectory(stubClient(withEmail, (userId) => { sent = userId; }));

    await directory.lookup(DID);

    // `_get(userID: string)` — the id alone, positional.
    expect(sent).toBe(DID);
  });

  it('preserves the mailbox exactly as the provider reports it', async () => {
    const directory = createPrivyUserDirectory(
      stubClient({ ...withEmail, linked_accounts: [{ type: 'email', address: 'Persona.Real@Example.COM' }] }),
    );

    expect((await directory.lookup(DID)).email).toBe('Persona.Real@Example.COM');
  });

  it('REFUSES a user with no linked email instead of inventing one', async () => {
    const directory = createPrivyUserDirectory(
      stubClient({ id: DID, linked_accounts: [{ type: 'wallet', address: '0x00' }] }),
    );

    // Fails closed. There is no reserved-TLD fallback anywhere in this file.
    await expect(directory.lookup(DID)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });

  it('fails closed when the provider cannot serve the lookup', async () => {
    const directory = createPrivyUserDirectory({
      users: () => ({ _get: async () => { throw new Error('401 Unauthorized'); } }),
    });

    await expect(directory.lookup(DID)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });

  it('rejects a key that is not a Privy DID before calling the provider', async () => {
    let called = false;
    const directory = createPrivyUserDirectory(stubClient(withEmail, () => { called = true; }));

    for (const bad of ['', 'not-a-did', 'id.a.b', 'did:web:example.com']) {
      await expect(directory.lookup(bad)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
    }
    expect(called).toBe(false);
  });

  it('treats an empty linked email as no email', async () => {
    const directory = createPrivyUserDirectory(stubClient({ id: DID, linked_accounts: [{ type: 'email', address: '  ' }] }));

    await expect(directory.lookup(DID)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });

  it("REFUSES a record whose own id is not the DID that was asked for", async () => {
    const directory = createPrivyUserDirectory(stubClient({ ...withEmail, id: OTHER_DID }));

    // The lookup answered, but with somebody else. Failing closed beats writing a
    // mailbox that belongs to a different person.
    await expect(directory.lookup(DID)).rejects.toBeInstanceOf(PrivyIdentityUnavailable);
  });
});