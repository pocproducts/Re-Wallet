/**
 * The bounded failures a balance read can produce.
 *
 * ── Why an enum and not the provider's own words ──────────────────────────────
 *
 * A JSON-RPC error from a public endpoint carries whatever the endpoint decided
 * to put in it: a sentence, sometimes a URL, sometimes an HTML page from a proxy.
 * Forwarding that to a browser is a leak and an unbounded string, and it is
 * useless to a screen, which can only render "we could not read this chain".
 *
 * So the reason crossing this boundary is one of three names, and the provider's
 * own words go to the log, where an operator can read them.
 *
 * ── Why three and not two ────────────────────────────────────────────────────
 *
 * `RPC_REJECTED` means the endpoint answered and said no — rate limit, method not
 * allowed, pruned node. `RPC_UNAVAILABLE` means it did not answer. `RPC_MALFORMED_RESPONSE`
 * means it answered with something this adapter cannot read as a number, which is
 * the case that must never be mistaken for a zero. They are separated because
 * they are fixed by different people: a malformed answer is ours to investigate,
 * an unavailable endpoint is not.
 */

/** Bounded by construction. No provider text ever crosses this boundary. */
export type BalanceReadFailure = 'RPC_UNAVAILABLE' | 'RPC_MALFORMED_RESPONSE' | 'RPC_REJECTED';

export class BalanceReadError extends Error {
  readonly reason: BalanceReadFailure;

  constructor(reason: BalanceReadFailure, detail: string, options?: { cause?: unknown }) {
    // `detail` is deliberately NOT in the message: it is logged, never answered.
    super(`Balance read failed (${reason}): ${detail}`, options);
    this.name = 'BalanceReadError';
    this.reason = reason;
  }
}