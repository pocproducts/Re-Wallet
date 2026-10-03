/**
 * The placeholder is gone, and this is the test that keeps it gone.
 *
 * A grep is normally something you run once, in a terminal, and forget. This makes
 * the deletion a property of the build instead: `rewallet.users.email` is `NOT NULL`
 * and `UNIQUE`, so any code that can invent an address can insert a row that claims
 * to be a mailbox and is not one, and nothing downstream would notice. The failure
 * mode is silent, so the guard has to be loud.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', 'src');
const BANNED = /privy\.invalid/;

/** Every `.ts` file under `src`, recursively. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });

describe('the invented-identity path', () => {
  it('does not exist anywhere in src', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (BANNED.test(readFileSync(file, 'utf8'))) {
        hits.push(file.slice(ROOT.length + 1));
      }
    }
    expect(hits).toEqual([]);
  });

  it('left no exported placeholder constant behind', async () => {
    const buildProfile = await import('../../src/application/user/buildProfile');
    const exported = Object.keys(buildProfile);
    expect(exported).not.toContain('PLACEHOLDER_EMAIL_DOMAIN');
  });
});
