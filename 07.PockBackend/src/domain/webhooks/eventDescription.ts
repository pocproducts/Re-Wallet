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
 *
 * ── Why the money entries name no amount, no asset and no chain ──────────────
 *
 * `wallet.funds_deposited` carries `amount` and `asset`; `transaction.*` carries
 * neither. A table keyed only by `event_type` cannot say "0.4 MON" for one of them
 * and stay honest for the other, and a sentence that invents a figure for the
 * events that lack one is worse than a short one. So each sentence below says
 * **what happened**, in second person, and stops there.
 *
 * Taking the payload into account would mean changing `describeEvent`'s signature
 * and every caller with it — a deliberate change, not a free one, because the
 * "unknown type is never blank and never dropped" guarantee above is what this
 * table exists to keep.
 *
 * The `wallet.*` funds entries and the `transaction.*` lifecycle are all
 * category `wallet`: each one is about the person's wallet.
 *
 * `wallet_action.transfer.*` is deliberately **absent**. Those are Wallet Actions
 * — we ask Privy to perform the transfer. This product signs in the browser with
 * the person's own wallet, so those events can never fire here, and a sentence
 * for them would describe a flow this product does not have.
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

  /* Money. What happened, in the second person, with nothing the payload does not carry. */
  'wallet.funds_deposited': { message: 'Llegaron fondos a tu billetera.', category: 'wallet' },
  'wallet.funds_withdrawn': { message: 'Salieron fondos de tu billetera.', category: 'wallet' },
  'transaction.broadcasted': { message: 'Se envió una transacción desde tu billetera.', category: 'wallet' },
  'transaction.confirmed': { message: 'Se confirmó una transacción de tu billetera.', category: 'wallet' },
  'transaction.execution_reverted': { message: 'Una transacción de tu billetera se revirtió.', category: 'wallet' },
  'transaction.failed': { message: 'Una transacción de tu billetera falló.', category: 'wallet' },
  'transaction.still_pending': { message: 'Una transacción de tu billetera sigue pendiente.', category: 'wallet' },
  'transaction.replaced': { message: 'Una transacción de tu billetera fue reemplazada.', category: 'wallet' },
};

const FALLBACK: EventDescription = { message: UNKNOWN_EVENT_MESSAGE, category: 'other' };

export const describeEvent = (eventType: string): EventDescription =>
  DESCRIPTIONS[eventType] ?? FALLBACK;
