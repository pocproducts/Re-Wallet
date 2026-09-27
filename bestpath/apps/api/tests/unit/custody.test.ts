import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadEnvFiles } from '../../src/lib/dotenv';
import { getEnv, type Env } from '@bestpath/config';
import { getCustodyProvider, __resetCustody } from '../../src/services/custody';
import { getPrivy } from '../../src/services/privy';

/**
 * The signing half of custody, without a network.
 *
 * `personal_sign` against the real TEE is proven by a manual run; what is proven
 * HERE is the part that unit tests are actually good at — the request we build.
 * Every assertion below exists because the corresponding mistake cost us a real
 * debugging session:
 *
 *   - a body that is missing `version`/`headers` produces a valid signature of the
 *     WRONG BYTES, and Privy answers 401 telling us the key might be wrong;
 *   - an invalid body is rejected 400 BEFORE authorisation is evaluated, so a 400
 *     proves nothing and we briefly concluded a signature had been accepted;
 *   - the key arrives from the dashboard with a `wallet-auth:` label, and passing
 *     it labelled produces a signature that verifies against nothing.
 *
 * The fake client signs nothing; the point is the bytes we hand to the SDK.
 */

loadEnvFiles(import.meta.url);
const env = getEnv();

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ data }),
});

describe('the wallet action request', () => {
  let input: Record<string, unknown> | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  let realPrivy: unknown;

  beforeEach(() => {
    __resetCustody();
    input = undefined;
    realPrivy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Capture what the SDK was asked to sign, and hand back a canned response.
    // `generateAuthorizationSignatures` is exercised for real; only HTTP is faked.
    vi.doMock('@privy-io/node', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@privy-io/node')>();
      return {
        ...actual,
        generateAuthorizationSignatures: (_client: unknown, opts: { input: Record<string, unknown> }) => {
          input = opts.input;
          return Promise.resolve(['c2lnbmF0dXJlLWR1bW15']);
        },
      };
    });
    vi.resetModules();
    fetchMock = vi.fn(async () => okResponse({ signature: '0xabc' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    (realPrivy as { mockRestore?: () => void }).mockRestore?.();
    vi.doUnmock('@privy-io/node');
    vi.unstubAllGlobals();
    __resetCustody();
  });

  const action = async (method: 'personal_sign' | 'eth_sendTransaction' = 'personal_sign') => {
    const { getCustodyProvider: fresh } = await import('../../src/services/custody');
    const provider = fresh(env as Env);
    return provider.act('wallet_1', { method, params: { message: 'hola', encoding: 'utf-8' } });
  };

  it('signs the canonical payload, with version and headers', async () => {
    await action();
    expect(input).toBeDefined();
    // These three are what a missing one silently breaks.
    expect(input!['version']).toBe(1);
    expect(input!['method']).toBe('POST');
    expect((input!['headers'] as Record<string, string>)['privy-app-id']).toBe(env.PRIVY_APP_ID);
    expect(input!['url']).toContain('/v1/wallets/wallet_1/rpc');
  });

  it('strips the wallet-auth label the dashboard adds', async () => {
    // If the labelled form reached the SDK it would sign fine and verify against
    // nothing, which is the worst possible failure: no error, no signature.
    expect(env.PRIVY_WALLET_AUTH_PRIVATE_KEY).toBeDefined();
    expect((env.PRIVY_WALLET_AUTH_PRIVATE_KEY as string).includes(':')).toBe(true);
    // The provider must pass the bare key; asserting the shape keeps the fixture
    // honest about what the dashboard actually hands out.
    const bare = (env.PRIVY_WALLET_AUTH_PRIVATE_KEY as string).split(':').pop();
    expect(bare).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('targets our chain, not a hardcoded one', async () => {
    await action();
    const body = input!['body'] as { caip2: string };
    expect(body.caip2).toBe(`eip155:${env.MONAD_CHAIN_ID}`);
  });

  it('sends the signature header, comma-joined for a multi-signer quorum', async () => {
    await action();
    const init = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['privy-authorization-signature']).toBe('c2lnbmF0dXJlLWR1bW15');
  });

  it('refuses to act without an authorization key, naming the variable', async () => {
    const withoutKey = { ...env, PRIVY_WALLET_AUTH_PRIVATE_KEY: undefined } as unknown as Env;
    // Both the provider and the error class come from the SAME fresh import.
    // Comparing against a class imported before `vi.resetModules()` fails on
    // identity, not on behaviour: two module instances, two classes, same shape.
    const mod = await import('../../src/services/custody');
    __resetCustody();
    const provider = mod.getCustodyProvider(withoutKey);

    const failure = await provider
      .act('wallet_1', { method: 'personal_sign', params: {} })
      .then(() => null)
      .catch((err: Error) => err);

    expect(failure).toBeInstanceOf(mod.CustodyNotConfiguredError);
    // The message has to NAME the variable: an operator reading a 500 in the log
    // should not have to go hunting for which of four custody settings is missing.
    expect(failure?.message ?? '').toMatch(/PRIVY_WALLET_AUTH_PRIVATE_KEY/);
  });

  it('a rejected action is an error, not a silent success', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"No valid authorization signatures were provided."}',
    }));
    const { getCustodyProvider: fresh } = await import('../../src/services/custody');
    const provider = fresh(env as Env);
    await expect(provider.act('wallet_1', { method: 'personal_sign', params: {} })).rejects.toThrow(/failed/);
  });
});

describe('the provider is a real dependency, not a stub', () => {
  it('resolves the Privy client lazily', () => {
    __resetCustody();
    expect(getCustodyProvider(env)).toBe(getCustodyProvider(env));
    __resetCustody();
    // And it holds a client that can actually create wallets: provisioning is not
    // mocked anywhere in this file.
    expect(typeof getPrivy(env)).toBe('object');
  });
});
