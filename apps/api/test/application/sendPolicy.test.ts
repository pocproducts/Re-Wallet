/**
 * EL MOTOR DE POLÍTICA: las tres reglas y su combinación.
 *
 * ── Por qué este archivo insiste tanto en los contra-casos ───────────────────
 *
 * El valor de un test de regla no es comprobar que permite lo bueno —eso lo
 * hace un `if`— sino comprobar que **frena lo que tiene que frenar**. Por eso
 * casi la mitad de estos checks son el caso contrario: que la regla grande frene,
 * que el ritmo corte, que el destino nuevo pida confirmación.
 *
 * ── Por qué todo está en unidades mínimas ───────────────────────────────────
 *
 * El motor no sabe qué es un dólar: sabe `bigint` en unidades mínimas. El
 * umbral de $500 es `500_000000`. Si un test escribiera `500` pensando en
 * dólares, la regla compararía 500 contra 500 millones y no dispararía nunca —
 * un falso negativo silencioso, el peor tipo de bug en un control de riesgo.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluatePolicy,
  maxSingleSend,
  newRecipient,
  velocityPerHour,
  usdToMinorUnits,
  POLICY_LIMITS,
  type PolicyFacts,
} from '../../src/application/policy/evaluateSendPolicy';

const usd = (n: bigint): bigint => usdToMinorUnits(n);

const hechos = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({
  amount: usd(50n),
  recipient: '@carlos',
  recentAmount: 0n,
  knownRecipient: true,
  ...over,
});

describe('regla 1 — max_single_send: magnitud', () => {
  it('permite un envío que no llega al límite', () => {
    expect(maxSingleSend(usd(499n)).verdict).toBe('allow');
  });

  it('permite exactamente el límite: el límite es un techo, no un fuera de ley', () => {
    expect(maxSingleSend(usd(POLICY_LIMITS.maxSingleSendUsd)).verdict).toBe('allow');
  });

  it('pide confirmación apenas lo pasa', () => {
    const v = maxSingleSend(usd(501n));
    expect(v.verdict).toBe('confirm');
    expect(v.rule).toBe('max_single_send');
  });

  it('el motivo menciona el número, para que la persona pueda decidir', () => {
    const v = maxSingleSend(usd(900n));
    expect(v.reason).toContain('500');
  });
});

describe('regla 2 — velocity_per_hour: ritmo', () => {
  it('permite el primer envío de una hora', () => {
    expect(velocityPerHour(0n, usd(100n)).verdict).toBe('allow');
  });

  it('suma lo ya enviado con lo nuevo, no mira el envío solo', () => {
    // $900 en la hora + $200 ahora = $1100. Evaluar solo el envío nuevo
    // dejaría pasar el drenaje completo, que es justamente lo que esta regla
    // existe para atrapar.
    expect(velocityPerHour(usd(900n), usd(200n)).verdict).toBe('deny');
  });

  it('corta, y no pide confirmación', () => {
    // Un script no toca "confirmar": si esta regla preguntara, no frenaría
    // nada y solo sumaría una pantalla entre la persona y su plata.
    expect(velocityPerHour(usd(1000n), usd(1n)).verdict).toBe('deny');
  });

  it('permite muchos envíos chicos mientras el total no pase', () => {
    // Cien envíos de $5 son $500 en la hora: por encima del límite individual no
    // pasan, pero bajo el de la hora. Así debe ser.
    expect(velocityPerHour(usd(500n), usd(5n)).verdict).toBe('allow');
  });
});

describe('regla 3 — new_recipient: destino nuevo', () => {
  it('pide confirmación al primer envío a un destino desconocido', () => {
    const v = newRecipient(usd(20n), false);
    expect(v.verdict).toBe('confirm');
    expect(v.rule).toBe('new_recipient');
  });

  it('no pide nada a un destino ya conocido', () => {
    expect(newRecipient(usd(900n), true).verdict).toBe('allow');
  });

  it('frena también un envío chico a un destino nuevo', () => {
    // Un secuestro de sesión manda $1 a su propia dirección, no $900. Si el
    // umbral estuviera en monto alto, el robo chico pasaría sin preguntar.
    expect(newRecipient(usd(1n), false).verdict).toBe('confirm');
  });
});

describe('la combinación', () => {
  it('permite un envío corriente', () => {
    const r = evaluatePolicy(hechos());
    expect(r.verdict).toBe('allow');
    expect(r.decisive).toBeNull();
    expect(r.triggered).toHaveLength(0);
  });

  it('un deny gana aunque otra regla pida confirmación', () => {
    // $800 a un destino nuevo con $700 ya enviados: la pantalla debe decir
    // "no", no "¿confirmás?". Si el confirm ganara, le pediría confirmar algo
    // que en realidad no se puede hacer.
    const r = evaluatePolicy(
      hechos({ amount: usd(800n), recentAmount: usd(700n), knownRecipient: false }),
    );
    expect(r.verdict).toBe('deny');
    expect(r.decisive).toBe('velocity_per_hour');
  });

  it('un confirm sin deny se convierte en confirm', () => {
    const r = evaluatePolicy(hechos({ amount: usd(600n), knownRecipient: false }));
    expect(r.verdict).toBe('confirm');
  });

  it('el mismo denegado dispara dos reglas, y reporta las dos', () => {
    // $600 a un destino nuevo, con $100 ya enviados en la hora: pasa por
    // magnitud ($600 > $500) y por destino nuevo, y ninguno corta — el total
    // queda en $700, bajo el límite de ritmo. Si solo se reportara una razón,
    // la persona pensaría que arreglar una alcanza.
    const r = evaluatePolicy(
      hechos({ amount: usd(600n), recentAmount: usd(100n), knownRecipient: false }),
    );
    expect(r.verdict).toBe('confirm');
    expect(r.triggered.length).toBeGreaterThanOrEqual(2);
    expect(r.perRule).toHaveLength(3);
  });

  it('las tres reglas corren siempre, incluso cuando la primera corta', () => {
    // Que `perRule` traiga las tres hace que la pantalla pueda explicar el
    // todo, y que un test pueda ver qué se evaluó.
    const r = evaluatePolicy(
      hechos({ amount: usd(5000n), recentAmount: usd(5000n), knownRecipient: false }),
    );
    expect(r.perRule).toHaveLength(3);
    expect(r.perRule.every((x) => x.rule !== undefined)).toBe(true);
  });
});