import { describe, expect, it } from 'vitest';

import { createFeedbackRoutes } from '../../src/interface/http/routes/feedback';
import type { SessionCodec } from '../../src/domain/ports/session-codec';

import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';

const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=good`;
const DID = 'did:privy:feedbacktester00000000000000001';

const sessions: SessionCodec = {
  issue: async () => { throw new Error('not used'); },
  read: async (token: string, _now: Date) => (token === 'good' ? { userId: 'u1', privyDid: DID } : null),
};

const app = (overrides: Partial<Parameters<typeof createFeedbackRoutes>[0]> = {}) =>
  createFeedbackRoutes({
    sessions,
    submit: async () => ({ issueUrl: 'https://github.com/x/y/issues/3', issueNumber: 3 }),
    ...overrides,
  });

const post = (target: ReturnType<typeof app>, body: unknown, cookie?: string) =>
  target.request('/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/feedback', () => {
  it('creates the issue and answers 201 with its URL', async () => {
    const response = await post(app(), { category: 'bug', comment: 'Se rompió el swap' }, SESSION_COOKIE);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      issueUrl: 'https://github.com/x/y/issues/3',
      issueNumber: 3,
    });
  });

  it('answers 401 without a session — this endpoint spends the tracker rate limit', async () => {
    const response = await post(app(), { category: 'bug', comment: 'hola' });
    expect(response.status).toBe(401);
  });

  it('answers 400 for an unknown category or an empty comment', async () => {
    const bad1 = await post(app(), { category: 'hackeo', comment: 'x' }, SESSION_COOKIE);
    expect(bad1.status).toBe(400);

    const empty = await post(
      app({ submit: async () => { throw new (await import('../../src/application/feedback/submitFeedback')).InvalidFeedback('empty'); } }),
      { category: 'bug', comment: '   ' },
      SESSION_COOKIE,
    );
    expect(empty.status).toBe(400);
  });

  it('answers 502 when the tracker cannot be reached — never a silent fake success', async () => {
    const failing = app({
      submit: async () => { throw new Error('github unreachable'); },
    });
    const response = await post(failing, { category: 'bug', comment: 'x' }, SESSION_COOKIE);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'FEEDBACK_UNAVAILABLE' } });
  });
});
