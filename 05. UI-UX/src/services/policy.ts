/**
 * EL CLIENTE DE LA POLÍTICA DE GASTO.
 *
 * ── Por qué existe un cliente y no una llamada suelta en la pantalla ──────────
 *
 * Porque la pantalla que consulta la política no es una: es la del envío, y va
 * a cambiar. Y porque las reglas de este proyecto (contrato 1.4) dicen que el
 * front es dueño del texto y el back es dueño del código: este archivo traduce
 * la respuesta del backend a los tres veredictos que la UI sabe pintar, y no
 * inventa ninguno.
 *
 * ── Por qué el `deny` no es un error ─────────────────────────────────────────
 *
 * Porque `deny` es una respuesta, no una falla. El backend lo devuelve con
 * HTTP 200 justamente para que la pantalla pueda mostrar el motivo y bloquear el
 * botón. Si se tradujera a una excepción, el `catch` la mezclaría con "la red se
 * cayó" y la persona vería un error técnico donde la política la frenó a
 * propósito.
 *
 * La única excepción que se propaga es la de transporte (`NETWORK_UNAVAILABLE`),
 * porque ahí sí no sabemos nada: no sabemos si la política habría permitido el
 * envío, y no se puede mostrar un veredicto que no existe.
 */
import { postJson, ApiError } from './api';

/** Los tres veredictos. Los mismos nombres que el backend. */
export type PolicyVerdict = 'allow' | 'confirm' | 'deny';

/** Las tres reglas, por identificador estable. */
export type PolicyRuleId = 'max_single_send' | 'velocity_per_hour' | 'new_recipient';

/** Una regla que se activó, con el motivo ya escrito para la persona. */
export interface PolicyTrigger {
  readonly verdict: PolicyVerdict;
  readonly rule: PolicyRuleId;
  /** La frase que la pantalla muestra tal cual. El front no la reescribe. */
  readonly reason: string;
}

/** La respuesta del backend, ya reducida a lo que la pantalla usa. */
export interface PolicyEvaluation {
  readonly verdict: PolicyVerdict;
  /** La regla que decidió. `null` solo si nada se activó. */
  readonly decisive: PolicyRuleId | null;
  /** Los motivos, listos para pintar. Vacío cuando `allow`. */
  readonly reasons: readonly string[];
  readonly triggered: readonly PolicyTrigger[];
}

/**
 * Lo que **no** sabemos cuando la consulta falla.
 *
 * Es un tipo propio y no `null` por una razón concreta: `null` se confunde con
 * "permitido" si alguien lo escribe como `verdict ?? 'allow'`. Con un tipo
 * explícito, la pantalla tiene que decidir qué mostrar cuando no hay veredicto,
 * y la respuesta honesta es "no pudimos verificar".
 */
export interface PolicyUnavailable {
  readonly available: false;
  readonly reason: 'NETWORK_UNAVAILABLE';
}

export interface PolicyAvailable {
  readonly available: true;
  readonly evaluation: PolicyEvaluation;
}

export type PolicyResult = PolicyAvailable | PolicyUnavailable;

/** Solo dígitos: el mismo contrato que el envío usa para `amountRaw`. */
const DIGITS = /^[0-9]+$/;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asVerdict = (value: unknown): PolicyVerdict | null =>
  value === 'allow' || value === 'confirm' || value === 'deny' ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Consulta el veredicto antes de que la persona firme.
 *
 * `amountRaw` va en **unidades mínimas** —6 decimales para USDC—, igual que en
 * el envío. Pasarlo en dólares sería un error de un millón de veces, y la regla
 * de magnitud no dispararía nunca.
 */
export const evaluatePolicy = async (params: {
  readonly amountRaw: string;
  readonly recipient: string;
}): Promise<PolicyResult> => {
  const amountRaw = params.amountRaw.trim();

  // Un monto que no son dígitos no se manda: el backend lo rechazaría, y
  // gastarle un round-trip en saber algo que ya sabemos es ruido.
  if (!DIGITS.test(amountRaw)) {
    return { available: false, reason: 'NETWORK_UNAVAILABLE' };
  }

  const recipient = params.recipient.trim();
  if (recipient.length === 0) {
    return { available: false, reason: 'NETWORK_UNAVAILABLE' };
  }

  let body: unknown;
  try {
    body = await postJson('/api/wallet/policy/evaluate', {
      amountRaw,
      recipient,
    });
  } catch (error) {
    // Solo el transporte falla con excepción. Un `deny` nunca llega acá.
    if (error instanceof ApiError) {
      return { available: false, reason: 'NETWORK_UNAVAILABLE' };
    }
    throw error;
  }

  const record = asRecord(body);
  if (record === null) return { available: false, reason: 'NETWORK_UNAVAILABLE' };

  const verdict = asVerdict(record.verdict);
  if (verdict === null) return { available: false, reason: 'NETWORK_UNAVAILABLE' };

  const triggeredRaw = Array.isArray(record.triggered) ? record.triggered : [];
  const triggered: PolicyTrigger[] = [];

  for (const entry of triggeredRaw) {
    const item = asRecord(entry);
    if (item === null) continue;
    const ruleVerdict = asVerdict(item.verdict);
    const rule = item.rule;
    const reason = typeof item.reason === 'string' ? item.reason : '';
    if (ruleVerdict === null || typeof rule !== 'string' || reason.length === 0) continue;
    triggered.push({ verdict: ruleVerdict, rule: rule as PolicyRuleId, reason });
  }

  const decisive =
    typeof record.decisive === 'string' ? (record.decisive as PolicyRuleId) : null;

  return {
    available: true,
    evaluation: {
      verdict,
      decisive,
      // Los motivos salen de las reglas activadas y no de un campo suelto: si
      // el backend alguna vez no mandara `reasons`, esta lista seguiría dando lo
      // que la persona necesita leer, que es lo que dice cada regla.
      reasons: asStringArray(record.reasons).filter((r) => r.length > 0),
      triggered,
    },
  };
};

/**
 * Una frase corta para el botón, según el veredicto.
 *
 * Vive acá y no en la pantalla porque la decisión es de **producto**: qué se le
 * pide a la persona es el mismo en los tres lugares donde aparece el botón.
 */
export const policyCallToAction = (verdict: PolicyVerdict): string => {
  switch (verdict) {
    case 'deny':
      return 'No se puede completar';
    case 'confirm':
      return 'Revisá y confirmá';
    case 'allow':
      return 'Enviar';
  }
};

/**
 * El cuerpo que lleva el gesto explícito.
 *
 * La política se exige adentro del servidor: cuando responde `confirm`, el envío
 * o el pago no sigue sin que alguien haya dicho que sí, y eso se dice con este
 * campo. **Un solo lugar decide cómo se dice**, y el valor es `true` y no otra
 * cosa: el servidor sólo acepta exactamente `true`, así que un `"true"` o un `1`
 * que alguna pantalla invente sería un gesto que no existe.
 *
 * No lleva ninguna otra clave. No hay campo que levante un `deny`, y agregarlo
 * desde el cliente sería exactamente el agujero que la política existe para
 * cerrar.
 */
export const POLICY_CONFIRMED_BODY = { policyConfirmed: true } as const;