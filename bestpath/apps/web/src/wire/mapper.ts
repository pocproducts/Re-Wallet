import type {
  AppState,
  Contact,
  Movement,
  MovementStatus,
  MovementType,
  User,
  Wallet,
} from '../types';

/**
 * API ⇄ store mapping.
 *
 * WHY THIS FILE EXISTS
 *
 * The UI and the backend do not speak the same language, and never will:
 *
 *   store.balance            number  ←→  numeric(20,6) STRING
 *   store.movements[].at     epoch ms ←→  createdAt ISO string
 *   store.movements[].amount number, NEGATIVE ←→  ALWAYS POSITIVE
 *   store.hasReceivedFunds   boolean ←→  firstFundsAt timestamptz
 *   store.userName           string  ←→  user{firstName,lastName}
 *   store.bpTag              "@ana" ←→  tag + tagNormalized
 *
 * The movement one is the dangerous case. The UI decides incoming vs outgoing
 * by the SIGN of the number (`m.amount >= 0 ? '+' : '−'`), while the database
 * always stores a positive amount and carries direction in `type`. Wire them
 * straight together and every SEND renders as a deposit — and it looks
 * perfect, which is the worst way for it to be wrong.
 *
 * Everything in this file is a pure function. That is the point: the UI can be
 * rewritten, the backend can change, and as long as both sides hold their
 * contract the store keeps its shape and the 121 UI tests keep passing.
 */

// ─── API → store ────────────────────────────────────────────────────────────

export interface ApiUser {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  tag: string;
  email: string | null;
  phone: string | null;
}

export interface ApiWallet {
  id: string;
  address: string;
  /** numeric(20,6) as a string. */
  balance: string;
  currency: string;
  firstFundsAt: string | null;
  yieldStartedAt: string | null;
}

export interface ApiMovement {
  id: string;
  type: MovementType;
  /** Always positive, per the DB contract. */
  amount: string;
  title: string;
  status: MovementStatus;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface ApiContact {
  id: string;
  name: string;
  tag: string;
  color: string | null;
  initials: string | null;
}

export interface ApiSession {
  user: ApiUser;
  wallet: ApiWallet;
}

export const toUser = (u: ApiUser): User => ({
  firstName: u.firstName,
  lastName: u.lastName,
  name: u.name,
  tag: u.tag,
});

/** A first credit latches and never resets, even if the balance later hits 0. */
export const toHasReceivedFunds = (w: ApiWallet): boolean => w.firstFundsAt !== null;

export const toBalance = (w: ApiWallet): number => Number(w.balance);

/** null until the user has held an Aave position at least once. */
export const toTimestamp = (iso: string | null): number =>
  iso === null ? 0 : new Date(iso).getTime();

/**
 * null until the user has held an Aave position at least once.
 *
 * Deliberately NOT toTimestamp(): that one answers 0 for null because the
 * store's plain epoch fields treat 0 as "unset". `yieldStartedAt` is typed
 * `number | null` so "never held a position" stays distinguishable from the
 * epoch — a 0 here would render as a position that started in 1970.
 */
export const toYieldStartedAt = (w: ApiWallet): number | null =>
  w.yieldStartedAt === null ? null : new Date(w.yieldStartedAt).getTime();

/**
 * The one that matters. `type` carries the direction, so the sign the UI reads
 * has to be reconstructed here and nowhere else.
 */
export const toMovement = (m: ApiMovement): Movement => ({
  id: m.id,
  type: m.type,
  title: m.title,
  amount: OUTFLOW_TYPES.has(m.type) ? -Math.abs(Number(m.amount)) : Math.abs(Number(m.amount)),
  at: new Date(m.createdAt).getTime(),
  status: m.status,
  meta: m.meta ?? {},
});

/** Sending money out. `yield` is an inflow even though it is not a deposit. */
const OUTFLOW_TYPES: ReadonlySet<string> = new Set(['send']);

export const toContact = (c: ApiContact): Contact => ({
  id: c.id,
  name: c.name,
  tag: c.tag,
  initials: c.initials ?? '',
  color: c.color ?? '#3D8BFF',
});

// ─── store → API ────────────────────────────────────────────────────────────

export interface ProfilePatch {
  firstName: string;
  lastName: string;
}

export const toProfilePatch = (s: AppState): ProfilePatch => ({
  firstName: s.firstName,
  lastName: s.lastName,
});

/**
 * Money leaves the UI as a string, never a float, even though the store holds a
 * number. The wire format and the display format are different concerns and
 * this is where they are kept apart.
 */
export const toAmountString = (n: number): string => n.toFixed(6);

// ─── session / auth ─────────────────────────────────────────────────────────

/** Fields the backend owns. The store must not persist these. */
export const SESSION_OWNED_FIELDS = ['session'] as const;

/**
 * Strip backend-owned fields before the store is written to localStorage.
 *
 * The session is a httpOnly cookie: the frontend literally cannot read it, so
 * persisting a `session: true` flag would be persisting a claim the browser
 * cannot back. On reload, the store comes back "logged out" and `GET
 * /auth/session` decides the truth.
 */
export function stripSessionOwned<T extends Partial<AppState>>(state: T): T {
  const copy = { ...state };
  for (const field of SESSION_OWNED_FIELDS) {
    delete (copy as Record<string, unknown>)[field];
  }
  return copy;
}

/** True when the store is consistent with a live server session. */
export const isHydrated = (state: AppState): boolean => state.userName.length > 0;
