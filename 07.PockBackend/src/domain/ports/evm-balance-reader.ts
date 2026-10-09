/**
 * PORT: the balance of an EVM address on an EVM network.
 *
 * ── Why a port and not `fetch` in the use case ────────────────────────────────
 *
 * Reading a balance is `eth_getBalance` plus one `eth_call` of `balanceOf` per
 * token. The interesting part is not the JSON-RPC envelope, it is **what a
 * failure means**, and that decision belongs to the use case, not to the
 * transport. Injecting the reader lets every test exercise Monad and Ethereum
 * with no network at all, which is the only way the failure paths are testable
 * on a day when the RPC is up.
 *
 * ── Why the amounts are `bigint` and not `number` ─────────────────────────────
 *
 * An 18-decimal balance does not survive a double: `123456789012345678901n` is
 * exactly representable as a bigint and not as a JS number. The value the
 * transaction is built from has to be the value the chain reported, so nothing on
 * this port is allowed to lose precision before it reaches the use case.
 *
 * ── Why the network is a name and not a URL ──────────────────────────────────
 *
 * The URL is an infrastructure detail of one adapter. Naming the network here
 * keeps `https://rpc.monad.xyz` in exactly one place, and keeps a test from
 * accidentally depending on it.
 */
import type { EvmNetwork } from '../portfolio/networks';

/**
 * How a read fails is declared in `domain/portfolio/errors.ts` with the error
 * itself, so both readers and the use case agree on one bounded set of names.
 */
export type { BalanceReadFailure } from '../portfolio/errors';

export interface EvmBalanceReader {
  /** The native balance (MON on Monad, ETH on Ethereum) in wei. */
  nativeBalance(network: EvmNetwork, address: string): Promise<bigint>;

  /**
   * The balance of an ERC-20 contract in that token's smallest unit.
   *
   * `network` first because the same token address answers differently on each
   * network: one address, two chains, two answers, and never mixed up.
   */
  erc20Balance(network: EvmNetwork, token: string, address: string): Promise<bigint>;
}

