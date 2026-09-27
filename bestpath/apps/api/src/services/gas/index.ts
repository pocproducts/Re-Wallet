import type { Database } from '../../db/client';
import { gasSponsorships } from '../../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { Env } from '@bestpath/config';
import { buildGasConfig, type GasConfig } from './config';
import type { GasProvider, GasResult, GasStatus, UserOp } from './types';
import { PrivySponsor } from './privy-sponsor';
import { PimlicoSponsor } from './pimlico-sponsor';
import { toStatus } from './config';
import type { Logger } from '../../lib/logger';

/**
 * The single interface everything else calls.
 *
 * `sendMoney` and `addMoney` call `sendTransaction` and never learn which
 * paymaster is in play, or whether it is a testnet or mainnet wallet. That is the
 * whole point: the MVP -> production switch and the testnet -> mainnet switch
 * are both env values, and neither requires touching calling code.
 */

export interface GasSponsor {
  readonly provider: GasProvider;
  send(op: UserOp): Promise<GasResult>;
  /** Used to decide whether this provider can run at all right now. */
  isConfigured(env: Env): boolean;
}

export class GasService {
  private readonly config: GasConfig;
  private readonly sponsor: GasSponsor;
  private readonly log: Logger;
  private readonly db: Database;

  constructor(env: Env, db: Database, log: Logger) {
    this.config = buildGasConfig(env);
    this.db = db;
    this.log = log;

    this.sponsor =
      this.config.provider === 'privy' ? new PrivySponsor(env) : new PimlicoSponsor(env, this.config);

    this.log.info(
      {
        phase: this.config.phase,
        provider: this.config.provider,
        mode: this.config.mode,
        chainId: this.config.chainId,
        network: this.config.network,
      },
      'gas layer ready',
    );
  }

  getPhase(): GasConfig['phase'] {
    return this.config.phase;
  }

  getProvider(): GasConfig['provider'] {
    return this.config.provider;
  }

  getStatus(): GasStatus {
    return toStatus(this.config);
  }

  /**
   * Send, exactly once per idempotency key.
   *
   * The replay check happens BEFORE anything is signed. A client that times out
   * and retries must never produce a second transaction, and the unique index
   * on gas_sponsorships.idempotency_key is the final backstop if two requests
   * race past the check at the same time.
   */
  async sendTransaction(op: UserOp): Promise<GasResult> {
    const replay = await this.findReplay(op.idempotencyKey);
    if (replay) {
      this.log.info(
        { idem: op.idempotencyKey, txHash: replay.txHash },
        'gas: replayed, not resent',
      );
      return { ...replay, code: 'replayed' };
    }

    const result = await this.sponsor.send(op);
    await this.record(op, result);
    return result;
  }

  private async findReplay(idempotencyKey: string): Promise<GasResult | null> {
    const [row] = await this.db
      .select({
        provider: gasSponsorships.provider,
        mode: gasSponsorships.mode,
        txHash: gasSponsorships.txHash,
        userOpHash: gasSponsorships.userOpHash,
        sponsoredAmount: gasSponsorships.sponsoredAmount,
        error: gasSponsorships.error,
        status: gasSponsorships.status,
      })
      .from(gasSponsorships)
      .where(eq(gasSponsorships.idempotencyKey, idempotencyKey))
      .limit(1);

    if (!row) return null;
    // A row still in flight is not a result to replay.
    if (row.status === 'pending') return null;

    return {
      ok: row.status === 'confirmed',
      provider: row.provider as GasResult['provider'],
      mode: row.mode as GasResult['mode'],
      ...(row.txHash ? { txHash: row.txHash } : {}),
      ...(row.userOpHash ? { userOpHash: row.userOpHash } : {}),
      ...(row.sponsoredAmount ? { gasCostUsd: row.sponsoredAmount } : {}),
      ...(row.error ? { error: row.error } : {}),
      code: row.status === 'failed' ? 'reverted' : 'sponsored',
    };
  }

  private async record(op: UserOp, result: GasResult): Promise<void> {
    const values = {
      userId: op.userId,
      provider: result.provider,
      mode: result.mode,
      txHash: result.txHash ?? null,
      userOpHash: result.userOpHash ?? null,
      sponsoredAmount: result.gasCostUsd ?? null,
      status: result.ok ? ('confirmed' as const) : ('failed' as const),
      error: result.error ?? null,
      idempotencyKey: op.idempotencyKey,
    };

    try {
      await this.db.insert(gasSponsorships).values(values);
    } catch (err) {
      // A unique violation here means a concurrent request with the same key
      // won the race. That is the idempotency guarantee working, not a failure.
      if (isUniqueViolation(err)) {
        this.log.warn({ idem: op.idempotencyKey }, 'gas: concurrent send with same key, ignoring');
        return;
      }
      throw err;
    }

    this.log.info(
      {
        userId: op.userId,
        provider: result.provider,
        mode: result.mode,
        txHash: result.txHash,
        gasCostUsd: result.gasCostUsd,
        ok: result.ok,
      },
      'gas: transaction recorded',
    );
  }
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

export { buildGasConfig } from './config';
export type { GasConfig } from './config';
export * from './types';
