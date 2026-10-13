/**
 * EL CLIENTE DE LA POLÍTICA DE GASTO.
 *
 * ── Por qué estos tests importan el módulo y no lo mockean entero ───────────
 *
 * Porque lo que hay que fijar acá es una frontera: qué se le manda al backend y
 * qué se entiende de lo que vuelve. Mockear `postJson` probaría que el cliente
 * llama a la función que el test le puso al lado, que es una tautología.
 *
 * ── La propiedad que más importa ────────────────────────────────────────────
 *
 * Que un `deny` **no** sea una excepción. Si fuera, el `catch` del hook la
 * mezclaría con "la red se cayó" y la persona vería un error técnico donde la
 * política la frenó a propósito — que es el peor lugar posible para anunciar que
 * tu propia plataforma te frenó.
 */
import { describe, expect, it } from 'vitest';

import { evaluatePolicy, policyCallToAction, type PolicyResult } from '../../src/services/policy';

/** Un cuerpo de respuesta del backend, tal como lo manda `/policy/evaluate`. */
const VEREDICTO_ALLOW = {
  verdict: 'allow',
  decisive: null,
  reasons: [],
  triggered: [],
};

const VEREDICTO_CONFIRM = {
  verdict: 'confirm',
  decisive: 'new_recipient',
  reasons: ['Nunca mandaste plata a este destino antes. Revisá que sea correcto.'],
  triggered: [
    {
      verdict: 'confirm',
      rule: 'new_recipient',
      reason: 'Nunca mandaste plata a este destino antes. Revisá que sea correcto.',
    },
  ],
};

const VEREDICTO_DENY = {
  verdict: 'deny',
  decisive: 'velocity_per_hour',
  reasons: ['Superaste el límite de $1000 por hora de salidas.'],
  triggered: [
    {
      verdict: 'deny',
      rule: 'velocity_per_hour',
      reason: 'Superaste el límite de $1000 por hora de salidas.',
    },
  ],
};

/** Instala un `fetch` que responde lo que se le pasa y devuelve el cuerpo pedido. */
const responderCon = (body: unknown, status = 200) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
};

const consultar = async (over: Partial<{ amountRaw: string; recipient: string }> = {}) =>
  evaluatePolicy({ amountRaw: '100000000', recipient: '@carlos', ...over });

describe('el cliente de la política', () => {
  it('traduce un allow', async () => {
    const restore = responderCon(VEREDICTO_ALLOW);
    try {
      const result = (await consultar()) as Extract<PolicyResult, { available: true }>;
      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.evaluation.verdict).toBe('allow');
      expect(result.evaluation.reasons).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('traduce un confirm con el motivo de la regla, sin reescribirlo', async () => {
    const restore = responderCon(VEREDICTO_CONFIRM);
    try {
      const result = (await consultar()) as Extract<PolicyResult, { available: true }>;
      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.evaluation.verdict).toBe('confirm');
      // El texto viene del backend tal cual: si la regla cambió sus palabras,
      // esta pantalla cambia con ella sin que nadie toque acá.
      expect(result.evaluation.reasons[0]).toContain('Nunca mandaste plata');
    } finally {
      restore();
    }
  });

  it('un deny es un veredicto, no una excepción', async () => {
    const restore = responderCon(VEREDICTO_DENY);
    try {
      const result = (await consultar()) as Extract<PolicyResult, { available: true }>;
      // La forma de esto es lo que se esta fijando: si el `deny` fuera una
      // excepción, acá habria una excepción y no un `result`.
      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.evaluation.verdict).toBe('deny');
      expect(result.evaluation.decisive).toBe('velocity_per_hour');
    } finally {
      restore();
    }
  });

  it('no manda un monto que no son digitos', async () => {
    let llamado = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      llamado = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const result = await consultar({ amountRaw: '1.5' });
      expect(result.available).toBe(false);
      // Gastar un round-trip en algo que ya se sabe es ruido: el backend lo
      // rechazaria con el mismo resultado.
      expect(llamado).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('no manda un destinatario vacio', async () => {
    const result = await consultar({ recipient: '   ' });
    expect(result.available).toBe(false);
  });

  it('una respuesta sin veredicto es indisponibilidad, no permiso', async () => {
    const restore = responderCon({ cosas: ['raras'] });
    try {
      const result = await consultar();
      // Si esto devolviera `allow`, un cuerpo raro habilitaría un envío. La
      // ausencia de veredicto se traduce a "no sabemos", y el hook deja pasar
      // con la política marcada como omitida.
      expect(result.available).toBe(false);
    } finally {
      restore();
    }
  });

  it('un error de red es indisponibilidad', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('failed to fetch');
    }) as unknown as typeof fetch;
    try {
      const result = await consultar();
      expect(result).toEqual({ available: false, reason: 'NETWORK_UNAVAILABLE' });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('el texto del boton', () => {
  it('cambia segun el veredicto, y el mismo texto en todos lados', () => {
    expect(policyCallToAction('deny')).toBe('No se puede completar');
    expect(policyCallToAction('confirm')).toBe('Revisá y confirmá');
    expect(policyCallToAction('allow')).toBe('Enviar');
  });
});