/**
 * PORT: lo que la política necesita saber, y dónde deja la decisión.
 *
 * ── Por qué es un puerto y no una consulta a la base ─────────────────────────
 *
 * Una política de gasto lee historial y escribe decisiones. Si eso fuera una
 * consulta directa, cada test que quisiera ejercitar una regla tendría que montar
 * Postgres, y la razón de este proyecto —que ningún test toca la red ni la base—
 * se perdería justo en la parte donde más importa: la regla que decide si una
 * persona puede mover su plata.
 *
 * ── Por qué las tres reglas son tres mecanismos distintos ───────────────────
 *
 * No son tres límites del mismo número con nombres distintos. Cada una atrapa un
 * patrón de fraude distinto, y por eso ninguna sustituye a otra:
 *
 *   1. **magnitud** — un solo movimiento grande. Atrapa el robo en un envío.
 *   2. **ritmo** — muchos movimientos en una hora. Atrapa el drenaje automático.
 *   3. **destinatario nuevo** — un destino con el que nunca se mandó. Atrapa el
 *      secuestro de sesión, donde el ladrón manda a su propia dirección nueva.
 *
 * La 2 y la 3 son las que un atacante no puede esquivar con ingeniería social:
 * un script no acepta confirmaciones, y no puede volver "viejo" un destino nuevo.
 *
 * ── Por qué las decisiones se guardan ────────────────────────────────────────
 *
 * Porque una política que no deja rastro no es una política: es un `if`. Guardar
 * cada veredicto —incluso los que permiten— es lo que permite responder después
 * "¿por qué esta persona no pudo retirar?", y es la diferencia entre un control
 * de riesgo y un obstacle course.
 */

/** Un movimiento de salida ya registrado, tal como la política lo necesita. */
export interface RecordedSend {
  /** Unidades mínimas del activo, como `bigint`. Nunca un `float`. */
  readonly amount: bigint;
  /**
   * El destinatario, como appeared en la pantalla. Puede ser un tag o una
   * dirección; la política compara la cadena, no la resuelve.
   */
  readonly recipient: string;
  readonly at: Date;
}

/** Una decisión de la política, tal como se guardó. */
export interface PolicyDecisionRecord {
  readonly userId: string;
  readonly amount: bigint;
  readonly recipient: string;
  /** El veredicto: `allow`, `confirm` o `deny`. */
  readonly verdict: PolicyVerdict;
  /** La regla que decidió, o `null` si ninguna se-opuso (permitido). */
  readonly rule: PolicyRuleId | null;
  readonly at: Date;
}

/**
 * Los tres veredictos posibles. No son equivalentes: cada uno se maneja distinto
 * en la pantalla.
 */
export type PolicyVerdict = 'allow' | 'confirm' | 'deny';

/** Las tres reglas, por identificador estable. El id nunca se renombra. */
export type PolicyRuleId = 'max_single_send' | 'velocity_per_hour' | 'new_recipient';

/** El store que la política lee y escribe. */
export interface PolicyStore {
  /**
   * Los envíos de esta persona desde `since`, del más reciente al más viejo.
   *
   * `since` lo calcula quien pregunta, no el store: la ventana es parte de la
   * regla (una hora para el ritmo), no parte de la tabla. Un store que decidiera
   * la ventana sería dueño de la regla sin que nadie la pueda leer.
   */
  sendsSince(userId: string, since: Date): Promise<readonly RecordedSend[]>;

  /**
   * ¿Se mandó alguna vez a este destinatario? `true`/`false`, no un conteo: la
   * regla pregunta por novedad, no por frecuencia.
   *
   * Cubre **toda** la historia, no solo la ventana reciente. Un destino usado
   * hace un año es conocido; solo el primer envío a uno nuevo es sospechoso.
   */
  hasEverSentTo(userId: string, recipient: string): Promise<boolean>;

  /** Guarda el veredicto. Un envío permitido también se guarda. */
  record(decision: PolicyDecisionRecord): Promise<void>;
}