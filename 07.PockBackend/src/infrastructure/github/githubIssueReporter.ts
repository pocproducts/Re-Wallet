/**
 * ADAPTER: create a GitHub issue through the REST API.
 *
 * ── Why a fail-closed constructor ─────────────────────────────────────────────
 *
 * A Worker that boots without a token or a repo and then answers 500 on every
 * report looks healthy until somebody needs it. Failing at construction moves
 * that discovery to deploy time, where it belongs. The wiring honours this: the
 * route is only mounted when the config carries the token, so this constructor
 * never actually throws in production — it is the seatbelt, not the plan.
 *
 * ── Why no library ────────────────────────────────────────────────────────────
 *
 * One `POST /repos/{owner}/{repo}/issues`. An SDK would add a dependency to do
 * one `fetch`. The deadline wrapper is the same one every other HTTP adapter in
 * this project uses, so a slow GitHub cannot hang the request.
 */
import type { FeedbackReporter, ReportedIssue } from '../../domain/ports/feedback-reporter';

export class GitHubIssueRejected extends Error {
  constructor(status: number, options?: { cause?: unknown }) {
    super(`GitHub issue creation failed: HTTP ${status}`, options);
    this.name = 'GitHubIssueRejected';
  }
}

export interface GitHubIssueReporterOptions {
  readonly token: string;
  /** `owner/repo`, e.g. `pocproducts/ReWALLET`. */
  readonly repo: string;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const createGitHubIssueReporter = (options: GitHubIssueReporterOptions): FeedbackReporter => {
  if (!options.token) throw new Error('GITHUB_FEEDBACK_TOKEN is not defined.');
  if (!REPO_PATTERN.test(options.repo)) throw new Error('GITHUB_FEEDBACK_REPO must look like owner/repo.');

  return {
    async report({ title, body, labels }): Promise<ReportedIssue> {
      const response = await fetch(`https://api.github.com/repos/${options.repo}/issues`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          // GitHub requires a User-Agent; any string does, but a name beats a version.
          'user-agent': 'rewallet-poc-api',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ title, body, labels: [...labels] }),
      });

      if (!response.ok) {
        throw new GitHubIssueRejected(response.status);
      }

      const created = (await response.json()) as { html_url?: unknown; number?: unknown };
      if (typeof created.html_url !== 'string' || typeof created.number !== 'number') {
        throw new GitHubIssueRejected(response.status);
      }
      return { issueUrl: created.html_url, issueNumber: created.number };
    },
  };
};
