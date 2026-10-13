/**
 * PORT: turn one person's feedback into an issue in the project's tracker.
 *
 * The route guards the session; this port knows nothing about sessions. The
 * adapter knows nothing about the route. Between them sits the use case, which
 * composes the title and body the tracker will carry.
 */
export interface FeedbackReport {
  /** Issue title as it will appear in the tracker. */
  readonly title: string;
  /** Issue body, Markdown. */
  readonly body: string;
  /** Labels to attach, e.g. ['beta-feedback', 'bug']. Unknown labels are the adapter's problem. */
  readonly labels: readonly string[];
}

export interface ReportedIssue {
  readonly issueUrl: string;
  readonly issueNumber: number;
}

export interface FeedbackReporter {
  report(input: FeedbackReport): Promise<ReportedIssue>;
}
