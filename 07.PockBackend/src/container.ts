/**
 * THE CONTAINER.
 *
 * Reads the configuration, builds the adapters, and hands the HTTP layer a
 * fully-wired application. Everything the routes need arrives as an argument:
 * no module reaches for `process.env` on its own, and no route constructs an
 * adapter. That is what makes the entire session flow testable offline.
 *
 * ── Why it fails closed ───────────────────────────────────────────────────────
 *
 * A missing `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `DATABASE_URL` or `SESSION_SECRET`
 * throws here, before the first request. A Worker that boots without knowing which
 * Privy app or which database it belongs to would look healthy and then reject
 * everybody, or write to the wrong place.
 *
 * ── Note what is NOT wired here any more ──────────────────────────────────────
 *
 * There is no wallet creation. This container used to hand `mintSession` a
 * provisioner that asked Privy for a wallet from the server side, and every
 * wallet it made belonged to an app key quorum instead of to the person. What is
 * wired now is the **verification** side: the browser creates the wallet, and
 * `claimWalletsFor` checks the claim against Privy's own record before writing.
 */
import { PrivyClient } from '@privy-io/node';

import { mintSession } from './application/session/mintSession';
import { readPortfolio } from './application/portfolio/readPortfolio';
import { readPool } from './application/pool/readPool';
import { prepareDeposit } from './application/pool/prepareDeposit';
import { readDepositInfo } from './application/deposit-info/readDepositInfo';
import { claimWalletsFor } from './application/wallet-claim/claimWalletsFor';
import { ingestPrivyWebhook } from './application/webhooks/ingestPrivyWebhook';
import { readNotifications } from './application/webhooks/readNotifications';
import { createDatabase, readEnv } from './infrastructure/db/client';
import { createPostgresUserStore } from './infrastructure/db/userStore.pg';
import { createPostgresWalletStore } from './infrastructure/db/walletStore.pg';
import { createPostgresWebhookEventStore } from './infrastructure/db/webhookEventStore.pg';
import { createPrivyTokenVerifier } from './infrastructure/privy/privyTokenVerifier';
import { createPrivyUserDirectory } from './infrastructure/privy/privyUserDirectory';
import { createPrivyWalletOwnershipVerifier } from './infrastructure/privy/privyWalletOwnershipVerifier';
import { createJsonRpcEvmBalanceReader, DEFAULT_EVM_ENDPOINTS } from './infrastructure/rpc/jsonRpcEvmBalanceReader';
import {
  createJsonRpcAavePoolReader,
  DEFAULT_POOL_ENDPOINTS,
} from './infrastructure/rpc/jsonRpcAavePoolReader';
import {
  createHttpSolanaBalanceReader,
  DEFAULT_SOLANA_RPC_URL,
} from './infrastructure/rpc/solanaBalanceReader.http';
import { createJwtSessionCodec } from './infrastructure/session/jwtSessionCodec';
import { createApp } from './interface/http/app';
import type { Logger } from './domain/ports/logger';

export interface Config {
  readonly privyAppId: string;
  readonly privyAppSecret: string;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  /**
   * The Privy webhook signing secret. Required, and it fails closed with the
   * other identities: without it the intake cannot tell a delivery from an
   * anonymous write, and a Worker that accepts both is worse than a Worker with
   * no intake at all.
   */
  readonly privyWebhookSigningSecret: string;
  /**
   * Optional: the endpoints the balance reads use. They have defaults that were
   * verified by hand, so a missing variable is **not** a startup failure here —
   * unlike a missing Privy app id or database URL. A public endpoint is a
   * deployment detail, not an identity, and failing closed on it would make the
   * whole Worker refuse to boot for a route that has a working default.
   */
  readonly monadRpcUrl: string;
  readonly ethereumRpcUrl: string;
  readonly solanaRpcUrl: string;
  /**
   * Optional: the endpoint the **pool** reads go through.
   *
   * Same reasoning as `monadRpcUrl`: a public endpoint is a deployment detail with
   * a verified default, not an identity. Failing closed on it would stop the whole
   * Worker from booting for a route that has a working default.
   */
  readonly monadPoolRpcUrl: string;
}

/** The one place that knows which environment variables exist. */
/** El primer endpoint configurado de una lista, o el nombre de una variable sin valor. */
const firstCandidate = (candidates: readonly string[]): string => candidates[0] ?? '';

export const readConfig = (env: Record<string, unknown> = process.env as Record<string, unknown>): Config => {
  const required = {
    privyAppId: readEnv(env, 'PRIVY_APP_ID'),
    privyAppSecret: readEnv(env, 'PRIVY_APP_SECRET'),
    databaseUrl: readEnv(env, 'DATABASE_URL'),
    sessionSecret: readEnv(env, 'SESSION_SECRET'),
    privyWebhookSigningSecret: readEnv(env, 'PRIVY_WEBHOOK_SIGNING_SECRET'),
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(', ')}.`);
  }

  return {
    ...required,
    monadRpcUrl: readEnv(env, 'MONAD_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.monad),
    ethereumRpcUrl: readEnv(env, 'ETHEREUM_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.ethereum),
    solanaRpcUrl: readEnv(env, 'SOLANA_RPC_URL') || DEFAULT_SOLANA_RPC_URL,
    monadPoolRpcUrl: readEnv(env, 'MONAD_POOL_RPC_URL') || firstCandidate(DEFAULT_POOL_ENDPOINTS),
  };
};

export const buildApp = (config: Config, log: Logger) => {
  const db = createDatabase(config.databaseUrl);
  const privy = new PrivyClient({ appId: config.privyAppId, appSecret: config.privyAppSecret });

  const verify = createPrivyTokenVerifier({ appId: config.privyAppId, appSecret: config.privyAppSecret });
  // The same directory lookup serves both facts: the mailbox for the session, the
  // wallets for the claim. One client, one record, one place that knows Privy's
  // user shape.
  const directory = createPrivyUserDirectory(privy);
  const ownership = createPrivyWalletOwnershipVerifier(privy);
  const walletStore = createPostgresWalletStore(db);
  const webhookEvents = createPostgresWebhookEventStore(db);
  const sessions = createJwtSessionCodec({ secret: config.sessionSecret });

  /*
   * The balance readers. Both URLs are overridable so the deployment can point at
   * a provider of its own — a public RPC rate-limits, and a rate limit must show
   * up as a per-chain error rather than as a Worker that cannot boot.
   */
  const evm = createJsonRpcEvmBalanceReader({
    // Una variable de entorno **agrega** un endpoint ahead of the defaults, no
    // los reemplaza: un override no debería dejar la cadena con una sola URL.
    endpoints: {
      monad: [...(config.monadRpcUrl !== DEFAULT_EVM_ENDPOINTS.monad[0] ? [config.monadRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.monad],
      ethereum: [...(config.ethereumRpcUrl !== DEFAULT_EVM_ENDPOINTS.ethereum[0] ? [config.ethereumRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.ethereum],
    },
  });
  const solana = createHttpSolanaBalanceReader({ url: config.solanaRpcUrl });

  /*
   * The Aave V3 pool on Monad. It reads the same network as the Monad balances but
   * through its own adapter, because `getReserveData` answers with a struct and a
   * `bigint` port would be the wrong shape for it.
   */
  const aavePool = createJsonRpcAavePoolReader({
    endpoints:
      config.monadPoolRpcUrl === DEFAULT_POOL_ENDPOINTS[0]
        ? DEFAULT_POOL_ENDPOINTS
        : [config.monadPoolRpcUrl, ...DEFAULT_POOL_ENDPOINTS],
  });

  return createApp({
    mint: mintSession({
      verify,
      directory,
      users: createPostgresUserStore(db),
      sessions,
      log,
    }),
    verify,
    claim: claimWalletsFor({
      directory,
      users: createPostgresUserStore(db),
      ownership,
      store: walletStore,
      log,
    }),
    sessions,
    // The same wallet store the claim writes through, read through.
    readPortfolio: readPortfolio({ wallets: walletStore, evm, solana, log }),
    /*
     * The pool read and the deposit, over the same store the portfolio reads: one
     * source of addresses, so the position shown on the pool screen belongs to the
     * wallet the portfolio shows and the deposit signs for.
     */
    readPool: readPool({ wallets: walletStore, pool: aavePool, log }),
    prepareDeposit: prepareDeposit({ wallets: walletStore, pool: aavePool, log }),
    /*
     * The deposit catalog and the addresses that go with it, read through the
     * **same** store. One store, una sola fuente de dirección: si esta ruta
     * leyera las carteras por otro lado, la dirección que la pantalla muestra
     * para recibir podría no ser la misma que la que el portfolio lee.
     */
    readDepositInfo: readDepositInfo({ wallets: walletStore, log }),
    // Intake and feed share one store: one write path and one read path over the
    // same rows, so "the feed shows what arrived" is a property of the wiring.
    ingestWebhook: ingestPrivyWebhook({
      store: webhookEvents,
      signingSecret: config.privyWebhookSigningSecret,
      log,
    }),
    readNotifications: readNotifications({ store: webhookEvents, log }),
    log,
  });
};