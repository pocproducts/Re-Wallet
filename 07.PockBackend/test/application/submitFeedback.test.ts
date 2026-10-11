import { describe, expect, it } from 'vitest';

import { submitFeedback, InvalidFeedback } from '../../src/application/feedback/submitFeedback';
import type { FeedbackReport } from '../../src/domain/ports/feedback-reporter';

const DID = 'did:privy:abcdef0123456789abcd';

const record = () => {
  const reports: FeedbackReport[] = [];
  const reporter = {
    report: async (input: FeedbackReport) => {
      reports.push(input);
      return { issueUrl: 'https://github.com/pocproducts/ReWALLET/issues/7', issueNumber: 7 };
    },
  };
  return { reports, submit: submitFeedback({ reporter }) };
};

/**
 * El único reporte que el tracker recibió.
 *
 * `noUncheckedIndexedAccess` obliga a probar que el índice existe antes de
 * leerlo. Esta función lo prueba —y falla el test con un mensaje claro si no
 * hay exactamente uno— sin tocar las aserciones de abajo.
 */
const onlyReport = (reports: readonly FeedbackReport[]): FeedbackReport => {
  expect(reports).toHaveLength(1);
  const [report] = reports;
  if (report === undefined) {
    throw new Error('expected exactly one feedback report');
  }
  return report;
};

describe('submitFeedback', () => {
  it('composes the titled issue and returns what the tracker answered', async () => {
    const { reports, submit } = record();
    const out = await submit(DID, { category: 'bug', comment: 'El botón de enviar no responde' });

    expect(out.issueNumber).toBe(7);
    expect(reports).toHaveLength(1);
    const report = onlyReport(reports);
    expect(report.title).toBe('[Bug] El botón de enviar no responde');
    expect(report.labels).toEqual(['beta-feedback', 'bug']);
    expect(report.body).toContain('El botón de enviar no responde');
    expect(report.body).toContain(`…${DID.slice(-8)}`);
    // The full DID never leaves the server.
    expect(report.body).not.toContain(DID);
  });

  it('includes diagnostics only when the reporter shared them', async () => {
    const { reports, submit } = record();
    await submit(DID, { category: 'idea', comment: 'Modo oscuro', diagnostics: 'ios 18 / safari' });

    expect(onlyReport(reports).body).toContain('ios 18 / safari');

    const second = record();
    await second.submit(DID, { category: 'idea', comment: 'Modo oscuro' });
    expect(onlyReport(second.reports).body).not.toContain('Diagnóstico');
  });

  it('refuses an empty comment and an oversized one before touching the tracker', async () => {
    const { reports, submit } = record();

    await expect(submit(DID, { category: 'bug', comment: '   ' })).rejects.toBeInstanceOf(InvalidFeedback);
    await expect(submit(DID, { category: 'bug', comment: 'x'.repeat(4001) })).rejects.toBeInstanceOf(
      InvalidFeedback,
    );
    expect(reports).toHaveLength(0);
  });
});
