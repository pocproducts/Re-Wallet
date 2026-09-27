import { z } from 'zod';
import { MONAD_CHAIN_IDS } from '@bestpath/shared/constants';

/**
 * Environment schema.
 *
 * Parsed once at startup. The process must REFUSE to boot on invalid config
 * rather than falling back to defaults: a wallet backend that silently starts
 * with the wrong chain id or a missing signing key is a wallet backend that
 * moves money in the wrong place.
 */

const hex = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`), `expected ${bytes * 2} hex characters`);

const evmAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'expected a 20-byte EVM address');

const httpUrl = z.string().url().startsWith('http', 'expected an http(s) URL');

/**
 * An optional URL coming from a .env file is usually either a real value or an
 * empty string. Treat the empty string as "not provided" so an unused optional
 * variable does not block startup.
 */
const optionalHttpUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  httpUrl.optional(),
);

/**
 * Same rule as `optionalHttpUrl`, for a plain string.
 *
 * `z.string().optional()` alone is a trap in a .env file: dotenv puts a variable
 * that is present but blank into the environment as `''`, so `OWNER_ID=` is
 * "present" to zod and any `.min(1)` rejects the WHOLE config at boot. The
 * operator left a placeholder line empty, and the API refuses to start with an
 * error about a variable they never meant to set.
 *
 * Blank and absent have to mean the same thing here — "not configured yet", which
 * is a runtime question with a runtime answer.
 */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ── Auth ──
    PRIVY_APP_ID: z.string().min(1, 'PRIVY_APP_ID is required'),
    PRIVY_APP_SECRET: z.string().min(1, 'PRIVY_APP_SECRET is required'),
    /**
     * JWKS endpoint from Dashboard > App settings > Basics.
     *
     * Verification is LOCAL: `verifyAccessToken` checks the ES256 JWT against
     * these keys with no call to Privy. Faster, and a Privy outage cannot lock
     * users out.
     *
     * A JWKS URL rather than a single key on purpose: Privy rotates signing
     * keys, and a remote key set picks up the rotation without a redeploy. A
     * hardcoded key silently breaks the day Privy rotates.
     */
    PRIVY_VERIFICATION_JWKS: httpUrl,

    /**
     * ── Custody (ADR-001) ──
     *
     * The backend's Privy wallet: created from OUR server, keys reconstructed
     * only inside the TEE. `createOnLogin` stays OFF, so there is no user-side
     * wallet and no key ever reaches a browser.
     *
     * ALL OPTIONAL ON PURPOSE. Missing custody configuration must not stop the
     * API from booting or the test suite from running — it fails at the moment a
     * wallet is actually provisioned, with a message that says what to do. The
     * alternative (required at boot) turns a partial dev setup into a dead server
     * and a test suite that cannot run.
     *
     * The private key is a base64 PKCS#8 P-256 key created in Dashboard >
     * Wallet infrastructure. It signs requests to the Privy API on behalf of the
     * wallet, so it is as sensitive as the funds: it belongs in `.env` and
     * nowhere else, never in a commit and never in a chat.
     */
    PRIVY_WALLET_AUTH_PRIVATE_KEY: optionalString,
    /** The authorization key's id, for logs and for matching the private key. */
    PRIVY_WALLET_AUTH_KEY_ID: optionalString,
    /**
     * The wallet OWNER, by id: a key quorum created in the dashboard.
     *
     * Configuration rather than code on purpose. The 2-of-2 shape (user passkey +
     * our authorization key) is assembled in the dashboard, and the API only ever
     * sees an id. That keeps an unverifiable payload shape out of the codebase
     * and makes the ownership model a config change instead of a release.
     */
    PRIVY_WALLET_OWNER_ID: optionalString,
    /** Policy ids applied to wallets we create, as a JSON array or comma list. */
    PRIVY_WALLET_POLICY_IDS: optionalString,

    // ── Chain ──
    MONAD_CHAIN_ID: z.coerce
      .number()
      .int()
      .refine((id) => id === MONAD_CHAIN_IDS.mainnet || id === MONAD_CHAIN_IDS.testnet, {
        message: `MONAD_CHAIN_ID must be ${MONAD_CHAIN_IDS.mainnet} (mainnet) or ${MONAD_CHAIN_IDS.testnet} (testnet)`,
      }),
    MONAD_RPC_URL: httpUrl,
    MONAD_EXPLORER_URL: httpUrl,

    // ── Gas layer ──
    // Which paymaster is live. Changing this is the whole MVP -> production
    // migration: no code change, just this value.
    GAS_PHASE: z.enum(['mvp', 'production'] as const).default('mvp'),
    GAS_TESTNET_MODE: z
      .string()
      .default('true')
      .transform((v) => v !== 'false'),

    // ── Account abstraction ──
    // Only required when GAS_PHASE=production; buildGasConfig() enforces that
    // rather than making a testnet-only deployment carry dead config.
    PIMLICO_API_KEY: z.string().min(1).optional(),
    PIMLICO_BUNDLER_URL: optionalHttpUrl,
    PIMLICO_PAYMASTER_URL: optionalHttpUrl,

    // ── Yield ──
    USDC_ADDRESS_MONAD: evmAddress,
    AAVE_POOL_ADDRESS_MONAD: evmAddress,
    AAVE_ATOKEN_ADDRESS_MONAD: evmAddress,

    // ── Session ──
    SESSION_SECRET: hex(32),
    COOKIE_DOMAIN: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().optional(),
    ),
    COOKIE_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    // ── Webhooks ──
    WEBHOOK_SECRET_PRIVY: z.string().min(1, 'WEBHOOK_SECRET_PRIVY is required'),
    WEBHOOK_SECRET_PIMLICO: z.string().min(1, 'WEBHOOK_SECRET_PIMLICO is required'),

    // ── Rate limiting ──
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

    // ── Logging ──
    LOG_LEVEL: z.enum(['info', 'debug', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.GAS_PHASE === 'production' && !env.PIMLICO_BUNDLER_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PIMLICO_BUNDLER_URL'],
        message: 'GAS_PHASE=production requires PIMLICO_BUNDLER_URL',
      });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function invalid(error: z.ZodError): Error {
  const detail = error.issues
    .map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return new Error(`Invalid environment configuration:\n${detail}`);
}

export function getEnv(source?: NodeJS.ProcessEnv): Env {
  // Only the no-argument form (the real process environment) is cached. Passing
  // an explicit source must always re-validate, otherwise a caller silently gets
  // a cached result for a config it never checked.
  if (source === undefined) {
    if (cached) return cached;
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) throw invalid(parsed.error);
    cached = parsed.data;
    return cached;
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw invalid(parsed.error);
  return parsed.data;
}

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
export const isTest = (env: Env): boolean => env.NODE_ENV === 'test';
