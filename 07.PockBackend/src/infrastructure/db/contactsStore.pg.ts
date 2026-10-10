/**
 * ADAPTER: los contactos salen de `rewallet.movements`.
 *
 * ── Por qué un envío a tag es la fila que lo prueba ──────────────────────────
 *
 * `prepareSend` escribe el `meta.recipientTag` **sólo** cuando el destino se
 * nombró por tag, así que la presencia de esa clave es exactamente la prueba de
 * "a esta persona le mandé plata por su handle". Un envío pegando una dirección
 * no aporta tag y no entra: no hay a quién atribuir una agenda.
 *
 * ── Por qué el nombre se resuelve con un `LEFT JOIN` ────────────────────────
 *
 * El tag es la identidad estable de la persona; el nombre es un dato de
 * perfil que puede faltar. Un `JOIN` interior tiraría el contacto entero por un
 * nombre ausente, y una persona a la que ya le mandaste plata no desaparece de
 * tu lista porque su perfil esté incompleto: aparece por su tag.
 *
 * ── El `JOIN` es por `tag_normalized` y no por `tag` ────────────────────────
 *
 * El tag se guarda acá sin `@` y en minúsculas: `prepareSend` normaliza el
 * destino con `normalizeRecipientTag`, que saca el `@` y baja a minúsculas antes
 * de escribir `meta.recipientTag`. Y `users.tag` es lo contrario —el público,
 * con `@`, y con la constraint `^@[a-z0-9_]{2,19}$`— así que juntarlos por ahí
 * no casa nunca y el nombre de cada contacto salía siempre `null`. La columna
 * que comparte forma con lo que se escribió es `users.tag_normalized`, la
 * misma que usa el store de billeteras para resolver un tag.
 *
 * ── `DISTINCT ON` y no `GROUP BY` ───────────────────────────────────────────
 *
 * La fila que se quiere es la **última** de cada tag, y en Postgres eso es
 * `DISTINCT ON` con el mismo `ORDER BY` del `LIMIT`: una sola pasada, sin
 * agrupar y volver a elegir. El orden es por fecha descendente, así que la fila
 * que sobrevive es la más reciente y su `sends` viene del conteo por tag.
 */
import type { ContactsStore, RewalletContact } from '../../domain/ports/contacts-store';
import type { Database } from './client';

interface ContactRow {
  readonly tag: string;
  readonly name: string | null;
  readonly last_sent_at: string | Date;
  readonly sends: number;
}

export const createPostgresContactsStore = (db: Database): ContactsStore => ({
  async listForUser(userId, limit) {
    /*
     * Una sola pasada: el CTE trae toda la actividad con tag de esta persona,
     * `DISTINCT ON` deja la fila más reciente de cada tag y el recorte por
     * recencia se hace acá, sobre los tags ya colapsados. El `LIMIT` del
     * `SELECT` final es una red de seguridad para el tamaño de la lista, no la
     * política: la política son los `MAX` del use case.
     */
    const rows = (await db.query(
      `
        WITH tagged AS (
          SELECT m.meta->>'recipientTag' AS tag,
                 u.name                   AS name,
                 m.created_at             AS last_sent_at,
                 COUNT(*) OVER (PARTITION BY m.meta->>'recipientTag')::int AS sends
            FROM rewallet.movements m
            JOIN rewallet.wallets w ON w.id = m.wallet_id
            LEFT JOIN rewallet.users u ON u.tag_normalized = m.meta->>'recipientTag'
           WHERE w.user_id = $1
             AND m.meta->>'recipientTag' IS NOT NULL
             AND m.meta->>'recipientTag' <> ''
        )
        SELECT DISTINCT ON (tag) tag, name, last_sent_at, sends
          FROM tagged
         ORDER BY tag, last_sent_at DESC
         LIMIT $2
      `,
      [userId, limit],
    )) as unknown as ContactRow[];

    /*
     * Recencia, y no el orden del tag: la persona a la que le mandaste hace un
     * minuto está más arriba que la de hace seis meses, aunque su tag ordenaría
     * antes.
     */
    const byRecency = [...rows].sort(
      (a, b) => new Date(b.last_sent_at).getTime() - new Date(a.last_sent_at).getTime(),
    );

    return byRecency.map((row): RewalletContact => ({
      tag: row.tag,
      name: row.name,
      lastSentAt: row.last_sent_at instanceof Date ? row.last_sent_at : new Date(row.last_sent_at),
      sends: row.sends,
    }));
  },
});
