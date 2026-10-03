/**
 * `POST /api/wallets/claim` — the other half of the ownership fix.
 *
 * ── The contract, in one body ─────────────────────────────────────────────────
 *
 * ```json
 * { "accessToken": "<privy access token>",
 *   "wallets": [ { "chain": "ethereum", "walletId": "…", "address": "0x…" },
 *                { "chain": "solana",   "walletId": "…", "address": "…" } ] }
 * ```
 *
 * The browser created those wallets — Privy gives client-side creations a **user**
 * owner — and this route is what turns "the browser says so" into "the wallets
 * this person owns are on file". The browser's claim is not believed: every id is
 * checked against the provider's own record for the DID the access token proved.
 *
 * ── Why the token is verified here and not from the cookie ─────────────────────
 *
 * The contract carries an `accessToken`, and it is verified **exactly** as
 * `POST /api/auth/session` does — same port, same failure, same 401. That is not
 * redundant with the session cookie: the cookie proves a session exists, and the
 * claim proves who the caller is right now. The DID that comes out of the token
 * is the only key the ownership check accepts, so a claim can never be made on
 * behalf of anybody else.
 *
 * ── Why the three failures answer differently ─────────────────────────────────
 *
 * - `401 UNAUTHENTICATED`  the token does not verify. The person's problem, and
 *   the same answer `/api/auth/session` gives, for the same reason.
 * - `403 WALLET_CLAIM_REJECTED` we are sure who you are, and the claim is not
 *   true: a wallet id that is not in your Privy record, an address that is not the
 *   one Privy reports, an unknown chain, two wallets for one chain. Rejecting is
 *   the whole design — a partial write would be worse than none.
 * - `502 …` we believe you and we could not finish: the identity could not be
 *   read, or the provider record could not be consulted. Telling somebody to log
 *   in again would be a lie about the cause, because it would fail identically.
 *
 * The reason for every one of them is in the log; the person gets the code.
 */
import { Hono } from 'hono';

import type { ClaimedWallet, ClaimWalletsFor } from '../../../application/wallet-claim/claimWalletsFor';
import {
  OwnershipUnavailable,
  WalletClaimRejected,
} from '../../../application/wallet-claim/claimWalletsFor';
import { IdentityUnavailable } from '../../../application/session/mintSession';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { TokenVerifier } from '../../../domain/ports/token-verifier';

export const WALLET_CLAIM_REJECTED_BODY = { error: { code: 'WALLET_CLAIM_REJECTED' } } as const;
export const WALLET_OWNERSHIP_UNAVAILABLE_BODY = { error: { code: 'WALLET_OWNERSHIP_UNAVAILABLE' } } as const;
export const UNAUTHENTICATED_BODY = { error: { code: 'UNAUTHENTICATED' } } as const;
export const IDENTITY_UNAVAILABLE_BODY = { error: { code: 'IDENTITY_UNAVAILABLE' } } as const;

export interface WalletsDeps {
  readonly verify: TokenVerifier;
  readonly claim: ClaimWalletsFor;
  readonly log?: Logger;
}

/** Reads one claim entry. Returns `null` for anything that is not well formed. */
const readClaim = (raw: unknown): ClaimedWallet | null => {
  if (raw === null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const chain = entry['chain'];
  const walletId = entry['walletId'];
  const address = entry['address'];

  if (typeof chain !== 'string' || chain.length === 0) return null;
  if (typeof walletId !== 'string' || walletId.length === 0) return null;
  if (typeof address !== 'string' || address.length === 0) return null;

  return { chain, walletId, address };
};

export const createWalletsRoutes = (deps: WalletsDeps) => {
  const app = new Hono();
  const log = deps.log ?? noopLogger;

  app.post('/claim', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
    }

    const parsed = body as Record<string, unknown> | null;
    const accessToken = parsed?.['accessToken'];
    const rawWallets = parsed?.['wallets'];

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
    }
    if (!Array.isArray(rawWallets)) {
      return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
    }

    /*
     * Malformed entries are refused here rather than forwarded: the use case owns
     * what a *claim* means, and this owns what the transport can carry.
     */
    const claimed: ClaimedWallet[] = [];
    for (const raw of rawWallets) {
      const entry = readClaim(raw);
      if (entry === null) return c.json({ error: { code: 'BAD_REQUEST' } }, 400);
      claimed.push(entry);
    }

    // 1. Who is calling. Identical verification to `POST /api/auth/session`.
    let privyDid: string;
    try {
      const identity = await deps.verify.verify(accessToken);
      privyDid = identity.privyDid;
    } catch (error) {
      log.error('POST /wallets/claim rejected', error);
      return c.json(UNAUTHENTICATED_BODY, 401);
    }

    // 2+3. Verify every claim against Privy, then write in chain order.
    try {
      const result = await deps.claim({ privyDid, claimed });
      // 204: the person learns it worked and nothing else. No ids, no addresses.
      log.log('wallets.claim_accepted', { count: result.wallets.length, written: result.written });
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof WalletClaimRejected) {
        log.error('POST /wallets/claim refused', error);
        return c.json(WALLET_CLAIM_REJECTED_BODY, 403);
      }

      if (error instanceof OwnershipUnavailable) {
        log.error('POST /wallets/claim could not verify ownership', error);
        return c.json(WALLET_OWNERSHIP_UNAVAILABLE_BODY, 502);
      }

      if (error instanceof IdentityUnavailable) {
        log.error('POST /wallets/claim could not resolve an identity', error);
        return c.json(IDENTITY_UNAVAILABLE_BODY, 502);
      }

      // Anything else is ours, and it is not the person's answer to guess at.
      throw error;
    }
  });

  return app;
};
