import { BP } from './core/bp';

/* ---- config ---- */
export const config = BP.config = {
  version: '0.6',
  storageKey: 'rewallet_state_v1',
  currency: 'USD',
  locale: 'en-US',
  minAmount: 1,
  defaultAmount: 100,
  processingMinMs: 3200,
  processingMaxMs: 5200,
  sendMinMs: 2400,
  sendMaxMs: 3800,
  annualYieldRate: 0.042,
  maxContacts: 20,

  /**
   * DEV ONLY: wipe the persisted state on every boot, so `pnpm dev` always
   * starts the first-run flow from scratch instead of restoring the last
   * session. This exists so the onboarding can be tested from zero without
   * opening devtools to clear localStorage.
   *
   * Hard-wired to false for production builds regardless of this value — see
   * shouldResetOnBoot.
   */
  resetOnBoot: true
};

/**
 * Never wipe in a production build. Guarded here rather than at the call site
 * so there is exactly one place to audit.
 */
export const shouldResetOnBoot = (): boolean => {
  if (import.meta.env.PROD) return false;
  return BP.config.resetOnBoot === true;
};

