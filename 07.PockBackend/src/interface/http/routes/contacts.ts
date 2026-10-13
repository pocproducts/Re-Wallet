/**
 * `GET /api/contacts` — a quién le mandaste plata por tag, en tu billetera.
 *
 * ── El mismo contrato que el resto ───────────────────────────────────────────
 *
 * Misma cookie, mismo codec, mismo 401, mismo "no leer nada si falla". La lista
 * es de **esta** persona: sale de sus movimientos y de nadie más, y no hay
 * ningún parámetro por el que se pueda pedir la agenda de otra.
 *
 * ── Por qué no devuelve direcciones ──────────────────────────────────────────
 *
 * Un contacto es un handle de ReWALLET. La dirección es de la billetera y ya
 * está en su propia pantalla; mezclarla en la agenda la convierte en una lista
 * de destinos que la app podría mandar plata por un toque, que es exactamente
 * el problema que los contactos mockeadosTRAeían.
 */
import { Hono } from 'hono';

import type { ReadContacts } from '../../../application/contacts/readContacts';
import { ContactsUnavailable } from '../../../application/contacts/readContacts';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';

export const CONTACTS_UNAVAILABLE_BODY = { error: { code: 'CONTACTS_UNAVAILABLE' } } as const;

export interface ContactsDeps {
  readonly sessions: SessionCodec;
  readonly readContacts: ReadContacts;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createContactsRoutes = (deps: ContactsDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.get('/', async (c) => {
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      const contacts = await deps.readContacts(claims.userId);
      return c.json(
        {
          generatedAt: clock().toISOString(),
          contacts: contacts.map((contact) => ({
            tag: contact.tag,
            name: contact.name,
            lastSentAt: contact.lastSentAt.toISOString(),
            sends: contact.sends,
          })),
        },
        200,
      );
    } catch (error) {
      if (error instanceof ContactsUnavailable) {
        log.error('contacts.failed', error);
        return c.json(CONTACTS_UNAVAILABLE_BODY, 502);
      }
      log.error('contacts.unhandled', error);
      return c.json({ error: { code: 'INTERNAL' } }, 500);
    }
  });

  return app;
};
