/**
 * `event_type` → a sentence a person can read.
 *
 * ── Why the sentence lives here and not in the screen ────────────────────────
 *
 * One table, in one module, is the whole contract between the backend and the
 * UI about what a notification *says*. A screen that translated event types
 * itself would have a second copy of this table, in another language, drifting
 * from this one — and a new Privy event would render as an empty row in one of
 * the two.
 *
 * ── Why an unknown type is never blank and never dropped ─────────────────────
 *
 * Privy adds event types without asking. A blank line renders as a broken row; a
 * dropped event is an event that never happened as far as the person is
 * concerned. So the fallback says exactly one true thing — an event was received
 * — and invents nothing about which, when a chain failed, or whether money moved.
 */

export type NotificationCategory = 'account' | 'security' | 'wallet' | 'link' | 'other';

export interface EventDescription {
  /** A short Spanish sentence. Never blank, for any input. */
  readonly message: string;
  readonly category: NotificationCategory;
}

/**
 * What an event type we do not know says.
 *
 * It states that something happened and **invents nothing** about what: not the
 * type, not a chain, not a success. A blank line would render as a broken row, and
 * dropping the event would hide it from the person it belongs to.
 */
export const UNKNOWN_EVENT_MESSAGE = 'Se recibió un evento de tu cuenta.';

/**
 * The types this product knows about, as of the Privy events this POC receives.
 *
 * Keys are matched exactly. `USER.CREATED` is not `user.created`: guessing at
 * case would mean two names for one event, and the fallback exists precisely for
 * the case nobody thought of.
 */
const DESCRIPTIONS: Record<string, EventDescription> = {
  'user.created': { message: 'Se creó tu cuenta en ReWALLET.', category: 'account' },
  'user.updated': { message: 'Se actualizaron los datos de tu cuenta.', category: 'account' },
  'user.deleted': { message: 'Se eliminó tu cuenta.', category: 'account' },
  'user.signed_in': { message: 'Iniciaste sesión en ReWALLET.', category: 'security' },
  'user.auth_recovered': { message: 'Recuperaste el acceso a tu cuenta.', category: 'security' },
  'wallet.created': { message: 'Se creó una billetera nueva en tu cuenta.', category: 'wallet' },
  'wallet.deleted': { message: 'Se eliminó una billetera de tu cuenta.', category: 'wallet' },
  'linked_account.created': { message: 'Conectaste un método de acceso a tu cuenta.', category: 'link' },
  'linked_account.deleted': { message: 'Desconectaste un método de acceso de tu cuenta.', category: 'link' },
};

const FALLBACK: EventDescription = { message: UNKNOWN_EVENT_MESSAGE, category: 'other' };

export const describeEvent = (eventType: string): EventDescription =>
  DESCRIPTIONS[eventType] ?? FALLBACK;
