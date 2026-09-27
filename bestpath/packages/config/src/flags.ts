/**
 * Feature flags. Read from env so a build can be reconfigured without a
 * redeploy, and so it is obvious in review when a behaviour is gated.
 */

export interface FeatureFlags {
  /** Deposit indexer running. */
  indexer: boolean;
  /** Daily yield accrual job. */
  yieldAccrual: boolean;
  /** Public /pay/{id} page. */
  paymentLinks: boolean;
  /** Read the live Aave rate instead of the reference constant. */
  liveAaveRate: boolean;
}

export const flags: FeatureFlags = {
  indexer: process.env['FEATURE_INDEXER'] !== 'false',
  yieldAccrual: process.env['FEATURE_YIELD_ACCRUAL'] !== 'false',
  paymentLinks: process.env['FEATURE_PAYMENT_LINKS'] !== 'false',
  liveAaveRate: process.env['FEATURE_LIVE_AAVE_RATE'] !== 'false',
};
