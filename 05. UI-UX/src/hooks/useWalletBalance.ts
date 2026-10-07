/**
 * The whole wallet balance of this person, read **once per session**.
 *
 * ── Why a hook and not a `fetch` in the screen ───────────────────────────────
 *
 * `GET /api/wallet-balance` is a composition of two chain reads — the free
 * wallets and the pool position — plus the price feeds, so asking it from every
 * screen would be extra trips to the chain per navigation. The hook cuts the
 * repetition with the same pattern as `usePortfolio`, `usePool` and
 * `useDigitalDollars`: **the identity of the session**, not the data.
 *
 * It also replaces `useDigitalDollars` as the source of the headline. That route
 * spans both buckets and is neither of them, so a screen that uses it shows a
 * figure that is not the wallet balance. The route stays mounted in the backend
 * for whoever needs the digital-dollar-only question; this app no longer calls it.
 *
 * ── When it reads again ──────────────────────────────────────────────────────
 *
 * - When the session opens: once.
 * - When `enabled` turns `false`, the one-shot latch is released and the reading
 *   is dropped, so the next session reads again instead of showing the previous
 *   person's balance.
 * - By hand, with `reload()`: what a "refresh" button would call, and what runs
 *   after a signed deposit.
 *
 * ── What this hook does NOT do ──────────────────────────────────────────────
 *
 * It adds nothing. No bucket is summed here, no price is applied here, and an
 * unreadable piece never becomes a zero. It also does not **hide** a partial
 * total: it exposes it with `complete === false` and with the sentence that
 * names what is missing, because a hook that swallowed that sentence would be
 * the exact place the lie comes back in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  readRewalletWalletBalance,
  type WalletBalanceView,
  type WalletBalanceYieldView,
} from '../services/walletBalance';
import { ApiError } from '../services/api';

export type WalletBalanceStatus =
  /** Nothing was asked for yet. */
  | 'idle'
  /** The read is in flight. */
  | 'loading'
  /** A response arrived. It may be partial: that is information, not failure. */
  | 'ready'
  /** The whole read failed: there is no figure to show. */
  | 'error';

export interface WalletBalanceScreenView {
  readonly status: WalletBalanceStatus;
  /** The backend's code, or `null`. The sentence belongs to the service. */
  readonly failureCode: string | null;
  /** The normalized reading, or `null` while nothing arrived. */
  readonly balance: WalletBalanceView | null;
  /** The headline, exactly as the backend composed it. `null` if unread. */
  readonly total: string | null;
  /** `false` when a piece is missing: the headline is only part of the truth. */
  readonly complete: boolean;
  /** The sentence for a partial headline, or `null` when it is whole. */
  readonly note: string | null;
  /**
   * The **combined** annual figure of every yield venue, as the service read it:
   * the exact ratio, the per-venue rows and the sentence when it is incomplete.
   *
   * Published whole, not summarized. `rate` is `null` exactly when the reads
   * were not whole, and `incompletenessNote` is the only sentence this hook ever
   * shows about the yield: a partial weighted mean is not published anywhere
   * between the backend and the screen, so there is nothing for a card to fall
   * back to. `null` when nothing arrived at all — which is a failed read, never
   * a yield of zero.
   */
  readonly yield: WalletBalanceYieldView | null;
  /** Re-reads. Decided by the person or by a signed deposit, never by a render. */
  readonly reload: () => void;
}

/**
 * @param enabled `true` only once the ReWALLET session is open: the cookie is
 *                what proves there is a session, and without it this route is 401.
 */
export const useWalletBalance = (enabled: boolean): WalletBalanceScreenView => {
  const [status, setStatus] = useState<WalletBalanceStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [balance, setBalance] = useState<WalletBalanceView | null>(null);

  /* Without this, a backend failure would retry on its own, forever. */
  const loadedFor = useRef<boolean>(false);

  /*
   * The token of this pass. `activeRun` does not ask whether the hook is still
   * mounted: it asks whether **this** pass belongs to **this** session, so a
   * `reload()` cannot overwrite a read that is still in flight.
   */
  const activeRun = useRef<symbol | null>(null);

  const load = useCallback((): void => {
    const run = Symbol('useWalletBalance:pass');
    activeRun.current = run;

    setStatus('loading');

    void (async () => {
      try {
        const next = await readRewalletWalletBalance();
        if (activeRun.current !== run) return;

        /*
         * A body that cannot be interpreted is **not** a zero: it is a failed
         * read. It is marked as an error so the screen says it could not read the
         * balance, instead of painting `u$0,00` for a corrupted response.
         */
        if (next === null) {
          setBalance(null);
          setFailureCode('MALFORMED_RESPONSE');
          setStatus('error');
          return;
        }

        setBalance(next);
        setFailureCode(null);
        setStatus('ready');
      } catch (error) {
        if (activeRun.current !== run) return;

        setBalance(null);
        setFailureCode(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
        setStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Sign-out: the latch and the reading are released, so the previous
      // person's balance does not stay in memory.
      loadedFor.current = false;
      activeRun.current = null;
      setBalance(null);
      setStatus('idle');
      return;
    }

    if (loadedFor.current) return;
    loadedFor.current = true;

    load();
  }, [enabled, load]);

  return useMemo<WalletBalanceScreenView>(
    () => ({
      status,
      failureCode,
      balance,
      total: balance === null ? null : (balance.total.usd?.formatted ?? null),
      complete: balance !== null && balance.total.complete,
      note: balance === null ? null : balance.total.incompletenessNote,
      // Passed through untouched: no rounding, no sentence, no re-reading of the
      // payload. The only bucket that carries a yield is the invested one.
      yield: balance === null ? null : balance.investedValue.yield,
      reload: load,
    }),
    [status, failureCode, balance, load],
  );
};