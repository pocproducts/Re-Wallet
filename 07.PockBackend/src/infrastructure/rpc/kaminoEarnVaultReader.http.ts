/**
 * ADAPTER: the Kamino Earn KVault account, over Solana JSON-RPC.
 *
 * ── What it reads and why nothing more ──────────────────────────────────────
 *
 * The position is the holder's token accounts of the vault's **shares mint**,
 * and those are read by the ordinary SPL balance reader
 * (`solanaBalanceReader.http.ts`, `mintBalance`) — that part is layout-light and
 * exactly verifiable. What is left for this adapter is the one thing an SPL read
 * cannot answer by itself:
 *
 *  1. **which** mint the shares are in, and at which exponent — read out of the
 *     vault account, because assuming the shares mint is the token mint reads a
 *     different account and calls it a position;
 *  2. whether anything is **staked in the farm**, which is invisible in the
 *     wallet by Kamino's own documentation.
 *
 * ── Why one `getMultipleAccounts` and not two ───────────────────────────────
 *
 * `jsonParsed` answers the owning program **and** the raw base64 of the data in
 * a single account record, so the program check and the decode come from the same
 * instant of the chain. Reading the account twice would let the two answers come
 * from different slots, and the one thing this adapter must never do is verify an
 * account and then decode a different version of it.
 *
 * ── Why the farm is asked about the chain and not assumed ───────────────────
 *
 * The farm address is a fact this repository pins, with its provenance recorded
 * next to it. Whether it **exists** is a fact about the chain, and only the chain
 * can say. So the account is asked for, every time:
 *
 *  - `null` — the farm does not exist. Nothing is staked in it: `0n`, a fact.
 *  - an account — a farm is live, and this repository has **no verified layout**
 *    for a user's staked shares inside it. That is `FarmStateUnreadableError`,
 *    and the position becomes *incomplete* rather than quietly smaller.
 *
 * Treating a missing farm as "so it is unstaked" forever would be a reader that
 * starts lying the day Kamino attaches a farm — which is exactly the day nobody
 * would be looking at this file.
 */
import { BalanceReadError } from '../../domain/portfolio/errors';
import { FarmStateUnreadableError, type KaminoEarnVaultReader } from '../../domain/ports/kamino-earn-vault-reader';
import {
  KAMINO_EARN_VAULT_ADDRESS,
  KAMINO_KVAULT_PROGRAM_ID,
  decodeKaminoKVault,
  type KaminoKVaultState,
} from '../../domain/yield/kaminoEarnVault';
import { isSolanaAddress } from '../../domain/send/recipients';

/** The default endpoint, the same one the Solana balances already use. */
export const DEFAULT_SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';

/** One account as `jsonParsed` answers it: the owner, and the data as base64. */
interface ParsedAccount {
  readonly owner?: unknown;
  readonly data?: unknown;
}

/** base64 → bytes, in a runtime with no `Buffer`. */
const base64ToBytes = (encoded: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = encoded.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) / 4);

  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of clean) {
    const digit = alphabet.indexOf(character);
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

export interface HttpKaminoEarnVaultReaderOptions {
  readonly url?: string;
  /** Injected so this adapter is testable without a network. Defaults to `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Overridable so a test can pin a different vault. Defaults to the live one. */
  readonly vaultAddress?: string;
}

export const createHttpKaminoEarnVaultReader = (
  options: HttpKaminoEarnVaultReaderOptions = {},
): KaminoEarnVaultReader => {
  const url = options.url ?? DEFAULT_SOLANA_RPC_URL;
  const send = options.fetchImpl ?? fetch;
  const vaultAddress = options.vaultAddress ?? KAMINO_EARN_VAULT_ADDRESS;

  /** One JSON-RPC call, and the same three failures the other reads separate. */
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (error) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `solana ${method} did not reach the endpoint`, { cause: error });
    }

    if (!response.ok) {
      throw new BalanceReadError('RPC_UNAVAILABLE', `solana ${method} answered HTTP ${response.status}`);
    }

    const text = await response.text();

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `solana ${method} answered with no JSON`, { cause: error });
    }

    const payload = body as { error?: unknown } | null;
    if (payload === null || typeof payload !== 'object') {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `solana ${method} answered with no JSON object`);
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw new BalanceReadError('RPC_REJECTED', `solana ${method} was rejected by the endpoint`);
    }
    return body;
  };

  /**
   * One account record, or `null` when the account does not exist.
   *
   * `null` is a **fact about the chain** and it is the single most important
   * `null` in this file: it is what says "this farm holds nothing", and it is
   * what keeps a missing account from being reported as a failed read.
   */
  const accountOf = async (address: string, label: string): Promise<ParsedAccount | null> => {
    const body = await call('getMultipleAccounts', [[address], { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const value = (body as { result?: { value?: unknown } }).result?.value;

    if (!Array.isArray(value)) {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', `solana ${label} answered without an account list`);
    }
    // A `null` entry in the list *is* "this address has no account".
    if (value.length === 0 || value[0] === null || value[0] === undefined) return null;

    return value[0] as ParsedAccount;
  };

  const dataOf = (account: ParsedAccount): string => {
    // `jsonParsed` answers `{ program, space, data: "<base64>" }` for an account a
    // Token program does not own.
    const data = (account.data as { data?: unknown } | undefined)?.data;
    if (typeof data !== 'string') {
      throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'solana answered an account without its data');
    }
    return data;
  };

  return {
    vault: async (): Promise<KaminoKVaultState> => {
      const account = await accountOf(vaultAddress, 'getMultipleAccounts');

      if (account === null) {
        /*
         * A vault with no account is not a vault with an empty position in it.
         * The pinned address answering nothing is a fact about the chain that
         * invalidates everything downstream, so it is a refusal and not a zero.
         */
        throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'the pinned Kamino Earn vault has no account on chain');
      }

      if (account.owner !== KAMINO_KVAULT_PROGRAM_ID) {
        throw new BalanceReadError('RPC_MALFORMED_RESPONSE', 'the pinned vault is not owned by the KVault program');
      }

      // The layout lives in the domain, with the provenance of every offset.
      return decodeKaminoKVault(vaultAddress, base64ToBytes(dataOf(account)));
    },

    stakedShares: async (farmAddress, owner) => {
      // No farm declared: nothing can be staked in it. A fact, not a failure.
      if (farmAddress === null) return 0n;
      if (!isSolanaAddress(farmAddress) || !isSolanaAddress(owner)) {
        throw new BalanceReadError('RPC_REJECTED', 'the farm and the owner both need to be Solana addresses');
      }

      const account = await accountOf(farmAddress, 'getMultipleAccounts');

      /*
       * The farm account does not exist, so no shares are staked in it. This is
       * the state of this vault today, verified on chain, and it is why a
       * position here is the holder's own token accounts.
       */
      if (account === null) return 0n;

      /*
       * A farm account **exists**, so shares may be staked in it and are
       * invisible in the wallet by Kamino's own documentation. This repository
       * has no verified layout for a user's staked shares inside a Kamino farm,
       * and guessing an offset produces a position that is quietly too small.
       * So it refuses, and the position is reported as incomplete — a smaller
       * number would be a lie, and a zero would be worse than either.
       */
      throw new FarmStateUnreadableError('a farm account exists and its user state could not be decoded', {
        cause: new Error('no verified layout for the staked-share field of a Kamino Earn farm'),
      });
    },
  };
};