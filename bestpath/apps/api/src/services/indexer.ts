/**
 * TODO(feature: indexer)
 * Deposit indexer.

Responsibilities: watch the deposit address for incoming USDC, wait for
confirmation depth, credit wallets.balance, write a deposit movement, and
survive reorgs without double-crediting. Every credit must be idempotent —
this process is the one that creates money out of nothing.
 */
export const TODO_INDEXER = true;
