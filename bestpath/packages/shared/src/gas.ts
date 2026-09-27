/**
 * Gas abstraction — shared types.
 *
 * The point of this layer is that nothing outside it knows which paymaster is
 * in play. `sendMoney` calls `GasService.sendTransaction()` and never learns
 * whether Privy sponsored it or Pimlico did.
 *
 * The user NEVER sees any of this. No "gas", no "fee", no "network cost",
 * no MON. They see dollars going in, out, or growing.
 */

export type GasPhase = 'mvp' | 'production';
export type SponsorshipMode = 'app_pays' | 'user_pays';
export type GasProvider = 'privy' | 'pimlico';

export const GAS_PHASES: readonly GasPhase[] = ['mvp', 'production'] as const;
export const GAS_PROVIDERS: readonly GasProvider[] = ['privy', 'pimlico'] as const;
export const SPONSORSHIP_MODES: readonly SponsorshipMode[] = ['app_pays', 'user_pays'] as const;

/**
 * A transaction to be sponsored.
 *
 * NOTE ON CUSTODY (decision D1, 2026-09-27): the backend is the custodian.
 * That means the `walletId` here is a BACKEND wallet, not a per-user Privy
 * embedded wallet. Privy's embedded wallet, if enabled at all, is identity —
 * it is not what signs. "App pays" still works exactly as documented: it means
 * the signing wallet never holds MON.
 */
export interface UserOp {
  /** Target contract. */
  to: string;
  /** Calldata. */
  data?: string;
  /** Native value in wei, as a decimal string. Never a float. */
  value?: string;
  /** The backend custodian wallet that signs. */
  walletId: string;
  userId: string;
  /** Required. Replays return the stored result instead of sending again. */
  idempotencyKey: string;
  /** Monad only. Never surfaced to the user. */
  chainId: number;
}

export interface GasResult {
  ok: boolean;
  provider: GasProvider;
  mode: SponsorshipMode;
  txHash?: string;
  userOpHash?: string;
  /** Internal token, never shown to the user. */
  error?: string;
  /** Gas units used, as a string. */
  gasUsed?: string;
  /** Cost in USD. numeric(20,6) in the DB, string on the wire. */
  gasCostUsd?: string;
  /** Stable machine token, safe to log. */
  code?: 'sponsored' | 'replayed' | 'sponsor_unavailable' | 'reverted' | 'invalid';
}

/** Public view of the layer. Safe to expose to a debug endpoint. */
export interface GasStatus {
  phase: GasPhase;
  provider: GasProvider;
  mode: SponsorshipMode;
  chainId: number;
  network: 'testnet' | 'mainnet';
  /** True when the signing wallet never needs to hold MON. */
  gasless: true;
}

/**
 * EIP-7702 note, for whoever touches this file next.
 *
 * On Monad, an EOA delegated via EIP-7702 cannot send a transaction that takes
 * its MON balance below 10 — it reverts unconditionally. That is why every path
 * through this layer is paymaster-sponsored: the signing wallet's MON balance
 * is never touched, so the restriction never applies.
 *
 * If you ever add a path where the user pays gas from their own MON, this stops
 * being true and that path will fail for anyone under 10 MON.
 */
export const EIP7702_MONAD_NOTE =
  'Monad EIP-7702 reverts transactions that would take a delegated EOA below 10 MON. ' +
  'Every provider here is paymaster-backed, so no signing wallet ever holds MON.';

/** The only thing the frontend is ever allowed to see about gas. */
export const GAS_COPY = {
  /** Shown when sponsorship fails. The user must never see a gas error. */
  failure: 'Algo no salió como esperábamos. Podés reintentar.',
} as const;
