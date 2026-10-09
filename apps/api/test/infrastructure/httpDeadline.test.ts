/**
 * The deadline policy itself: one attempt, one deadline, one reason.
 *
 * No network and — the point of the injectable schedule — **no wall time**. Every
 * test here arms the deadline by hand and fires it when it decides the time has
 * come, so a test about a four-second timeout finishes in microseconds and cannot
 * flake on a loaded machine.
 */
import { describe, expect, it } from 'vitest';

import {
  HttpDeadlineExceededError,
  deadlineOf,
  isDeadlineExceeded,
  transportDetail,
  withDeadline,
  type DeadlinePolicy,
  type DeadlineSchedule,
} from '../../src/infrastructure/rpc/httpDeadline';

/**
 * A schedule the test drives by hand.
 *
 * It records that a deadline was armed — which is what proves a request cannot go
 * out without one — and hands back the moment to expire it.
 */
const manualDeadline = (
  timeoutMs = 4_000,
): { deadline: DeadlinePolicy; armed: () => number; expire: () => void; releases: () => number } => {
  let armedFor: number | undefined;
  let pending: (() => void) | undefined;
  let releases = 0;

  const schedule: DeadlineSchedule = (fireInMs, onDeadline) => {
    armedFor = fireInMs;
    pending = onDeadline;
    return () => {
      releases += 1;
      pending = undefined;
    };
  };

  return {
    deadline: { timeoutMs, schedule },
    armed: () => armedFor ?? -1,
    expire: () => {
      if (pending === undefined) throw new Error('no deadline is armed');
      pending();
    },
    releases: () => releases,
  };
};

/** A `fetch` that never answers, and only ever settles when its signal aborts. */
const hangingFetch = (seen?: { signal?: AbortSignal | null }): typeof fetch =>
  ((_input: unknown, init?: RequestInit) => {
    seen && (seen.signal = init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        // Exactly what a real `fetch` does: it rejects with the abort reason, so
        // a caller that can name the reason is the only caller that can tell a
        // deadline from a network failure.
        reject(init?.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
      });
    });
  }) as unknown as typeof fetch;

/** A `fetch` that answers headers and then stops sending the rest of the body. */
const stallingBodyFetch = (): typeof fetch =>
  ((_input: unknown, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"result":"0x2'));
        // The signal is what ends a real body; the fake has to end it too.
        init?.signal?.addEventListener('abort', () => controller.error(init?.signal?.reason));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as unknown as typeof fetch;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the deadline policy', () => {
  it('gives every request a signal, and a deadline to go with it', async () => {
    const clock = manualDeadline(4_000);
    const seen: { signal?: AbortSignal | null } = {};

    const send = withDeadline(hangingFetch(seen), clock.deadline);
    const pending = send('https://endpoint.invalid', { method: 'POST' });
    pending.catch(() => undefined);

    await settle();
    expect(clock.armed()).toBe(4_000);
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal?.aborted).toBe(false);
  });

  it('rejects a hung endpoint with a named deadline, not with a network error', async () => {
    const clock = manualDeadline(3_000);
    const send = withDeadline(hangingFetch(), clock.deadline);

    const pending = send('https://endpoint.invalid', { method: 'POST' });
    await settle();
    clock.expire();

    const failure = await pending.then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDeadlineExceeded(failure)).toBe(true);
    // The sentence an operator reads. "did not answer in 3s" is a provider being
    // silent; "did not reach the endpoint" would send them after DNS.
    expect((failure as Error).message).toBe('the endpoint did not answer in 3s');
    expect((failure as HttpDeadlineExceededError).timeoutMs).toBe(3_000);
  });

  it('bounds the body as well as the request — headers are not the answer', async () => {
    const clock = manualDeadline(5_000);
    const send = withDeadline(stallingBodyFetch(), clock.deadline);

    const response = await send('https://endpoint.invalid', { method: 'POST' });
    const pendingBody = response.json();
    await settle();
    clock.expire();

    // A body that stops mid-answer rejects with the deadline itself, so the
    // adapter above can map it to transport and not to a corrupt document.
    const failure = await pendingBody.then(
      () => null,
      (error: unknown) => error,
    );
    expect(isDeadlineExceeded(failure)).toBe(true);
  });

  it('releases the deadline once a whole answer has been read', async () => {
    const clock = manualDeadline(4_000);
    const send = withDeadline(
      (async () => new Response('{"result":"0x2a"}', { status: 200 })) as unknown as typeof fetch,
      clock.deadline,
    );

    const response = await send('https://endpoint.invalid', { method: 'POST' });
    expect(await response.json()).toEqual({ result: '0x2a' });
    await settle();

    // Nothing left armed: a released deadline is one that cannot hold a Worker
    // request open after the answer is already in hand.
    expect(clock.releases()).toBeGreaterThan(0);
    expect(() => clock.expire()).toThrow(/no deadline is armed/);
  });

  it('releases the deadline on an error status without reading the body', async () => {
    const clock = manualDeadline(4_000);
    const send = withDeadline(
      (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode('<html>rate limited</html>'));
              controller.close();
            },
          }),
          { status: 429 },
        )) as unknown as typeof fetch,
      clock.deadline,
    );

    const response = await send('https://endpoint.invalid', { method: 'POST' });
    expect(response.status).toBe(429);
    await settle();

    /*
     * A provider's error page never crosses this boundary, so the deadline is not
     * held open for bytes nobody will consume. The stream is dropped rather than
     * drained, which is what an error page deserves: it is unbounded, sometimes
     * HTML, and never read by anything here.
     */
    const delivered = await response.text().then(
      (text) => text,
      () => '',
    );
    expect(delivered).not.toContain('rate limited');
    expect(clock.releases()).toBeGreaterThan(0);
  });

  it('leaves every other failure exactly as it was', async () => {
    const send = withDeadline(
      (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
      manualDeadline(4_000).deadline,
    );

    await expect(send('https://endpoint.invalid')).rejects.toThrow(TypeError);
  });
});

describe('telling a deadline apart from any other failure', () => {
  it('names a deadline in the log line and leaves the rest of the vocabulary alone', () => {
    const deadline = new HttpDeadlineExceededError(3_000);
    expect(isDeadlineExceeded(deadline)).toBe(true);
    expect(transportDetail(deadline, 'did not reach the endpoint')).toBe('the endpoint did not answer in 3s');

    // Everything else keeps the words this repository has always used for it, so
    // the log does not start describing DNS failures as timeouts.
    expect(isDeadlineExceeded(new TypeError('fetch failed'))).toBe(false);
    expect(transportDetail(new TypeError('fetch failed'), 'did not reach the endpoint')).toBe(
      'did not reach the endpoint',
    );
    expect(transportDetail('not an error at all', 'did not reach the endpoint')).toBe('did not reach the endpoint');
  });

  it('says milliseconds when the deadline is not a round number of them', () => {
    expect(new HttpDeadlineExceededError(2_500).message).toBe('the endpoint did not answer in 2500ms');
  });

  it('still names the deadline through a client library that wrapped it', () => {
    /*
     * `@solana/web3.js` catches the rejection inside `Connection` and throws its
     * own error with the original as `cause`, so the deadline arrives wearing
     * somebody else's message. Following the chain is what keeps the log honest.
     */
    const deadline = new HttpDeadlineExceededError(5_000);
    const wrapped = new Error('RPC connection failed', { cause: deadline });

    expect(isDeadlineExceeded(wrapped)).toBe(false);
    expect(deadlineOf(wrapped)).toBe(deadline);
    expect(transportDetail(wrapped, 'could not be read')).toBe('the endpoint did not answer in 5s');
  });

  it('still names the deadline through a client library that flattened it', () => {
    /*
     * The same library in its other path: the failure is not re-thrown at all, it
     * is stringified into a new message. Nothing survives but the text, and the
     * text is still readable — so the operator gets both the library's own words
     * and the deadline, in one line.
     */
    const flattened = new Error('failed to get recent blockhash: HttpDeadlineExceededError: the endpoint did not answer in 5s');

    expect(isDeadlineExceeded(flattened)).toBe(false);
    expect(transportDetail(flattened, 'could not be read')).toBe(flattened.message);

    // And an unrelated failure is never mistaken for one.
    expect(transportDetail(new Error('failed to fetch: 429'), 'could not be read')).toBe('could not be read');
  });
});
