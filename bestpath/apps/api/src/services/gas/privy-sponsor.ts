import type { Env } from '@bestpath/config';
import { getPrivy } from '../privy';
import { notImplemented } from '../../lib/errors';
import type { GasResult, UserOp } from './types';

/**
 * MVP provider: Privy Gas Sponsorship, "App pays".
 *
 * Privy runs its own paymaster (powered by Alchemy) on Monad mainnet and
 * testnet, so there is no bundler or paymaster URL to configure — it is enabled
 * in the dashboard and Privy routes the transaction itself.
 *
 * The signing wallet is the BACKEND's (decision D1: backend is the custodian),
 * not a per-user Privy embedded wallet. "App pays" just means that wallet never
 * holds MON.
 *
 * PRIVY_MVP: `send` is intentionally unimplemented until the MVP testnet flow
 * is burned down end to end. It throws a real AppError rather than a bare Error
 * so callers get the same error envelope, and the user-facing copy never
 * mentions gas.
 */
export class PrivySponsor {
  readonly provider = 'privy' as const;

  constructor(private readonly env: Env) {}

  isConfigured(env: Env): boolean {
    return Boolean(env.PRIVY_APP_ID && env.PRIVY_APP_SECRET);
  }

  async send(op: UserOp): Promise<GasResult> {
    void op;
    void getPrivy(this.env);
    void this.env;
    throw notImplemented('El envío patrocinado por Privy');
  }
}
