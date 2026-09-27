import type { Env } from '@bestpath/config';
import type { GasConfig } from './config';
import { notImplemented } from '../../lib/errors';
import type { GasResult, UserOp } from './types';

/**
 * Production provider: Pimlico bundler + paymaster, "User pays" in USDC.
 *
 * Not available for user-pays on Monad yet, which is exactly why this is the
 * production target rather than the MVP. Switching to it is GAS_PHASE=production
 * and nothing else: the buildGasConfig() guard already fails the boot if the
 * bundler URL is missing, so a misconfigured switch can never look healthy.
 *
 * PRIVY_PIMLICO: `send` is unimplemented on purpose. Wiring it means a Pimlico
 * API key, a Safe smart account per custodian wallet, and permissionless.js.
 */
export class PimlicoSponsor {
  readonly provider = 'pimlico' as const;

  constructor(
    private readonly env: Env,
    private readonly config: GasConfig,
  ) {}

  isConfigured(env: Env): boolean {
    return Boolean(env.PIMLICO_BUNDLER_URL);
  }

  async send(op: UserOp): Promise<GasResult> {
    void op;
    void this.env;
    void this.config;
    throw notImplemented('El envío patrocinado por Pimlico');
  }
}
