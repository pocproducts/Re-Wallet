/**
 * ADAPTER: verify the Privy access token.
 *
 * ── Why the SDK does the verification ─────────────────────────────────────────
 *
 * An earlier version of this (in `06. Backend`) verified the JWT with `jose` by
 * hand and then looked for the user in a claim named `privy_did`. **That claim
 * name was invented.** The real token carries the DID in `sub`, the standard
 * claim. Signature, issuer and audience all passed, and then the code fell over on
 * "no DID of the expected shape" — the least informative error available. Worse,
 * the tests were **green**, because they signed tokens carrying the invented
 * claim: a test that validates one's own invention proves nothing about the
 * provider's format.
 *
 * So verification is delegated to `PrivyClient`, which resolves the app JWKS from
 * `PRIVY_APP_ID` alone and returns the DID under the correct name (`user_id`, read
 * from `sub`).
 *
 * ── Why there is no email here ────────────────────────────────────────────────
 *
 * This adapter used to read an `email` claim out of the verified token with a bare
 * `decodeJwt`, and it never found one: the SDK's own payload reader (`lib/auth.d.ts`)
 * enumerates `aud`, `iss`, `iat`, `exp`, `sid`, `sub` and nothing else. The claim is
 * not undocumented-and-rare, it is absent, so the read was a guess that failed on
 * every login and pushed the caller into its placeholder path.
 *
 * The identity of the caller is the DID, and the DID is the only thing this port
 * returns. The mailbox comes from the provider's user record via `UserDirectory`,
 * after verification has already succeeded.
 *
 * ── Why there is no way through ───────────────────────────────────────────────
 *
 * If verification fails, it **throws**. No fallback, no "if it looks like a DID,
 * let it pass", no development flag. A verifier with an escape hatch is a verifier
 * somebody will open.
 */
import { PrivyClient } from '@privy-io/node';

import type { TokenVerifier, VerifiedIdentity } from '../../domain/ports/token-verifier';

/** `did:privy:...` and nothing else. */
const DID_PATTERN = /^did:privy:[A-Za-z0-9._~-]{1,128}$/;

/**
 * The minimal surface this adapter needs from the Privy client.
 *
 * Declared here instead of importing the whole SDK type so the adapter can be
 * constructed with a stub. The production object satisfies it structurally.
 */
export interface PrivyAuthClient {
  verifyAuthToken(authToken: string): Promise<{ user_id: string }>;
}

export interface PrivyTokenVerifierOptions {
  readonly appId: string;
  readonly appSecret: string;
}

/** The error this adapter throws. The domain never sees it. */
export class PrivyTokenRejected extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Privy token rejected: ${reason}`, options);
    this.name = 'PrivyTokenRejected';
  }
}


export const createPrivyTokenVerifier = (options: PrivyTokenVerifierOptions): TokenVerifier => {
  // Fails closed at construction: a backend that starts without knowing which
  // Privy app it belongs to looks healthy and then rejects everybody.
  if (!options.appId) throw new Error('PRIVY_APP_ID is not defined.');
  if (!options.appSecret) throw new Error('PRIVY_APP_SECRET is not defined.');

  const client = new PrivyClient({ appId: options.appId, appSecret: options.appSecret });
  const auth: PrivyAuthClient = {
    // `PrivyClient` resolves the app JWKS from `appId`; no extra key is needed.
    verifyAuthToken: (authToken: string) => client.utils().auth().verifyAuthToken(authToken),
  };

  return {
    async verify(accessToken: string): Promise<VerifiedIdentity> {
      // Shape check first: a malformed token costs nothing to reject and would
      // otherwise become a network call to Privy for every garbage request.
      if (!accessToken || accessToken.split('.').length !== 3) {
        throw new PrivyTokenRejected('does not look like a JWT');
      }

      let userId: string;
      try {
        const verified = await auth.verifyAuthToken(accessToken);
        // The SDK already validated signature/issuer/audience/expiry and read the
        // DID from `sub` — the claim we did not know about before.
        userId = verified.user_id;
      } catch (error) {
        // The reason goes to the server log and **never to the person**: every
        // rejection ends in the same 401.
        throw new PrivyTokenRejected('signature, issuer, audience or expiry', { cause: error });
      }

      if (!DID_PATTERN.test(userId)) {
        throw new PrivyTokenRejected('token carries no Privy DID of the expected shape');
      }

      return { privyDid: userId };
    },
  };
};