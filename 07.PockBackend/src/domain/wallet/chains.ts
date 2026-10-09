/**
 * The chains ReWALLET provisions wallets on, **and the order they are created in**.
 *
 * This file is the rule. It lives in `domain/` because it imports nothing: it is
 * a fact about the product, not about Privy or Postgres. The Privy adapter knows
 * *how* to create a wallet; it knows the order **because this array says so**.
 *
 * ── Why the order is not an accident ──────────────────────────────────────────
 *
 *  1. EVM first. Phase 1 operates on an EVM chain, so the wallet that will be
 *     used has to exist first.
 *  2. The order makes the write verifiable. The database validates the address
 *     against the declared chain: a `solana` row holding a `0x…` address is
 *     rejected. Writing the other way round produces exactly that error, and the
 *     database catching it is better than finding out later with someone else's
 *     money.
 *
 * A `CHECK` constraint cannot express "every Solana holder already had an EVM
 * wallet": that needs to read another table. Its owner is the `provisionWalletsFor`
 * use case, and this array is what tells it how.
 *
 * ── Why the order is the order of this array ──────────────────────────────────
 *
 * Because that is the only way "the order" lives in **one** place. If the order
 * were in the `for` loop and the list here, there would be two truths that can
 * drift apart. Adding a chain is adding one line **to this file**.
 */

/** The two chains of this stage. There is no third. */
export const WALLET_CHAIN_ORDER = ['ethereum', 'solana'] as const;

export type WalletChain = (typeof WALLET_CHAIN_ORDER)[number];

/** Named so the rule can be asserted by name instead of by index. */
export const FIRST_CHAIN: WalletChain = WALLET_CHAIN_ORDER[0];
export const SECOND_CHAIN: WalletChain = WALLET_CHAIN_ORDER[1];