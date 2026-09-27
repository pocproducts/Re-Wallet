/**
 * Shared domain and API types.
 *
 * This package is the contract between `apps/web`, `apps/api` and `packages/sdk`.
 * It is promoted from the frontend's `src/types.ts`, so the shapes here are the
 * ones the verified UI already uses.
 */

// ─── Domain ────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  /** @ana, or an email/phone. Lowercase. */
  tag: string;
  initials: string;
  /** hex colour, e.g. #5B4DFF */
  color: string;
}

export type MovementType = 'deposit' | 'send' | 'receive' | 'yield';
export type MovementStatus = 'pending' | 'completed' | 'failed';

export interface Movement {
  id: string;
  type: MovementType;
  /** Always positive; direction is carried by `type`. */
  amount: string;
  title: string;
  status: MovementStatus;
  createdAt: string;
  meta: Record<string, unknown>;
}

export interface User {
  id: string;
  name: string;
  /** @ana, lowercase, unique. */
  tag: string;
  recoveryEmail: string | null;
  recoveryPhone: string | null;
  avatarColor: string | null;
}

export interface Wallet {
  address: string;
  /** USDC, 6 decimals, serialised as a string to preserve precision. */
  balance: string;
  currency: 'USD';
  yieldStartedAt: string | null;
}

/**
 * Custody model: the backend is the custodian (decision D1, 2026-09-27).
 * `balance` is an internal ledger balance, not an on-chain balance.
 */
export interface YieldSummary {
  /** Current rate as basis points, e.g. 565 = 5.65%. */
  rateBps: number;
  earned: string;
  projected: string;
  currency: 'USD';
}

export interface YieldAccrual {
  date: string;
  amount: string;
  apyBps: number;
}

export type PaymentRequestStatus = 'pending' | 'paid' | 'expired';

export interface PaymentRequest {
  id: string;
  amount: string;
  status: PaymentRequestStatus;
  createdAt: string;
  expiresAt: string;
}

export * from './tag';
export * from './gas';

// ─── API envelope ──────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
  message: string;
  code: number;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type Result<T, E = ApiFailure> = { ok: true; value: T } | { ok: false; error: E };

// ─── Route payloads ────────────────────────────────────────────────────────

export interface SessionPayload {
  user: User;
  wallet: Wallet;
}

export interface DepositIntent {
  /** EVM address to fund, or an onramp URL. */
  address?: string;
  onrampUrl?: string;
}

export interface SendResult {
  movement: Movement;
  newBalance: string;
}

export interface HealthPayload {
  ok: boolean;
  version: string;
  uptime: number;
}

export interface ReadyPayload {
  db: 'ok' | 'error';
  rpc: 'ok' | 'error' | 'skipped';
  privy: 'ok' | 'error' | 'skipped';
}
