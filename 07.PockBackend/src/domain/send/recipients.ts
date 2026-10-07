/**
 * A RECIPIENT, validated for the chain it is going to be paid on.
 *
 * ── Why this file is the first gate of a send ────────────────────────────────
 *
 * Everything after this is arithmetic. Before it there is one question — *is this
 * string an address on the chain the person chose* — and every way of answering
 * it wrongly ends the same way: money that leaves an account and arrives
 * nowhere, and the transaction that proves it is **final**. No support ticket
 * undoes it and no refund button exists. So the checks here are deliberately
 * unforgiving, and there is no "close enough" branch anywhere in them.
 *
 * ── Why the alphabet of the chain is the check, and not a length ──────────────
 *
 * An EVM address is `0x` plus forty hex digits. A Solana address is base58 that
 * decodes to exactly 32 bytes. Neither can be mistaken for the other: the
 * alphabets do not overlap (`0`, `O`, `I` and `l` are not base58) and the decoded
 * lengths do not either. That is why an EVM address pasted into a Solana send is
 * **refused** rather than "sent": there is no interpretation under which it is a
 * Solana account, and choosing to try is choosing to lose.
 *
 * ── Why a checksum that fails is a refusal, and not a normalization ──────────
 *
 * EIP-55 says: hash the lowercased address with keccak-256, and uppercase the
 * `i`-th hex digit of the address exactly when bit `i` of that hash is 1. An
 * address written in mixed case is therefore **claiming** that claim.
 *
 * When it does not hold, one character of the address is not the character the
 * sender meant — and on an EVM chain nothing checks that character again. There
 * is no checksum enforced at the protocol level: the address either exists as an
 * account or does not, and if it does not, the transfer is burned. So a mixed
 * case address whose checksum fails is the one input in this file where the
 * honest answer is "I cannot know what you meant", and refusing is the only
 * answer that is not a bet.
 *
 * All-lowercase and all-uppercase addresses are accepted, and they are not an
 * inconsistency: they carry **no checksum information at all**, so there is
 * nothing to verify. Those are exactly the forms a machine writes — which is
 * also why an all-lowercase address pasted by hand deserves the same suspicion as
 * a bad one, and the only available defence there is the checksum the person
 * cannot be expected to have typed.
 */
import type { DepositChain } from '../deposit/catalog';
import { asciiHex, keccak256 } from './keccak256';

/** `0x` followed by exactly forty hexadecimal digits. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The base58 alphabet. Bitcoin's, and therefore Solana's: it is base64 without
 * `0`, `O`, `I` and `l`, because those are the four glyphs a person misreads
 * most often.
 */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A Solana address is a public key: exactly 32 bytes, and nothing else. */
const SOLANA_KEY_BYTES = 32;

/** `0x` plus forty hex digits, and nothing else in the string. */
export const isEvmAddress = (value: unknown): value is string =>
  typeof value === 'string' && EVM_ADDRESS.test(value);

/**
 * Whether the address carries a valid EIP-55 checksum.
 *
 * - An address in **one** case carries no checksum: there is nothing to verify,
 *   and it is accepted.
 * - An address in **mixed** case carries one, and it must hold.
 * - A string that is not an address at all is not a valid checksum either.
 */
export const isEvmChecksumValid = (address: string): boolean => {
  if (!isEvmAddress(address)) return false;

  const bare = address.slice(2);
  const isLower = bare === bare.toLowerCase();
  const isUpper = bare === bare.toUpperCase();
  if (isLower || isUpper) return true;

  /*
   * The hashed text is the lowercased address **as characters, without the
   * `0x`**: the prefix is not part of the key material, and EIP-55 hashes the
   * forty characters rather than the twenty bytes. Hashing either of those
   * differently produces a digest that is a perfectly good hash of something
   * else, and an address that then fails its own valid checksum — which is a
   * worse bug than missing the check, because it refuses payments that would
   * have worked.
   */
  const digest = keccak256(asciiHex(bare.toLowerCase())).slice(2);

  for (let index = 0; index < bare.length; index += 1) {
    const character = bare[index] as string;
    // Only the **letters** carry a checksum bit. Digits are `0`-`9` in every
    // checksum, so there is nothing to compare — and skipping them by comparing
    // against `'a'` would skip every uppercase letter too, which is half of the
    // address this check is about.
    if (!/[a-fA-F]/.test(character)) continue;

    // Bit `index` of the hash, read as the hex digit it is written as.
    const shouldBeUpper = Number.parseInt(digest[index] as string, 16) >= 8;
    const isUpper = character === character.toUpperCase();
    if (shouldBeUpper !== isUpper) return false;
  }
  return true;
};

/**
 * base58 to bytes, or `null` for a character outside the alphabet.
 *
 * Big integers and no lookup shortcuts: an address is 32 bytes, it is decoded
 * once per request, and a decoder that is subtly wrong on some input is a
 * validator that lets a bad address through.
 */
const decodeBase58 = (value: string): Uint8Array | null => {
  if (value.length === 0) return null;

  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }

  // Leading `1`s are leading zero **bytes**, which the integer representation
  // has already dropped.
  const leadingZeros = value.length - value.replace(/^1+/, '').length;
  // `0n` has no digits of its own: a run of leading `1`s and nothing else is a
  // run of zero bytes, and stringifying it as `'0'` would invent a byte.
  let hex = number === 0n ? '' : number.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;

  const decoded = new Uint8Array(hex.length / 2);
  for (let index = 0; index < decoded.length; index += 1) {
    decoded[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  const withZeros = new Uint8Array(leadingZeros + decoded.length);
  withZeros.set(decoded, leadingZeros);
  return withZeros;
};

/** Base58 that decodes to exactly 32 bytes. */
export const isSolanaAddress = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const decoded = decodeBase58(value);
  return decoded !== null && decoded.length === SOLANA_KEY_BYTES;
};

/**
 * The recipient as the transaction has to carry it, or `null` when it is not a
 * valid address **on that chain**.
 *
 * Returning the validated string rather than a boolean is what lets the caller
 * build the transaction from the value that was checked, and nothing else.
 */
export const recipientForChain = (chain: DepositChain, value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  if (chain === 'solana') return isSolanaAddress(value) ? value : null;

  // EVM: shape first, then the checksum. Both, always.
  return isEvmAddress(value) && isEvmChecksumValid(value) ? value : null;
};
