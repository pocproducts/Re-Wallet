/**
 * Aave V3 on Monad — reading a position.
 *
 * ── What this module reads, and what it deliberately does not ─────────────
 *
 * It reads the POSITION: how much aUSDC the user holds, and how much USDC is
 * sitting idle in the same wallet. Both are plain ERC-20 `balanceOf` calls, and
 * both are provable against the chain.
 *
 * It does NOT read the pool's supply rate, and that is a decision, not an
 * omission. `getReserveData` returns a struct whose layout is version-specific
 * (Aave v3.7 reordered it), the deployed contract is not verified on Sourcify,
 * and a wrong field index does not error — it returns a plausible number. The
 * first attempt read `aUSDC` as the interest-rate strategy and a rate of
 * **3183% annual**. Shipping a yield number that turns out to be a borrow rate
 * is the kind of bug that ends a pitch, so the function is not here at all
 * until there is a verified ABI to read it with.
 *
 * ── The yield does not need it ─────────────────────────────────────────────
 *
 * The RATE is a function of the POSITION: aUSDC balance grows as yield accrues,
 * so annualising what we can already read gives the same number without a second
 * ABI. And for the product, "tu saldo subió $0,42 porque el aUSDC de tu wallet
 * subió" is a better sentence than a projected APY: it is money that demonstrably
 * arrived, read from Monad by an address the user can look up on the explorer.
 *
 * ── Addresses come from configuration, never from a constant ───────────────
 *
 * Monad mainnet and testnet are different chains with different contracts, and
 * the addresses live in the environment. Hardcoding them is how a testnet run
 * calls a mainnet pool.
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { monad } from 'viem/chains';
import { getEnv, type Env } from '@bestpath/config';

let client: PublicClient | null = null;

export function getChainClient(env: Env = getEnv()): PublicClient {
  if (!client) {
    client = createPublicClient({
      // Monad's chain object with OUR chain id, because Privy does not serve an
      // RPC for Monad and a testnet/mainnet mixup here would be invisible until
      // a transaction went somewhere unexpected.
      chain: { ...monad, id: env.MONAD_CHAIN_ID as 143 },
      transport: http(env.MONAD_RPC_URL),
    });
  }
  return client;
}

export function __resetChainClient(): void {
  client = null;
}

/** USDC: 6 decimals. Aave's aToken is also 6 — it is a wrapper, not a rebasing share. */
const USDC_DECIMALS = 6;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    // ERC-4626: an aToken that will not name its underlying is not something to
    // read a balance from. This is the assertion that makes a mismatched env
    // value a loud failure instead of a wrong number on a screen.
    type: 'function',
    name: 'UNDERLYING_ASSET_ADDRESS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

export class AavePairingMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `Aave aToken points at ${actual} but USDC_ADDRESS_MONAD is ${expected}. ` +
        'Reading a balance from this pairing would report the wrong number.',
    );
    this.name = 'AavePairingMismatchError';
  }
}

/**
 * Prove the configured aToken really wraps the configured USDC.
 *
 * Called before any balance from that aToken is trusted. Two env variables that
 * disagree is a configuration mistake; without this check it shows up as a user
 * whose balance is wrong, and nobody connects it to a `.env` line.
 */
export const assertAavePairing = async (env: Env = getEnv()): Promise<void> => {
  const underlying = await getChainClient(env).readContract({
    address: env.AAVE_ATOKEN_ADDRESS_MONAD as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'UNDERLYING_ASSET_ADDRESS',
  });
  if (underlying.toLowerCase() !== (env.USDC_ADDRESS_MONAD as string).toLowerCase()) {
    throw new AavePairingMismatchError(env.USDC_ADDRESS_MONAD, underlying);
  }
};

/** Raw 6-decimal units as a decimal string, without a float in the middle. */
export const unitsToDecimalString = (units: bigint, decimals = USDC_DECIMALS): string => {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, '0');
  return `${whole}.${frac}`;
};

/**
 * What one user holds, read from Monad.
 *
 * `aToken` is the money EARNING. `idleUsdc` is money in the same wallet that is
 * NOT earning yet — the honest number for a UI is the sum, and the honest
 * breakdown is showing that some of it is still idle. A wallet that says
 * "$1,200" when $200 of it is not in the money market is a wallet that
 * overpromises.
 */
export interface YieldPosition {
  /** 6-decimal units of aUSDC. */
  aTokenUnits: bigint;
  /** 6-decimal units of plain USDC in the same wallet. */
  idleUsdcUnits: bigint;
  /** The sum, in decimal string form. */
  total: string;
  aTokenAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}

export const getYieldPosition = async (
  userAddress: `0x${string}`,
  env: Env = getEnv(),
): Promise<YieldPosition> => {
  await assertAavePairing(env);
  const chain = getChainClient(env);

  const [aTokenUnits, idleUsdcUnits] = await Promise.all([
    chain.readContract({
      address: env.AAVE_ATOKEN_ADDRESS_MONAD as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    }),
    chain.readContract({
      address: env.USDC_ADDRESS_MONAD as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    }),
  ]);

  return {
    aTokenUnits,
    idleUsdcUnits,
    total: unitsToDecimalString(aTokenUnits + idleUsdcUnits),
    aTokenAddress: env.AAVE_ATOKEN_ADDRESS_MONAD as `0x${string}`,
    usdcAddress: env.USDC_ADDRESS_MONAD as `0x${string}`,
  };
};
