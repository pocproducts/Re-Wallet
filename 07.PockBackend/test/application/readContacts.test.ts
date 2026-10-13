import { describe, expect, it } from 'vitest';

import { readContacts, ContactsUnavailable } from '../../src/application/contacts/readContacts';
import type { ContactsStore } from '../../src/domain/ports/contacts-store';

const CONTACT = {
  tag: 'faccha20',
  name: 'Nicolas Chaves',
  lastSentAt: new Date('2026-10-01T10:00:00Z'),
  sends: 3,
};

describe('readContacts', () => {
  it('pasa la lista del store y le pasa el tope como un límite de pantalla', async () => {
    const asked: { userId: string; limit: number }[] = [];
    const store: Pick<ContactsStore, 'listForUser'> = {
      listForUser: async (userId, limit) => {
        asked.push({ userId, limit });
        return [CONTACT];
      },
    };

    const read = readContacts({ store });
    expect(await read('user-1')).toEqual([CONTACT]);
    expect(asked).toEqual([{ userId: 'user-1', limit: 30 }]);
  });

  it('una agenda vacía es una agenda vacía: no es un fallo', async () => {
    const read = readContacts({ store: { listForUser: async () => [] } });
    expect(await read('user-1')).toEqual([]);
  });

  it('si la base no contesta, levanta ContactsUnavailable y no una lista vacía', async () => {
    const read = readContacts({
      store: {
        listForUser: async () => {
          throw new Error('connection terminated unexpectedly');
        },
      },
    });

    await expect(read('user-1')).rejects.toBeInstanceOf(ContactsUnavailable);
  });
});
