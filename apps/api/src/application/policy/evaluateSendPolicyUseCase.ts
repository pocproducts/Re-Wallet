/**
 * CASO DE USO: evaluar la política de un envío, y dejar la decisión escrita.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * 1. Lee el historial del store: cuánto mandó en la última hora, y si ya mandó
 *    alguna vez a este destinatario.
 * 2. Le pasa los hechos al motor —que es puro— y recibe un veredicto.
 * 3. Guarda el veredicto, permitido o denegado.
 * 4. Devuelve el veredicto con sus motivos, para que la pantalla lo muestre.
 *
 * ── Por qué el store es una dependencia ──────────────────────────────────────
 *
 * Para que este caso de uso se pueda probar con un store de mentira, sin
 * Postgres. El motor no sabe leer nada; solo este caso sabe qué leer y cuándo.
 */

import {
  evaluatePolicy,
  type PolicyEvaluation,
  type PolicyFacts,
  VELOCITY_WINDOW_MS,
} from './evaluateSendPolicy';
import type { PolicyStore, PolicyVerdict, PolicyRuleId } from '../../domain/ports/policy-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

/** Lo que hay que saber para evaluar un envío. */
export interface EvaluateSendPolicyInput {
  readonly userId: string;
  /** El monto del envío, en unidades mínimas. */
  readonly amount: bigint;
  /** El destinatario como lo escribió la persona. */
  readonly recipient: string;
}

/**
 * Lo que la pantalla necesita para decidir qué mostrar.
 *
 * `verdict` y las razones van juntos a propósito: mostrar solo `confirm` sin el
 * motivo es peor que no mostrar nada, porque la persona no puede decidir sin
 * saber qué la deteniene.
 */
export interface EvaluateSendPolicyOutput extends PolicyEvaluation {
  /**
   * Todos los motivos, unidos, listos para pintar. Vacío cuando `allow`: un
   * envío permitido no necesita una explicación.
   */
  readonly reasons: readonly string[];
}

export interface EvaluateSendPolicyDeps {
  readonly policy: PolicyStore;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export type EvaluateSendPolicy = (
  input: EvaluateSendPolicyInput,
) => Promise<EvaluateSendPolicyOutput>;

export const createEvaluateSendPolicy = (
    deps: EvaluateSendPolicyDeps,
): EvaluateSendPolicy =>
  async (input) => {
    const { policy, now = () => new Date(), log = noopLogger } = deps;
    const { userId, amount, recipient } = input;

    const at = now();
    const windowStart = new Date(at.getTime() - VELOCITY_WINDOW_MS);

    const [recentSends, knownRecipient] = await Promise.all([
      policy.sendsSince(userId, windowStart),
      policy.hasEverSentTo(userId, recipient),
    ]);

    // La suma del historial la calcula este caso, no la regla: la regla recibe
    // un número y decide, y no vuelve a sumar de otra forma.
    const recentAmount = recentSends.reduce((sum, send) => sum + send.amount, 0n);

    const facts: PolicyFacts = { amount, recipient, recentAmount, knownRecipient };
    const evaluation = evaluatePolicy(facts);

    await policy.record({
      userId,
      amount,
      recipient,
      verdict: evaluation.verdict as PolicyVerdict,
      rule: evaluation.decisive as PolicyRuleId | null,
      at,
    });

    log.log('policy.evaluated', {
      userId,
      verdict: evaluation.verdict,
      decisive: evaluation.decisive,
      recentAmount: recentAmount.toString(),
      knownRecipient,
    });

    return {
      ...evaluation,
      reasons: evaluation.triggered.map((r) => r.reason).filter((r) => r.length > 0),
    };
  };