/**
 * What the portfolio shows on each chain, and how a raw integer becomes a number
 * a screen can render without losing a digit.
 *
 * ── Why the decimals live here and not in the screen ──────────────────────────
 *
 * "USDC has six decimals" is a fact about the token, and it is what makes an
 * amount meaningful. If the screen carried it, the backend could return an
 * integer and the screen would guess the exponent — and a wrong exponent is not a
 * wrong picture, it is wrong money. So the response states `decimals` next to the
 * amount, and the screen divides by nothing it had to remember.
 *
 * ── Why the USDC contract is a constant here ─────────────────────────────────
 *
 * USDC has the same address on Monad and on Ethereum mainnet. It is written down
 * once, with the two networks that answer for it, and both are read through the
 * same port. Copying the address into a second place is how a balance of one
 * token gets read from a contract that does not exist on that chain.
 */
import type { PortfolioChain } from './networks';
import type { PortfolioAsset } from '../../application/portfolio/readPortfolio';

/**
 * USDC on Monad mainnet **and** on Ethereum mainnet: one address, two networks.
 *
 * Verified against `balanceOf` on both chains. It is not copied from memory and
 * not from another chain's list — an address that answers on one EVM chain and
 * reverts on another is exactly the failure this codebase already paid for once
 * (see `odd/tasks/datos-reales-monad-aave.md`).
 */
export const USDC_ADDRESS = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';

export interface PortfolioAssetSpec {
  readonly symbol: string;
  readonly decimals: number;
  /** Absent for a native coin: there is no contract to ask. */
  readonly token?: string;
}

/**
 * The assets read per chain, in the order they are read.
 *
 * Native coin first: it is the one the screen shows at the top, and it is the
 * balance that pays gas. The order is display order, not importance.
 */
export const ASSETS_BY_CHAIN: Readonly<Record<PortfolioChain, readonly PortfolioAssetSpec[]>> = {
  monad: [
    { symbol: 'MON', decimals: 18 },
    { symbol: 'USDC', decimals: 6, token: USDC_ADDRESS },
  ],
  ethereum: [
    { symbol: 'ETH', decimals: 18 },
    { symbol: 'USDC', decimals: 6, token: USDC_ADDRESS },
  ],
  solana: [{ symbol: 'SOL', decimals: 9 }],
};

/**
 * The exact decimal string for `raw` in a token with `decimals` decimals.
 *
 * ── Why this is `bigint` arithmetic and not division ─────────────────────────
 *
 * `raw / 10 ** decimals` in JS produces `123.4567890123456789` — a double, rounded
 * at the 17th significant digit and printed without its tail. A balance is the
 * number a transfer is built from; a silently truncated one is a transfer that is
 * off by dust and nobody can see why. So the integer and the fraction are
 * **string surgery**: no arithmetic, no rounding, no possibility of either.
 *
 * Trailing zeros in the fraction are dropped (`1500000` at six decimals is `1.5`,
 * not `1.500000`) because a screen appends its own decimals anyway, and keeping
 * them would only make two representations of one number.
 */
export const formatUnits = (raw: bigint, decimals: number): string => {
  if (decimals < 0) throw new RangeError(`decimals must not be negative: ${decimals}`);
  if (raw < 0n) throw new RangeError('a balance cannot be negative');
  if (decimals === 0) return raw.toString();

  const digits = raw.toString().padStart(decimals + 1, '0');
  const integer = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');

  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
};

/** Builds the response's view of one asset, exact, from what the chain reported. */
export const toAsset = (spec: PortfolioAssetSpec, raw: bigint): PortfolioAsset => ({
  symbol: spec.symbol,
  unit: spec.symbol,
  decimals: spec.decimals,
  raw: raw.toString(),
  amount: formatUnits(raw, spec.decimals),
});