/**
 * `POST /api/wallets/claim`, over HTTP, with injected ports only: no network, no
 * database, no Privy.
 *
 * What is asserted here is the shape of the answers, because the shape is the
 * contract the browser codes against: a claim that is not true is a **403**, a
 * token that does not verify is the **same 401** `/api/auth/session` gives, and a
 * provider that cannot answer is a **502** — never a refusal dressed up as an
 * outage, and never the other way round.
 */
import { describe, expect, it } from 'vitest';

import { IdentityUnavailable } from '../../src/application/session/mintSession';
import {
  OwnershipUnavailable,
  WalletClaimRejected,
  type ClaimedWallet,
  type ClaimWalletsFor,
} from '../../src/application/wallet-claim/claimWalletsFor';
import type { TokenVerifier } from '../../src/domain/ports/token-verifier';
import { createApp } from '../../src/interface/http/app';
import { DID, recordingLogger, USER_ID } from '../support/fixtures';

const ACCESS_TOKEN = 'a.b.c';

const EVM_WALLET_ID = 'wallet-ethereum-1';
const SOLANA_WALLET_ID = 'wallet-solana-1';
const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SOLANA_ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

const BODY = {
  accessToken: ACCESS_TOKEN,
  wallets: [
    { chain: 'ethereum', walletId: EVM_WALLET_ID, address: EVM_ADDRESS },
    { chain: 'solana', walletId: SOLANA_WALLET_ID, address: SOLANA_ADDRESS },
  ],
};

const acceptingVerifier = (): TokenVerifier & { readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    verify: async (token: string) => {
      asked.push(token);
      return { privyDid: DID };
    },
  };
};

const recordingClaim = () => {
  const calls: { privyDid: string; claimed: readonly ClaimedWallet[] }[] = [];
  const claim: ClaimWalletsFor = async (input) => {
    calls.push(input);
    return { wallets: [], written: calls.length };
  };
  return { claim, calls };
};

const rejectingClaim = (error: Error): ClaimWalletsFor => async () => {
  throw error;
};

const app = (claim: ClaimWalletsFor, verify: TokenVerifier = acceptingVerifier()) =>
  createApp({
    mint: async () => ({ token: 'rw1', expiresAt: new Date('2030-01-01T00:00:00Z'), userId: USER_ID, privyDid: DID }),
    sessions: { issue: async () => ({ token: 'rw1', expiresAt: new Date() }), read: async () => null },
    verify,
    claim,
    now: () => new Date('2025-01-01T00:00:00Z'),
    log: recordingLogger(),
  });

describe('POST /api/wallets/claim', () => {
  it('verifies the token exactly as the session route does, and passes its DID on', async () => {
    const { claim, calls } = recordingClaim();
    const verify = acceptingVerifier();

    const response = await app(claim, verify).request('/api/wallets/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(204);
    expect(verify.asked).toEqual([ACCESS_TOKEN]);
    expect(calls[0]?.privyDid).toBe(DID);
    expect(calls[0]?.claimed).toEqual(BODY.wallets);
  });

  it('answers 401 for a token that does not verify, and writes nothing', async () => {
    const { claim, calls } = recordingClaim();
    const verify: TokenVerifier = {
      verify: async () => {
        throw new Error('Privy token rejected: signature');
      },
    };

    const response = await app(claim, verify).request('/api/wallets/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED' } });
    expect(calls).toEqual([]);
  });

  it('answers 403 when the claim is not proven, and says why in the log only', async () => {
    const log = recordingLogger();
    const response = await createApp({
      mint: async () => ({ token: 'rw1', expiresAt: new Date('2030-01-01T00:00:00Z'), userId: USER_ID, privyDid: DID }),
      sessions: { issue: async () => ({ token: 'rw1', expiresAt: new Date() }), read: async () => null },
      verify: acceptingVerifier(),
      claim: rejectingClaim(new WalletClaimRejected('the claimed ethereum wallet is not in the Privy record of this user')),
      log,
    }).request('/api/wallets/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'WALLET_CLAIM_REJECTED' } });
    expect(log.lines).toContain('error:POST /wallets/claim refused');
  });

  it('answers 502, not 403, when ownership could not be checked', async () => {
    const response = await app(rejectingClaim(new OwnershipUnavailable('the provider record could not be read'))).request(
      '/api/wallets/claim',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'WALLET_OWNERSHIP_UNAVAILABLE' } });
  });

  it('answers 502 when the identity itself cannot be named', async () => {
    const response = await app(rejectingClaim(new IdentityUnavailable('user has no linked email account'))).request(
      '/api/wallets/claim',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'IDENTITY_UNAVAILABLE' } });
  });

  it('refuses a malformed body with 400 and never reaches the use case', async () => {
    const { claim, calls } = recordingClaim();

    const bodies: unknown[] = [
      {},
      { accessToken: ACCESS_TOKEN },
      { accessToken: ACCESS_TOKEN, wallets: 'nope' },
      { accessToken: ACCESS_TOKEN, wallets: [{ chain: 'ethereum' }] },
      { accessToken: ACCESS_TOKEN, wallets: [{ chain: 'ethereum', walletId: 'w', address: '' }] },
      { accessToken: '', wallets: [] },
    ];

    for (const body of bodies) {
      const response = await app(claim).request('/api/wallets/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }

    expect(calls).toEqual([]);
  });

  it('answers 400 to a body that is not JSON at all', async () => {
    const response = await app(recordingClaim().claim).request('/api/wallets/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
  });

  it('is not mounted at all when the deployment cannot verify ownership', async () => {
    // A route that answered "not configured" would look, from the browser, like a
    // rejection. The honest answer is that the route is not there.
    const response = await createApp({
      mint: async () => ({ token: 'rw1', expiresAt: new Date('2030-01-01T00:00:00Z'), userId: USER_ID, privyDid: DID }),
      sessions: { issue: async () => ({ token: 'rw1', expiresAt: new Date() }), read: async () => null },
    }).request('/api/wallets/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(404);
  });
});
