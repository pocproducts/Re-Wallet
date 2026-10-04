/**
 * PORT: the `rewallet.webhook_events` rows.
 *
 * It exists so the intake and the feed can be exercised with no network and no
 * database, and so the route never learns that `rewallet.webhook_events` is
 * Postgres.
 *
 * ── Why a verified event carries `signature_valid: true` implicitly ───────────
 *
 * There is no way to reach `store` with an unverified payload: the application
 * use case verifies the signature first and only then builds a `VerifiedWebhookEvent`.
 * The column is still written, because the table says a row records *that the
 * signature was checked* — an audit fact, not an application convenience.
 */
export interface VerifiedWebhookEvent {
  readonly source: 'privy';
  readonly eventType: string;
  /** Deduplication key. `UNIQUE (source, external_id)`. */
  readonly externalId: string;
  /** The person this event belongs to, or `null` for an app-level event. */
  readonly privyDid: string | null;
  readonly payload: Record<string, unknown>;
  readonly receivedAt: Date;
}

export interface StoredWebhookEvent {
  /**
   * `false` when `UNIQUE (source, external_id)` already held the row: a retry of
   * an event already on file. **Not** an error — see the intake use case.
   */
  readonly inserted: boolean;
}

export interface PersonWebhookEvent {
  readonly id: string;
  readonly eventType: string;
  readonly createdAt: Date;
}

export interface WebhookEventStore {
  /**
   * Writes the event, or reports that the same `(source, external_id)` is already
   * stored. The caller decides what that means; the store does not raise.
   */
  store(event: VerifiedWebhookEvent): Promise<StoredWebhookEvent>;

  /** This person's events only, newest first, at most `limit` rows. */
  listForPerson(privyDid: string, limit: number): Promise<readonly PersonWebhookEvent[]>;
}
