/**
 * PORT: las personas a las que esta billetera ya mandó plata por tag.
 *
 * ── Por qué una lista y no un buscador libre ────────────────────────────────
 *
 * Antes la pantalla de "Enviar a otra ReWALLET" ofrecía una agenda escrita a
 * mano —cinco nombres y cinco tags que existían de verdad— y tocar una fila
 * mandaba el envío a una persona real. Una lista de contactos que no sale de
 * los envíos de **esta** billetera no es una agenda: es una lista de personas
 * reales con un botón de enviar.
 *
 * La lista se deriva de los propios movimientos, que es la única fuente donde
 * "a quién le mandé" es un hecho y no una suposición.
 */
export interface RewalletContact {
  /** El tag, sin arroba: es la clave con la que el backend resuelve. */
  readonly tag: string;
  /** El nombre que esa persona tiene en `rewallet.users`, si hay. */
  readonly name: string | null;
  /** Cuándo fue el último envío a esta persona. */
  readonly lastSentAt: Date;
  /** Cuántos envíos le salieron a esta persona. */
  readonly sends: number;
}

export interface ContactsStore {
  /** Los contactos de esta persona, más reciente primero. Sin duplicados por tag. */
  listForUser(userId: string, limit: number): Promise<readonly RewalletContact[]>;
}
