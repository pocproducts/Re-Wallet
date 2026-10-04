/**
 * THE RULES OF A TRANSFER, at the layer where a mistake is a lost payment.
 *
 * ── What is being protected here ─────────────────────────────────────────────
 *
 *   1. **An address is valid FOR ITS CHAIN.** `0x…` is an EVM address, base58 of
 *      32 bytes is a Solana one, and pasting one into the other chain's send is
 *      refused. There is no "best effort" branch: the two alphabets do not
 *      overlap, so an address from the wrong chain is not near an address.
 *   2. **EIP-55, when the address claims to carry one.** A mixed-case address is
 *      a checksum and it is verified against `keccak256(lowercase address)`. A
 *      mistyped character changes that hash, and a mistyped character in a
 *      recipient address is a transfer to nobody.
 *   3. **The calldata is derived, not typed.** `transfer(address,uint256)`'s
 *      selector is computed here and asserted against `viem`'s own
 *      `toFunctionSelector`, so a typo cannot hide behind a plausible constant.
 *
 * The `keccak256` under test is this repository's own implementation with no
 * dependencies, because `viem` is a **dev** dependency and a Worker cannot ship
 * it. It is therefore cross-checked against `viem` here, on the empty string and
 * on text with a multi-byte character.
 */
import { describe, expect, it } from 'vitest';
import { keccak256 as viemKeccak256, toFunctionSelector } from 'viem';

import { keccak256 } from '../../src/domain/send/keccak256';
import { isEvmAddress, isEvmChecksumValid, isSolanaAddress, recipientForChain } from '../../src/domain/send/recipients';
import { chainIdentityFor, encodeTransfer, TRANSFER_SELECTOR } from '../../src/domain/send/transfer';

const EVM_LOWER = '0x1234567890abcdef1234567890abcdef12345678';
/** The EIP-55 reference vector, and the same address with one letter's case flipped. */
const EVM_CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const EVM_CHECKSUM_BROKEN = '0x5aAeb6053f3E94C9b9A09f33669435E7Ef1BeAed';
const SOLANA = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

describe('keccak256', () => {
  it('agrees with viem on the empty string, on ASCII and on a multi-byte character', () => {
    for (const text of ['0x', 'transfer(address,uint256)', 'ñ', 'a'.repeat(200), '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed']) {
      const asHex = `0x${Array.from(new TextEncoder().encode(text))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')}`;

      expect(keccak256(asHex), text).toBe(viemKeccak256(asHex as `0x${string}`));
    }
  });

  it('agrees with viem on a block longer than the 136-byte rate of keccak-256', () => {
    const hex = `0x${'ab'.repeat(400)}`;
    expect(keccak256(hex)).toBe(viemKeccak256(hex as `0x${string}`));
  });
});

describe('an EVM recipient', () => {
  it('accepts 0x plus forty hex digits, in either case', () => {
    expect(isEvmAddress(EVM_LOWER)).toBe(true);
    expect(isEvmAddress(EVM_LOWER.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('refuses anything that is not forty hex digits', () => {
    for (const value of [
      '0x123',
      '0x1234567890abcdef1234567890abcdef123456789',
      '1234567890abcdef1234567890abcdef12345678',
      '0xZZ34567890abcdef1234567890abcdef12345678',
      '0x1234567890abcdef1234567890abcdef1234567 ',
      '',
      null,
      42,
    ]) {
      expect(isEvmAddress(value as unknown), String(value)).toBe(false);
    }
  });

  it('refuses a Solana address outright, with no attempt to interpret it', () => {
    // An EVM address pasted into a Solana send is not near an address: the
    // alphabets do not overlap and the lengths do not either.
    expect(isEvmAddress(SOLANA)).toBe(false);
    expect(recipientForChain('solana', EVM_LOWER)).toBeNull();
    expect(recipientForChain('solana', SOLANA)).toBe(SOLANA);
  });
});

describe('EIP-55', () => {
  it('accepts a mixed-case address whose checksum is right', () => {
    expect(isEvmChecksumValid(EVM_CHECKSUMMED)).toBe(true);
    expect(isEvmChecksumValid('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')).toBe(true);
  });

  it('refuses a mixed-case address with one character mistyped', () => {
    // The reference vector with the case of one letter changed: the copy-paste
    // error this check exists to catch, and one the chain would not catch.
    expect(isEvmChecksumValid(EVM_CHECKSUM_BROKEN)).toBe(false);
  });

  it('accepts an all-lowercase or all-uppercase address: it carries no checksum to verify', () => {
    expect(isEvmChecksumValid(EVM_LOWER)).toBe(true);
    expect(isEvmChecksumValid(EVM_LOWER.toUpperCase().replace('0X', '0x'))).toBe(true);
  });

  it('refuses an address that is not an address at all', () => {
    expect(isEvmChecksumValid('0x123')).toBe(false);
  });
});

describe('a Solana recipient', () => {
  it('accepts base58 that decodes to exactly 32 bytes', () => {
    expect(isSolanaAddress(SOLANA)).toBe(true);
    // The system program, also 32 bytes.
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
  });

  it('refuses base58 that decodes to another length', () => {
    expect(isSolanaAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
    expect(isSolanaAddress('3yZe7d')).toBe(false);
    expect(isSolanaAddress('111111111111111111111111111111111')).toBe(false);
    expect(isSolanaAddress('')).toBe(false);
    // `0`, `O`, `I` and `l` are not in the base58 alphabet.
    expect(isSolanaAddress('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvu0Il')).toBe(false);
    expect(isSolanaAddress(null)).toBe(false);
  });
});

describe('the transfer calldata', () => {
  it('derives the selector instead of typing it, and it is transfer(address,uint256)', () => {
    expect(TRANSFER_SELECTOR).toBe(keccak256('0x7472616e7366657228616464726573732c75696e7432353629').slice(0, 10));
    expect(TRANSFER_SELECTOR).toBe(toFunctionSelector('transfer(address,uint256)'));
  });

  it('encodes the recipient left-padded and the amount as one 32-byte word', () => {
    const data = encodeTransfer(EVM_LOWER, 1_500_000n);

    expect(data).toBe(
      `0x${TRANSFER_SELECTOR.slice(2)}` +
        '0000000000000000000000001234567890abcdef1234567890abcdef12345678' +
        '000000000000000000000000000000000000000000000000000000000016e360',
    );
    expect(data).toHaveLength(2 + 8 + 128);
  });

  it('does not care about the case of the recipient it was given', () => {
    expect(encodeTransfer(EVM_CHECKSUMMED, 1n)).toBe(encodeTransfer(EVM_CHECKSUMMED.toLowerCase(), 1n));
  });

  it('refuses to encode a negative amount or something that is not an address', () => {
    expect(() => encodeTransfer(EVM_LOWER, -1n)).toThrow();
    expect(() => encodeTransfer('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 1n)).toThrow();
  });
});

describe('the chain a transaction is signed on', () => {
  it('carries the numeric chain id and the CAIP-2 name of the catalog row', () => {
    expect(chainIdentityFor('monad')).toEqual({ chainId: 143, network: 'eip155:143' });
    expect(chainIdentityFor('ethereum')).toEqual({ chainId: 1, network: 'eip155:1' });
  });

  it('names Solana in its own namespace and claims no numeric chain id', () => {
    // Solana has no EIP-155 id: `network` is the identifier and `chainId` is 0.
    const identity = chainIdentityFor('solana');

    expect(identity.network.startsWith('solana:')).toBe(true);
    expect(identity.chainId).toBe(0);
  });
});
