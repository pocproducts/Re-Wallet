import { describe, it, expect, vi } from 'vitest';
import { createMonadReader, InvalidMonadAddressError, type MonadReader } from '../../src/services/monad';
import type { PublicClient } from 'viem';

/**
 * The USDC read, without a network.
 *
 * What is worth testing here is not "viem can encode a call" — that is viem's
 * test, not ours. It is the three things THIS file is responsible for:
 *
 *   1. the result is a decimal STRING with 6 decimals, never a number. The
 *      column is `numeric(20,6)` and the project rule is that money crosses the
 *      wire as a string; a `number` here would be a silent precision loss on the
 *      one value that cannot afford one.
 *   2. a malformed address fails HERE, with a named error, instead of becoming
 *      an `InvalidAddressError` from inside viem four frames down.
 *   3. the reader is the only thing that needs the client injected, so the
 *      reconciliation that uses it can be tested without a chain.
 */

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as const;
const OWNER = '0x6c9F272E77A84fe90E83372c37Bfd6Da05aB7ae1' as const;

/** A client that answers `balanceOf` with a fixed uint256 and records the call. */
const fakeClient = (raw: bigint) => {
  // The parameter is declared even though the fake ignores it: without it the
  // mock's `calls` tuple is `[]` and asserting on the arguments does not typecheck.
  const readContract = vi.fn(async (_request: unknown) => raw);
  return { client: { readContract } as unknown as PublicClient, readContract };
};

describe('usdc balanceOf', () => {
  it('returns a decimal STRING with the token scale, not a number', async () => {
    // 826004 micro-USDC = the 0.826004 USDC the QR wallet actually held.
    const { client, readContract } = fakeClient(826004n);
    const reader = createMonadReader(client, USDC);

    const balance = await reader.usdcBalanceOf(OWNER);

    expect(balance).toBe('0.826004');
    expect(typeof balance).toBe('string');
  });

  it('keeps the full scale on a large balance instead of losing precision', async () => {
    // 1_000_000_000_000 USDC in micro-units. As a JS number this is still exact,
    // but the point stands for anything past 2^53 micro-USDC, and the string is
    // what makes that a non-question.
    const { client } = fakeClient(1_000_000_000_000_000_000n);
    const balance = await createMonadReader(client, USDC).usdcBalanceOf(OWNER);
    expect(balance).toBe('1000000000000.000000');
  });

  it('an empty wallet is 0.000000, not an empty string and not null', async () => {
    const { client } = fakeClient(0n);
    const balance = await createMonadReader(client, USDC).usdcBalanceOf(OWNER);
    // The three shapes are distinguishable: '' and null would both read as "we
    // do not know" in the caller, and this value is "we know, it is zero".
    // `viem.formatUnits` alone would answer "0" here, so the fixed scale comes
    // from `lib/money.ts` doing the serialisation.
    expect(balance).toBe('0.000000');
  });

  it('asks the token, for the owner given, and nothing else', async () => {
    const { client, readContract } = fakeClient(1n);
    await createMonadReader(client, USDC).usdcBalanceOf(OWNER);

    expect(readContract).toHaveBeenCalledTimes(1);
    const arg = readContract.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.address).toBe(USDC);
    expect(arg.functionName).toBe('balanceOf');
    expect(arg.args).toEqual([OWNER]);
  });
});

describe('a malformed address fails before the network', () => {
  // Each of these is a plausible corruption of the `wallets.address` column, and
  // none of them should reach an RPC: a call with a bad argument is a 400 that
  // reads like a chain problem, and the cron would retry it forever.
  const bad = [
    ['empty', ''],
    ['not hex', '0xZZZZ'],
    ['no 0x prefix', '6c9F272E77A84fe90E83372c37Bfd6Da05aB7ae1'],
    ['too short', '0x6c9F272E'],
    ['with whitespace', ' 0x6c9F272E77A84fe90E83372c37Bfd6Da05aB7ae1 '],
  ] as const;

  for (const [label, address] of bad) {
    it(`rejects ${label}`, async () => {
      const { client, readContract } = fakeClient(1n);
      const reader: MonadReader = createMonadReader(client, USDC);

      await expect(reader.usdcBalanceOf(address)).rejects.toThrow(InvalidMonadAddressError);
      // The important half: it never left the process.
      expect(readContract).not.toHaveBeenCalled();
    });
  }

  it('the error names the offending value, because a bad row is a data bug', async () => {
    const { client } = fakeClient(1n);
    await expect(
      createMonadReader(client, USDC).usdcBalanceOf('0xnope'),
    ).rejects.toThrow(/0xnope/);
  });
});
