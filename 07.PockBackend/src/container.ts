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
 */
import { PrivyClient } from '@privy-io/node';

import { mintSession } from './application/session/mintSession';
import { provisionWalletsFor } from './application/provision-wallet/provisionWalletsFor';
import { createDatabase, readEnv } from './infrastructure/db/client';
import { createPostgresUserStore } from './infrastructure/db/userStore.pg';
import { createPostgresWalletStore } from './infrastructure/db/walletStore.pg';
import { createPrivyTokenVerifier } from './infrastructure/privy/privyTokenVerifier';
import { createPrivyUserDirectory } from './infrastructure/privy/privyUserDirectory';
import { createPrivyWalletProvisioner } from './infrastructure/privy/privyWalletProvisioner';
import { createJwtSessionCodec } from './infrastructure/session/jwtSessionCodec';
import { createApp } from './interface/http/app';
import type { Logger } from './domain/ports/logger';

export interface Config {
  readonly privyAppId: string;
  readonly privyAppSecret: string;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
}

/** The one place that knows which environment variables exist. */
export const readConfig = (env: Record<string, unknown> = process.env as Record<string, unknown>): Config => {
  const config: Config = {
    privyAppId: readEnv(env, 'PRIVY_APP_ID'),
    privyAppSecret: readEnv(env, 'PRIVY_APP_SECRET'),
    databaseUrl: readEnv(env, 'DATABASE_URL'),
    sessionSecret: readEnv(env, 'SESSION_SECRET'),
  };

  const missing = Object.entries(config)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(', ')}.`);
  }

  return config;
};

export const buildApp = (config: Config, log: Logger) => {
  const db = createDatabase(config.databaseUrl);
  const privy = new PrivyClient({ appId: config.privyAppId, appSecret: config.privyAppSecret });

  const verify = createPrivyTokenVerifier({ appId: config.privyAppId, appSecret: config.privyAppSecret });
  const provisioner = createPrivyWalletProvisioner(privy);
  const directory = createPrivyUserDirectory(privy);
  const walletStore = createPostgresWalletStore(db);
  const sessions = createJwtSessionCodec({ secret: config.sessionSecret });

  return createApp({
    mint: mintSession({
      verify,
      directory,
      users: createPostgresUserStore(db),
      provisionWallets: provisionWalletsFor(provisioner, walletStore),
      sessions,
      log,
    }),
    sessions,
    log,
  });
};