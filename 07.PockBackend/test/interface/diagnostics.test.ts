/**
 * The diagnostics route exists so a Privy failure **in the browser** can be read
 * from a server log. Its whole safety property is that it logs no free text.
 */
import { describe, expect, it } from 'vitest';

import type { Logger } from '../../src/domain/ports/logger';
import { createApp } from '../../src/interface/http/app';
import { DIAGNOSTIC_CODES, sanitize } from '../../src/interface/http/routes/diagnostics';
import { recordingLogger } from '../support/fixtures';

/** Captures the detail object, which is where the sanitised values land. */
const capturingLogger = () => {
  const entries: Array<{ step: string; detail?: Record<string, unknown> }> = [];
  const logger: Logger = {
    log: (step, detail) => {
      entries.push({ step, detail });
    },
    error: (message) => {
      entries.push({ step: message });
    },
  };
  return { entries, logger };
};

const post = (body: unknown, logger: Logger) =>
  createApp({
    mint: async () => {
      throw new Error('not used');
    },
    sessions: { issue: async () => ({ token: 't', expiresAt: new Date() }), read: async () => null },
    log: logger,
  }).request('/api/diagnostics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('sanitize', () => {
  it('keeps only [a-z0-9_]', () => {
    expect(sanitize('too_many_requests')).toBe('too_many_requests');
    // Uppercase, spaces, punctuation and the rest of SQL all disappear.
    expect(sanitize('Bad CODE; DROP TABLE users--')).toBe('adusers');
    expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert1script');
    expect(sanitize('line\nbreak')).toBe('linebreak');
  });
});

describe('POST /api/diagnostics', () => {
  it('logs an allowlisted code verbatim', async () => {
    const { entries, logger } = capturingLogger();

    const response = await post({ etapa: 'login_with_code', codigo: 'incorrect_code' }, logger);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toEqual({ etapa: 'login_with_code', codigo: 'incorrect_code', allowlisted: true, estado: 'ok' });
  });

  it('rejects a code outside the allowlist but STILL logs a sanitised line', async () => {
    const { entries, logger } = capturingLogger();

    const response = await post({ etapa: 'send_code', codigo: 'bad CODE; DROP TABLE users--' }, logger);

    expect(response.status).toBe(204);
    expect(entries).toHaveLength(1);

    const detail = entries[0]?.detail;
    expect(detail?.['allowlisted']).toBe(false);
    expect(detail?.['estado']).toBe('rejected');
    // Nothing that could rewrite a log line survives.
    expect(detail?.['codigo']).toBe('badusers');
    expect(JSON.stringify(detail)).not.toContain(';');
    expect(JSON.stringify(detail)).not.toContain('DROP');
  });

  it('never echoes the received text back in the response', async () => {
    const { logger } = capturingLogger();
    const response = await post({ etapa: 'send_code', codigo: 'leaked-secret-value' }, logger);

    expect(await response.text()).toBe('');
  });

  it('sanitises the etapa too, because it is also free text', async () => {
    const { entries, logger } = capturingLogger();

    await post({ etapa: 'a\nb c', codigo: 'too_many_requests' }, logger);

    expect(entries[0]?.detail?.['etapa']).toBe('abc');
  });

  it('accepts exactly the codes it declares', () => {
    for (const code of DIAGNOSTIC_CODES) {
      expect(code).toMatch(/^[a-z0-9_]+$/);
    }
    expect(DIAGNOSTIC_CODES.has('anything else')).toBe(false);
  });

  it('is 400 for a body that is not JSON', async () => {
    const { logger } = capturingLogger();
    const response = await createApp({
      mint: async () => {
        throw new Error('not used');
      },
      sessions: { issue: async () => ({ token: 't', expiresAt: new Date() }), read: async () => null },
      log: logger,
    }).request('/api/diagnostics', { method: 'POST', body: 'not json' });

    expect(response.status).toBe(400);
  });
});