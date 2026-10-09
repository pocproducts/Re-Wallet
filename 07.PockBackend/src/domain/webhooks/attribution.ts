/**
 * Which person an event belongs to, if any.
 *
 * ── Why this is a list of named paths and not a deep search ───────────────────
 *
 * Attribution is a **claim about a payload**, so it may only be made from a path
 * whose meaning is known. Walking the payload looking for any `did:privy:` string
 * would attribute an event to whoever is *mentioned* in it, which is a different
 * thing from "this happened to this person". A wrong attribution puts one
 * person's event in another person's feed.
 *
 * So the paths below are the only ones read, and the same list builds the SQL
 * filter in the adapter — one definition of the shape, used for writing and for
 * reading, so the two cannot disagree.
 *
 * ── `user_id`, the entry that was missing, and what it cost ──────────────────
 *
 * This list read `user_did` and left out `user_id`, on the reasonable reading
 * that `user_did` is Privy's field for the person's DID. Privy demonstrably
 * sends `user_id` in production: the two real events on file in
 * `rewallet.webhook_events` both carry `user_id` at the top level —
 *
 * ```json
 * { "type": "wallet.created",  "user_id": "did:privy:…", "wallet_id": "rer86y…", … }
 * { "type": "user.signed_in",  "user_id": "did:privy:…" }
 * ```
 *
 * With `user_id` absent, **both** of them were unattributable: the feed returned
 * zero rows, with no error, no log line and nothing to debug. In production the
 * notification feed had been empty for every real event that has ever arrived. A
 * path list needs a real payload behind every entry, because the cost of a missing
 * entry is not a wrong answer, it is no answer at all.
 *
 * Both names stay. `user_did` is what Privy's documented payload shapes use, and
 * `user_id` is what it actually sent; they are true of different events, and
 * keeping the unobserved one costs one `OR` term while removing the observed one
 * would hide real events again.
 */

/**
 * `user_did` is Privy's own field; the `user.id` shape is what its user objects
 * carry; and `user_id` is what production has actually sent — see the header.
 *
 * `data.user_id` is precautionary and unobserved: no event on file nests it, but a
 * path that is never needed costs an inert `OR` term, whereas the path that turns
 * out to be needed costs every notification the person ever gets.
 */
export const PERSON_DID_PATHS: readonly string[] = [
  'user_did',
  'user.id',
  'object.user_did',
  'object.user.id',
  'wallet.user_did',
  'user_id',
  'data.user_id',
];

/**
 * ── Why a second list: the events that carry money carry no DID ──────────────
 *
 * Privy's money events — `wallet.funds_deposited`, `wallet.funds_withdrawn`,
 * `transaction.*` — never mention the person. They carry `wallet_id`, the id of
 * the wallet the event is about:
 *
 * ```json
 * { "type": "wallet.funds_deposited", "wallet_id": "fmfdj…", "caip2": "eip155:143", … }
 * { "type": "transaction.broadcasted", "data": { "wallet_id": "…", "transaction_id": "…" } }
 * ```
 *
 * With only `PERSON_DID_PATHS` those rows are not found: **zero rows and no
 * error**, which reads to the person as "you have no notifications" when the
 * truth is "these cannot be attributed yet". That is the worst way to fail —
 * silent, and with the wrong explanation.
 *
 * The wallet id is resolved the same way the DID is: from a list of paths whose
 * meaning is known, never by scanning the payload for anything that looks like an
 * id. `sender`/`recipient` are not here for the same reason `invited_by` is not
 * in the DID list: being mentioned is not being the person the event happened
 * to.
 *
 * And the other way round, just as strictly: an id that is not in
 * `rewallet.wallets` for this person attributes the event to **nobody**. It does
 * not fall back to "somebody", and it is not guessed from a shared address. The
 * feed shows a person their own history, not the history of every wallet id that
 * happens to appear in their events.
 */
export const PERSON_WALLET_ID_PATHS: readonly string[] = [
  'wallet_id',
  'data.wallet_id',
];

/**
 * The jsonb containment shape for one dotted path and one value.
 *
 * `containmentShape('data.wallet_id', 'fmfdj…')` is `{ data: { wallet_id: 'fmfdj…' } }`,
 * which `payload @> …` can be tested with and the GIN index can serve.
 *
 * One builder for both lists, so `PERSON_DID_PATHS` and `PERSON_WALLET_ID_PATHS`
 * cannot each grow their own idea of what a dotted path means.
 */
export const containmentShape = (path: string, value: string): Record<string, unknown> => {
  const keys = path.split('.');
  const last = keys[keys.length - 1] as string;
  const shape: Record<string, unknown> = {};
  let cursor = shape;
  for (const key of keys.slice(0, -1)) {
    const next: Record<string, unknown> = {};
    cursor[key] = next;
    cursor = next;
  }
  cursor[last] = value;
  return shape;
};

/** `did:privy:...` and nothing else. Same rule as the token verifier. */
const DID_PATTERN = /^did:privy:[A-Za-z0-9._~-]{1,128}$/;

/**
 * The jsonb containment shapes for one person's events, in the order of
 * `PERSON_DID_PATHS`. `payload @> …` on any of them is the feed's filter, and
 * the GIN index on `payload` can serve it.
 */
export const personDidContainments = (privyDid: string): Record<string, unknown>[] =>
  PERSON_DID_PATHS.map((path) => containmentShape(path, privyDid));

/**
 * The same shapes for a wallet id.
 *
 * The adapter cannot use these directly — it does not know the person's provider
 * wallet ids before the statement runs, and asking the database twice to join the
 * same fact is a round trip for nothing. It renders the **same paths** as
 * `jsonb_build_object` inside a subquery over `rewallet.wallets`, so this list
 * is still the single definition of the shapes.
 */
export const personWalletIdContainments = (providerWalletId: string): Record<string, unknown>[] =>
  PERSON_WALLET_ID_PATHS.map((path) => containmentShape(path, providerWalletId));

/** Reads one dotted path out of a parsed payload. `null` for anything else. */
const readPath = (payload: Record<string, unknown>, path: string): unknown => {
  let cursor: unknown = payload;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
};

/** The person's DID, or `null` when the event is not attributable to one. */
export const extractPersonDid = (payload: unknown): string | null => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  for (const path of PERSON_DID_PATHS) {
    const value = readPath(record, path);
    if (typeof value === 'string' && DID_PATTERN.test(value)) return value;
  }

  return null;
};
