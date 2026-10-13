/**
 * The networks the portfolio reads, and which address serves each.
 *
 * ── Why this file exists at all ───────────────────────────────────────────────
 *
 * Two facts used to live in three places: the wallet rows the database accepts,
 * and the RPC endpoints the adapters call. Reading a balance needs a third
 * thing the other two do not say: that **one EVM address answers on every EVM
 * network**. That is a product fact (Privy's embedded wallets are chain-agnostic
 * EVM accounts), it is load-bearing, and it is written down here once.
 *
 * ── Why Monad is not in `WALLET_CHAIN_ORDER` ──────────────────────────────────
 *
 * Because it is not a *wallet* chain. There is no second EVM wallet to create
 * and no second row to write: the address in the `ethereum` row is the address
 * that is read on Monad. Adding `'monad'` to the provisioning order would mean
 * inventing a wallet the person does not have, and the `address UNIQUE`
 * constraint on `rewallet.wallets` would refuse the write anyway.
 */
import type { WalletChain } from '../wallet/chains';

/** The EVM networks the portfolio reads, by the wallet row that serves them. */
export const EVM_NETWORKS = ['monad', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon'] as const;

export type EvmNetwork = (typeof EVM_NETWORKS)[number];

/** Every chain the portfolio reports on, in the order it reports them. */
export const PORTFOLIO_CHAINS = ['monad', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana'] as const;

export type PortfolioChain = (typeof PORTFOLIO_CHAINS)[number];

/**
 * The wallet row that serves a portfolio chain.
 *
 * This is the whole "one EVM address, several networks" rule, as data. Every
 * EVM chain maps to `ethereum`, because all of them are read with the same
 * address out of the same single row.
 */
export const WALLET_CHAIN_FOR: Readonly<Record<PortfolioChain, WalletChain>> = {
  monad: 'ethereum',
  ethereum: 'ethereum',
  base: 'ethereum',
  arbitrum: 'ethereum',
  optimism: 'ethereum',
  polygon: 'ethereum',
  solana: 'solana',
};