/**
 * The bounded failure a price read can produce on its way to becoming a
 * `PriceResult`.
 *
 * ── Why an error object and not a reason returned everywhere ─────────────────
 *
 * The adapter has real work to do between "the node said no" and "here is the
 * union": several calls, several channels, three breakers. Threading a reason
 * through all of it by hand is how a `throw` and a `return` end up meaning
 * different things. An error carrying a bounded `reason` crosses every frame on
 * its own, and the union is built at exactly one place — where the port's
 * signature is honoured — so the two shapes cannot drift.
 *
 * ── Why the reason is bounded here too ───────────────────────────────────────
 *
 * Same rule as `BalanceReadError`, and for the same reason: a JSON-RPC error
 * from a public endpoint carries whatever the endpoint decided to put in it — a
 * sentence, sometimes an HTML page from a proxy. That text goes to the log, where
 * an operator can read it. The six names in `PriceFeedFailure` are what crosses
 * into the application, and a screen can only render a name.
 */
import type { PriceFeedFailure } from '../ports/price-feed';

export class PriceFeedError extends Error {
  readonly reason: PriceFeedFailure;

  constructor(reason: PriceFeedFailure, detail: string, options?: { cause?: unknown }) {
    // `detail` is deliberately NOT in a field anything can answer to: it is
    // logged, never returned.
    super(`Price read failed (${reason}): ${detail}`, options);
    this.name = 'PriceFeedError';
    this.reason = reason;
  }
}
