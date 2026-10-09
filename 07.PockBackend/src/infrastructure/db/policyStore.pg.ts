/**
 * STORE: la política de gasto, sobre Postgres.
 *
 * ── Por qué una tabla de `numeric` y no de `bigint` ──────────────────────────
 *
 * `rewallet.movements` usa `numeric(20, 6)`. Si la política leyera saldos de
 * otra columna con otra escala, la suma de "cuánto mandó en la hora" podría
 * quedar un factor de 10⁶ desviada — un `deny` que corta a la gente sin motivo,
 * o un `allow` que deja pasar un drenaje. La escala tiene que coincidir con la
 * de los movimientos que ya existen, por eso `amount` también es `numeric(20,6)`.
 *
 * ── Por qué las lecturas son las dos que la regla necesita, y no más ─────────
 *
 * `sendsSince` responde "cuánto van en la ventana" y `hasEverSentTo` responde
 * "¿este destino es nuevo". Ninguna otra forma de leer la tabla le sirve a la
 * política, y una lectura que devuelve el hist��rico entero obligaría a la regla
 * a saber qué filtrar — que es exactamente la lógica que debe estar en el caso
 * de uso, no en un `reduce` escondido acá adentro.
 */
import type {
  PolicyStore,
  PolicyDecisionRecord,
  RecordedSend,
} from '../../domain/ports/policy-store';
import type { Database } from './client';

interface SendRow {
  readonly amount: string;
  readonly recipient: string;
  readonly decided_at: Date;
}

interface SeenRow {
  readonly seen: boolean;
}

export const createPostgresPolicyStore = (db: Database): PolicyStore => ({
  async sendsSince(userId: string, since: Date): Promise<readonly RecordedSend[]> {
    const rows = (await db`
      SELECT amount, recipient, decided_at
        FROM rewallet.policy_decisions
       WHERE user_id = ${userId}
         AND decided_at >= ${since}
         AND amount > 0
       ORDER BY decided_at DESC
    `) as unknown as SendRow[];

    return rows.map((row) => ({
      amount: BigInt(row.amount),
      recipient: row.recipient,
      at: row.decided_at,
    }));
  },

  async hasEverSentTo(userId: string, recipient: string): Promise<boolean> {
    const rows = (await db`
      SELECT TRUE AS seen
        FROM rewallet.policy_decisions
       WHERE user_id = ${userId}
         AND recipient = ${recipient}
         AND amount > 0
       LIMIT 1
    `) as unknown as SeenRow[];

    return rows.length > 0;
  },

  async record(decision: PolicyDecisionRecord): Promise<void> {
    await db`
      INSERT INTO rewallet.policy_decisions
        (user_id, amount, recipient, verdict, rule_id, decided_at)
      VALUES (
        ${decision.userId},
        ${decision.amount.toString()},
        ${decision.recipient},
        ${decision.verdict},
        ${decision.rule},
        ${decision.at}
      )
    `;
  },
});