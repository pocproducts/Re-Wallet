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
import { claimWalletsFor } from './application/wallet-claim/claimWalletsFor';
import { createDatabase, readEnv } from './infrastructure/db/client';
import { createPostgresUserStore } from './infrastructure/db/userStore.pg';
import { createPostgresWalletStore } from './infrastructure/db/walletStore.pg';
import { createPrivyTokenVerifier } from './infrastructure/privy/privyTokenVerifier';
import { createPrivyUserDirectory } from './infrastructure/privy/privyUserDirectory';
import { createPrivyWalletOwnershipVerifier } from './infrastructure/privy/privyWalletOwnershipVerifier';
import { createJsonRpcEvmBalanceReader, DEFAULT_EVM_ENDPOINTS } from './infrastructure/rpc/jsonRpcEvmBalanceReader';
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
   * Optional: the endpoints the balance reads use. They have defaults that were
   * verified by hand, so a missing variable is **not** a startup failure here —
   * unlike a missing Privy app id or database URL. A public endpoint is a
   * deployment detail, not an identity, and failing closed on it would make the
   * whole Worker refuse to boot for a route that has a working default.
   */
  readonly monadRpcUrl: string;
  readonly ethereumRpcUrl: string;
  readonly solanaRpcUrl: string;
}

/** The one place that knows which environment variables exist. */
export const readConfig = (env: Record<string, unknown> = process.env as Record<string, unknown>): Config => {
  const required = {
    privyAppId: readEnv(env, 'PRIVY_APP_ID'),
    privyAppSecret: readEnv(env, 'PRIVY_APP_SECRET'),
    databaseUrl: readEnv(env, 'DATABASE_URL'),
    sessionSecret: readEnv(env, 'SESSION_SECRET'),
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(', ')}.`);
  }

  return {
    ...required,
    monadRpcUrl: readEnv(env, 'MONAD_RPC_URL') || DEFAULT_EVM_ENDPOINTS.monad,
    ethereumRpcUrl: readEnv(env, 'ETHEREUM_RPC_URL') || DEFAULT_EVM_ENDPOINTS.ethereum,
    solanaRpcUrl: readEnv(env, 'SOLANA_RPC_URL') || DEFAULT_SOLANA_RPC_URL,
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
  const sessions = createJwtSessionCodec({ secret: config.sessionSecret });

  /*
   * The balance readers. Both URLs are overridable so the deployment can point at
   * a provider of its own — a public RPC rate-limits, and a rate limit must show
   * up as a per-chain error rather than as a Worker that cannot boot.
   */
  const evm = createJsonRpcEvmBalanceReader({
    endpoints: { monad: config.monadRpcUrl, ethereum: config.ethereumRpcUrl },
  });
  const solana = createHttpSolanaBalanceReader({ url: config.solanaRpcUrl });

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
    log,
  });
};