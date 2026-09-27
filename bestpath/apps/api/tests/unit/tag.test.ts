import { describe, it, expect } from 'vitest';
import {
  sanitizeTagBase,
  normalizeTag,
  toDisplayTag,
  candidateTags,
  allocateTag,
} from '../../src/services/tag';

/**
 * The tag is a human-readable alias and it has to be collision-proof. These
 * tests pin the sanitisation rules and the allocation order, because a change
 * here silently changes what handles look like for every user created after it.
 */

describe('sanitizeTagBase', () => {
  it('lowercases and strips accents', () => {
    expect(sanitizeTagBase('Ana María')).toBe('anamaria');
    expect(sanitizeTagBase('José')).toBe('jose');
    expect(sanitizeTagBase('Ñoño')).toBe('nono');
    expect(sanitizeTagBase('Ana Sofía Chen')).toBe('anasofiachen');
  });

  it('removes everything that is not alphanumeric', () => {
    expect(sanitizeTagBase('ana-maria')).toBe('anamaria');
    expect(sanitizeTagBase('ana_maria')).toBe('anamaria');
    expect(sanitizeTagBase('  ana  maria  ')).toBe('anamaria');
    expect(sanitizeTagBase('a.b.c')).toBe('abc');
  });

  it('falls back when nothing survives sanitisation', () => {
    expect(sanitizeTagBase('---')).toBe('user');
    expect(sanitizeTagBase('')).toBe('user');
    expect(sanitizeTagBase('   ')).toBe('user');
    // ñ is NOT stripped: NFD splits it into 'n' + combining tilde, so it
    // survives as 'n'. Same rule as José -> jose. Only the accent goes.
    expect(sanitizeTagBase('ñ')).toBe('n');
  });

  it('is idempotent', () => {
    const once = sanitizeTagBase('José Ñoño');
    expect(sanitizeTagBase(once)).toBe(once);
  });
});

describe('normalizeTag / toDisplayTag', () => {
  it('normalises a user-typed tag the same way as a generated one', () => {
    expect(normalizeTag('@Ana')).toBe('ana');
    expect(normalizeTag('ana')).toBe('ana');
    expect(normalizeTag('@ana maria')).toBe('anamaria');
  });

  it('round-trips through the display form', () => {
    expect(normalizeTag(toDisplayTag('ana'))).toBe('ana');
  });
});

describe('candidateTags', () => {
  it('starts at the bare name and suffixes from 2', () => {
    expect(candidateTags('ana').slice(0, 4)).toEqual(['ana', 'ana2', 'ana3', 'ana4']);
  });
});

describe('allocateTag', () => {
  const taken = (...set: string[]) => new Set(set);
  const alloc = (set: Set<string>, userSeq = 1) => ({
    isTaken: async (n: string) => set.has(n),
    userSeq,
  });

  it('returns the bare name when it is free', async () => {
    expect(await allocateTag('Ana', alloc(taken()))).toBe('ana');
  });

  it('suffixes on collision', async () => {
    expect(await allocateTag('Ana', alloc(taken('ana')))).toBe('ana2');
    expect(await allocateTag('Ana', alloc(taken('ana', 'ana2')))).toBe('ana3');
  });

  it('skips holes: takes ana3 even if ana2 is free', async () => {
    // Sequential, not random — a user retrying lands on the same handle.
    expect(await allocateTag('Ana', alloc(taken('ana', 'ana3')))).toBe('ana2');
  });

  it('sanitises the name before allocating', async () => {
    expect(await allocateTag('José', alloc(taken()))).toBe('jose');
    expect(await allocateTag('José', alloc(taken('jose')))).toBe('jose2');
  });

  it('falls back to user{seq} when the suffix space is exhausted', async () => {
    const all = new Set<string>();
    for (let n = 1; n <= 100; n += 1) all.add(n === 1 ? 'ana' : `ana${n}`);
    expect(await allocateTag('Ana', alloc(all, 4242))).toBe('user4242');
  });

  it('is deterministic for the same input', async () => {
    const a = alloc(taken('ana', 'ana2'));
    const b = alloc(taken('ana', 'ana2'));
    expect(await allocateTag('Ana', a)).toBe(await allocateTag('Ana', b));
  });
});
