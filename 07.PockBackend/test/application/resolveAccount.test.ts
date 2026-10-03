/**
 * The rules of `resolveAccount`, exercised against a fake that enforces the same
 * `UNIQUE` constraints the live `rewallet.users` table does.
 *
 * The failure this file exists to prevent is a real one, not a hypothetical:
 * Privy rotated the DID of a person who had already signed up, the row kept the
 * old DID, the lookup by DID missed, and the insert collided on
 * `users_email_key` — a 401 for someone who had just proved they own the mailbox.
 */
import { describe, expect, it } from 'vitest';

import { buildProfile } from '../../src/application/user/buildProfile';
import { IdentityConflict, resolveAccount } from '../../src/application/user/resolveAccount';
import { UserStoreConflict } from '../../src/domain/ports/user-store';
import type { UserStore } from '../../src/domain/ports/user-store';
import { recordingLogger } from '../support/fixtures';
import { CONSTRAINTS, inMemoryUserStore, seedUser } from '../support/userStore';

const OLD_DID = 'did:privy:2old00000000000000000000000000000000';
const NEW_DID = 'did:privy:2new00000000000000000000000000000000';
const EMAIL = 'cortezjoaquin205@gmail.com';

const profileFor = (privyDid: string, email: string) => buildProfile({ privyDid, email });

const resolve = (store: ReturnType<typeof inMemoryUserStore>, log = recordingLogger()) => {
  const steps: string[] = [];
  const run = resolveAccount({
    users: store.users,
    log,
    stepPrefix: 'session',
    markStep: (marker) => { steps.push(marker); },
  });
  return { run, steps, log };
};

describe('one email is one account', () => {
  // ── Rule 1: the DID is known ────────────────────────────────────────────────

  it('keeps the same row for a login whose DID is already known', async () => {
    const existing = seedUser({ id: 'aaaaaaaa-0000-4000-8000-000000000001', privyDid: OLD_DID, email: EMAIL });
    const store = inMemoryUserStore([existing]);
    const { run } = resolve(store);

    const account = await run(profileFor(OLD_DID, EMAIL));

    // The same id, not a second row: this is what the wallets are keyed on.
    expect(account.resolution).toBe('existing');
    expect(account.user.id).toBe(existing.id);
    expect(store.rows()).toHaveLength(1);
    expect(store.rows()[0]?.email).toBe(EMAIL);
  });

  it('treats a mailbox that only differs in case as the same person', async () => {
    // `rewallet.users.email` is `citext`: `Ana@Example.com` and `ana@example.com`
    // are one mailbox to the database, so they must be one mailbox here too.
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: 'Ana@Example.COM' })]);

    const account = await resolve(store).run(profileFor(OLD_DID, 'ana@example.com'));

    expect(account.resolution).toBe('existing');
    expect(store.rows()).toHaveLength(1);
  });

  // ── Rule 2: the DID rotated, the person did not ──────────────────────────────

  it('adopts the new DID on the existing row when only the email is known', async () => {
    const existing = seedUser({ id: 'aaaaaaaa-0000-4000-8000-000000000001', privyDid: OLD_DID, email: EMAIL });
    const store = inMemoryUserStore([existing]);
    const log = recordingLogger();
    const { run } = resolve(store, log);

    const account = await run(profileFor(NEW_DID, EMAIL));

    expect(account.resolution).toBe('adopted');
    expect(account.previousPrivyDid).toBe(OLD_DID);
    // The id survives: wallets, movements and policies already point at it.
    expect(account.user.id).toBe(existing.id);
    // And the row is now reachable by the new DID alone.
    expect(store.rows()[0]?.privyDid).toBe(NEW_DID);
    // Still exactly one row. The old orphan was repaired, not duplicated.
    expect(store.rows()).toHaveLength(1);
    // And the adoption is a line of its own, distinguishable from an update.
    expect(log.lines).toContain('session.account_adopted');
    expect(log.lines).not.toContain('session.account_existing');
  });

  it('keeps the name, the tag and the tag_normalized on adoption', async () => {
    // `tag` is a handle shown to people. A provider rotating a technical
    // identifier must not rename the human: every existing reference to this
    // person would break.
    const existing = seedUser({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      privyDid: OLD_DID,
      email: EMAIL,
      name: 'joaquin.cortez',
      tag: 'joaquin.cortez',
      tagNormalized: 'joaquin.cortez',
    });
    const store = inMemoryUserStore([existing]);

    const account = await resolve(store).run(profileFor(NEW_DID, EMAIL));

    expect(account.user.name).toBe('joaquin.cortez');
    expect(account.user.tag).toBe('joaquin.cortez');
    expect(account.user.tagNormalized).toBe('joaquin.cortez');
    // And the row on disk agrees, not only the returned value.
    expect(store.rows()[0]).toMatchObject({
      name: 'joaquin.cortez',
      tag: 'joaquin.cortez',
      tagNormalized: 'joaquin.cortez',
    });
  });

  it('does not rewrite the stored mailbox while adopting', async () => {
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: 'Cortez.Joaquin205@Gmail.com' })]);

    await resolve(store).run(profileFor(NEW_DID, EMAIL));

    // The casing on file is not ours to normalise during a DID rotation.
    expect(store.rows()[0]?.email).toBe('Cortez.Joaquin205@Gmail.com');
  });

  it('reads by DID first, and only then by email', async () => {
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: EMAIL })]);

    await resolve(store).run(profileFor(OLD_DID, EMAIL));

    // The order is the rule: the DID decides, and the mailbox is only consulted
    // when the DID knows nobody. The `upsert` after it is the deliberate
    // double-click absorber, not a second identity check.
    expect(store.calls.map((call) => call.op)).toEqual(['findByPrivyDid', 'upsert']);
  });

  it('does not derive a new tag when it only has to adopt a DID', async () => {
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: EMAIL, tag: 'ana.abcd' })]);

    await resolve(store).run(profileFor(NEW_DID, EMAIL));

    // `buildProfile` derives a tag from the DID, so a DID-derived tag would change
    // here. Adoption must not use it.
    expect(store.calls.some((call) => call.op === 'create' || call.op === 'upsert')).toBe(false);
    expect(store.rows()[0]?.tag).toBe('ana.abcd');
  });

  // ── Rule 3: neither is known ────────────────────────────────────────────────

  it('creates a new row when neither the DID nor the mailbox is on file', async () => {
    const store = inMemoryUserStore();

    const account = await resolve(store).run(profileFor(NEW_DID, 'someone.new@example.com'));

    expect(account.resolution).toBe('created');
    expect(store.rows()).toHaveLength(1);
    expect(store.rows()[0]).toMatchObject({ privyDid: NEW_DID, email: 'someone.new@example.com' });
  });

  // ── Rule 4: a DID that is known under a different mailbox ────────────────────

  it('refuses a known DID whose stored mailbox is a different one', async () => {
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: EMAIL })]);
    const { run } = resolve(store);

    // Overwriting the stored mailbox is the one move that could hand one person's
    // account to another, so it is not taken.
    await expect(run(profileFor(OLD_DID, 'attacker@example.com'))).rejects.toBeInstanceOf(IdentityConflict);
    expect(store.rows()[0]?.email).toBe(EMAIL);
    expect(store.rows()[0]?.privyDid).toBe(OLD_DID);
  });

  it('reports the conflict as its own reason, distinct from a provider failure', async () => {
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: EMAIL })]);

    const error = await resolve(store)
      .run(profileFor(OLD_DID, 'attacker@example.com'))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdentityConflict);
    expect(error).not.toBeInstanceOf(UserStoreConflict);
    // The two DIDs are in the reason; neither mailbox is.
    const message = (error as Error).message;
    expect(message).toContain(OLD_DID);
    expect(message).not.toContain('attacker@example.com');
    expect(message).not.toContain(EMAIL);
  });

  // ── Races, not contradictions ───────────────────────────────────────────────

  it('surfaces a raced unique violation as a named conflict, not a driver error', async () => {
    // Two logins for one mailbox arriving together: both read, both insert, one
    // loses. Reproduced by handing the resolver a store whose mailbox read missed
    // a row that is already on disk — which is exactly what a stale read is.
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: EMAIL })]);
    const racing: UserStore = { ...store.users, findByEmail: async () => null };
    const log = recordingLogger();
    const run = resolveAccount({ users: racing, log, stepPrefix: 'session' });

    const raced = await run(profileFor(NEW_DID, EMAIL)).catch((caught: unknown) => caught);

    // A condition with a name and a constraint, which is what the HTTP layer
    // turns into a 409 — not a 500 carrying a Postgres driver message.
    expect(raced).toBeInstanceOf(UserStoreConflict);
    expect((raced as UserStoreConflict).constraint).toBe(CONSTRAINTS.email);
  });

  // ── The step markers ────────────────────────────────────────────────────────

  it('names the statement that is about to run, so a failure has one place to look', async () => {
    const store = inMemoryUserStore([seedUser({ privyDid: OLD_DID, email: EMAIL })]);
    const { run, steps } = resolve(store);

    await run(profileFor(NEW_DID, EMAIL));

    expect(steps).toEqual(['session.user_adopt_did']);
  });
});