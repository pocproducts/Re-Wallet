/**
 * Domain types for the ReWallet wallet state.
 *
 * The render layer (screens, ui, router) is intentionally left loosely typed:
 * it is string-template markup and typing it buys nothing for the wiring phase.
 * What matters is that the DATA MODEL is exact, because src/core/api.ts is the
 * seam the next phase replaces and these are the shapes it must satisfy.
 */

export interface Contact {
  id: string;
  name: string;
  tag: string;
  initials: string;
  color: string;
}

/**
 * Mirrors the DB contract. `receive` and `meta` were missing here and exist in
 * Postgres — the store is a projection of the contract, so the types have to
 * agree with it or the mapper has nowhere to land the fields.
 */
export type MovementType = 'deposit' | 'send' | 'receive' | 'yield';
export type MovementStatus = 'pending' | 'completed' | 'failed';

export interface Movement {
  id: string;
  type: MovementType;
  title: string;
  /** Signed: negative is an outflow. The DB stores positive and carries the
   *  direction in `type` — the mapper reconstructs the sign, nowhere else. */
  amount: number;
  at: number;
  status: MovementStatus;
  meta: Record<string, unknown>;
}

export interface Recipient {
  kind: 'contact' | 'address';
  id?: string;
  name?: string;
  tag?: string;
  address?: string;
  chain?: 'eth' | 'solana';
}

export interface AppSettings {
  biometricEnabled: boolean;
  notificationsEnabled: boolean;
}

/**
 * What the chain says the wallet holds.
 *
 * `earning` and `available` are separate because they are different things: the
 * first is deposited in Aave and paying, the second is in the wallet and not
 * paying. A single number would hide the second, and the user would have no way
 * to know part of their money is idle.
 */
export interface OnChainPosition {
  /** USDC deposited in the Aave market. */
  earning: number;
  /** USDC in the wallet, not earning. */
  available: number;
  /** The sum. What the headline shows. */
  total: number;
  /** When the chain was read, so the UI can say how fresh it is. */
  readAt: number;
}

export interface AppState {
  version: string;
  onboardingComplete: boolean;
  session: boolean;
  userName: string;
  firstName: string;
  lastName: string;
  bpTag: string;
  recoveryEmail: string;
  /** Full number in E.164, e.g. +549112345678. */
  recoveryPhone: string;
  recoveryPhoneCountry: CountryCode;
  balance: number;
  /**
   * The on-chain position, read from Monad. `null` means "we do not know", which
   * is NOT the same as zero: a chain read that failed must never render as an
   * empty account.
   */
  position: OnChainPosition | null;
  /**
   * Whether we have read the chain yet.
   *
   * Three states, and collapsing them is a lie in one direction or the other:
   * `unknown` is the first paint, before any read completes, and showing "we
   * could not verify your balance" there invents a failure that did not happen.
   * `error` is a real failed read. `ok` means the numbers came from Monad.
   */
  positionStatus: 'unknown' | 'ok' | 'error';
  /** Our custody wallet address. Shown to the user: the first thing anyone asks. */
  walletAddress: string;
  /**
   * Set once, the first time funds land. NEVER reset.
   *
   * A state, not a balance: it drives the "Recibir" emphasis for a brand new
   * user. Deriving it from `balance` would re-onboard anyone who spends down to
   * zero. Mirrors wallets.first_funds_at in the schema.
   */
  hasReceivedFunds: boolean;
  movements: Movement[];
  contacts: Contact[];
  settings: AppSettings;
  yieldStartedAt: number | null;
  createdAt: number;
  lastYieldAt: number;
}

/** Presentational user profile derived from AppState. */
export interface User {
  firstName: string;
  lastName: string;
  /** first + last, for display. */
  name: string;
  tag: string;
}

/** ISO 3166-1 alpha-2, used to preselect the phone country picker. */
export type CountryCode = string;

export interface Country {
  code: CountryCode;
  name: string;
  /** International dialling code without the +, e.g. "54" for Argentina. */
  dial: string;
  flag: string;
}

/** Balance projection shown in the UI. */
export interface Wallet {
  balance: number;
  currency: string;
}
