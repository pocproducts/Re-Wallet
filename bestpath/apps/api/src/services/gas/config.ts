import { MONAD_CHAIN_IDS } from '@bestpath/shared/constants';
import type { GasPhase, GasProvider, SponsorshipMode, GasStatus } from './types';
import type { Env } from '@bestpath/config';

/**
 * The layer resolves to exactly one provider at construction time, chosen by
 * GAS_PHASE. Moving from MVP to production is a single env value — no code
 * change, no redeploy of logic, and `getPhase()` reports which one is live so
 * the switch is observable rather than silent.
 */
export interface GasConfig {
  phase: GasPhase;
  provider: GasProvider;
  mode: SponsorshipMode;
  chainId: number;
  network: 'testnet' | 'mainnet';
  bundlerUrl?: string;
}

/** Which provider each phase means. Single source of truth for the switch. */
const BY_PHASE: Record<GasPhase, { provider: GasProvider; mode: SponsorshipMode }> = {
  // Privy sponsors natively on Monad (mainnet and testnet). The signing wallet
  // never holds MON, which is what makes it gasless for the user.
  mvp: { provider: 'privy', mode: 'app_pays' },
  // Pimlico's token paymaster lets the user cover the cost in USDC, so the app
  // stops burning credits. Not yet available for user-pays on Monad, which is
  // why this is the production target and not the MVP.
  production: { provider: 'pimlico', mode: 'user_pays' },
};

export function buildGasConfig(env: Env): GasConfig {
  const phase = env.GAS_PHASE;
  const chosen = BY_PHASE[phase];
  const network = env.MONAD_CHAIN_ID === MONAD_CHAIN_IDS.mainnet ? 'mainnet' : 'testnet';

  // Pimlico needs a bundler. Failing here rather than at the first send means
  // a misconfigured production deploy never looks healthy.
  if (chosen.provider === 'pimlico' && !env.PIMLICO_BUNDLER_URL) {
    throw new Error('GAS_PHASE=production requires PIMLICO_BUNDLER_URL');
  }

  return {
    phase,
    provider: chosen.provider,
    mode: chosen.mode,
    chainId: env.MONAD_CHAIN_ID,
    network,
    ...(env.PIMLICO_BUNDLER_URL ? { bundlerUrl: env.PIMLICO_BUNDLER_URL } : {}),
  };
}

export const toStatus = (c: GasConfig): GasStatus => ({
  phase: c.phase,
  provider: c.provider,
  mode: c.mode,
  chainId: c.chainId,
  network: c.network,
  gasless: true,
});
