/**
 * Custody — ADR-001.
 *
 * WHO OWNS A WALLET, AND WHERE THE KEY LIVES
 *
 * The decision (see `odd/decisions/adr-001-custodia.md`): the backend provisions
 * every wallet, Privy reconstructs the key only inside a TEE, and the wallet's
 * OWNER is a key quorum created in the dashboard — the user's passkey plus our
 * authorization key. `createOnLogin` stays off, so there is no user-side wallet
 * and no key ever reaches a browser.
 *
 * ── The interface is the point ─────────────────────────────────────────────
 *
 * `getWalletForUser` used to throw. Before that it was a function that would have
 * grown whatever Privy happened to return, and migrating custody later would have
 * meant hunting every caller. One interface, one implementation behind it, and
 * moving to a KMS or to ERC-4337 becomes a new implementation of the same three
 * methods instead of a rewrite.
 *
 * ── Why the owner is an ID and not a payload ───────────────────────────────
 *
 * The `wallets.create` call accepts `owner_id`, `owner`, `additional_signers` and
 * `policy_ids`, and the quorum that mixes a user ID with an authorization key is
 * only creatable through the SDK or REST — not from the dashboard. That shape is
 * the one thing in this integration that cannot be verified from the installed
 * types alone, and guessing it is how the register path ended up writing a
 * hardcoded tag that only ever worked once.
 *
 * So the quorum is assembled in the DASHBOARD, and the code only ever passes its
 * id. The unverifiable payload disappears from the critical path, and changing
 * the ownership model becomes a configuration change rather than a release.
 */

import { getEnv, type Env } from '@bestpath/config';
import { generateAuthorizationSignatures, type PrivyClient } from '@privy-io/node';
import { getPrivy } from './privy';

const inputHeaders = (appId: string) => ({ 'privy-app-id': appId });

/**
 * What a provider must be able to do. Deliberately tiny: address and provider
 * id are all the register path needs, and signing gets added when there is
 * something to sign.
 */
/**
 * What `wallets.create` gives back that we care about.
 *
 * Narrow on purpose: this file depends on the capability it uses, not on the
 * SDK's client class. A full SDK type drags hundreds of unrelated declarations
 * into our build for the sake of one method, and it makes a signature change in
 * a dependency look like a change in here.
 */
export interface ProvisionedWallet {
  id: string;
  address: string;
}

/**
 * The one Privy call this provider makes.
 *
 * THE SERVICE IS A THUNK. `client.wallets` is a **getter that returns a factory
 * function**, so the real shape is `client.wallets().create(...)`. The installed
 * types describe `wallets` as the service itself and the generated docs show
 * `client.wallets.create(...)`; both are wrong at runtime, and the failure is
 * `create is not a function` with NO type error to catch it, because the cast
 * below is exactly where the two disagree.
 *
 * Found by introspecting the live client, not by reading types — the same class
 * of mistake as the hardcoded tag, and the reason the call sits behind a narrow
 * interface with a single obvious adaptation point.
 */
export interface PrivyWalletsApi {
  create(params: Record<string, unknown>): Promise<ProvisionedWallet>;
}

export interface CustodyProvider {
  /** A stable name for logs and for the DB, e.g. `privy-tee`. */
  readonly name: string;

  /**
   * Provision (or return) the wallet for a Privy identity.
   *
   * MUST be idempotent. Retrying a registration must never create a second
   * wallet: `wallets.address` is UNIQUE, so the second one turns a retry into a
   * 500 — exactly what the hardcoded tag did. The user's Privy DID is the natural
   * idempotency key, because it is itself unique.
   */
  provisionFor(privyDid: string): Promise<{ address: string; providerWalletId: string }>;

  /**
   * Make the wallet act: sign a message, or send a transaction.
   *
   * Split from `provisionFor` because provisioning and signing fail for entirely
   * different reasons and a wallet that exists but cannot sign is a state worth
   * naming. It exists at all because a wallet with no owner cannot be signed
   * for: the key quorum is the owner.
   */
  act(
    providerWalletId: string,
    action: { method: 'personal_sign' | 'eth_sendTransaction'; params: unknown },
  ): Promise<{ signature?: `0x${string}`; hash?: `0x${string}`; raw?: unknown }>;
}

/**
 * The one place a misconfiguration becomes a readable error.
 *
 * Failing here with "set PRIVY_WALLET_AUTH_PRIVATE_KEY" is worth ten minutes of
 * logging a raw Privy 401 and then guessing which of the four custody variables is
 * missing.
 */
export class CustodyNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Custody is not configured. Missing: ${missing.join(', ')}. ` +
        'Create an authorization key in Privy (Dashboard > Wallet infrastructure), ' +
        'put its private key in .env as PRIVY_WALLET_AUTH_PRIVATE_KEY, and set ' +
        'PRIVY_WALLET_OWNER_ID to the key quorum that should own the wallet.',
    );
    this.name = 'CustodyNotConfiguredError';
  }
}

/** `"a,b"` or `'["a","b"]'` → `['a','b']`. Env is a string; config is a list. */
const parseList = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
      // A malformed list is a configuration error, not something to swallow: it
      // would silently provision wallets with NO policies, which is the
      // difference between "this wallet can only do what we allow" and "this
      // wallet can do anything this key authorises".
      throw new CustodyNotConfiguredError([`PRIVY_WALLET_POLICY_IDS (invalid JSON: ${trimmed.slice(0, 40)})`]);
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
};

/**
 * Wallets created from our server, keys in Privy's TEE.
 *
 * Only the fields verified against the installed SDK's `WalletCreateParams` are
 * set: `chain_type`, `display_name`, `external_id`, `privy-idempotency-key`, and
 * `owner_id` / `policy_ids` when configured. `chain_type: 'ethereum'` is correct for
 * Monad: an EVM address is chain-agnostic, and Monad is not in Privy's default
 * chain list precisely because it has no Privy RPC — the RPC is ours
 * (`MONAD_RPC_URL`).
 */
export class PrivyTeeCustody implements CustodyProvider {
  readonly name = 'privy-tee';

  constructor(
    /**
     * The Privy client, resolved on demand.
     *
     * One dependency for both needs, and that is deliberate: creating a wallet
     * needs `client.wallets().create(...)` and signing needs the client itself
     * for the authorization helper. Injecting both separately would let a test
     * wire one and forget the other, which is the shape of bug where provisioning
     * is tested and signing is never exercised.
     */
    private readonly client: () => { wallets: () => PrivyWalletsApi },
    private readonly env: Env = getEnv(),
  ) {}

  /**
   * Owner and policies are OPTIONAL at provisioning time, on purpose.
   *
   * The SDK's own documented example is `wallets.create({ chain_type })` with no
   * owner, and the app credentials are enough to create one. The owner id and the
   * authorization key only start to MATTER at signing time, so refusing to
   * provision without them would block testing a path that does not need them —
   * and would make it impossible to discover what Privy actually requires.
   *
   * A malformed policy list is still a hard error: it would silently provision
   * wallets with NO policies, and that is the difference between "this wallet can
   * only do what we allow" and "this wallet can do anything this key authorises".
   */
  private requireConfig(): { ownerId?: string; policyIds?: string[] } {
    return {
      ownerId: this.env.PRIVY_WALLET_OWNER_ID || undefined,
      policyIds: parseList(this.env.PRIVY_WALLET_POLICY_IDS),
    };
  }

  /**
   * Ask the wallet to sign or send, authorised by our server key.
   *
   * THE CANONICAL INPUT IS NOT OPTIONAL. Privy recomputes the payload it expects
   * to have been signed: `version: 1`, the method, the url, the body, AND the
   * `privy-app-id` header. A signature produced without `version` and `headers`
   * is a perfectly valid signature of the wrong bytes, and Privy answers 401 with
   * "your signing keys may be incorrect or expired" — which is exactly the wrong
   * thing to tell a developer whose key is fine.
   *
   * Note the order of validation, because it cost us a wrong conclusion: an
   * invalid body is rejected with 400 BEFORE the authorisation is evaluated. A
   * 400 from this endpoint therefore proves nothing about the signature.
   */
  async act(
    providerWalletId: string,
    action: { method: 'personal_sign' | 'eth_sendTransaction'; params: unknown },
  ): Promise<{ signature?: `0x${string}`; hash?: `0x${string}`; raw?: unknown }> {
    const privateKey = this.env.PRIVY_WALLET_AUTH_PRIVATE_KEY;
    if (!privateKey) {
      throw new CustodyNotConfiguredError(['PRIVY_WALLET_AUTH_PRIVATE_KEY']);
    }

    // The dashboard hands out this key with a `wallet-auth:` label; the SDK
    // wants the bare base64 PKCS#8. Passing the labelled form silently produces
    // a signature that verifies against nothing.
    const key = privateKey.includes(':') ? privateKey.split(':').pop()! : privateKey;

    const body = {
      caip2: `eip155:${this.env.MONAD_CHAIN_ID}`,
      chain_type: 'ethereum',
      method: action.method,
      params: action.params,
    };
    const url = `https://api.privy.io/v1/wallets/${providerWalletId}/rpc`;

    const signatures = await generateAuthorizationSignatures(
      this.client() as unknown as PrivyClient,
      {
        authorizationContext: { authorization_private_keys: [key] },
        input: {
          version: 1,
          method: 'POST',
          url,
          body,
          headers: { 'privy-app-id': this.env.PRIVY_APP_ID },
        },
      },
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...inputHeaders(this.env.PRIVY_APP_ID),
        'content-type': 'application/json',
        // Comma-joined when the quorum needs more than one signer. Today it is
        // one, and a 2-of-2 would send two.
        'privy-authorization-signature': signatures.join(','),
        Authorization: `Basic ${Buffer.from(
          `${this.env.PRIVY_APP_ID}:${this.env.PRIVY_APP_SECRET}`,
        ).toString('base64')}`,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      // Privy's message is for the log, not for the user. What matters to the
      // caller is that it did not happen.
      console.warn('[custody] la wallet no pudo ejecutar la acción', response.status, text.slice(0, 300));
      throw new Error(`custody: wallet action failed (${response.status})`);
    }

    const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
    return {
      signature: parsed.data?.['signature'] as `0x${string}` | undefined,
      hash: parsed.data?.['hash'] as `0x${string}` | undefined,
      raw: parsed.data,
    };
  }

  async provisionFor(privyDid: string): Promise<{ address: string; providerWalletId: string }> {    const { ownerId, policyIds } = this.requireConfig();

    let created: ProvisionedWallet;
    try {
      created = await this.client().wallets().create({
        chain_type: 'ethereum',
        ...(ownerId ? { owner_id: ownerId } : {}),
        ...(policyIds ? { policy_ids: policyIds } : {}),
        // Our user id in Privy's own field, so the wallet is traceable back
        // without a local lookup. Sanitised because Privy validates this field
        // against a charset: a DID contains `:` and is rejected with a 400
        // `invalid_string` naming the exact path. Found by calling the API, not by
        // reading types — the field is documented as a plain string.
        external_id: `rewallet-${privyDid.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        display_name: `rewallet:${privyDid.slice(-8)}`,
        // THE IDEMPOTENCY KEY. Without it a retried register creates a second
        // wallet and the UNIQUE address constraint turns the retry into a 500.
        'privy-idempotency-key': privyDid,
      });
    } catch (err) {
      // Privy's own error carries the reason (bad owner id, missing policy,
      // wallet limit); ours adds what the operator has to do about it. The
      // private key never appears here.
      console.warn('[custody] no se pudo provisionar la wallet en Privy', err);
      throw new Error('custody: wallet provisioning failed');
    }

    const address = created?.address;
    const providerWalletId = created?.id;
    if (!address || !providerWalletId) {
      // A response without an address is not a wallet. Registering the user
      // against it would write a dead address into an UNIQUE column and the next
      // user would collide on it.
      throw new Error('custody: Privy returned a wallet without an address');
    }
    return { address, providerWalletId };
  }
}

let provider: CustodyProvider | null = null;

/** Drop the cached provider. Tests only. */
export function __resetCustody(): void {
  provider = null;
}

export function getCustodyProvider(env: Env = getEnv()): CustodyProvider {
  if (!provider) {
    provider = new PrivyTeeCustody(
      // The whole adaptation between the SDK's real shape and what this file
      // uses. `client.wallets` is a getter returning a FACTORY, so it has to be
      // called: `client.wallets.create` is what the types and the docs say, and
      // it is not a function at runtime.
      () => getPrivy(env) as unknown as { wallets: () => PrivyWalletsApi },
      env,
    );
  }
  return provider;
}
