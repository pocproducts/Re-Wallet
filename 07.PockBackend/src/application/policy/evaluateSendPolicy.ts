/**
 * EL MOTOR DE POLÍTICA DE GASTO.
 *
 * ── Qué decide ───────────────────────────────────────────────────────────────
 *
 * Antes de que una persona mande plata, tres reglas miran el envío y contestan
 * una de tres cosas: `allow`, `confirm` o `deny`. No es decoración de demo: son
 * los tres mecanismos con los que una wallet de consumo se protege de las tres
 * formas de robo que le importan.
 *
 * ── Por qué las reglas son funciones puras ───────────────────────────────────
 *
 * Cada regla recibe los hechos y devuelve un veredicto. No lee la base, no
 * escribe, no conoce la hora del reloj (eso lo pasa quien llama). Eso permite
 * ejercitar cada regla con un caso y un contra-caso, que es donde vive el valor
 * de un test de regla: no que funcione, sino que **no funcione** cuando debe.
 *
 * ── Por qué `deny` es distinto de `confirm` ─────────────────────────────────
 *
 * `confirm` es una pregunta a la persona: "¿seguro? acá tenés el detalle". El
 * roboMagnitude y el destino nuevo se frenan con una pregunta, porque una
 * persona puede responderla bien.
 *
 * `deny` es un muro. El ritmo excedido solo lo produce un automatismo —un
 * script no "confirma", reintenta— así que preguntar no frenaría nada y solo
 * agregaría una pantalla deETERS entre la persona y su dinero. Por eso la regla
 * de ritmo, y solo ella, corta.
 */

/** Los tres veredictos. */
export type Verdict = 'allow' | 'confirm' | 'deny';

/** Los identificadores de regla. Estables: se guardan y se muestran. */
export type RuleId = 'max_single_send' | 'velocity_per_hour' | 'new_recipient';

/** Un veredicto con la regla que lo produjo y el motivo escrito. */
export interface RuleVerdict {
  readonly verdict: Verdict;
  /** La regla que decidió. En un `allow` es la que pasó o la que más cerca estuvo. */
  readonly rule: RuleId;
  /** Por qué, en una frase que la pantalla pueda mostrar tal cual. */
  readonly reason: string;
  /** El número que decidió, cuando la regla es numérica. `null` si no aplica. */
  readonly observed?: bigint;
  /** El límite contra el que se comparó, si la regla tiene uno. */
  readonly limit?: bigint;
}

/**
 * ── Los límites ──────────────────────────────────────────────────────────────
 *
 * Son cifras redondas y en dólares enteros porque están **para ser leídos**: un
 * límite de `$0.037415` no es un control, es un bug. Y están en unidades
 * legibles (dólares) mientras el motor trabaja en unidades mínimas (6
 * decimales), porque el producto habla de dólares aunque la cadena no.
 *
 * Los tres números viven acá juntos y en un solo lugar. El motivo es concreto:
 * en una app de riesgo, cambiar un umbral a mano sin revisar los otros dos es
 * como pasa siempre.
 */
export const POLICY_LIMITS = {
  /** Regla 1: a partir de esto, un envío pide confirmación. */
  maxSingleSendUsd: 500n,
  /**
   * Regla 2: total salidas en una hora. Hard deny.
   *
   * El número no es "cuántas operaciones" sino "cuánta plata": un ladrón con la
   * sesión hace cien envíos de $1 y no tendría por qué ser frenado por un límite
   * de $1000 si puede sacarle $100 en un minuto. El límite está en plata porque
   * la plata es lo que se pierde.
   */
  velocityPerHourUsd: 1_000n,
  /**
   * Regla 3: a partir de esto, mandar a un destino **nuevo** pide confirmación.
   *
   * Es 0 a propósito para que la regla sea "primer envío a un destino nuevo,
   * sin importar el monto". Un umbral bajo haría que los envíos chicos a
   * desconocidos sean invisibles, que es justo el caso del secuestro de sesión.
   */
  newRecipientUsd: 0n,
} as const;

/** La ventana de la regla de ritmo: una hora. */
export const VELOCITY_WINDOW_MS = 60 * 60 * 1000;

/** Convierte dólares enteros a unidades mínimas de un activo de 6 decimales. */
export const usdToMinorUnits = (usd: bigint): bigint => usd * 1_000_000n;

/**
 * ── Los hechos de una evaluación ─────────────────────────────────────────────
 *
 * Se passa lo que las reglas necesitan, no un `userId` y un store: son funciones
 * puras y eso es lo que las hace testeables sin base de datos.
 */
export interface PolicyFacts {
  /** El monto del envío, en unidades mínimas. */
  readonly amount: bigint;
  /** El destinatario como lo escribió la persona (tag o dirección). */
  readonly recipient: string;
  /**
   * Los envíos de la última hora, ya filtrados por ventana. `recentAmount` es
   * su suma y viene calculado para que la regla no dependa de una aritmética
   * que el lector podría hacer mal.
   */
  readonly recentAmount: bigint;
  /** ¿Ya se mandó alguna vez a este destinatario? */
  readonly knownRecipient: boolean;
}

/**
 * REGLA 1 — `max_single_send`.
 *
 * Atrapa el envío grande puntual: la forma más común de que una persona descubra
 * que la cuenta está comprometida cuando ya no queda plata.
 *
 * Por qué `confirm` y no `deny`: alguien puede querer legítimamente mover $800.
 * Negárselo sería paternalista; preguntarle no cuesta nada y lo frena.
 */
export const maxSingleSend = (
  amount: bigint,
  limit: bigint = usdToMinorUnits(POLICY_LIMITS.maxSingleSendUsd),
): RuleVerdict =>
  amount > limit
    ? {
        verdict: 'confirm',
        rule: 'max_single_send',
        reason: `Este envío supera los $${POLICY_LIMITS.maxSingleSendUsd} y necesita tu confirmación.`,
        observed: amount,
        limit,
      }
    : { verdict: 'allow', rule: 'max_single_send', reason: '', observed: amount, limit };

/**
 * REGLA 2 — `velocity_per_hour`.
 *
 * Atrapa el drenaje automático: muchas salidas seguidas, cada una chica y por
 * debajo del límite individual.
 *
 * Por qué `deny`: un ladrón no lee la pantalla, no toca "confirmar" y no espera.
 * Un límite de ritmo solo sirve si **corta**. Si pidiera confirmación, un script
 * simplemente seguiría, y la persona ni se enteraría hasta ver el saldo.
 *
 * Por qué suma monto y no cuenta operaciones: el daño se mide en plata.
 */
export const velocityPerHour = (
  recentAmount: bigint,
  amount: bigint,
  limit: bigint = usdToMinorUnits(POLICY_LIMITS.velocityPerHourUsd),
): RuleVerdict => {
  const projected = recentAmount + amount;
  return projected > limit
    ? {
        verdict: 'deny',
        rule: 'velocity_per_hour',
        reason: `Superaste el límite de $${POLICY_LIMITS.velocityPerHourUsd} por hora de salidas.`,
        observed: projected,
        limit,
      }
    : { verdict: 'allow', rule: 'velocity_per_hour', reason: '', observed: projected, limit };
};

/**
 * REGLA 3 — `new_recipient`.
 *
 * Atrapa el secuestro de sesión: alguien entra a una cuenta ajena y manda a su
 * propia dirección. Cada envío a un destino conocido pasa; el primero a uno
 * nuevo es el sospechoso.
 *
 * Por qué `confirm` y no `deny`: mandar por primera vez a alguien es algo
 * normal y frecuente; bloquearlo sería insoportable. Pero hacerlo **siempre** es
 * distinto, y ahí es donde el ladrón choca.
 */
export const newRecipient = (
  amount: bigint,
  knownRecipient: boolean,
  limit: bigint = usdToMinorUnits(POLICY_LIMITS.newRecipientUsd),
): RuleVerdict =>
  !knownRecipient && amount > limit
    ? {
        verdict: 'confirm',
        rule: 'new_recipient',
        reason: 'Nunca mandaste plata a este destino antes. Revisá que sea correcto.',
        observed: amount,
        limit,
      }
    : { verdict: 'allow', rule: 'new_recipient', reason: '', observed: amount, limit };

/**
 * El veredicto final, combinando las tres reglas.
 *
 * ── Por qué el orden importa ────────────────────────────────────────────────
 *
 * Se evalúa **de la más grave a la menos grave**: primero `deny`, después
 * `confirm`, después `allow`. Si no, un envío que fuera denegado por ritmo podría
 * "ganar" un `confirm` de otra regla y la pantalla le pediría confirmar algo que
 * en realidad no se puede hacer. Un `deny` es final; un `confirm` es el máximo
 * que se puede pedir.
 *
 * Devuelve también **todas** las reglas que se activaron, no solo la primera,
 * para que la pantalla pueda decir "esto y esto" en vez de una razón a la vez.
 */
export interface PolicyEvaluation {
  readonly verdict: Verdict;
  /** La regla que decidió el veredicto. `null` solo si nada se activó. */
  readonly decisive: RuleId | null;
  /** Todas las reglas que pidieron algo, para explicarlas. */
  readonly triggered: readonly RuleVerdict[];
  /** El veredicto de cada regla, en orden, para depurar y testear. */
  readonly perRule: readonly RuleVerdict[];
}

export const evaluatePolicy = (facts: PolicyFacts): PolicyEvaluation => {
  const perRule: RuleVerdict[] = [
    velocityPerHour(facts.recentAmount, facts.amount),
    maxSingleSend(facts.amount),
    newRecipient(facts.amount, facts.knownRecipient),
  ];

  const denials = perRule.filter((r) => r.verdict === 'deny');
  const confirmations = perRule.filter((r) => r.verdict === 'confirm');

  if (denials.length > 0) {
    const decisive = denials[0]!;
    return {
      verdict: 'deny',
      decisive: decisive.rule,
      triggered: [...denials, ...confirmations],
      perRule,
    };
  }

  if (confirmations.length > 0) {
    const decisive = confirmations[0]!;
    return {
      verdict: 'confirm',
      decisive: decisive.rule,
      triggered: confirmations,
      perRule,
    };
  }

  return { verdict: 'allow', decisive: null, triggered: [], perRule };
};