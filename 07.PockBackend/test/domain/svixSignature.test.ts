/**
 * The signature scheme, on its own.
 *
 * The tolerance boundary, the malformed cases and the rotation case are asserted
 * here because they are the ones a route test can only reach by accident. The
 * signatures are produced with `node:crypto`, independently of the code under
 * test, so a change on both sides at once would have to be a change in the scheme
 * itself.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  verifySvixSignature,
  type SvixHeaders,
} from '../../src/domain/webhooks/svixSignature';

const SECRET = 'whsec_dGVzdF9zaWduaW5nX3NlY3JldF9ieXRlcw==';
const NOW = new Date('2025-06-01T12:00:00.000Z');
const BODY = '{"type":"user.created"}';
const ID = 'msg_1';

const sign = (id: string, timestamp: string, body: string, secret = SECRET): string => {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
};

const at = (offsetSeconds: number): string => String(Math.floor(NOW.getTime() / 1000) + offsetSeconds);

const headers = (timestamp: string, signature: string): SvixHeaders => ({
  id: ID,
  timestamp,
  signature,
});

const verify = (overrides: Partial<Parameters<typeof verifySvixSignature>[0]> = {}) =>
  verifySvixSignature({
    body: BODY,
    headers: headers(at(0), sign(ID, at(0), BODY)),
    secret: SECRET,
    now: NOW,
    ...overrides,
  });

describe('verifySvixSignature', () => {
  it('accepts a signature made over `${id}.${timestamp}.${body}`', async () => {
    await expect(verify()).resolves.toEqual({ ok: true });
  });

  it('accepts the secret with or without its `whsec_` prefix', async () => {
    // The prefix is presentation, not key material: both are the same key.
    await expect(verify({ secret: SECRET.replace(/^whsec_/, '') })).resolves.toEqual({ ok: true });
    await expect(verify()).resolves.toEqual({ ok: true });
  });

  it('accepts when any one of several `v1,` values matches, and rejects when none does', async () => {
    // Two `v1` entries is what a secret rotation looks like on the wire.
    const rotated = sign(ID, at(0), BODY, 'whsec_dGhlX3ByZXZpb3VzX3NlY3JldA==');
    const good = sign(ID, at(0), BODY);

    await expect(verify({ headers: headers(at(0), `${rotated} ${good}`) })).resolves.toEqual({ ok: true });
    await expect(verify({ headers: headers(at(0), rotated) })).resolves.toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects a body, an id or a timestamp that the signature does not cover', async () => {
    const timestamp = at(0);

    await expect(verify({ body: `${BODY} ` })).resolves.toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    await expect(verify({ headers: { ...headers(timestamp, sign(ID, timestamp, BODY)), id: 'msg_2' } })).resolves.toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    await expect(verify({ headers: headers(at(-10), sign(ID, at(0), BODY)) })).resolves.toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });
});

describe('verifySvixSignature — the missing and the malformed', () => {
  it('rejects when a header is absent, naming it as missing rather than as a bad signature', async () => {
    const none: SvixHeaders = { id: null, timestamp: null, signature: null };
    await expect(verify({ headers: none })).resolves.toEqual({ ok: false, reason: 'MISSING_HEADERS' });

    const noSignature = headers(at(0), '');
    await expect(verify({ headers: { ...noSignature, signature: null } })).resolves.toEqual({
      ok: false,
      reason: 'MISSING_HEADERS',
    });
  });

  it('rejects a timestamp that is not an integer second, without throwing', async () => {
    await expect(verify({ headers: headers('yesterday', sign(ID, 'yesterday', BODY)) })).resolves.toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
    await expect(verify({ headers: headers('', sign(ID, '', BODY)) })).resolves.toEqual({
      ok: false,
      reason: 'MISSING_HEADERS',
    });
  });

  it('rejects a signature header with no readable `v1,` value', async () => {
    await expect(verify({ headers: headers(at(0), 'v2,abc') })).resolves.toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });
});

describe('verifySvixSignature — freshness', () => {
  it('accepts a timestamp just inside the tolerance and rejects it just outside', async () => {
    const tolerance = DEFAULT_SIGNATURE_TOLERANCE_SECONDS;

    const justInside = String(Math.floor(NOW.getTime() / 1000) - (tolerance - 10));
    const justOutside = String(Math.floor(NOW.getTime() / 1000) - (tolerance + 10));

    await expect(verify({ headers: headers(justInside, sign(ID, justInside, BODY)) })).resolves.toEqual({ ok: true });
    await expect(verify({ headers: headers(justOutside, sign(ID, justOutside, BODY)) })).resolves.toEqual({
      ok: false,
      reason: 'STALE',
    });
  });

  it('rejects a timestamp from the future as stale, not as a bad signature', async () => {
    const ahead = at(DEFAULT_SIGNATURE_TOLERANCE_SECONDS + 60);

    await expect(verify({ headers: headers(ahead, sign(ID, ahead, BODY)) })).resolves.toEqual({
      ok: false,
      reason: 'STALE',
    });
  });

  it('honours an explicit tolerance', async () => {
    const tenMinutesAgo = String(Math.floor(NOW.getTime() / 1000) - 600);
    const signed = headers(tenMinutesAgo, sign(ID, tenMinutesAgo, BODY));

    await expect(verify({ headers: signed })).resolves.toEqual({ ok: false, reason: 'STALE' });
    await expect(verify({ headers: signed, toleranceSeconds: 900 })).resolves.toEqual({ ok: true });
  });
});
