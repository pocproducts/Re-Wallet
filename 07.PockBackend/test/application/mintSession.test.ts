import { describe, expect, it } from 'vitest';

import { IdentityUnavailable, mintSession } from '../../src/application/session/mintSession';
import { buildProfile, MissingRealEmail, USER_TAG_PATTERN } from '../../src/application/user/buildProfile';
import type { TokenVerifier } from '../../src/domain/ports/token-verifier';
import type { DirectoryUser, UserDirectory } from '../../src/domain/ports/user-directory';
import type { NewUserProfile, StoredUser, UserStore } from '../../src/domain/ports/user-store';
import type { SessionCodec } from '../../src/domain/ports/session-codec';
import { DID, recordingLogger, USER_ID } from '../support/fixtures';

const ACCESS_TOKEN = 'a.b.c';

const validVerifier = (): TokenVerifier => ({ verify: async () => ({ privyDid: DID }) });

/** The provider's user record, which is the only source of the mailbox. */
const directoryFor = (overrides: Partial<DirectoryUser> = {}): UserDirectory & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    lookup: async (privyDid) => {
      asked.push(privyDid);
      return {
        privyDid: DID,
        email: 'ana@example.com',
        displayName: null,
        ...overrides,
      };
    },
  };
};

const recordingUserStore = () => {
  const calls: string[] = [];
  const profiles: NewUserProfile[] = [];
  const user: StoredUser = { id: USER_ID, privyDid: DID, name: 'ana.abcd', email: 'ana@example.com', tag: 'ana.abcd' };
  const users: UserStore = {
    upsert: async (profile) => {
      calls.push(profile.privyDid);
      profiles.push(profile);
      return { ...user, email: profile.email, name: profile.name, tag: profile.tag };
    },
  };
  return { users, calls, profiles, user };
};

const noopProvision = () => {
  const calls: string[] = [];
  return { calls, provision: async ({ userId }: { userId: string }) => { calls.push(userId); return []; } };
};

const stubCodec = (): SessionCodec => ({
  issue: async () => ({ token: 'rw1_token', expiresAt: new Date('2030-01-01T00:00:00Z') }),
  read: async () => ({ userId: USER_ID, privyDid: DID }),
});

describe('mintSession', () => {
  it('rejects a bad token and writes NOTHING', async () => {
    const { users, calls } = recordingUserStore();
    const { calls: provisionCalls, provision } = noopProvision();
    const log = recordingLogger();

    const mint = mintSession({
      verify: { verify: async () => { throw new Error('bad signature'); } },
      directory: directoryFor(),
      users,
      provisionWallets: provision,
      sessions: stubCodec(),
      log,
    });

    await expect(mint('not-a-jwt')).rejects.toThrow('bad signature');

    // No user row, no wallet, no session.
    expect(calls).toEqual([]);
    expect(provisionCalls).toEqual([]);
    // And the failure says WHICH step died.
    expect(log.lines).toContain('session.start');
    expect(log.lines).toContain('error:session.failed');
  });

  it('verifies, resolves, upserts, provisions and issues, in that order', async () => {
    const { users } = recordingUserStore();
    const { provision } = noopProvision();
    const log = recordingLogger();

    const mint = mintSession({
      verify: validVerifier(),
      directory: directoryFor(),
      users,
      provisionWallets: provision,
      sessions: stubCodec(),
      log,
    });

    const minted = await mint(ACCESS_TOKEN);

    expect(minted.userId).toBe(USER_ID);
    expect(minted.privyDid).toBe(DID);
    expect(minted.token).toBe('rw1_token');
    expect(log.lines).toEqual([
      'session.start',
      'session.token_verified',
      'session.identity_resolved',
      'session.user_ready',
      'session.wallets_ready',
      'session.issued',
    ]);
  });

  it('looks the user up BY the DID the access token proved — no second token', async () => {
    const directory = directoryFor();

    const mint = mintSession({
      verify: validVerifier(),
      directory,
      users: recordingUserStore().users,
      provisionWallets: noopProvision().provision,
      sessions: stubCodec(),
    });

    await mint(ACCESS_TOKEN);

    expect(directory.asked).toEqual([DID]);
  });

  // ── The identity, as stored ──────────────────────────────────────────────────

  it('stores the REAL email from the Privy user record', async () => {
    const { users, profiles } = recordingUserStore();

    const mint = mintSession({
      verify: validVerifier(),
      directory: directoryFor({ email: 'Persona Real@Example.COM' }),
      users,
      provisionWallets: noopProvision().provision,
      sessions: stubCodec(),
    });

    await mint(ACCESS_TOKEN);

    // Verbatim from the provider: not lowercased, not slugified, not derived.
    expect(profiles[0]?.email).toBe('Persona Real@Example.COM');
    // The derived columns still satisfy the live CHECK.
    expect(profiles[0]?.tag).toMatch(USER_TAG_PATTERN);
    expect(profiles[0]?.name).toMatch(USER_TAG_PATTERN);
    // And none of it is the placeholder.
    expect(profiles[0]?.email).not.toContain('privy.invalid');
  });

  it('prefers the display name when the provider has one', async () => {
    const { users, profiles } = recordingUserStore();

    const mint = mintSession({
      verify: validVerifier(),
      directory: directoryFor({ email: 'ana@example.com', displayName: 'Ana Ruiz' }),
      users,
      provisionWallets: noopProvision().provision,
      sessions: stubCodec(),
    });

    await mint(ACCESS_TOKEN);

    // The readable half is the display name; the digest half is the DID's, so two
    // people called "Ana Ruiz" still get two rows.
    expect(profiles[0]?.tag).toMatch(/^ana\.ruiz\.[0-9a-f]{4}$/);
    expect(profiles[0]?.name).toBe(profiles[0]?.tag);
    expect(profiles[0]?.email).toBe('ana@example.com');
  });

  // ── Failing closed ───────────────────────────────────────────────────────────

  it('fails closed and writes NOTHING when the user lookup cannot resolve an identity', async () => {
    const { users, calls, profiles } = recordingUserStore();
    const { calls: provisionCalls, provision } = noopProvision();
    const log = recordingLogger();

    const mint = mintSession({
      verify: validVerifier(),
      // The provider authenticated the caller but has no mailbox for them.
      directory: { lookup: async () => { throw new Error('user has no linked email account'); } },
      users,
      provisionWallets: provision,
      sessions: stubCodec(),
      log,
    });

    await expect(mint(ACCESS_TOKEN)).rejects.toThrow('user has no linked email account');

    // Nothing invented, nothing written, no wallet, no cookie.
    expect(calls).toEqual([]);
    expect(profiles).toEqual([]);
    expect(provisionCalls).toEqual([]);
    // The failing step is named, so "login failed" becomes "login failed at …".
    expect(log.lines).toContain('error:session.failed');
  });

  it('refuses a lookup that resolved a DIFFERENT Privy user than the token proved', async () => {
    const { users, calls } = recordingUserStore();

    const mint = mintSession({
      verify: validVerifier(),
      directory: directoryFor({ privyDid: 'did:privy:2someoneelse0000000000000000000000000' }),
      users,
      provisionWallets: noopProvision().provision,
      sessions: stubCodec(),
    });

    await expect(mint(ACCESS_TOKEN)).rejects.toBeInstanceOf(IdentityUnavailable);
    expect(calls).toEqual([]);
  });
});

describe('buildProfile', () => {
  it('uses the real email from the user record', () => {
    const profile = buildProfile({ privyDid: DID, email: 'Ana@example.com' });
    expect(profile.email).toBe('Ana@example.com');
    expect(profile.tag).toMatch(USER_TAG_PATTERN);
  });

  it('refuses a subject with no email instead of inventing one', () => {
    // This is the deleted placeholder path. There is no argument that reaches it.
    expect(() => buildProfile({ privyDid: DID, email: '' })).toThrow(MissingRealEmail);
    expect(() => buildProfile({ privyDid: DID, email: '   ' })).toThrow(MissingRealEmail);
    expect(() => buildProfile({ privyDid: DID, email: 'not-an-address' })).toThrow(MissingRealEmail);
  });

  it('is deterministic: the same Privy user always yields the same tag', () => {
    expect(buildProfile({ privyDid: DID, email: 'ana@example.com' })).toEqual(
      buildProfile({ privyDid: DID, email: 'ana@example.com' }),
    );
  });

  it('keeps two people who share a mailbox prefix on distinct tags', () => {
    const a = buildProfile({ privyDid: 'did:privy:2aaaaaaaaa00000000000000000000000000', email: 'ana@a.com' });
    const b = buildProfile({ privyDid: 'did:privy:2bbbbbbbbb00000000000000000000000000', email: 'ana@b.com' });
    // `users.name` and `users.tag` are both UNIQUE, so equal tags would be a 500.
    expect(a.tag).not.toBe(b.tag);
    expect(a.name).not.toBe(b.name);
  });

  it('always produces a tag the live CHECK accepts', () => {
    const emails = ['a@b.co', 'josé.pérez+tag@Example.COM', 'x@x.io', 'ünïcödé@exämple.com'];
    for (const email of emails) {
      const profile = buildProfile({ privyDid: DID, email });
      expect(profile.tag).toMatch(USER_TAG_PATTERN);
      expect(profile.name).toMatch(USER_TAG_PATTERN);
    }
  });
});
