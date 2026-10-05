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
 * ── Why the money entries name no amount and no chain ─────────────────────────
 *
 * The sentences below say **what happened**, in second person, and stop there.
 * They are what an event says when nothing about the payload is available — a
 * `transaction.*` event, which carries no `amount` at all, and a
 * `wallet.funds_deposited` whose chain or asset this product cannot place.
 *
 * ── Why the payload is read now, and only three fields of it ──────────────────
 *
 * A real deposit arrived and the notification could not say how much: the
 * person saw that funds landed and had to ask. So `describeEvent` now takes the
 * payload, and the *only* thing taken from it is a figure, via
 * `resolveEventAmount` (`.eventAmount.ts`): the decimals come from our own
 * catalog, never from the payload, and an unresolved chain or asset yields no
 * figure at all.
 *
 * The sentence may carry **an amount and a symbol**. It may never carry a
 * sender, a recipient, a `wallet_id` or a truncated address:
 * `docs/contrato-dinero.md` forbids showing a person an address, and a
 * notification is a place a person reads. The payload's other fields are
 * unreachable from here, not merely unused.
 *
 * The signature change is deliberate: the "unknown type is never blank and never
 * dropped" guarantee above is what this table exists to keep, and it holds
 * exactly as before for every input, payload or not.
 *
 * The `wallet.*` funds entries and the `transaction.*` lifecycle are all
 * category `wallet`: each one is about the person's wallet.
 *
 * `wallet_action.transfer.*` is deliberately **absent**. Those are Wallet Actions
 * — we ask Privy to perform the transfer. This product signs in the browser with
 * the person's own wallet, so those events can never fire here, and a sentence
 * for them would describe a flow this product does not have.
 */

import { resolveEventAmount } from './eventAmount';
import type { ResolvedAmount } from './eventAmount';

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

/**
 * The money events that may state a figure, and how each of them says it.
 *
 * A table like this rather than a second copy of `DESCRIPTIONS`: a sentence with
 * a figure in it is a **function** of the amount, and an event type absent from
 * here keeps the sentence in the table above whatever the payload says. That is
 * also what keeps `transaction.*` unchanged — they carry no `amount`, and they
 * are not in this table, so nothing is invented for them.
 */
const AMOUNT_SENTENCES: Record<string, (amount: ResolvedAmount) => string> = {
  'wallet.funds_deposited': (amount) => `Entraron ${amount.value} ${amount.symbol}.`,
  'wallet.funds_withdrawn': (amount) => `Salieron ${amount.value} ${amount.symbol} de tu billetera.`,
};

/**
 * The event type → sentence.
 *
 * `payload` is the stored row's payload, and it is optional: with none — a
 * `transaction.*` event, or a caller that has no payload — the table's sentence
 * stands unchanged. When one is given, it is read for a figure **only**, and only
 * for the event types in `AMOUNT_SENTENCES`; anything unresolvable leaves the
 * sentence exactly as it was, digits included none of.
 */
export const describeEvent = (
  eventType: string,
  payload?: Readonly<Record<string, unknown>> | null,
): EventDescription => {
  const described = DESCRIPTIONS[eventType] ?? FALLBACK;
  const sayAmount = AMOUNT_SENTENCES[eventType];
  if (sayAmount === undefined || payload === undefined || payload === null) return described;

  const amount = resolveEventAmount(payload);
  if (amount === null) return described;

  return { ...described, message: sayAmount(amount) };
};
