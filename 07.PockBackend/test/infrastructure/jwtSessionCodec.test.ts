import { describe, expect, it } from 'vitest';

import { createJwtSessionCodec } from '../../src/infrastructure/session/jwtSessionCodec';
import { DID, USER_ID } from '../support/fixtures';

const SECRET = 'a'.repeat(48);
const NOW = new Date('2025-01-01T00:00:00Z');

describe('jwtSessionCodec', () => {
  it('round-trips the claims', async () => {
    const codec = createJwtSessionCodec({ secret: SECRET });
    const issued = await codec.issue({ userId: USER_ID, privyDid: DID }, NOW);

    expect(issued.token.startsWith('rw1_')).toBe(true);
    await expect(codec.read(issued.token, NOW)).resolves.toEqual({ userId: USER_ID, privyDid: DID });
  });

  it('rejects a malformed token without throwing', async () => {
    const codec = createJwtSessionCodec({ secret: SECRET });
    await expect(codec.read('rw1_not-a-jwt', NOW)).resolves.toBeNull();
    await expect(codec.read('no-prefix', NOW)).resolves.toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const mine = createJwtSessionCodec({ secret: SECRET });
    const theirs = createJwtSessionCodec({ secret: 'b'.repeat(48) });
    const issued = await theirs.issue({ userId: USER_ID, privyDid: DID }, NOW);

    await expect(mine.read(issued.token, NOW)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const codec = createJwtSessionCodec({ secret: SECRET, ttlSeconds: 60 });
    const issued = await codec.issue({ userId: USER_ID, privyDid: DID }, NOW);

    const muchLater = new Date(NOW.getTime() + 120 * 1000);
    await expect(codec.read(issued.token, muchLater)).resolves.toBeNull();
  });
});