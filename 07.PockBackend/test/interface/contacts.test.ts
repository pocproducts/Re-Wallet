import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME } from '../../src/interface/http/cookie';
import { createContactsRoutes } from '../../src/interface/http/routes/contacts';
import { ContactsUnavailable } from '../../src/application/contacts/readContacts';
import type { SessionCodec } from '../../src/domain/ports/session-codec';

const GOOD_COOKIE = `${SESSION_COOKIE_NAME}=good`;

const sessions = {
  issue: async () => {
    throw new Error('not used');
  },
  read: async (token: string, _now: Date) =>
    token === 'good' ? { userId: 'user-1', privyDid: 'did:privy:x' } : null,
} as SessionCodec;

const contact = {
  tag: 'faccha20',
  name: 'Nicolas Chaves',
  lastSentAt: new Date('2026-10-01T10:00:00.000Z'),
  sends: 3,
};

const app = (readContacts: Parameters<typeof createContactsRoutes>[0]['readContacts']) =>
  createContactsRoutes({ sessions, readContacts, now: () => new Date('2026-10-02T00:00:00Z') });

const get = (target: ReturnType<typeof app>, cookie?: string) =>
  target.request('/', { headers: cookie ? { cookie } : {} });

describe('GET /api/contacts', () => {
  it('responde la agenda de esta persona, con la fecha en ISO', async () => {
    const response = await get(app(async () => [contact]), GOOD_COOKIE);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      generatedAt: '2026-10-02T00:00:00.000Z',
      contacts: [{ tag: 'faccha20', name: 'Nicolas Chaves', lastSentAt: '2026-10-01T10:00:00.000Z', sends: 3 }],
    });
  });

  it('sin sesión responde 401: la agenda de alguien es de alguien', async () => {
    expect((await get(app(async () => []))).status).toBe(401);
  });

  it('cuando la lista no se pudo leer responde 502, no una agenda vacía', async () => {
    const failing = app(async () => {
      throw new ContactsUnavailable('the movement rows could not be read');
    });
    const response = await get(failing, GOOD_COOKIE);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'CONTACTS_UNAVAILABLE' } });
  });

  it('un fallo que no es de la lista responde el 500 del servidor, sin filtrar el motivo', async () => {
    const broken = app(async () => {
      throw new Error('connection terminated unexpectedly');
    });
    const response = await get(broken, GOOD_COOKIE);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL' } });
  });
});
