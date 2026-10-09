/**
 * The Kamino Earn vault: the layout, the pinned identities, and the scale of
 * what Kamino publishes — **no network, no database.**
 *
 * ── What this file is for ────────────────────────────────────────────────────
 *
 * Two of the three facts this reader depends on are constants, and constants are
 * the things that rot silently. A vault address that points at another vault, or
 * a shares mint read at the wrong offset, does not throw: it produces a
 * plausible balance for a different account. So both are pinned here, and the
 * layout is checked against **bytes that came off the chain**.
 *
 * `KVAULT_ACCOUNT_PREFIX_BASE64` is the first 512 bytes of the live account at
 * `KAMINO_EARN_VAULT_ADDRESS`, captured once and written down. It is why the
 * offset assertions below are evidence rather than arithmetic: every expected
 * value in them is what the chain said, not what this code would have produced.
 */
import { describe, expect, it } from 'vitest';

import {
  KAMINO_EARN_SHARES_SYMBOL,
  KAMINO_EARN_VAULT_ADDRESS,
  KAMINO_EARN_VAULT_FARM_ADDRESS,
  KAMINO_EARN_VAULT_TOKEN_SYMBOL,
  KAMINO_KVAULT_ACCOUNT_BYTES,
  KAMINO_KVAULT_DISCRIMINATOR,
  KAMINO_KVAULT_PROGRAM_ID,
  KVAULT_FIELD_OFFSET,
  KaminoVaultDecodeError,
  decodeKaminoKVault,
  formatExactDecimal,
  parseExactDecimal,
} from '../../src/domain/yield/kaminoEarnVault';
import { isSolanaAddress } from '../../src/domain/send/recipients';

/** The pinned shares mint, as the chain holds it at offset 184. */
const SHARES_MINT = '7D8C5pDFxug58L9zkwK7bCiDg4kD4AygzbcZUmf5usHS';
/** Solana USDC, as the chain holds it at offset 80. */
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * The first 512 bytes of the live vault account, as base64. Captured from
 * `getAccountInfo(KAMINO_EARN_VAULT_ADDRESS, { encoding: 'base64' })`.
 */
const KVAULT_ACCOUNT_PREFIX_BASE64 =
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

/** The full account: the captured head, then the reserved padding the vault has. */
const realAccount = (): Uint8Array => {
  const head = base64ToBytes(KVAULT_ACCOUNT_PREFIX_BASE64);
  const account = new Uint8Array(KAMINO_KVAULT_ACCOUNT_BYTES);
  account.set(head, 0);
  return account;
};

/** An account of the right size with a field written into it, for the refusals. */
const accountWith = (write: (account: Uint8Array) => void): Uint8Array => {
  const account = realAccount();
  write(account);
  return account;
};

describe('the pinned Kamino Earn vault', () => {
  it('pins the vault address, so changing it is a deliberate act', () => {
    // Steakhouse USDC on Solana mainnet, verified live with `getAccountInfo`.
    expect(KAMINO_EARN_VAULT_ADDRESS).toBe('HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E');
    expect(isSolanaAddress(KAMINO_EARN_VAULT_ADDRESS)).toBe(true);
    expect(KAMINO_KVAULT_PROGRAM_ID).toBe('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd');
    expect(KAMINO_KVAULT_ACCOUNT_BYTES).toBe(62552);
    expect(KAMINO_KVAULT_DISCRIMINATOR).toBe('e4c452a562d2eb98');
  });

  it('pins the shares mint separately from the token mint, because they differ', () => {
    /*
     * The whole reader turns on this being **two different mints**. A reader that
     * assumed the shares mint was the token mint would read the wallet's plain
     * USDC accounts and call them a Kamino position.
     */
    expect(KAMINO_EARN_VAULT_TOKEN_SYMBOL).toBe('USDC');
    expect(KAMINO_EARN_SHARES_SYMBOL).toBe('kV-STKUSDC');

    const state = decodeKaminoKVault(KAMINO_EARN_VAULT_ADDRESS, realAccount());
    expect(state.tokenMint).toBe(USDC_MINT);
    expect(state.sharesMint).toBe(SHARES_MINT);
    expect(state.sharesMint).not.toBe(state.tokenMint);
    expect(isSolanaAddress(state.sharesMint)).toBe(true);
  });

  it('pins the farm this vault declares, with the account that does not exist', () => {
    /*
     * Provenance: Kamino's own `GET /kvaults/vaults/{pubkey}` answers it as
     * `state.vaultFarm`, and `getMultipleAccounts` for it answers `null` — so
     * nothing is staked there today and the shares live in the holder's accounts.
     * It is still read on every request, so the day the farm is live this code
     * finds out instead of assuming.
     */
    expect(KAMINO_EARN_VAULT_FARM_ADDRESS).toBe('9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj');
    expect(isSolanaAddress(KAMINO_EARN_VAULT_FARM_ADDRESS)).toBe(true);
  });

  it('reads the layout at the offsets the chain says, from the chain\'s own bytes', () => {
    const state = decodeKaminoKVault(KAMINO_EARN_VAULT_ADDRESS, realAccount());

    // Every offset is a fact about the account, not about this code.
    expect(KVAULT_FIELD_OFFSET.sharesMint).toBe(184);
    expect(KVAULT_FIELD_OFFSET.tokenMint).toBe(80);

    expect(state.sharesMintDecimals).toBe(6);
    expect(state.tokenMintDecimals).toBe(6);

    // `sharesIssued` at 232 and `tokenAvailable` at 224, little-endian u64.
    expect(state.sharesIssued).toBe(17_887_740_793_751n);
    expect(state.tokenAvailable).toBe(79_951_135_232n);

    // The vault's own authority and its vaults are read too, and every one of
    // them is a valid 32-byte public key.
    for (const address of [state.vaultAuthority, state.baseVaultAuthority, state.tokenVault, state.tokenProgram]) {
      expect(isSolanaAddress(address)).toBe(true);
    }
    expect(state.tokenVault).not.toBe(state.sharesMint);
  });

  it('refuses an account that is not this vault, rather than decoding it anyway', () => {
    // The wrong length: not a KVault account at all.
    expect(() => decodeKaminoKVault(KAMINO_EARN_VAULT_ADDRESS, new Uint8Array(100))).toThrow(KaminoVaultDecodeError);

    // The right length, somebody else's discriminator: a decode here would be a
    // balance about another program's account.
    const wrongDiscriminator = accountWith((account) => {
      account[0] = (account[0] as number) ^ 0xff;
    });
    expect(() => decodeKaminoKVault(KAMINO_EARN_VAULT_ADDRESS, wrongDiscriminator)).toThrow(
      KaminoVaultDecodeError,
    );

    // A decimals field that is not a mint's scale is a layout that moved, and it
    // is refused rather than valued at an invented exponent.
    const impossibleDecimals = accountWith((account) => {
      account[KVAULT_FIELD_OFFSET.sharesMintDecimals] = 200;
    });
    expect(() => decodeKaminoKVault(KAMINO_EARN_VAULT_ADDRESS, impossibleDecimals)).toThrow(KaminoVaultDecodeError);
  });
});

describe('the scale of the share price', () => {
  it('takes the scale from the digits Kamino publishes, and from nowhere else', () => {
    // The live figure: nineteen fractional digits, and no declared exponent.
    const live = parseExactDecimal('1.0617770761260384793');
    expect(live).toEqual({ raw: 10617770761260384793n, decimals: 19 });
    expect(formatExactDecimal(live as { raw: bigint; decimals: number })).toBe('1.0617770761260384793');

    // A different scale tomorrow must not be forced back onto today's.
    expect(parseExactDecimal('1.0625')).toEqual({ raw: 10625n, decimals: 4 });
    expect(parseExactDecimal('2')).toEqual({ raw: 2n, decimals: 0 });
    expect(parseExactDecimal('0.000000001')).toEqual({ raw: 1n, decimals: 9 });
  });

  it('refuses anything whose scale it would have to guess', () => {
    // An exponent form, a sign, an empty string, a non-string: each of these is an
    // answer whose scale is not stated, and a position at a guessed scale is
    // wrong by a power of ten.
    for (const text of ['1e-7', '-1.5', '1.5.2', '', ' 1.5', '0x10', 'NaN', 'Infinity', 1.5, null, undefined]) {
      expect(parseExactDecimal(text)).toBeNull();
    }
    // More fractional digits than any mint has: not a scale, a mistake.
    expect(parseExactDecimal(`0.${'1'.repeat(37)}`)).toBeNull();
  });
});