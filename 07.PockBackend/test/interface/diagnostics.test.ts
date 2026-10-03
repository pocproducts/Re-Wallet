/**
 * The diagnostics route exists so a Privy failure **in the browser** can be read
 * from a server log. Its whole safety property is that it logs no free text.
 */
import { describe, expect, it } from 'vitest';

import type { Logger } from '../../src/domain/ports/logger';
import { createApp } from '../../src/interface/http/app';
import {
  DIAGNOSTIC_CODES,
  sanitize,
  sanitizeDetalle,
} from '../../src/interface/http/routes/diagnostics';
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

describe('sanitizeDetalle', () => {
  it('collapses whitespace, then strips everything outside [a-z0-9_], then bounds it', () => {
    // `Error:` loses the uppercase `E` and the colon; every whitespace run becomes
    // one `_`, so the words stay apart and the line stays a single line.
    expect(sanitizeDetalle('Error:\n  Wallet creation failed\n')).toBe('rror_allet_creation_failed_');
    expect(sanitizeDetalle('a'.repeat(500))).toHaveLength(200);
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

  it('logs an optional detalle alongside a known code', async () => {
    const { entries, logger } = capturingLogger();

    await post(
      {
        etapa: 'wallets_reclamar',
        codigo: 'unknown_error',
        detalle: 'code_walletclaimrejected_status_403_name_apierror',
      },
      logger,
    );

    expect(entries[0]?.detail).toEqual({
      etapa: 'wallets_reclamar',
      codigo: 'unknown_error',
      detalle: 'code_walletclaimrejected_status_403_name_apierror',
      allowlisted: true,
      estado: 'ok',
    });
  });

  it('truncates a hostile detalle to 200 characters of [a-z0-9_]', async () => {
    const { entries, logger } = capturingLogger();

    // 300 surviving characters, each of them a log-line separator or an injection.
    const hostile = 'Ab\n--\r\n'.repeat(100);
    await post({ etapa: 'wallets_crear_solana', codigo: 'unknown_error', detalle: hostile }, logger);

    const detail = entries[0]?.detail;
    const logged = detail?.['detalle'];
    expect(typeof logged).toBe('string');
    expect((logged as string).length).toBe(200);
    expect(logged as string).toMatch(/^[a-z0-9_]+$/);
    // The newline survives nowhere: not in the detail, not in the log line.
    expect(JSON.stringify(detail)).not.toContain('\n');
  });

  it('collapses whitespace in a detalle so one failure cannot write many log lines', async () => {
    const { entries, logger } = capturingLogger();

    await post(
      { etapa: 'wallets_crear_ethereum', codigo: 'network_error', detalle: 'code_x\n\n\n\tstatus_500' },
      logger,
    );

    const logged = entries[0]?.detail?.['detalle'];
    expect(logged).toBe('code_x_status_500');
    expect(typeof logged === 'string' && logged.includes('\n')).toBe(false);
  });

  it('ignores a detalle that is not a string', async () => {
    const { entries, logger } = capturingLogger();

    await post({ etapa: 'wallets_crear_solana', codigo: 'unknown_error', detalle: { evil: true } }, logger);

    expect(entries[0]?.detail).not.toHaveProperty('detalle');
  });

  it('omits detalle entirely when the browser did not send one', async () => {
    const { entries, logger } = capturingLogger();

    await post({ etapa: 'login_with_code', codigo: 'incorrect_code' }, logger);

    expect(entries[0]?.detail).toEqual({
      etapa: 'login_with_code',
      codigo: 'incorrect_code',
      allowlisted: true,
      estado: 'ok',
    });
  });

  it('never echoes a detalle back in the response', async () => {
    const { logger } = capturingLogger();
    const response = await post(
      { etapa: 'wallets_reclamar', codigo: 'unknown_error', detalle: 'leaked_secret_value' },
      logger,
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
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