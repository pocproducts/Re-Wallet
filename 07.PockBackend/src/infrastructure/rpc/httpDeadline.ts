/**
 * THE DEADLINE POLICY: one outbound HTTP attempt, one deadline, one reason.
 *
 * ── Why this exists and is not seven copies of `setTimeout` ───────────────────
 *
 * Every adapter under `infrastructure/rpc` leaves the isolate over HTTP, and
 * every one of them used to do it with a bare `await fetch(url, …)`. A bare
 * `fetch` has no deadline of its own, so a peer that accepts the connection and
 * then says nothing — a public RPC endpoint behind a proxy that blackholes, a
 * TLS handshake that never completes — holds the Worker request open until the
 * platform gives up. The person sees a screen that never resolves, and the only
 * thing that ends it is a limit nobody here chose.
 *
 * The fix is one line at each call site, which is exactly why it does not
 * survive: seven call sites today, seven more after the next adapter, and a
 * deadline nobody owns is a deadline that drifts. So the policy lives here, once:
 * an adapter states **how long its own operation is worth waiting for** and gets
 * the rest — the signal, the timer, the distinction between *our* abort and a
 * network failure — for free.
 *
 * ── Why the deadline is per adapter and not one number for the codebase ───────
 *
 * The right deadline is a property of the operation, not of the repository. An
 * `eth_call` into an Aave pool reads many storage slots of one reserve; a Kamino
 * REST GET returns a small JSON document from an edge cache. A single number for
 * both would be either too patient for the balance page or too impatient for the
 * page that paints a pool. Each adapter therefore declares its own
 * {@link DeadlinePolicy} and defends it at the constant.
 *
 * ── Why a timeout is a transport failure and not a bad answer ─────────────────
 *
 * This is the whole point of the module, and the reason it cannot be a
 * three-line helper. A read that ran out of time has told us **nothing**: it is
 * emphatically not a zero, not an empty list, not a malformed answer. Each
 * adapter maps it to the transport reason it already has —
 * `RPC_UNAVAILABLE`, `RPC_REJECTED`'s sibling in the price vocabulary,
 * `KAMINO_UNAVAILABLE`, `RPC_UNAVAILABLE` on the transfer preparer — and this
 * module exists so that mapping happens at the abort, where it cannot be
 * forgotten, instead of in a catch block that someone may forget to write.
 *
 * The failure is also **named**, not generic. An operator reading a log has to
 * be able to tell "the endpoint did not answer in 3s" from "DNS failed": the
 * first is a provider being slow or a network path being blackholed, the second
 * is a name that does not resolve. {@link HttpDeadlineExceededError} carries that
 * sentence and the deadline it was given, and it is thrown in place of the
 * underlying error rather than beside it.
 *
 * ── Why the abort reason is the error itself ─────────────────────────────────
 *
 * `fetch` rejects with whatever `AbortController.abort(reason)` was handed, and a
 * stalled **body** read rejects with that same object. Aborting *with* the error
 * is therefore what lets an adapter's body-reading `catch` tell our deadline
 * apart from a body that was not JSON — and without that, an endpoint that sends
 * headers and then stalls would be reported as `RPC_MALFORMED_RESPONSE`, which is
 * precisely the lie this codebase is built to avoid: it would file the endpoint's
 * silence as a bug in this adapter and hide a real outage behind our name for it.
 *
 * ── Why the deadline also covers the body ────────────────────────────────────
 *
 * Headers arriving is not the answer. `response.json()` reads the rest of the
 * exchange, and an endpoint that sends a head and then goes quiet is the same
 * outage as one that sends nothing. The body is therefore piped through a
 * transform whose only job is to release the deadline when the exchange ends —
 * which is why the caller still receives an ordinary `Response` and does not have
 * to know that any of this happened.
 *
 * The one body this module refuses to wait for is the body of a **non-ok**
 * response: a provider's error page never crosses this boundary anywhere in this
 * repository (see `describeUnparseableBody`), so nobody is going to read it, and
 * holding a deadline open for a body nobody consumes would make every failed
 * endpoint candidate cost its full timeout twice — once waiting, once draining.
 *
 * ── Why the timer is injectable ──────────────────────────────────────────────
 *
 * A deadline tested by sleeping is a test that is slow when it passes and flaky
 * when it does not. {@link DeadlinePolicy.schedule} is the seam: the production
 * schedule is `setTimeout`, and a test supplies one that captures the callback
 * and fires it exactly when it decides the deadline has come. No test in this
 * repository waits for wall time to expire a timeout.
 */

/**
 * How a deadline is armed and disarmed.
 *
 * It is given the delay it should wait and the callback to run when it expires,
 * and it returns the function that cancels it. Nothing else about the timer is
 * exposed, and nothing else needs to be: the policy has to be drivable by hand.
 */
export type DeadlineSchedule = (fireInMs: number, onDeadline: () => void) => () => void;

/**
 * What an adapter is willing to wait for its own operation.
 *
 * `schedule` is optional and defaults to `setTimeout`; it exists so a test can
 * decide when the deadline comes instead of waiting for it.
 */
export interface DeadlinePolicy {
  readonly timeoutMs: number;
  readonly schedule?: DeadlineSchedule;
}

/**
 * The one failure this module produces: the endpoint did not answer in time.
 *
 * It is a distinct class, not a string, because every adapter has to tell it
 * apart from the other way a request fails before it can map it — and because
 * the sentence it carries is what the log has to say.
 */
export class HttpDeadlineExceededError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`the endpoint did not answer in ${describeDuration(timeoutMs)}`, options);
    this.name = 'HttpDeadlineExceededError';
    this.timeoutMs = timeoutMs;
  }
}

/** `3000` → `3s`, so the log sentence is readable and the number is exact. */
const describeDuration = (timeoutMs: number): string =>
  timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;

const setTimeoutSchedule: DeadlineSchedule = (fireInMs, onDeadline) => {
  const handle = setTimeout(onDeadline, fireInMs);
  return (): void => clearTimeout(handle);
};

/** Whether a failure is **our** deadline, as opposed to any other network error. */
export const isDeadlineExceeded = (error: unknown): error is HttpDeadlineExceededError =>
  error instanceof HttpDeadlineExceededError;

/**
 * The name a flattened failure carries when a client library stringified us.
 *
 * `@solana/web3.js` does not re-throw a failed `fetch`: it catches it inside
 * `Connection` and builds a fresh `Error` whose **message** embeds the original,
 * as `"failed to get recent blockhash: HttpDeadlineExceededError: …"`. Nothing
 * but the text survives — no `cause`, no class — so the class name is the marker,
 * and it is in the message for exactly that reason.
 */
const FLATTENED_MARKER = `${HttpDeadlineExceededError.name}: `;

/**
 * The deadline inside a failure, however many libraries wrapped it on the way out.
 *
 * `fetch` rejects with the abort reason directly, but not every caller hands the
 * rejection straight back: `@solana/web3.js` catches it inside `Connection` and
 * throws its own error with the original as `cause`. Without following the chain,
 * the deadline would arrive at the adapter wearing somebody else's message and be
 * reported as a generic transport failure — the exact thing this module exists to
 * prevent, arriving through the one path that had not been thought about.
 *
 * The walk is bounded because a cause chain is not a linked list anyone controls.
 *
 * When the chain is gone — flattened into a message, as above — the marker is the
 * last way to recognise the deadline, and the error it returns is the one whose
 * message carries it. That is the right thing to hand back: the sentence an
 * operator reads then names both what the library tried to do and how long the
 * endpoint was given.
 */
export const deadlineOf = (error: unknown, depth = 5): Error | undefined => {
  let current = error;
  for (let hop = 0; hop <= depth; hop += 1) {
    if (isDeadlineExceeded(current)) return current;
    if (current instanceof Error && current.message.includes(FLATTENED_MARKER)) return current;
    if (!(current instanceof Error)) return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

/**
 * The sentence to log for a transport failure.
 *
 * `otherwise` is what the adapter says when the request failed for its own
 * reasons — DNS, TLS, a refused connection — because this repository has always
 * had words for those. A deadline has different words, and an operator reading
 * "did not reach the endpoint" for a request that was deliberately given up on
 * would be reading the wrong story.
 */
export const transportDetail = (error: unknown, otherwise: string): string =>
  deadlineOf(error)?.message ?? otherwise;

/**
 * One request, one deadline.
 *
 * The returned function has the shape of `fetch` and is built **once** per
 * adapter, at construction: a call site cannot forget the deadline because it
 * never has the choice of sending without one. That is the property that makes
 * this a policy instead of seven timeouts.
 */
export const withDeadline = (send: typeof fetch, policy: DeadlinePolicy): typeof fetch =>
  ((input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    sendWithinDeadline(send, input, init ?? {}, policy)) as typeof fetch;

const sendWithinDeadline = async (
  send: typeof fetch,
  input: string | URL | Request,
  init: RequestInit,
  policy: DeadlinePolicy,
): Promise<Response> => {
  const schedule = policy.schedule ?? setTimeoutSchedule;
  const controller = new AbortController();

  let expired = false;
  let release: (() => void) | undefined;

  const onDeadline = (): void => {
    expired = true;
    /*
     * Aborting *with* the error is what carries the reason into a stalled body
     * read: the body rejects with this exact object, so the adapter's own catch
     * can tell our deadline from a body that was not JSON.
     */
    controller.abort(new HttpDeadlineExceededError(policy.timeoutMs));
    // A schedule that already fired leaves nothing to cancel.
    release?.();
  };

  const cancel = schedule(policy.timeoutMs, onDeadline);
  release = cancel;
  if (expired) release = undefined;

  let response: Response;
  try {
    /*
     * `init.signal` is ours: an adapter hands this wrapper its options and gets a
     * deadline back, and a caller-supplied signal would be the one thing able to
     * cancel a read that is supposed to be bounded. The bound is the policy.
     */
    response = await send(input, { ...init, signal: controller.signal });
  } catch (error) {
    release?.();
    // A rejection under an expired deadline is a timeout whatever the transport
    // called it — `AbortError`, a socket reset, anything.
    if (expired) throw new HttpDeadlineExceededError(policy.timeoutMs, { cause: error });
    throw error;
  }

  // No body to wait for: nothing can hang, so the deadline is spent.
  if (response.body === null) {
    release?.();
    return response;
  }

  /*
   * A non-ok status is an answer on its own. This repository never reads a
   * provider's error page — it is unbounded, sometimes HTML, and never crosses
   * this boundary — so the body is dropped rather than drained, and the deadline
   * is released instead of being held open for bytes nobody will consume.
   */
  if (!response.ok) {
    await response.body.cancel().catch(() => undefined);
    release?.();
    return response;
  }

  /*
   * The rest of the exchange, still bounded. The transform enqueues everything
   * unchanged and exists only to release the deadline when the body ends, is
   * cancelled, or is aborted — the third of which is the case this whole module
   * was written for.
   */
  const guarded = new Response(
    response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => controller.enqueue(chunk),
        flush: () => release?.(),
        cancel: () => release?.(),
      }),
    ),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );

  return guarded;
};
