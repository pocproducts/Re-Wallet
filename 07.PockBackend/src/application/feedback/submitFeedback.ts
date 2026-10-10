/**
 * USE CASE: one beta-tester's feedback becomes one GitHub issue.
 *
 * ── Why the title and body are composed here ──────────────────────────────────
 *
 * The route accepts a category and a comment; the tracker wants a title and a
 * Markdown body. That translation is application policy, not transport and not
 * provider: the category prefix (`[Bug]`) and the diagnostics block are decided
 * here so the route stays thin and the adapter stays ignorant of Markdown.
 *
 * ── Why the DID is a pseudonymous label, not an identifier in the body ───────
 *
 * The session knows who reported, and the issue should let a maintainer group
 * reports by the same person without publishing their identity to a public
 * tracker. The DID's tail is that grouping key; the full DID stays server-side.
 */
import type { FeedbackReporter, ReportedIssue } from '../../domain/ports/feedback-reporter';

export type FeedbackCategory = 'bug' | 'payment' | 'idea' | 'other';

export interface FeedbackInput {
  readonly category: FeedbackCategory;
  readonly comment: string;
  /** Optional device/app diagnostics the reporter agreed to share. */
  readonly diagnostics?: string | null;
}

export class InvalidFeedback extends Error {
  constructor(reason: string) {
    super(`feedback rejected: ${reason}`);
    this.name = 'InvalidFeedback';
  }
}

const CATEGORY_PREFIX: Record<FeedbackCategory, string> = {
  bug: '[Bug]',
  payment: '[Pago]',
  idea: '[Idea]',
  other: '[Otro]',
};

const MAX_COMMENT = 4000;

const titleFrom = (comment: string): string => {
  const firstLine = (comment.split('\n')[0] ?? '').trim();
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 69)}…`;
};

/** The last 8 characters: enough to group one reporter's issues, not enough to name them. */
const reporterTag = (privyDid: string): string => privyDid.slice(-8);

export interface SubmitFeedback {
  (privyDid: string, input: FeedbackInput): Promise<ReportedIssue>;
}

export const submitFeedback = (deps: { readonly reporter: FeedbackReporter }): SubmitFeedback => {
  return async (privyDid, input) => {
    const comment = input.comment.trim();
    if (comment.length === 0) throw new InvalidFeedback('comment is empty');
    if (comment.length > MAX_COMMENT) throw new InvalidFeedback(`comment exceeds ${MAX_COMMENT} characters`);

    const diagnostics = input.diagnostics?.trim();
    const body = [
      comment,
      '',
      '---',
      `**Categoría:** ${input.category}`,
      `**Reporter:** \`…${reporterTag(privyDid)}\``,
      ...(diagnostics ? ['', '**Diagnóstico:**', '```', diagnostics.slice(0, 2000), '```'] : []),
      '',
      '_Enviado desde la beta app de ReWALLET._',
    ].join('\n');

    return deps.reporter.report({
      title: `${CATEGORY_PREFIX[input.category]} ${titleFrom(comment)}`,
      body,
      labels: ['beta-feedback', input.category],
    });
  };
};
