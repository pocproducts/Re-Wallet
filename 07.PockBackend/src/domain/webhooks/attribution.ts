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
 */

/** `user_did` is Privy's own field; the `user.id` shape is what its user objects carry. */
export const PERSON_DID_PATHS: readonly string[] = [
  'user_did',
  'user.id',
  'object.user_did',
  'object.user.id',
  'wallet.user_did',
];

/** `did:privy:...` and nothing else. Same rule as the token verifier. */
const DID_PATTERN = /^did:privy:[A-Za-z0-9._~-]{1,128}$/;

/**
 * The jsonb containment shapes for one person's events, in the order of
 * `PERSON_DID_PATHS`. `payload @> …` on any of them is the feed's filter, and
 * the GIN index on `payload` can serve it.
 */
export const personDidContainments = (privyDid: string): Record<string, unknown>[] =>
  PERSON_DID_PATHS.map((path) => {
    const keys = path.split('.');
    const last = keys[keys.length - 1] as string;
    const shape: Record<string, unknown> = {};
    let cursor = shape;
    for (const key of keys.slice(0, -1)) {
      const next: Record<string, unknown> = {};
      cursor[key] = next;
      cursor = next;
    }
    cursor[last] = privyDid;
    return shape;
  });

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
