/**
 * The Postgres adapter, against a fake transport.
 *
 * ── Why this is worth a file ─────────────────────────────────────────────────
 *
 * The one behaviour that cannot be checked from the application layer is the
 * **translation** of a driver's unique-constraint failure. Everything else in
 * this file is a mapping that a typo would show up as loudly as a broken login;
 * the translation is invisible until two people log in at the same instant, and
 * its absence is an HTTP 500 carrying `duplicate key value violates unique
 * constraint "users_email_key"` to a browser.
 *
 * So the fake transport is a tagged-template function that either returns rows or
 * throws the shape the HTTP driver throws. No database is involved, and none is
 * needed: what is under test is how this adapter reacts to a failure, not what
 * Postgres means by one.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresUserStore } from '../../src/infrastructure/db/userStore.pg';
import { UserStoreConflict } from '../../src/domain/ports/user-store';

/** A `rewallet.users` row as `RETURNING` produces it. */
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  privy_did: 'did:privy:2test0000000000000000000000000000000',
  name: 'ana.abcd',
  email: 'ana@example.com',
  tag: 'ana.abcd',
  tag_normalized: 'ana.abcd',
};

/** The unique violation the Neon HTTP driver raises, verbatim in shape. */
const uniqueViolation = (constraint: string): unknown => ({
  code: '23505',
  severity: 'ERROR',
  constraint,
  message: `duplicate key value violates unique constraint "${constraint}"`,
});

/** A tagged-template stand-in for `neon()`. */
const fakeDb = (behaviour: () => Promise<unknown>): Database => {
  const template = async () => behaviour();
  return Object.assign(template, { unsafe: (sql: string) => sql }) as unknown as Database;
};

describe('createPostgresUserStore', () => {
  it('reads a row by DID and reports `tag_normalized` as it is stored', async () => {
    const store = createPostgresUserStore(fakeDb(async () => [ROW]));

    const user = await store.findByPrivyDid(ROW.privy_did);

    expect(user).toEqual({
      id: ROW.id,
      privyDid: ROW.privy_did,
      name: ROW.name,
      email: ROW.email,
      tag: ROW.tag,
      tagNormalized: ROW.tag_normalized,
    });
  });

  it('reports "nobody" as null rather than an empty object', async () => {
    const store = createPostgresUserStore(fakeDb(async () => []));

    // The resolver branches on this. A truthy empty row would read as an account
    // with no name, no mailbox and an id nobody can own.
    expect(await store.findByPrivyDid(ROW.privy_did)).toBeNull();
    expect(await store.findByEmail(ROW.email)).toBeNull();
  });

  it('translates a unique violation into a named conflict', async () => {
    const store = createPostgresUserStore(fakeDb(async () => { throw uniqueViolation('users_email_key'); }));

    const error = await store
      .create({ privyDid: ROW.privy_did, name: ROW.name, email: ROW.email, tag: ROW.tag })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UserStoreConflict);
    expect((error as UserStoreConflict).constraint).toBe('users_email_key');
    // The driver message stays a `cause` — available to the log, never returned.
    expect((error as Error).message).not.toContain('duplicate key value');
  });

  it('translates a violation on any of the writes, including the adoption', async () => {
    // All three writes can lose a race, and all three must answer the same way:
    // `name`, `tag` and `tag_normalized` are `UNIQUE` too, so a second account
    // built from the same mailbox prefix collides on one of those, not on the DID.
    const racing = createPostgresUserStore(fakeDb(async () => { throw uniqueViolation('users_tag_key'); }));
    const profile = { privyDid: ROW.privy_did, name: ROW.name, email: ROW.email, tag: ROW.tag };

    const errors = await Promise.all([
      racing.adoptPrivyDid(ROW.id, 'did:privy:2taken0000000000000000000000000000000').catch((caught: unknown) => caught),
      racing.upsert(profile).catch((caught: unknown) => caught),
      racing.create(profile).catch((caught: unknown) => caught),
    ]);

    for (const error of errors) {
      expect(error).toBeInstanceOf(UserStoreConflict);
      expect((error as UserStoreConflict).constraint).toBe('users_tag_key');
    }
  });

  it('re-throws anything that is not a unique violation', async () => {
    // An outage must not be disguised as a conflict: that would send support
    // looking for two simultaneous logins that never happened.
    const outage = Object.assign(new Error('fetch failed: connection terminated'), { code: 'ECONNRESET' });
    const store = createPostgresUserStore(fakeDb(async () => { throw outage; }));

    await expect(store.create({ privyDid: ROW.privy_did, name: ROW.name, email: ROW.email, tag: ROW.tag })).rejects.toBe(
      outage,
    );
  });

  it('names the statement when a write returns no row at all', async () => {
    const store = createPostgresUserStore(fakeDb(async () => []));

    await expect(
      store.adoptPrivyDid(ROW.id, ROW.privy_did),
    ).rejects.toThrow(`no users row returned while adopting ${ROW.privy_did} on the account ${ROW.id}`);
  });
});