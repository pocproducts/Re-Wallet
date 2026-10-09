/**
 * KAMINO EARN (KVaults) on **Solana mainnet**: one vault, its layout, and the
 * exact scale of what Kamino publishes about it.
 *
 * ── The trust split this file exists to state ────────────────────────────────
 *
 * **How much** is ours and verifiable. The vault's `sharesMint` is an ordinary
 * SPL mint, so "how many shares does this person hold" is one `bigint` read out
 * of that mint's token accounts with standard JSON-RPC — no SDK, no indexer, no
 * provider in the middle. The vault's own account is decoded here, field by
 * field, from bytes the chain handed us.
 *
 * **What it is worth** is Kamino's and is *not* verifiable by us. The share
 * price is `netAUM / sharesIssued`, and ~99.5 % of this vault's assets sit in
 * klend cTokens rather than in the vault's own token account — so anything
 * derived from that account alone is wrong by roughly 200×. On top of that,
 * Kamino's own documentation says an off-chain figure computed from reserve
 * state that can lag "can only over-estimate". So the price is **asked for**,
 * through an injected port, and is never reimplemented here. That is the whole
 * reason the reader is split in two.
 *
 * ── The trap this reader is built around ─────────────────────────────────────
 *
 * > "If the vault has a farm attached, shares are automatically staked in the
 * > farm and **are not visible in the user's wallet**." — Kamino Earn docs
 *
 * A reader that looked in the wallet would report an empty position while the
 * money was earning, and it would do so **silently**. So the shares are read
 * from the vault's shares mint — the one account that exists whether the shares
 * sit in the wallet or in the farm — and the farm is read **as well**, and a
 * farm we cannot read makes the position *incomplete*, never smaller.
 *
 * ── What was verified on chain, and how ──────────────────────────────────────
 *
 * Every offset below was checked against the live account on
 * `api.mainnet-beta.solana.com`, not remembered and not guessed:
 *
 * | fact | value | how it was confirmed |
 * |---|---|---|
 * | owner | `KvauGMsp…FLjd` (the KVault program) | `getAccountInfo.owner` |
 * | size | 62 552 bytes | `getAccountInfo` |
 * | discriminator | `e4c452a562d2eb98` | the first 8 bytes of the account |
 * | `tokenMint` @ 80 | `EPjFWdd5…TDt1v` (Solana USDC, 6 decimals) | bytes 80–112 base58-encode to that mint; decimals at 112 read 6 |
 * | `sharesMint` @ 184 | `7D8C5pDF…5usHS` (6 decimals) | bytes 184–216, **and** the account at that address is an SPL mint owned by the Token Program with `decimals == 6` |
 * | `sharesIssued` @ 232 | matches the vault's own published figure | little-endian `u64` |
 * | farm `9FVjHqdu…VRzj` | **no account on chain** | `getMultipleAccounts` → `null` |
 *
 * The shares mint is **not** assumed to be the token mint: it is read out of the
 * account at the offset above, and the two are different mints here.
 *
 * ── Why the layout is decoded rather than trusted ───────────────────────────
 *
 * A struct read one byte off produces a value that looks like a value. The
 * decoder below therefore refuses anything it cannot account for — wrong
 * discriminator, wrong length, a pubkey that is not 32 bytes, a decimals field
 * that is not a sane exponent — and a refusal is `VAULT_LAYOUT_UNREADABLE`,
 * which is ours to investigate and never a zero.
 *
 * ── Why the price is parsed as text and never as a number ────────────────────
 *
 * Kamino publishes `sharePrice` as a **decimal string** (its OpenAPI type is
 * literally `Decimal = string`), so the scale of the figure is **declared by the
 * digits it is published with** and not by anything this file could guess. The
 * parser takes the digits as they are: the integer is the digits, the exponent is
 * the number of fractional digits, and no `parseFloat` is within reach of it. An
 * exponent form (`1e-7`) is refused rather than interpreted, because the one time
 * this code guessed a scale a position was wrong by a factor of ten million.
 */
import { formatUnits } from '../portfolio/assets';

/** The vault this application reads: Steakhouse USDC on Solana mainnet. */
export const KAMINO_EARN_VAULT_ADDRESS = 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E';

/** The program that owns the vault account. Verified with `getAccountInfo.owner`. */
export const KAMINO_KVAULT_PROGRAM_ID = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd';

/** The account size of a KVault. Verified: `getAccountInfo` answers 62 552 bytes. */
export const KAMINO_KVAULT_ACCOUNT_BYTES = 62552;

/** The Anchor account discriminator. Verified: the first eight bytes of the account. */
export const KAMINO_KVAULT_DISCRIMINATOR = 'e4c452a562d2eb98';

/**
 * The farm this vault declares, with its provenance recorded.
 *
 * **Where the address came from.** Kamino's own public API answers it as
 * `state.vaultFarm` on `GET /kvaults/vaults/{pubkey}` — and it is recorded here
 * as a **pinned constant, not as a decoded field**, for a reason worth stating:
 * the vault account does **not** carry that address anywhere in its 62 552 bytes
 * (checked, all offsets), and the reserved regions of the account hold ~1 900
 * all-zero pubkey slots with nothing on chain that distinguishes one of them as
 * "the farm". So there is no offset this repository can honestly claim for it, and
 * inventing one would be the same kind of guess that produced a 200x wrong
 * position last time.
 *
 * **What is checked on chain, every time.** Whether the farm **exists** is a fact
 * about the chain and only the chain can say, so the address is asked for on every
 * read: `getMultipleAccounts` for `9FVjHqdu…VRzj` answers **`null`** today, so no
 * shares are staked in it and the position is the holder's own token accounts.
 * The day it answers with an account, `stakedShares` refuses instead of assuming —
 * see `KaminoEarnVaultReader.stakedShares`.
 */
export const KAMINO_EARN_VAULT_FARM_ADDRESS = '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj';

/** The deposited asset, read from `tokenMint` at offset 80 and named by Kamino. */
export const KAMINO_EARN_VAULT_TOKEN_SYMBOL = 'USDC';

/**
 * The shares mint's own symbol, from Kamino's
 * `GET /kvaults/mints/{pubkey}/metadata` (`kV-STKUSDC`). It is a label for a
 * screen, never an input to any arithmetic.
 */
export const KAMINO_EARN_SHARES_SYMBOL = 'kV-STKUSDC';

/**
 * Byte offsets of the fields this reader uses.
 *
 * These are constants, not a comment, because `test/domain/kaminoEarnVault.test.ts`
 * asserts the account this file was written against decodes through them — and a
 * layout change that nobody noticed then fails there rather than producing a
 * plausible number on a balance screen.
 */
export const KVAULT_FIELD_OFFSET = {
  vaultAuthority: 8,
  baseVaultAuthority: 40,
  tokenMint: 80,
  tokenMintDecimals: 112,
  tokenVault: 120,
  tokenProgram: 152,
  sharesMint: 184,
  sharesMintDecimals: 216,
  tokenAvailable: 224,
  sharesIssued: 232,
} as const;

/** A public key is 32 bytes. Anything else in a pubkey slot is not a pubkey. */
const PUBKEY_BYTES = 32;

/**
 * The widest exponent a decimals field may carry.
 *
 * A mint with 37 decimals does not exist, and a misaligned read that lands on
 * one is a layout problem. Refusing is cheaper than a value at an invented scale.
 */
const MAX_DECIMALS = 36;

/** The vault account that could not be read. Ours to investigate, never a zero. */
export class KaminoVaultDecodeError extends Error {
  constructor(message: string) {
    super(`Kamino Earn vault could not be decoded: ${message}`);
    this.name = 'KaminoVaultDecodeError';
  }
}

/** The head of a KVault account, decoded from bytes the chain returned. */
export interface KaminoKVaultState {
  /** The address that was read. It is the pinned vault; the state is its head. */
  readonly address: string;
  readonly vaultAuthority: string;
  readonly baseVaultAuthority: string;
  readonly tokenMint: string;
  readonly tokenMintDecimals: number;
  readonly tokenVault: string;
  readonly tokenProgram: string;
  /** The mint whose token accounts hold the position. Never assumed = tokenMint. */
  readonly sharesMint: string;
  readonly sharesMintDecimals: number;
  /** What the vault holds idle, in the token mint's base units. */
  readonly tokenAvailable: bigint;
  /** How many shares exist, in the shares mint's base units. */
  readonly sharesIssued: bigint;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * 32 bytes as a base58 address.
 *
 * Written out rather than imported so the decoder in `domain/send/recipients.ts`
 * keeps its own hand-rolled arithmetic: two implementations of base58 in one
 * repository is two places a subtle bug could hide, and a public key that comes
 * back as the wrong address is a balance read for the wrong account.
 */
const encodeBase58 = (bytes: Uint8Array): string => {
  let digits = 0n;
  for (const byte of bytes) digits = digits * 256n + BigInt(byte);

  let encoded = '';
  while (digits > 0n) {
    const rest = digits % 58n;
    digits /= 58n;
    encoded = BASE58[Number(rest)] + encoded;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded.length === 0 ? BASE58[0] as string : encoded;
};

const bytesOf = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
};

/** A little-endian `u64`. Solana's integers are little-endian; nothing else is. */
const u64Of = (account: Uint8Array, offset: number): bigint => {
  if (offset + 8 > account.length) throw new KaminoVaultDecodeError(`a field at ${offset} is out of the account`);
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(account[offset + index] as number);
  return value;
};

const u8Of = (account: Uint8Array, offset: number): number => {
  if (offset >= account.length) throw new KaminoVaultDecodeError(`a field at ${offset} is out of the account`);
  return account[offset] as number;
};

const pubkeyAt = (account: Uint8Array, offset: number): string => {
  if (offset + PUBKEY_BYTES > account.length) {
    throw new KaminoVaultDecodeError(`a pubkey at ${offset} is out of the account`);
  }
  return encodeBase58(account.subarray(offset, offset + PUBKEY_BYTES));
};

/**
 * The decimals of a mint, refused when the exponent is not one a mint has.
 *
 * A decimals field is read as a `u8` and range-checked, which is what a field
 * that lands on the wrong offset looks like: a plausible number that is not a
 * mint's scale.
 */
const decimalsAt = (account: Uint8Array, offset: number): number => {
  const decimals = u8Of(account, offset);
  if (decimals > MAX_DECIMALS) {
    throw new KaminoVaultDecodeError(`a decimals field at ${offset} read ${decimals}, which is not a mint's scale`);
  }
  return decimals;
};

/**
 * Decode the head of a KVault account.
 *
 * Refuses — as `KaminoVaultDecodeError`, never as a zero — when the account is
 * the wrong length or does not carry this program's discriminator. Both of those
 * mean "this is not the account we think it is", and a position read from it
 * would be a number about somebody else's money.
 */
export const decodeKaminoKVault = (address: string, account: Uint8Array): KaminoKVaultState => {
  if (account.length !== KAMINO_KVAULT_ACCOUNT_BYTES) {
    throw new KaminoVaultDecodeError(`the account is ${account.length} bytes, not ${KAMINO_KVAULT_ACCOUNT_BYTES}`);
  }

  const discriminator = bytesOf(KAMINO_KVAULT_DISCRIMINATOR);
  for (let index = 0; index < discriminator.length; index += 1) {
    if (account[index] !== discriminator[index]) {
      throw new KaminoVaultDecodeError('the account does not carry this program\'s discriminator');
    }
  }

  const state: KaminoKVaultState = {
    address,
    vaultAuthority: pubkeyAt(account, KVAULT_FIELD_OFFSET.vaultAuthority),
    baseVaultAuthority: pubkeyAt(account, KVAULT_FIELD_OFFSET.baseVaultAuthority),
    tokenMint: pubkeyAt(account, KVAULT_FIELD_OFFSET.tokenMint),
    tokenMintDecimals: decimalsAt(account, KVAULT_FIELD_OFFSET.tokenMintDecimals),
    tokenVault: pubkeyAt(account, KVAULT_FIELD_OFFSET.tokenVault),
    tokenProgram: pubkeyAt(account, KVAULT_FIELD_OFFSET.tokenProgram),
    sharesMint: pubkeyAt(account, KVAULT_FIELD_OFFSET.sharesMint),
    sharesMintDecimals: decimalsAt(account, KVAULT_FIELD_OFFSET.sharesMintDecimals),
    tokenAvailable: u64Of(account, KVAULT_FIELD_OFFSET.tokenAvailable),
    sharesIssued: u64Of(account, KVAULT_FIELD_OFFSET.sharesIssued),
  };

  return state;
};

/** An exact decimal, as the integer at the scale its own digits declare. */
export interface ExactDecimal {
  readonly raw: bigint;
  readonly decimals: number;
}

/**
 * The exact value of a decimal **string**, or `null` when it is not one.
 *
 * The scale is whatever the published digits say it is: `"1.0617770761260384793"`
 * is the integer `10617770761260384793` at 19 decimals, full stop. Nothing here
 * decides a scale, so nothing here can impose one.
 *
 * Refused: an exponent (`1e-7`), a sign, an empty string, more than
 * `MAX_DECIMALS` fractional digits, and anything that is not a string at all.
 * Each of those is an answer whose scale this code would have to guess, and a
 * position valued at a guessed scale is worse than an unreadable one.
 */
export const parseExactDecimal = (text: unknown): ExactDecimal | null => {
  if (typeof text !== 'string') return null;

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return null;

  const integer = match[1] as string;
  const fraction = match[2] ?? '';
  if (fraction.length > MAX_DECIMALS) return null;

  const digits = `${integer}${fraction}`;
  if (digits.length === 0 || !/^\d+$/.test(digits)) return null;

  return { raw: BigInt(digits), decimals: fraction.length };
};

/**
 * The decimal **text** of an exact decimal, through the same string surgery every
 * amount in this repository uses. Never `Number`, never a division.
 */
export const formatExactDecimal = (value: ExactDecimal): string => formatUnits(value.raw, value.decimals);