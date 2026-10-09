/**
 * PORT: `rewallet.idempotency_keys`, the table that makes a double tap a replay.
 *
 * ── Why the key that is stored carries the person in it ──────────────────────
 *
 * Because `key` is the table's PRIMARY KEY, and it is global. Storing the
 * `requestId` as it arrived would mean two properties, both wrong:
 *
 *   - **one person's `requestId` would block another's send.** A shared value
 *     that nobody coordinated is a collision, not a replay.
 *   - **the lookup would have to be by `requestId` alone**, which is exactly the
 *     lookup that produces the first bug.
 *
 * So the stored key is `userId | endpoint | requestId`, and every read and write
 * is also scoped by `user_id` and `endpoint` in SQL. The rule the product
 * actually has — *the same request, from the same person, at the same endpoint,
 * answers once* — is then a property of the primary key itself rather than
 * something the adapter has to remember to check.
 *
 * ── Why a claim is two steps: `reserve`, then `complete` ─────────────────────
 *
 * A single "prepare and store the answer" cannot protect a double tap: two
 * overlapping requests both find nothing and both prepare. So the key is claimed
 * **before** the transaction is built, and the answer is written onto the claim
 * afterwards.
 *
 * - `find` only answers for a claim that **finished**. An unfinished claim is
 *   not an answer, and serving it as one would hand the browser a `{}`.
 * - `reserve` answers `false` — not an error — when somebody else holds it.
 * - `release` gives an empty claim back, so a preparation that failed for an
 *   ordinary reason (an unreadable balance, say) does not leave the person's
 *   `requestId` burnt forever. It only ever releases a claim with no answer, so
 *   a stored response can never be deleted and the replay can never change.
 *
 * The TTL is on the row because the table has `expires_at NOT NULL`: an
 * idempotency key that never expires is a table that grows without bound, and a
 * client `requestId` is only ever meant to de-duplicate one attempt.
 */
/** One stored answer, with the status code it was stored with. */
export interface IdempotentResponse {
  readonly response: unknown;
  readonly statusCode: number;
}

export interface IdempotencyScope {
  /** The stored key: `userId | endpoint | requestId`. */
  readonly key: string;
  readonly userId: string;
  readonly endpoint: string;
}

export interface IdempotencyStore {
  /**
   * The stored answer for this scope, or `null` — including when the claim
   * exists and is still being prepared.
   */
  find(scope: IdempotencyScope): Promise<IdempotentResponse | null>;

  /**
   * Claims the key. `false` means somebody else already holds it; that is an
   * ordinary answer, not a failure.
   */
  reserve(scope: IdempotencyScope & { readonly expiresAt: Date }): Promise<boolean>;

  /** Writes the answer onto a claim this caller holds. */
  complete(scope: IdempotencyScope & { readonly response: unknown; readonly statusCode: number }): Promise<void>;

  /** Gives an **empty** claim back. A claim with an answer is never released. */
  release(scope: IdempotencyScope): Promise<void>;
}

/**
 * The stored key. Exported so the format has exactly one definition and a test
 * can assert it, rather than being a string assembled twice.
 *
 * `|` is not in a uuid, a path or a client-generated id, so the three parts can
 * never run together into another valid triple.
 */
export const idempotencyKeyFor = (userId: string, endpoint: string, requestId: string): string =>
  `${userId}|${endpoint}|${requestId}`;
