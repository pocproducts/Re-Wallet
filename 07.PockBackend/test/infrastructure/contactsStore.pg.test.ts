/**
 * El store de contactos, contra un transporte falso.
 *
 * Lo que está bajo prueba es la **traducción**: una consulta que este proyecto
 * eligió escribir para derivar la agenda de `rewallet.movements`. La elección
 * que es invisible desde la capa de aplicación, y que muerde:
 *
 *   1. **El `JOIN` tiene que ser por `tag_normalized`.** `prepareSend` normaliza
 *      el destino antes de escribirlo —`normalizeRecipientTag` saca el `@` y
 *      baja a minúsculas—, así que `meta.recipientTag` se guarda **sin** `@`.
 *      `users.tag` es la columna pública, **con** `@`, y con la constraint
 *      `^@[a-z0-9_]{2,19}$`. Juntar por ahí no casa nunca: la consulta
 *      devuelve las filas correctas con el nombre en `null` y nada delata el
 *      error. Por eso el `JOIN` va contra `tag_normalized`, que comparte forma
 *      con lo que se escribió, y hay un test que falla si vuelve a `u.tag`.
 *   2. **Un envío pegando una dirección no es un contacto.** Sin
 *      `recipientTag` no hay a quién atribuir la agenda, así que la consulta
 *      filtra los nulos y los vacíos en vez de devolver una fila sin nombre.
 *   3. **`DISTINCT ON` con el mismo `ORDER BY`**, para que la fila que sobrevive
 *      sea la más reciente de cada tag en una sola pasada.
 *   4. **El orden final es por recencia y no por tag.** En SQL el `ORDER BY`
 *      tiene que llevar `tag` primero para que `DISTINCT ON` sea legal; la
 *      ordenación que la persona lee es otra, y se hace en TypeScript.
 */
import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/client';
import { createPostgresContactsStore } from '../../src/infrastructure/db/contactsStore.pg';

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface Seen {
  readonly text: string;
  readonly values: unknown[];
}

const recordingDb = (rows: unknown): Database & { readonly seen: Seen[] } => {
  const seen: Seen[] = [];
  const query = async (sql: string, params?: unknown[]): Promise<unknown> => {
    seen.push({ text: sql, values: params ?? [] });
    return rows;
  };
  return Object.assign(() => Promise.resolve(rows), {
    unsafe: (sql: string) => sql,
    query,
    json: (value: unknown) => value,
    seen,
  }) as unknown as Database & { readonly seen: Seen[] };
};

const sqlOf = (db: { readonly seen: readonly Seen[] }): string =>
  db.seen.map((call) => call.text).join('\n');

const ROWS = [
  { tag: 'ana.abcd', name: 'Ana', last_sent_at: new Date('2026-10-01T00:00:00.000Z'), sends: 3 },
  { tag: 'bruno.x', name: 'Bruno', last_sent_at: new Date('2026-10-09T00:00:00.000Z'), sends: 1 },
];

describe('createPostgresContactsStore — de dónde sale cada contacto', () => {
  it('deduce la agenda de los envíos hechos a un tag', async () => {
    const db = recordingDb(ROWS);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    const sql = sqlOf(db);
    expect(sql).toContain('FROM rewallet.movements');
    expect(sql).toContain('rewallet.wallets');
    // El envío es la fila que prueba la relación: la consulta lee actividad,
    // no una tabla de contactos que nadie llena.
    expect(sql).not.toContain('rewallet.contacts');
  });

  it('exige que el envío lleve tag: sin tag no hay a quién atribuir la agenda', async () => {
    const db = recordingDb(ROWS);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    const sql = sqlOf(db);
    expect(sql).toContain("m.meta->>'recipientTag' IS NOT NULL");
    expect(sql).toContain("m.meta->>'recipientTag' <> ''");
  });

  it('se circunscribe a la persona que pregunta', async () => {
    const db = recordingDb([]);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    // La agenda es de quien pregunta: un contacto no es el mismo para dos
    // billeteras, así que el filtro por usuario tiene que estar en la consulta.
    expect(sqlOf(db)).toContain('w.user_id = $1');
    expect(db.seen[0]?.values).toEqual([USER_ID, 30]);
  });
});

describe('createPostgresContactsStore — el nombre se resuelve por la columna correcta', () => {
  it('une contra `tag_normalized`, que es la forma en que el tag se guardó', async () => {
    const db = recordingDb(ROWS);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    const sql = sqlOf(db);
    // `meta.recipientTag` se escribe sin `@` y en minúsculas. `users.tag` la
    // lleva con `@` y con constraint: juntarlas por ahí nunca casa y el nombre
    // de cada contacto salía `null` sin que nada fallara.
    expect(sql).toContain('u.tag_normalized = m.meta->>');
  });

  it('no vuelve a unir por la columna pública, que nunca casa con lo escrito', async () => {
    const db = recordingDb(ROWS);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    expect(sqlOf(db)).not.toMatch(/u\.tag\s*=/);
  });

  it('deja entrar al contacto aunque no tenga nombre', async () => {
    const db = recordingDb(ROWS);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    const sql = sqlOf(db);
    // `LEFT JOIN` y no interior: a una persona a la que ya le mandaste plata no
    // la borra un perfil incompleto. Aparece por su tag.
    const joins = sql.match(/(LEFT|INNER|CROSS|FULL|RIGHT)?\s*JOIN rewallet\.users/g) ?? [];
    expect(joins).toHaveLength(1);
    expect(joins[0]).toContain('LEFT');
    // Ningún `JOIN` interior sobre la misma tabla: el interior exige que el
    // nombre exista, y un contacto sin nombre es un contacto igual.
    expect(sql).not.toContain('INNER JOIN rewallet.users');
  });

  it('entrega el nombre que la consulta trajo, sin inventar uno', async () => {
    const db = recordingDb(ROWS);

    const contacts = await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    expect(contacts.map((contact) => contact.name)).toEqual(['Bruno', 'Ana']);
  });

  it('deja el nombre en `null` cuando la base no lo tiene, en vez de putsarlo', async () => {
    const db = recordingDb([
      { tag: 'sin.nombre', name: null, last_sent_at: new Date('2026-10-09T00:00:00.000Z'), sends: 1 },
    ]);

    const contacts = await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    expect(contacts[0]?.name).toBeNull();
    expect(contacts[0]?.tag).toBe('sin.nombre');
  });
});

describe('createPostgresContactsStore — la fila que sobrevive y el orden que se lee', () => {
  it('colapsa a la fila más reciente de cada tag', async () => {
    const db = recordingDb(ROWS);

    await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    const sql = sqlOf(db);
    expect(sql).toContain('DISTINCT ON (tag)');
    // `DISTINCT ON` exige que el `ORDER BY` empiece por la misma expresión.
    expect(sql).toMatch(/ORDER BY tag, last_sent_at DESC/);
  });

  it('ordena por recencia y no por tag, aunque el `ORDER BY` de SQL empiece por el tag', async () => {
    const db = recordingDb(ROWS);

    const contacts = await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    // En SQL el tag va primero porque `DISTINCT ON` lo exige; lo que la persona
    // lee es otra cosa: a quién le mandaste hace un minuto va primero, aunque
    // su tag ordenaría después.
    expect(contacts.map((contact) => contact.tag)).toEqual(['bruno.x', 'ana.abcd']);
  });

  it('cuenta los envíos por tag', async () => {
    const db = recordingDb(ROWS);

    const contacts = await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    expect(contacts.map((contact) => contact.sends)).toEqual([1, 3]);
  });

  it('lee la fecha aunque venga como texto', async () => {
    const db = recordingDb([
      { tag: 'ana.abcd', name: 'Ana', last_sent_at: '2026-10-01T00:00:00.000Z', sends: 3 },
    ]);

    const contacts = await createPostgresContactsStore(db).listForUser(USER_ID, 30);

    // Postgres devuelve `timestamptz` como `Date`, pero un driver puede entregar
    // texto; el shape público promete `Date` y no puede depender de eso.
    expect(contacts[0]?.lastSentAt).toBeInstanceOf(Date);
    expect(contacts[0]?.lastSentAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('devuelve una lista vacía, no un error, cuando no hay envíos con tag', async () => {
    const db = recordingDb([]);

    await expect(createPostgresContactsStore(db).listForUser(USER_ID, 30)).resolves.toEqual([]);
  });
});