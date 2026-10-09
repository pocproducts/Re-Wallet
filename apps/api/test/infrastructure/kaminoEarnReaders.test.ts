/**
 * The two Kamino adapters over an injected `fetch`: **no network, no database.**
 *
 * ── What these tests are for ─────────────────────────────────────────────────
 *
 * The vault adapter answers two questions that look alike and are not: *which
 * mint are the shares in* (ours, from bytes) and *is anything staked in the farm*
 * (the chain's, and the documented trap). A missing farm account must read as
 * `0n` — a fact about the chain — and an **existing** farm must refuse, because
 * this repository has no verified layout for the staked shares inside one, and a
 * reader that guessed would report a position smaller than the person holds.
 *
 * The price adapter is the other half of the hybrid: Kamino's own figure, taken
 * exactly as published, with the scale read off the digits — and, on the same
 * document, the vault's **APY**, under the same discipline and with its failures
 * kept separate. Every way either can fail is a name, and none of them is ever a
 * zero.
 */
import { describe, expect, it } from 'vitest';

import { createHttpKaminoEarnVaultReader } from '../../src/infrastructure/rpc/kaminoEarnVaultReader.http';
import { createHttpKaminoSharePriceFeed } from '../../src/infrastructure/rpc/kaminoSharePriceFeed.http';
import { FarmStateUnreadableError } from '../../src/domain/ports/kamino-earn-vault-reader';
import { BalanceReadError } from '../../src/domain/portfolio/errors';
import type { DeadlinePolicy } from '../../src/infrastructure/rpc/httpDeadline';
import { KAMINO_KVAULT_ACCOUNT_BYTES } from '../../src/domain/yield/kaminoEarnVault';

/**
 * The captured head of the live vault account. See
 * `test/domain/kaminoEarnVault.test.ts` for where these bytes came from and what
 * every offset in them says.
 */
const VAULT_PREFIX_BASE64 =
  '5MRSpWLS65h//yQduSi1+i8cFHuT8PxRl6nhEyuyY+hkGDw2zkrnppQ03c0b8R+9jE+83Tn5P/x5' +
  '/tY73yxcUgG/FUWw5XoZ/wAAAAAAAADG+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYQYA' +
  'AAAAAAAAAuZAvIKOEDWVOPY7c1fkxtBmCbAmpmVTP7OoJLV3ZBEG3fbh12Whk9nL4UbO63msHLSF' +
  '7V9bN5E6jPWFfv8AqVxBOOWlKWSgTBd7CJTP6iFV/J/wfMNxWaoCEi3MR0thBgAAAAAAAAAAgnWd' +
  'EgAAAJeTb9BEEAAAzQEAAAAAAAAAAAAAAAAAAPQBAAAAAAAAAAAAAAAAAAB5dsVqAAAAADLqrWuj' +
  'oz/2XcdbaBQBAAB0ltYillH2d2hk1ykBAAAA51fUPAGKUc0icYOJ/FNzJ8uhY+FDeXxO9x/KSnp1' +
  'BONIDgUhyKMejdg++v/5MP5s1rS1xckiyjh+BooHB9txbUF3AwAAAAAA///////////+AAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64ToBytes = (encoded: string): Uint8Array => {
  const clean = encoded.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) / 4);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of clean) {
    const digit = BASE64.indexOf(character);
    if (digit < 0) continue;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
};

const VAULT_ACCOUNT_BASE64 = (() => {
  const account = new Uint8Array(KAMINO_KVAULT_ACCOUNT_BYTES);
  account.set(base64ToBytes(VAULT_PREFIX_BASE64), 0);
  let binary = '';
  for (const byte of account) binary += String.fromCharCode(byte);
  return btoa(binary);
})();

const VAULT_ADDRESS = 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E';
const FARM_ADDRESS = '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj';
const KVAULT_PROGRAM = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd';
const OWNER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

interface RpcCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

/**
 * A JSON-RPC endpoint that answers each address with the account it was given.
 *
 * The data is shaped the way `jsonParsed` really answers it for an account a
 * Token program does not own — `{ program, space, data: "<base64>" }` — so this
 * stub is the real wire shape and not a convenient one.
 */
const rpcStub = (accounts: Record<string, { owner: string; data: string } | null>, calls: RpcCall[] = []) =>
  async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push({ method: request.method, params: request.params });
    const addresses = (Array.isArray(request.params[0]) ? request.params[0] : [request.params[0]]) as string[];
    const value = addresses.map((address) => {
      const account = accounts[address] ?? null;
      if (account === null) return null;
      return {
        owner: account.owner,
        lamports: 437252818,
        executable: false,
        data: { program: 'kamino_kvault', space: KAMINO_KVAULT_ACCOUNT_BYTES, data: account.data },
      };
    });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

describe('the KVault account reader', () => {
  it('decodes the shares mint out of the vault account, and does not assume it', async () => {
    const calls: RpcCall[] = [];
    const reader = createHttpKaminoEarnVaultReader({
      fetchImpl: rpcStub({ [VAULT_ADDRESS]: { owner: KVAULT_PROGRAM, data: VAULT_ACCOUNT_BASE64 } }, calls),
    });

    const vault = await reader.vault();

    expect(vault.tokenMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(vault.sharesMint).toBe('7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS');
    expect(vault.sharesMintDecimals).toBe(6);
    expect(vault.sharesIssued).toBe(17_887_740_793_751n);

    // One call, and it is the account this adapter is about: the owner check and
    // the decode come from the same instant of the chain, not from two reads.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('getMultipleAccounts');
    expect((calls[0]?.params[0] as string[])[0]).toBe(VAULT_ADDRESS);
  });

  it('refuses an account the KVault program does not own, rather than decoding it', async () => {
    const reader = createHttpKaminoEarnVaultReader({
      fetchImpl: rpcStub({
        [VAULT_ADDRESS]: { owner: '11111111111111111111111111111111', data: VAULT_ACCOUNT_BASE64 },
      }),
    });

    await expect(reader.vault()).rejects.toBeInstanceOf(BalanceReadError);
  });

  it('refuses a pinned vault that has no account, and never reports a zero position', async () => {
    const reader = createHttpKaminoEarnVaultReader({ fetchImpl: rpcStub({}) });

    await expect(reader.vault()).rejects.toBeInstanceOf(BalanceReadError);
  });

  it('reports no staked shares when the farm account does not exist on chain', async () => {
    // The state of this vault today, verified on chain: the farm is named and it
    // does not exist, so nothing is staked in it. `0n` is a **fact**.
    const reader = createHttpKaminoEarnVaultReader({ fetchImpl: rpcStub({}) });
    await expect(reader.stakedShares(FARM_ADDRESS, OWNER)).resolves.toBe(0n);
  });

  it('reports no staked shares when the vault declares no farm at all', async () => {
    const reader = createHttpKaminoEarnVaultReader({
      fetchImpl: async () => {
        throw new Error('a vault with no farm must not reach the cluster at all');
      },
    });

    await expect(reader.stakedShares(null, OWNER)).resolves.toBe(0n);
  });

  it('refuses a farm that exists, because its user state cannot be decoded', async () => {
    /*
     * The documented trap: shares staked in a farm "are not visible in the user's
     * wallet". Reading only the wallet here would report a smaller position
     * silently — so a farm that exists refuses, and the caller answers
     * "incomplete" rather than a smaller number.
     */
    const reader = createHttpKaminoEarnVaultReader({
      fetchImpl: rpcStub({ [FARM_ADDRESS]: { owner: KVAULT_PROGRAM, data: 'AAAA' } }),
    });

    await expect(reader.stakedShares(FARM_ADDRESS, OWNER)).rejects.toBeInstanceOf(FarmStateUnreadableError);
  });
});

describe('the APY on the same feed', () => {
  const feedOver = (handler: (url: string) => Response) =>
    createHttpKaminoSharePriceFeed({ fetchImpl: async (url) => handler(String(url)) });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** The live shape of `/stats`, with the APY exactly as Kamino publishes it. */
  const liveStats = {
    token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    sharesIssued: '17887740.793751',
    sharePrice: '1.0617770761260384793',
    apy: { total: '0.041808723945949255', base: { total: '0.033000000000000000' } },
  };

  it('reads the APY out of the same vault statistics, at the scale its digits declare', async () => {
    const asked: string[] = [];
    const feed = feedOver((url) => {
      asked.push(url);
      return json(liveStats);
    });

    const result = await feed.apy(VAULT_ADDRESS);

    expect(asked).toEqual([`https://api.kamino.finance/kvaults/vaults/${VAULT_ADDRESS}/stats`]);
    // Eighteen fractional digits, taken from the answer — not from a constant.
    expect(result).toEqual({
      status: 'ok',
      value: { raw: 41808723945949255n, decimals: 18, text: '0.041808723945949255' },
    });
  });

  it('keeps whatever scale the answer carries, at more than one scale', async () => {
    // The same feed, a rate published with four digits and one published with
    // two. Nothing here may assume a scale, least of all the exponent of a rate.
    const four = await feedOver(() => json({ apy: { total: '0.0418' } })).apy(VAULT_ADDRESS);
    const two = await feedOver(() => json({ apy: { total: '0.05' } })).apy(VAULT_ADDRESS);
    const twenty = await feedOver(() => json({ apy: { total: '0.04180872394594925500' } })).apy(VAULT_ADDRESS);

    expect(four).toEqual({ status: 'ok', value: { raw: 418n, decimals: 4, text: '0.0418' } });
    expect(two).toEqual({ status: 'ok', value: { raw: 5n, decimals: 2, text: '0.05' } });
    expect(twenty).toEqual({
      status: 'ok',
      value: { raw: 4180872394594925500n, decimals: 20, text: '0.04180872394594925500' },
    });
  });

  it('reads only `total`, and never the rewards programs beside it', async () => {
    // `apy.base`, `apy.points` and `apy.farm` are reward programs layered on the
    // vault. Adding them would answer a different question than "what does this
    // vault earn".
    const feed = feedOver(() =>
      json({
        apy: { total: '0.04', base: { total: '0.99' }, points: { total: '0.5' }, farm: { total: '0.7' } },
      }),
    );

    expect(await feed.apy(VAULT_ADDRESS)).toEqual({
      status: 'ok',
      value: { raw: 4n, decimals: 2, text: '0.04' },
    });
  });

  it('never turns an absent, malformed, exponent-form or non-positive APY into a zero', async () => {
    // No `apy` in the answer at all.
    const absent = await feedOver(() => json({ sharePrice: '1.0617' })).apy(VAULT_ADDRESS);
    expect(absent).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });

    // `apy` present, `total` absent.
    const noTotal = await feedOver(() => json({ apy: { base: { total: '0.04' } } })).apy(VAULT_ADDRESS);
    expect(noTotal).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });

    // A number where Kamino's own type is a string: `JSON.parse` would have
    // rounded it before this code ever saw it.
    const numeric = await feedOver(() => json({ apy: { total: 0.0418 } })).apy(VAULT_ADDRESS);
    expect(numeric).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });

    // An exponent, not a decimal: a scale this code would have to guess.
    const exponent = await feedOver(() => json({ apy: { total: '4.18e-2' } })).apy(VAULT_ADDRESS);
    expect(exponent).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });

    // A negative rate, a bare sign and a non-string of every shape.
    const negative = await feedOver(() => json({ apy: { total: '-0.0418' } })).apy(VAULT_ADDRESS);
    expect(negative).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });
    const nonsense = await feedOver(() => json({ apy: { total: 'high' } })).apy(VAULT_ADDRESS);
    expect(nonsense).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });

    // Zero is not an annual yield.
    const zero = await feedOver(() => json({ apy: { total: '0' } })).apy(VAULT_ADDRESS);
    expect(zero).toEqual({ status: 'unreadable', reason: 'APY_NON_POSITIVE' });
    const zeroFractions = await feedOver(() => json({ apy: { total: '0.000000000000000000' } })).apy(VAULT_ADDRESS);
    expect(zeroFractions).toEqual({ status: 'unreadable', reason: 'APY_NON_POSITIVE' });

    // And an outage is an outage, not a yield of nothing.
    const down = await feedOver(() => new Response('<html>502</html>', { status: 502 })).apy(VAULT_ADDRESS);
    expect(down).toEqual({ status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' });
    const notJson = await feedOver(() => new Response('not json', { status: 200 })).apy(VAULT_ADDRESS);
    expect(notJson).toEqual({ status: 'unreadable', reason: 'KAMINO_MALFORMED_RESPONSE' });
  });

  it('leaves the share price alone when the APY is unreadable, and the other way round', async () => {
    /*
     * The two answers are independent on purpose: a rate this code cannot parse
     * must not put a hole in somebody's **balance**.
     */
    const brokenRate = feedOver(() => json({ sharePrice: '1.0617770761260384793', apy: { total: 'nope' } }));
    expect(await brokenRate.apy(VAULT_ADDRESS)).toEqual({
      status: 'unreadable',
      reason: 'KAMINO_MALFORMED_RESPONSE',
    });
    expect(await brokenRate.sharePrice(VAULT_ADDRESS)).toEqual({
      status: 'ok',
      value: { raw: 10617770761260384793n, decimals: 19, usd: '1.0617770761260384793' },
    });

    const brokenPrice = feedOver(() => json({ sharePrice: 'x', apy: { total: '0.0418' } }));
    expect(await brokenPrice.sharePrice(VAULT_ADDRESS)).toEqual({
      status: 'unreadable',
      reason: 'KAMINO_MALFORMED_RESPONSE',
    });
    expect(await brokenPrice.apy(VAULT_ADDRESS)).toEqual({
      status: 'ok',
      value: { raw: 418n, decimals: 4, text: '0.0418' },
    });
  });
});

describe('the share price feed', () => {
  const feedOver = (handler: (url: string) => Response) =>
    createHttpKaminoSharePriceFeed({ fetchImpl: async (url) => handler(String(url)) });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('asks Kamino for the vault statistics, and takes the price it published', async () => {
    const asked: string[] = [];
    const feed = feedOver((url) => {
      asked.push(url);
      return json({
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        sharesIssued: '17887740.793751',
        tokensPerShare: '1.0618782665207387597',
        sharePrice: '1.0617770761260384793',
      });
    });

    const result = await feed.sharePrice(VAULT_ADDRESS);

    expect(asked).toEqual([`https://api.kamino.finance/kvaults/vaults/${VAULT_ADDRESS}/stats`]);
    expect(result).toEqual({
      status: 'ok',
      value: { raw: 10617770761260384793n, decimals: 19, usd: '1.0617770761260384793' },
    });
  });

  it('keeps whatever scale the answer carries, rather than forcing one', async () => {
    const feed = feedOver(() => json({ sharePrice: '1.0625' }));
    const result = await feed.sharePrice(VAULT_ADDRESS);

    // Four decimals today, nineteen tomorrow: the exponent travels with the price
    // and nothing downstream has to assume it.
    expect(result).toEqual({ status: 'ok', value: { raw: 10625n, decimals: 4, usd: '1.0625' } });
  });

  it('never turns an outage, a malformed answer or a price of nothing into a number', async () => {
    // Kamino is down.
    const down = feedOver(() => new Response('<html>502</html>', { status: 502 }));
    await expect(down.sharePrice(VAULT_ADDRESS)).resolves.toEqual({
      status: 'unreadable',
      reason: 'KAMINO_UNAVAILABLE',
    });

    // Kamino answers with something that is not JSON at all.
    const notJson = feedOver(() => new Response('not json', { status: 200 }));
    await expect(notJson.sharePrice(VAULT_ADDRESS)).resolves.toEqual({
      status: 'unreadable',
      reason: 'KAMINO_MALFORMED_RESPONSE',
    });

    // No `sharePrice` in the answer at all.
    const absent = feedOver(() => json({ token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }));
    await expect(absent.sharePrice(VAULT_ADDRESS)).resolves.toEqual({
      status: 'unreadable',
      reason: 'KAMINO_MALFORMED_RESPONSE',
    });

    // A scale this code cannot read exactly: an exponent, not a decimal.
    const exponent = feedOver(() => json({ sharePrice: '1.0617e0' }));
    await expect(exponent.sharePrice(VAULT_ADDRESS)).resolves.toEqual({
      status: 'unreadable',
      reason: 'KAMINO_MALFORMED_RESPONSE',
    });

    // A vault that has never been initialised answers zero, and zero dollars is
    // not the price of anything.
    const zero = feedOver(() => json({ sharePrice: '0' }));
    await expect(zero.sharePrice(VAULT_ADDRESS)).resolves.toEqual({
      status: 'unreadable',
      reason: 'SHARE_PRICE_NON_POSITIVE',
    });

    // And the network itself is down.
    const unreachable = createHttpKaminoSharePriceFeed({
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    await expect(unreachable.sharePrice(VAULT_ADDRESS)).resolves.toEqual({
      status: 'unreadable',
      reason: 'KAMINO_UNAVAILABLE',
    });
  });
});

describe('endpoints that do not answer', () => {
  /**
   * The hung endpoint for both adapters: a `fetch` that only settles when its
   * signal aborts, and a deadline the test expires by hand. No network, and no
   * waiting for wall time — without the bound these reads never settle at all.
   */
  const hungEndpoint = () => {
    let fire: (() => void) | undefined;
    const requests: string[] = [];

    const fetchImpl = ((url: string, init?: RequestInit) => {
      requests.push(String(url));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init?.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
        });
      });
    }) as unknown as typeof fetch;

    const deadline: DeadlinePolicy = {
      timeoutMs: 5_000,
      schedule: (_ms, onDeadline) => {
        fire = onDeadline;
        return () => {
          fire = undefined;
        };
      },
    };

    return {
      fetchImpl,
      deadline,
      requests,
      expire: (): void => fire?.(),
      tick: (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0)),
    };
  };

  it('refuses the vault as RPC_UNAVAILABLE, never as a vault with no account', async () => {
    const hung = hungEndpoint();
    const reader = createHttpKaminoEarnVaultReader({ url: 'https://solana.invalid', fetchImpl: hung.fetchImpl, deadline: hung.deadline });

    const pending = reader.vault();
    await hung.tick();
    hung.expire();

    /*
     * This is the distinction the whole file is built on. A missing account is
     * `RPC_MALFORMED_RESPONSE` — "the address this repository pinned does not
     * exist" — and a hung cluster is `RPC_UNAVAILABLE`. Reporting the second as
     * the first would invalidate the pinned vault permanently, on the strength of
     * a node that simply stopped talking.
     */
    await expect(pending).rejects.toMatchObject({ reason: 'RPC_UNAVAILABLE' });
    expect(hung.requests).toEqual(['https://solana.invalid']);
  });

  it('reports the share price as KAMINO_UNAVAILABLE, never as a malformed price', async () => {
    const hung = hungEndpoint();
    const feed = createHttpKaminoSharePriceFeed({
      baseUrl: 'https://kamino.invalid',
      fetchImpl: hung.fetchImpl,
      deadline: hung.deadline,
    });

    const pending = feed.sharePrice(VAULT_ADDRESS);
    await hung.tick();
    hung.expire();

    // Not `KAMINO_MALFORMED_RESPONSE`, which would send an operator to the decimal
    // parser instead of to the edge that stopped answering; and not a share price
    // of anything.
    await expect(pending).resolves.toEqual({ status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' });
  });

  it('reports the rate as KAMINO_UNAVAILABLE too — the deadline is the GET, not the question', async () => {
    const hung = hungEndpoint();
    const feed = createHttpKaminoSharePriceFeed({
      baseUrl: 'https://kamino.invalid',
      fetchImpl: hung.fetchImpl,
      deadline: hung.deadline,
    });

    const pending = feed.apy(VAULT_ADDRESS);
    await hung.tick();
    hung.expire();

    // The rate's failure never becomes a rate of zero, and never couples the
    // price's answer to its own.
    await expect(pending).resolves.toEqual({ status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' });
  });
});