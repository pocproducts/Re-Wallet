/**
 * Server-side wallet creation does not exist any more, and this is the test that
 * keeps it that way.
 *
 * This is the same shape as `noPlaceholderIdentity.test.ts`: a deletion that is
 * otherwise invisible. Nothing fails when the creation path quietly comes back —
 * the Worker boots, the login succeeds, a wallet appears — and the symptom is only
 * visible much later, when somebody tries to withdraw from a wallet that the
 * **app** owns. Production said exactly that: `owner: null`, `owner_id` pointing
 * at an app key quorum, and a user record listing no wallets at all.
 *
 * So the absence of the call is a property of the build, not a habit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claimWalletsFor, WalletClaimRejected } from '../../src/application/wallet-claim/claimWalletsFor';
import { createPrivyWalletOwnershipVerifier } from '../../src/infrastructure/privy/privyWalletOwnershipVerifier';

const ROOT = join(import.meta.dirname, '..', '..', 'src');

/** Any reference to Privy's wallet creation, in code or in prose. */
const BANNED = /wallets\(\)\.create|wallets\(\)\b/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });

describe('server-side wallet creation', () => {
  it('is not called anywhere in src', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (BANNED.test(readFileSync(file, 'utf8'))) hits.push(file.slice(ROOT.length + 1));
    }
    expect(hits).toEqual([]);
  });

  it('left no provisioner module in src', () => {
    const names = sourceFiles(ROOT).map((file) => file.slice(ROOT.length + 1));

    expect(names).not.toContain('domain/ports/wallet-provisioner.ts');
    expect(names).not.toContain('infrastructure/privy/privyWalletProvisioner.ts');
    expect(names).not.toContain('application/provision-wallet/provisionWalletsFor.ts');
  });

  it('offers the verification path in its place', () => {
    // The replacement is a factory, not a class, and it answers one question:
    // which wallets does the provider report for this person.
    expect(typeof createPrivyWalletOwnershipVerifier).toBe('function');
    expect(typeof claimWalletsFor).toBe('function');
    // And the only way out of a claim is a refusal that writes nothing.
    expect(WalletClaimRejected.prototype).toBeInstanceOf(Error);
  });
});
