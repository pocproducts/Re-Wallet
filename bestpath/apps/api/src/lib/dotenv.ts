import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from the given module to the filesystem root, loading every `.env`
 * found — nearest first, so the most specific file wins. Variables already
 * present in the real environment are never clobbered.
 *
 * Walking up rather than hardcoding relative paths means this works the same
 * from `src/`, from `tests/integration/`, and from a compiled `dist/`.
 */
export function loadEnvFiles(fromUrl: string): string[] {
  const start = dirname(fileURLToPath(fromUrl));
  const root = parse(start).root;
  const found: string[] = [];

  let dir = start;
  for (;;) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
      found.push(candidate);
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  if (found.length === 0) {
    console.warn(
      '[bestpath] no .env found — the process will refuse to boot unless every ' +
        'variable is set in the real environment. See .env.example.',
    );
  }
  return found;
}
