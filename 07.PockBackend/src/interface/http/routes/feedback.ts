/**
 * `POST /api/feedback` — a beta-tester's report becomes a GitHub issue.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```
 * POST /api/feedback
 * Host-Cookie: …
 * { "category": "bug", "comment": "…", "diagnostics": "…optional…" }
 *
 * 201 { "issueUrl": "https://github.com/…/issues/N", "issueNumber": N }
 * 400 malformed body, unknown category, empty/oversized comment
 * 401 no session      502 GitHub unreachable or rejected
 * ```
 *
 * ── Why the session door ──────────────────────────────────────────────────────
 *
 * The endpoint spends the project's GitHub rate limit and writes to the public
 * tracker: an open door would be a free graffiti wall for the internet. The
 * session cookie is the same one every other route checks, and the DID it
 * proves is what groups a reporter's issues server-side.
 */
import { Hono } from 'hono';

import type { SubmitFeedback } from '../../../application/feedback/submitFeedback';
import { InvalidFeedback } from '../../../application/feedback/submitFeedback';
import type { FeedbackCategory } from '../../../application/feedback/submitFeedback';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';

const BAD_FEEDBACK_BODY = { error: { code: 'BAD_FEEDBACK' } } as const;
const FEEDBACK_UNAVAILABLE_BODY = { error: { code: 'FEEDBACK_UNAVAILABLE' } } as const;

const CATEGORIES: readonly FeedbackCategory[] = ['bug', 'payment', 'idea', 'other'];

export interface FeedbackDeps {
  readonly sessions: SessionCodec;
  readonly submit: SubmitFeedback;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createFeedbackRoutes = (deps: FeedbackDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.post('/', async (c) => {
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    let payload: { category?: unknown; comment?: unknown; diagnostics?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json(BAD_FEEDBACK_BODY, 400);
    }

    if (typeof payload.comment !== 'string' || typeof payload.category !== 'string') {
      return c.json(BAD_FEEDBACK_BODY, 400);
    }
    const category = payload.category as FeedbackCategory;
    if (!CATEGORIES.includes(category)) {
      return c.json(BAD_FEEDBACK_BODY, 400);
    }

    try {
      const issue = await deps.submit(claims.privyDid, {
        category,
        comment: payload.comment,
        diagnostics: typeof payload.diagnostics === 'string' ? payload.diagnostics : null,
      });
      log.log('feedback.github issue created', { issueNumber: issue.issueNumber, category });
      return c.json(issue, 201);
    } catch (error) {
      if (error instanceof InvalidFeedback) {
        return c.json(BAD_FEEDBACK_BODY, 400);
      }
      // The provider's reason stays in the log; the person learns only that it failed.
      log.error('feedback.github rejected', error);
      return c.json(FEEDBACK_UNAVAILABLE_BODY, 502);
    }
  });

  return app;
};
