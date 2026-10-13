/**
 * Reporte de beta → issue real de GitHub, vía `POST /api/feedback`.
 *
 * El backend es quien crea la issue (con su token): el navegador nunca ve una
 * credencial de GitHub, y la cookie de sesión es la puerta — sin sesión no hay
 * reporte, igual que en el resto de la app.
 */
import { postJson } from './api';

export type FeedbackCategory = 'bug' | 'payment' | 'idea' | 'other';

export interface ReportedIssue {
  readonly issueUrl: string;
  readonly issueNumber: number;
}

export const collectDiagnostics = (userTag: string): string =>
  [
    `tag: ${userTag}`,
    `ua: ${navigator.userAgent}`,
    `pantalla: ${window.innerWidth}x${window.innerHeight}`,
    `idioma: ${navigator.language}`,
    `url: ${window.location.pathname}`,
  ].join('\n');

export const submitFeedback = (input: {
  category: FeedbackCategory;
  comment: string;
  diagnostics: string | null;
}): Promise<ReportedIssue> => postJson<ReportedIssue>('/feedback', input);
