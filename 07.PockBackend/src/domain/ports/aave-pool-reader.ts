/**
 * PORT: everything the pool screen needs from Aave V3 on Monad, and nothing else.
 *
 * ── Why a port and not a JSON-RPC call in the use case ────────────────────────
 *
 * The interesting decisions here are not the requests, they are the failures: a
 * reserve that could not be read is a state, and a position that could not be
 * read is a *different* state from a position of zero. Those decisions belong to
 * the use case, and the only way to exercise them is to be able to hand it a
 * reader that fails on demand.
 *
 * ── Why the addresses are not arguments ───────────────────────────────────────
 *
 * `AaveV3Monad` is a fact about one deployment, not a parameter of a call. A port
 * whose methods took a pool address would be a port that could be pointed at
 * another contract by whoever wired it, and this code moves real money. The
 * adapter holds the addresses; the use case holds the intent.
 *
 * ── Why amounts are `bigint` all the way ──────────────────────────────────────
 *
 * A USDC balance has six decimals and a rate has twenty-seven. Neither survives a
 * double, and the values that cross this boundary are the values a transaction is
 * built from.
 */
import type { ReserveData } from '../pool/reserveData';

/**
 * What `getReserveConfigurationData` says about the reserve, read on every call.
 *
 * `decimals` is here so the response states the scale the chain reports instead of
 * the scale this code remembers. `reserveFactorBps` is what makes the supply rate
 * checkable against the borrow rate and the utilisation.
 */
export interface ReserveConfiguration {
  readonly decimals: bigint;
  readonly ltv: bigint;
  readonly liquidationThreshold: bigint;
  readonly reserveFactorBps: bigint;
  readonly isActive: boolean;
  readonly isFrozen: boolean;
}

export interface AavePoolReader {
  /** `getReserveData(asset)` on the data provider: the twelve words, decoded. */
  reserveData(): Promise<ReserveData>;

  /** `getReserveConfigurationData(asset)`. */
  reserveConfiguration(): Promise<ReserveConfiguration>;

  /** `balanceOf` of an ERC-20, in its smallest unit. `0n` is a real zero. */
  erc20Balance(token: string, address: string): Promise<bigint>;

  /** `allowance(owner, spender)` of an ERC-20, in its smallest unit. */
  allowance(token: string, owner: string, spender: string): Promise<bigint>;

  /** `eth_getBalance`, in wei. This is what pays for the deposit's gas. */
  nativeBalance(address: string): Promise<bigint>;
}
