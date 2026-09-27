import { PrivyClient, verifyAccessToken, verifyIdentityToken } from '@privy-io/node';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { getEnv, type Env } from '@bestpath/config';
import { unauthorized } from '../lib/errors';
import { getCustodyProvider } from './custody';

/**
 * Privy server integration.
 *
 * ── Package ──────────────────────────────────────────────────────────────
 * `@privy-io/server-auth` is DEPRECATED ("use @privy-io/node instead"). The gas
 * prompt maestro still names the old package. This uses the current one.
 *
 * ── Token verification is LOCAL, not a network call ───────────────────────
 * `verifyAccessToken` is a standalone function that verifies the ES256 JWT
 * against the verification key from the dashboard. There is no round trip to
 * Privy, which is faster and means a Privy outage cannot lock users out.
 *
 * Three corrections to the prompt maestro, all verified against the installed
 * 0.35.0 types:
 *
 *   1. `new PrivyClient({ appId, appSecret })` — an OPTIONS OBJECT. The prompt
 *      passes them positionally, which does not typecheck and would not work.
 *   2. There is no `privy.verifyAuthToken()` method. `verifyAuthToken` and
 *      `verifyIdentityToken`... `verifyAccessToken` is standalone, and
 *      `verification_key` is REQUIRED. The prompt's call cannot work as written.
 *   3. The passkey hook's `onComplete` receives
 *      `{ user, isNewUser, isNewlyAuthenticated, loginMethod, linkedAccount }`
 *      — there is no `idToken` in it. The token comes from `getAccessToken()`.
 */

let client: PrivyClient | null = null;

/**
 * Remote key set, built once and cached.
 *
 * `createRemoteJWKSet` handles caching and refetching, so a Privy key rotation
 * is picked up without a redeploy. A hardcoded key would break on rotation day
 * and we would not find out until logins failed.
 */
let jwks: JWTVerifyGetKey | null = null;

function verificationKey(env: Env): JWTVerifyGetKey {
  if (!jwks) jwks = createRemoteJWKSet(new URL(env.PRIVY_VERIFICATION_JWKS));
  return jwks;
}

export function getPrivy(env: Env = getEnv()): PrivyClient {
  if (!client) {
    // Options object, NOT positional.
    client = new PrivyClient({
      appId: env.PRIVY_APP_ID,
      appSecret: env.PRIVY_APP_SECRET,
    });
  }
  return client;
}

/** Drop the cached client so a new env can be picked up. Tests only. */
export function __resetPrivy(): void {
  client = null;
  jwks = null;
}

export interface VerifiedPrivyUser {
  /** The Privy DID — our `users.privy_did`, UNIQUE. */
  privyDid: string;
  sessionId: string;
  email?: string;
  expiresAt: number;
}

/**
 * Verify a Privy access token and return who it belongs to.
 *
 * The DID comes straight out of the verified payload, so nothing downstream
 * needs a second lookup just to learn the identity. An unverified token is
 * never an identity: on failure this throws and nothing is created.
 */
export async function verifyIdToken(
  accessToken: string,
  env: Env = getEnv(),
): Promise<VerifiedPrivyUser> {
  if (!accessToken) throw unauthorized('Falta el token de sesión.');

  try {
    const payload = await verifyAccessToken({
      access_token: accessToken,
      app_id: env.PRIVY_APP_ID,
      verification_key: verificationKey(env),
    });

    if (payload.app_id !== env.PRIVY_APP_ID) {
      // A token minted for a different Privy app. Verification passed against our
      // key, so this is a configuration mix-up, not an attack — but it is still
      // not someone we should accept.
      throw new Error('token app_id mismatch');
    }

    return {
      privyDid: payload.user_id,
      sessionId: payload.session_id,
      expiresAt: payload.expiration * 1000,
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'token app_id mismatch') throw err;
    throw unauthorized('Tu sesión no es válida. Volvé a iniciar sesión.');
  }
}

/**
 * Verify an identity token and get the full Privy user.
 *
 * Heavier than verifyIdToken: it decodes the linked-accounts claim and returns
 * the whole user. Only worth calling when we actually need something beyond the
 * DID — and right now we do not, because the email is typed by the user in
 * onboarding rather than taken from Privy.
 *
 * Kept because it is the path for enabling email verification later, without
 * having to rediscover the API.
 */
export async function getUserFromIdentityToken(
  identityToken: string,
  env: Env = getEnv(),
): Promise<{ privyDid: string }> {
  const user = await verifyIdentityToken({
    identity_token: identityToken,
    app_id: env.PRIVY_APP_ID,
    verification_key: verificationKey(env),
  });
  return { privyDid: user.id };
}

/**
 * The backend custodian wallet for a user. Delegates to the custody layer.
 *
 * With custody Option A this is NOT a Privy embedded wallet: the funds live in
 * a wallet the backend provisions, and the embedded wallet stays OFF (it is
 * identity, not custody). The address stored in `wallets.address` comes from
 * here.
 *
 * ADR-001: the wallet is created from OUR server and its owner is a key quorum
 * in Privy's TEE. See `services/custody.ts` for the model and
 * `odd/decisions/adr-001-custodia.md` for why it is decided now and not later:
 * changing who owns a wallet is a migration, not a refactor.
 */
export async function getWalletForUser(
  privyDid: string,
  env: Env = getEnv(),
): Promise<{ address: string; walletId: string }> {
  const { address, providerWalletId } = await getCustodyProvider(env).provisionFor(privyDid);
  return { address, walletId: providerWalletId };
}
