/**
 * THE ID OF A CHARGE: a shared link is a bearer secret, and its shape is the
 * security of this feature.
 *
 * ── Why the id has to be unguessable, and not merely unique ──────────────────
 *
 * `docs/contrato-dinero.md` puts a shared link next to the QR as **one of the two
 * ways money arrives**. That sentence is the whole threat model: the link is
 * printed in a chat, forwarded, and pasted into a group, and anybody who holds it
 * can open the charge. There is no second factor on this route, no "is this
 * person in my contacts", and no session of the payee's involved. So the id **is**
 * the access control for the charge, and it has to survive enumeration.
 *
 * Enumeration is the attack that matters here, because the ids are public: a
 * short or structured id turns "guessing an id" into "walking a range", and
 * walking a range over outstanding charges is reading other people's bills.
 *
 * ── Why 32 characters of base64url, and the arithmetic that decides it ───────
 *
 * The table decided the alphabet and the bounds before anybody wrote this:
 * `payment_requests_id_format` is `^[A-Za-z0-9_-]{10,32}$`, so the alphabet is
 * 64 symbols and the width is the only free parameter.
 *
 * | Width | Bits   | What it costs an attacker                              |
 * |-------|--------|---------------------------------------------------------|
 * | 10    | ~60    | `2^60` — enumerable in minutes on one machine            |
 * | 16    | ~96    | not worth attacking, but not free either                 |
 * | 32    | 192    | `2^192` — 2^51 years at a billion guesses per second      |
 *
 * 32 characters is the **maximum the CHECK allows**, so the choice costs nothing:
 * a URL segment two dozen characters longer, and a search space that no amount of
 * compute reaches. Any shorter id would be a decision about which of the two
 * things the schema made possible to give up, and there is nothing to gain by
 * giving either up.
 *
 * ── Why base64url of 24 bytes, and not something with structure ─────────────
 *
 * 24 random bytes encode to exactly 32 base64url characters with no padding, so
 * the character count cannot be hiding a shorter payload. That rules out the
 * three shapes that look convenient and are enumerable:
 *
 *   - a **counter** (`000123`) — a range walk, not a search;
 *   - a **timestamp** (ULID, Snowflake) — monotonically increasing, so the rows
 *     around now are the rows around the clock;
 *   - a **hash of the user id** — one person's charges share a structure, and an
 *     attacker who guesses one user id has guessed the shape of all of them.
 *
 * The entropy is `crypto.getRandomValues`, never `Math.random`, for the same
 * reason `services/send.ts` on the front refuses to fall back to it: a
 * predictable id is not a protection, and a protection that looks like one is
 * worse than none because it is trusted.
 *
 * ── Why the pattern is exported and asserted against the CHECK ───────────────
 *
 * The generator and the database constraint have to agree, or a charge could not
 * be written at all — and, worse, a future change to either could quietly leave
 * the other behind. `PAYMENT_REQUEST_ID_PATTERN` is a copy of the constraint's
 * regex on purpose: `test/application/paymentRequests.test.ts` asserts that both
 * accept and refuse the same strings, which is the only way a copied constant
 * stays true.
 */

/** The alphabet `payment_requests_id_format` permits, minus nothing: 64 symbols. */
export const PAYMENT_REQUEST_ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 24 bytes of entropy. The width the CHECK allows at most. */
export const PAYMENT_REQUEST_ID_BYTES = 24;

/** 32 base64url characters, with no padding: exactly 24 bytes. */
export const PAYMENT_REQUEST_ID_LENGTH = 32;

/** The copy of `payment_requests_id_format`, and the reason a draw is checked. */
export const PAYMENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{10,32}$/;

/**
 * How many bits an id carries: `bytes * 8`.
 *
 * Exported because "it is unguessable" is a claim with a number behind it, and a
 * number in a test is a claim that fails when someone shortens the id.
 */
export const paymentRequestIdEntropyBits = (): number => PAYMENT_REQUEST_ID_BYTES * 8;

/** The value of each character of the alphabet; `-1` where there is no character. */
const ALPHABET_VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < PAYMENT_REQUEST_ID_ALPHABET.length; index += 1) {
    table[PAYMENT_REQUEST_ID_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

/**
 * `bytes` as base64url, by hand.
 *
 * No `Buffer`, no `btoa`: this runs on a Cloudflare Worker, and the encoding has
 * to be byte-exact on every runtime. `btoa` also needs a binary string, and the
 * temptation to build one with `String.fromCharCode(...bytes)` is a stack
 * overflow waiting for a longer payload.
 */
export const base64urlOf = (bytes: Uint8Array): string => {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);

    encoded += PAYMENT_REQUEST_ID_ALPHABET[(chunk >> 18) & 0x3f];
    encoded += PAYMENT_REQUEST_ID_ALPHABET[(chunk >> 12) & 0x3f];
    // 24 bytes is a whole number of 3-byte groups, so the padding slots are never
    // reached; the guards are here so the function is right for any length.
    if (index + 1 < bytes.length) encoded += PAYMENT_REQUEST_ID_ALPHABET[(chunk >> 6) & 0x3f];
    if (index + 2 < bytes.length) encoded += PAYMENT_REQUEST_ID_ALPHABET[chunk & 0x3f];
  }
  return encoded;
};

/** The inverse of `base64urlOf`, for the tests that read the entropy back. */
export const bytesFromBase64url = (encoded: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

  const bytes = new Uint8Array(PAYMENT_REQUEST_ID_BYTES);
  let bits = 0;
  let held = 0;
  let offset = 0;
  for (const character of encoded) {
    bits = (bits << 6) | (ALPHABET_VALUES[character.charCodeAt(0)] ?? -1);
    held += 6;
    if (held >= 8) {
      held -= 8;
      bytes[offset] = (bits >> held) & 0xff;
      offset += 1;
    }
  }
  return bytes.subarray(0, offset);
};

/**
 * A new id, from `crypto.getRandomValues`.
 *
 * Fails closed: with no Web Crypto there is no id, and a charge without an
 * unguessable id is not a charge. Returning a guessable one would be worse than
 * throwing, because the row would still be written and the link would still be
 * shared.
 */
export const newPaymentRequestId = (): string => {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error(
      'A payment request id needs crypto.getRandomValues. There is no fallback: ' +
        'an id that can be guessed is a charge anybody can read and anybody can pay.',
    );
  }

  const bytes = new Uint8Array(PAYMENT_REQUEST_ID_BYTES);
  webCrypto.getRandomValues(bytes);
  return base64urlOf(bytes);
};
