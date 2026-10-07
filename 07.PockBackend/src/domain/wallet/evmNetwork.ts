/**
 * WHICH EVM NETWORK THE PERSON IS OPERATING ON.
 *
 * ── Why this is not a wallet row ──────────────────────────────────────────────
 *
 * Privy's embedded wallets are chain-agnostic EVM accounts: **one** EVM address
 * serves **every** configured EVM network (Ethereum and Monad today). So the
 * address cannot say which network the person is on — there is only one address
 * and it is valid on both. That is also why `rewallet.wallets` cannot gain a row
 * per network: `address` is `UNIQUE`, a second Monad row with the same address
 * would be refused by the database, and inventing a second wallet the person
 * does not have is worse.
 *
 * The network in use is therefore a **recorded fact on the row**, not a row:
 * one column, `NOT NULL DEFAULT 'eip155:1'`, no constraint changed, no data
 * migration for the rows that already exist.
 *
 * ── Why CAIP-2 and not a bare chain id ────────────────────────────────────────
 *
 * `1` is a number somebody has to look up to know which network it names.
 * `eip155:1` carries its own namespace, so the stored value is self-describing:
 * it says it is an EIP-155 chain and which one, without a lookup table next to
 * it. (CAIP-2 is the chain-agnostic identifier standard; the EVM namespace is
 * `eip155` and the reference is the chain id.)
 *
 * ── Why Ethereum is the default and stays the default ─────────────────────────
 *
 * The owner decided it: Monad is **added** as a supported network, Ethereum is
 * **not replaced**. So the value a row carries until somebody chooses otherwise
 * is `eip155:1`. Anything sent to the wrong chain is unrecoverable for the
 * person, so the safe answer is the one the product has always meant — and the
 * refusal in `toEvmNetworkId` is what keeps an unknown value from becoming a
 * silent fallback to it.
 *
 * ── What this is not ─────────────────────────────────────────────────────────
 *
 * Not a *wallet* chain. `WALLET_CHAIN_ORDER` (`./chains.ts`) stays two entries
 * long, because there are still only two wallets. This module names the networks
 * an EVM address can be operated on.
 *
 * The portfolio's `EvmNetwork` (`../portfolio/networks.ts`) is a different name
 * on purpose: that one is a chain the portfolio *reads*, this one is the chain
 * the person is *operating on*, stored on a row.
 */
export const ETHEREUM_MAINNET_NETWORK_ID = 'eip155:1';
export const MONAD_MAINNET_NETWORK_ID = 'eip155:143';

/** Every EVM network a person may operate on. Both ids verified on chain. */
export const SUPPORTED_EVM_NETWORK_IDS = [ETHEREUM_MAINNET_NETWORK_ID, MONAD_MAINNET_NETWORK_ID] as const;

export type EvmNetworkId = (typeof SUPPORTED_EVM_NETWORK_IDS)[number];

/** Ethereum mainnet, and the column's `DEFAULT`. See the header on why. */
export const DEFAULT_EVM_NETWORK: EvmNetworkId = ETHEREUM_MAINNET_NETWORK_ID;

/**
 * Reads a stored value as an EVM network id, or `null` when it is not one.
 *
 * `null` and never the default: a row holding something we do not support must
 * be refused by whoever reads it, not quietly read as Ethereum. Defaulting here
 * would send a transaction to a network nobody chose — the exact mistake this
 * column exists to prevent.
 */
export const toEvmNetworkId = (value: unknown): EvmNetworkId | null =>
  typeof value === 'string' && (SUPPORTED_EVM_NETWORK_IDS as readonly string[]).includes(value)
    ? (value as EvmNetworkId)
    : null;

/** The same question, as a yes/no. For guards and conditionals. */
export const isSupportedEvmNetworkId = (value: unknown): value is EvmNetworkId => toEvmNetworkId(value) !== null;