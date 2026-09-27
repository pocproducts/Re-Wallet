import { describe, it, expect, vi } from 'vitest';
import worker from '../../src/worker';

/**
 * The cron entry point, without a Worker runtime.
 *
 * The failure this file exists to prevent is silent. A Cloudflare cron does NOT
 * retry: if `scheduled` throws, the mirror stops updating and the only symptom
 * is a wrong balance on someone's profile days later, with nothing in the app to
 * explain it. So the two properties worth pinning are that the handler EXISTS
 * (a missing `scheduled` export means the cron in `wrangler.toml` fires into
 * nothing, silently) and that it NEVER throws.
 *
 * Note what is NOT asserted here: that the sync works. That is
 * `tests/unit/balance.test.ts`. This file is about the Worker wiring only.
 */

interface FakeCtx {
  waitUntil(promise: Promise<unknown>): void;
}

const ctx = (): FakeCtx & { waited: Promise<unknown>[] } => {
  const waited: Promise<unknown>[] = [];
  return { waited, waitUntil: (p) => { waited.push(p); } };
};

describe('the Worker exports both entry points', () => {
  it('has a fetch handler for traffic', () => {
    expect(typeof worker.fetch).toBe('function');
  });

  it('has a scheduled handler, or the cron fires into nothing', () => {
    // The `crons = ["*/5 * * * *"]` in `wrangler.toml` is invisible to every
    // other test and to `tsc`. Deleting the export leaves the config valid, the
    // deploy green and the mirror frozen.
    expect(typeof worker.scheduled).toBe('function');
  });
});

describe('the cron handler never throws', () => {
  it('swallows a missing database configuration instead of failing the run', async () => {
    // No HYPERDRIVE and no DATABASE_URL: exactly the misconfiguration that
    // would reject `getEnv`. Cloudflare would not retry it.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        worker.scheduled({}, {} as never, ctx() as never),
      ).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it('swallows a failing database instead of failing the run', async () => {
    // A reachable-looking config whose connection is refused. Same contract: log
    // it, end the run, let the next tick try again.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        worker.scheduled(
          {},
          { DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nope' } as never,
          ctx() as never,
        ),
      ).resolves.toBeUndefined();
    } finally {
      err.mockRestore();
    }
  });
});
