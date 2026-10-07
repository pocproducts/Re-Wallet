/**
 * The Svix signature scheme, as implemented.
 *
 * ── The scheme, exactly ───────────────────────────────────────────────────────
 *
 * Privy delivers webhooks through Svix, so the request carries three headers:
 * `svix-id`, `svix-timestamp` and `svix-signature`. The signed content is the
 * message id, the timestamp and the **raw body**, joined with dots:
 *
 * ```
 * `${svix-id}.${svix-timestamp}.${rawBody}`
 * ```
 *
 * The key is the webhook signing secret with its `whsec_` prefix removed and the
 * rest base64-decoded; the signature is HMAC-SHA256 over that content, base64
 * encoded. The header may carry several space-separated `v1,<signature>` values,
 * and any one of them matching is enough — that is how a secret rotation keeps
 * both keys working.
 *
 * ── Why the timestamp is inside the signed content ────────────────────────────
 *
 * Because freshness and authenticity are the same fact here: a replayed body
 * cannot be re-timestamped without the secret. Checking the timestamp against
 * the clock *after* verifying the signature is what makes a stale request
 * rejectable at all.
 *
 * ── Why this is ~40 lines instead of the `svix` package ───────────────────────
 *
 * The whole scheme is an HMAC over a string, plus a base64 decode, and this
 * Worker already has the primitive: Web Crypto, which the Workers runtime and
 * Node both expose as `crypto.subtle`. `svix` would pull Node-oriented
 * dependencies into a `platform: 'neutral'` workerd bundle, and `build.mjs`
 * keeps its list of Node builtins deliberately short so a dependency cannot
 * smuggle in a second, subtly different crypto. The tests in
 * `test/domain/svixSignature.test.ts` re-derive the signatures with
 * `node:crypto` instead of with this file, so the implementation is checked
 * against the scheme and not against itself.
 *
 * ── Why a rejection is named ──────────────────────────────────────────────────
 *
 * `MISSING_HEADERS`, `MALFORMED`, `STALE` and `BAD_SIGNATURE` are four different
 * operational facts. A "signature is wrong" alert that fires for a clock skew and
 * for a random internet scanner is an alert nobody reads. All four answer 401 to
 * the sender; they are separated in the log.
 */
export const SVIX_ID_HEADER = 'svix-id';
export const SVIX_TIMESTAMP_HEADER = 'svix-timestamp';
export const SVIX_SIGNATURE_HEADER = 'svix-signature';

/** Svix's own default tolerance: five minutes. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface SvixHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

export type SignatureRejection =
  /** No headers at all, or one of the three missing. */
  | 'MISSING_HEADERS'
  /** The timestamp is not an integer, or no `v1,` value can be read. */
  | 'MALFORMED'
  /** Correctly signed, but outside the tolerance window. */
  | 'STALE'
  /** Inside the window, and the HMAC does not match. */
  | 'BAD_SIGNATURE';

export type SignatureVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: SignatureRejection };

export interface VerifySvixSignatureInput {
  /** The **raw** body, byte for byte as it arrived. */
  readonly body: string;
  readonly headers: SvixHeaders;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}

const reject = (reason: SignatureRejection): SignatureVerdict => ({ ok: false, reason });

/**
 * `whsec_` is a label, not key material: the bytes are what is left of the value.
 *
 * A secret that is not valid base64 is a misconfiguration, and it must not become
 * a 500 for a route that exists to answer. The raw UTF-8 bytes are used as the key
 * in that case: the HMAC then matches nothing, and the request is rejected as a
 * bad signature — which is the truth. A secret that cannot be decoded is a secret
 * that does not verify anything.
 */
const secretBytes = (secret: string): Uint8Array => {
  const raw = secret.replace(/^whsec_/, '');
  let binary: string;
  try {
    binary = atob(raw);
  } catch {
    binary = raw;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * Every `v1,<signature>` value in the header.
 *
 * A rotation leaves two: the current key and the previous one. `v1` is the only
 * scheme version accepted — anything else is a header from something that is not
 * Svix.
 */
const readV1Signatures = (header: string): string[] =>
  header
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice('v1,'.length))
    .filter((value) => value.length > 0);

/**
 * Constant-time comparison of two equal-length strings.
 *
 * Not decoration: a byte-by-byte early return leaks, through timing, how much of
 * a forged signature was correct. This is the only place a signature is
 * compared, so the property is stated once here.
 */
const equals = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export const verifySvixSignature = async (input: VerifySvixSignatureInput): Promise<SignatureVerdict> => {
  const { body, headers, secret, now } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;

  if (!secret) return reject('MISSING_HEADERS');

  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return reject('MISSING_HEADERS');

  const candidates = readV1Signatures(signature);
  if (candidates.length === 0) return reject('MALFORMED');

  const sent = Number(timestamp);
  // `Number` accepts `1_0`, `Infinity` and `0x10`; an integer second does not.
  if (!Number.isInteger(sent)) return reject('MALFORMED');

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sent);
  if (ageSeconds > tolerance) return reject('STALE');

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));

  const expected = base64(new Uint8Array(mac));
  return candidates.some((candidate) => equals(candidate, expected)) ? { ok: true } : reject('BAD_SIGNATURE');
};
