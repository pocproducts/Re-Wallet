import { serve } from '@hono/node-server';
import { getEnv } from '@bestpath/config';
import { createApp } from './app';
import { loadEnvFiles } from './lib/dotenv';
import { createLogger } from './lib/logger';
import { API_VERSION } from '@bestpath/shared/constants';

loadEnvFiles(import.meta.url);

/** Loud, early warning about credentials that were never filled in. */
function warnOnPlaceholderCredentials(env: ReturnType<typeof getEnv>) {
  const placeholders: [string, string][] = [
    ['PRIVY_APP_ID', env.PRIVY_APP_ID],
    ['PRIVY_APP_SECRET', env.PRIVY_APP_SECRET],
    ['PRIVY_VERIFICATION_JWKS', env.PRIVY_VERIFICATION_JWKS],
  ];
  const missing = placeholders
    .filter(([, v]) => v.toUpperCase().includes('PLACEHOLDER') || v.toUpperCase().includes('TEST_'))
    .map(([k]) => k);

  if (missing.length > 0) {
    console.warn(
      `[bestpath] AVISO: ${missing.join(', ')} siguen siendo placeholders.\n` +
        '          El arranque va a funcionar, pero la verificacion de passkey ' +
        'fallara en el primer intento real.\n' +
        '          Dashboard > App settings > Basics > "Verify with key".',
    );
  }
}

function main() {
  // getEnv throws on invalid config. That is deliberate: a wallet backend must
  // never boot half-configured.
  const env = getEnv();
  const log = createLogger(env);
  warnOnPlaceholderCredentials(env);
  const app = createApp(env);

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    log.info(
      { port: info.port, chainId: env.MONAD_CHAIN_ID, nodeEnv: env.NODE_ENV },
      `ReWallet API v${API_VERSION} running`,
    );
  });
}

main();
