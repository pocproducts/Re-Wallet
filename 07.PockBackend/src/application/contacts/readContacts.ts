/**
 * USE CASE: la agenda real de esta billetera —a quién le mandaste plata por tag.
 *
 * ── Por qué el tag es la identidad y no el nombre ───────────────────────────
 *
 * El nombre se puede cambiar y dos personas pueden llamarse igual; el tag es la
 * clave con la que el backend resuelve el envío. Por eso la lista se ordena por
 * tag y el nombre es un dato que acompaña, nunca el que identifica.
 *
 * ── Por qué un tope ─────────────────────────────────────────────────────────
 *
 * Una agenda sin tope es un volcado del historial: la lista tiene que caber en
 * una pantalla y "las últimas" es lo que una persona busca cuando abre
 * "Enviar a otra ReWALLET" — a quién le mandé **re Recently**.
 */
import type { ContactsStore, RewalletContact } from '../../domain/ports/contacts-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

export interface ReadContacts {
  (userId: string): Promise<readonly RewalletContact[]>;
}

/** Cuántos contactos entran en la hoja. Es una pantalla, no un archivo. */
const MAX_CONTACTS = 30;

/** Lo que la base no pudo responder. La razón se queda en el log. */
export class ContactsUnavailable extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`contacts unavailable: ${reason}`, options);
    this.name = 'ContactsUnavailable';
  }
}

export const readContacts = (deps: {
  readonly store: Pick<ContactsStore, 'listForUser'>;
  readonly log?: Logger;
}): ReadContacts => {
  const log = deps.log ?? noopLogger;

  return async (userId) => {
    try {
      return await deps.store.listForUser(userId, MAX_CONTACTS);
    } catch (error) {
      /*
       * Una agenda vacía y una agenda que no se pudo leer se ven iguales en la
       * pantalla, y no son lo mismo: la primera dice "todavía no enviaste a
       * nadie", que es un hecho. La segunda no puede decir nada, y por eso
       * levanta una falla que la ruta traduce en un 502.
       */
      log.error('contacts.store_failed', { userId, error });
      throw new ContactsUnavailable('the movement rows could not be read', { cause: error });
    }
  };
};
