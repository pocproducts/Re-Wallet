/**
 * `src/services/digitalDollars.ts`: el mismo normalizador, otra vez.
 *
 * La duplicación es intencional en el código (cada módulo defiende su propio
 * borde), y por eso también necesita su propia defensa en tests: si el segundo
 * normalizador se portara bien, la primera mitad de la app queda sin cubrir.
 */

import { describe, expect, it } from 'vitest';
import {
  AMOUNT_DISPLAY_DECIMALS,
  buildIncompletenessNote,
  normalizeDigitalDollars,
  TOTAL_UNREADABLE_NOTE,
} from '../../src/services/digitalDollars';
import { amount, asOk } from '../fixtures';

const usdc = (raw: string, decimals = 6) => ({ raw, amount: raw, decimals, unit: 'USDC' });

const body = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2024-05-01T00:00:00.000Z',
  unit: 'USDC',
  total: usdc('0'),
  complete: true,
  components: [],
  ...overrides,
});

const okComponent = (overrides: Record<string, unknown> = {}) => ({
  key: 'dd.monad.USDC',
  label: 'USDC en Monad',
  source: 'free_wallet',
  status: 'ok',
  reason: null,
  value: usdc('100000000'),
  ...overrides,
});

describe('normalizeDigitalDollars — la misma barra de lectura que en el balance', () => {
  it('se niega a leer un cuerpo sin `complete` en vez de asumir que está entero', () => {
    // Sin el booleano del backend no hay forma de saber si el total es toda la
    // verdad. Devolver una vista "completa" por omisión es la forma más
    // silenciosa de mentir sobre plata.
    expect(normalizeDigitalDollars(body({ complete: undefined }))).toBeNull();
    expect(normalizeDigitalDollars(body({ complete: 'true' }))).toBeNull();
    expect(normalizeDigitalDollars(null)).toBeNull();
  });

  it('se niega a leer un cuerpo sin lista de componentes', () => {
    expect(normalizeDigitalDollars(body({ components: undefined }))).toBeNull();
    expect(normalizeDigitalDollars(body({ components: {} }))).toBeNull();
  });

  it('deja un componente ilegible sin valor aunque el cuerpo se lo pegue', () => {
    // La mitad ilegible de la unión. Si aceptara el `value` que viene pegado,
    // el total parcial incluiría plata que nadie verificó.
    const view = normalizeDigitalDollars(
      body({
        total: usdc('0'),
        complete: false,
        components: [
          okComponent(),
          {
            key: 'dd.solana.USDC',
            label: 'USDC en Solana',
            source: 'free_wallet',
            status: 'unreadable',
            reason: 'RPC_UNAVAILABLE',
            value: usdc('50000000'),
          },
        ],
      }),
    )!;
    const unreadable = view.parts[1];
    expect(unreadable.status).toBe('unreadable');
    expect('raw' in unreadable).toBe(false);
    expect(view.unreadableParts).toHaveLength(1);
    expect(view.complete).toBe(false);
    expect(view.incompletenessNote).toContain('USDC en Solana');
  });

  it('trata un cero leído como cero real, no como ilegible', () => {
    // Una billetera sin dólares tiene que poder parecer vacía. Conflatar el
    // cero con "no lo sé" produce un aviso de error sobre una billetera que
    // funciona.
    const view = normalizeDigitalDollars(
      body({ total: usdc('0'), components: [okComponent({ value: usdc('0') })] }),
    )!;
    expect(view.parts[0].status).toBe('ok');
    expect(asOk(view.parts[0]).isZero).toBe(true);
    expect(asOk(view.parts[0]).formatted).toBe('0,00');
    expect(view.complete).toBe(true);
    expect(view.total).toBe('0,00');
  });

  it('degrada a ilegible un componente "ok" cuyo importe no se puede leer', () => {
    // Un `raw` negativo o con letras no es un importe. Volverlo cero sería
    // decir que no tenés USDC.
    const view = normalizeDigitalDollars(
      body({ complete: false, components: [okComponent({ value: { raw: '-1', amount: '-1', decimals: 6, unit: 'USDC' } })] }),
    )!;
    expect(view.parts[0].status).toBe('unreadable');
    expect(view.total).toBe('0,00');
    expect(view.complete).toBe(false);
  });

  it('degrada a ilegible un `source` que no es del catálogo', () => {
    const view = normalizeDigitalDollars(
      body({ complete: false, components: [okComponent({ source: 'yield_but_not' })] }),
    )!;
    expect(view.parts[0].status).toBe('unreadable');
  });

  it('no descarta en silencio un componente que ni siquiera tiene nombre', () => {
    // Un componente imposible de identificar sigue siendo un hueco del total.
    // Tirarlo haría que la suma de lo que queda saliera exacta y el cartel
    // de "incompleto" no aparecería.
    const view = normalizeDigitalDollars(
      body({ total: usdc('100000000'), complete: false, components: [{ status: 'ok' }] }),
    )!;
    expect(view.parts).toHaveLength(1);
    expect(view.parts[0].status).toBe('unreadable');
    expect(view.parts[0].key).toBe('desconocido');
    expect(view.complete).toBe(false);
  });

  it('no declara completo un total sin número legible', () => {
    const view = normalizeDigitalDollars(
      body({ total: { raw: 'mucho', amount: 'mucho', decimals: 6, unit: 'USDC' }, components: [okComponent()] }),
    )!;
    expect(view.total).toBeNull();
    expect(view.totalRaw).toBeNull();
    expect(view.complete).toBe(false);
  });

  it('no declara completo un cuerpo sin ninguna pieza leída', () => {
    // Cero piezas no es "cero dólares leídos": es que no se leyó nada. La
    // conjunción exige al menos una pieza.
    //
    // Observado, y sin corregir acá: en este caso `incompletenessNote` queda
    // `null`, porque `buildIncompletenessNote([])` no tiene una pieza que
    // nombrar. O sea: `complete: false` **sin** frase que lo explique. La
    // vista dice que el total no es toda la verdad pero no dice por qué, y el
    // contrato del campo dice que `null` es sólo cuando sí lo es. Seguido en
    // `digitalDollars.ts` (`normalizeDigitalDollars`, rama del `incompletenessNote`).
    const view = normalizeDigitalDollars(body({ total: usdc('0'), components: [] }))!;
    expect(view.complete).toBe(false);
    expect(view.parts).toHaveLength(0);
  });

  it('no copia el `true` del backend cuando una pieza quedó ilegible', () => {
    const view = normalizeDigitalDollars(
      body({
        complete: true,
        components: [okComponent(), { key: 'k', label: 'Kamino', source: 'yield', status: 'unreadable', reason: 'APY_NON_POSITIVE' }],
      }),
    )!;
    expect(view.complete).toBe(false);
  });

  it('lee un total de 23 decimales sin perder el centavo que un double perdería', () => {
    // 1.234.567.890.123.456,79 vive en la posición 18 del entero. Cualquier
    // implementación en `double` redondea esto a ...457,00 — setenta mil
    // dólares de diferencia sobre una sola fila.
    const raw = `${123456789012345679n}${'0'.repeat(21)}`;
    const view = normalizeDigitalDollars(
      body({ total: { raw, amount: raw, decimals: 23, unit: 'USDC' }, components: [okComponent()] }),
    )!;
    expect(view.totalRaw).toBe(123456789012345679000000000000000000000n);
    expect(view.total).toBe('1.234.567.890.123.456,79');
    expect(view.totalDecimals).toBe(23);
  });

  it('cae a USDC cuando el total no se pudo leer, sin inventar otra unidad', () => {
    const view = normalizeDigitalDollars(
      body({ total: null, components: [okComponent()] }),
    );
    expect(view).not.toBeNull();
    expect(view!.unit).toBe('USDC');
    expect(AMOUNT_DISPLAY_DECIMALS).toBe(2);
  });
});

describe('buildIncompletenessNote de dólares digitales — la misma frase que el balance', () => {
  it('no inventa frase cuando no falta nada', () => {
    expect(buildIncompletenessNote([])).toBeNull();
  });

  it('nombra las piezas que faltan y aclara que el total es parcial', () => {
    const note = buildIncompletenessNote(['USDC en Monad', 'USDC en Solana'])!;
    expect(note).toContain('USDC en Monad y USDC en Solana');
    expect(note).toContain('sólo cuenta lo que sí pudimos leer');
  });

  it('separa "no lo supimos leer" de "no tenés"', () => {
    expect(TOTAL_UNREADABLE_NOTE).toContain('No es que no tengas: es que no lo supimos leer');
  });
});

describe('el importe que el backend manda en la unidad mínima', () => {
  it('acepta un importe con 18 decimales sin perder el último dígito', () => {
    const view = normalizeDigitalDollars(
      body({ total: { raw: '123456789012345678', amount: '0.123456789012345678', decimals: 18, unit: 'USDC' }, components: [okComponent()] }),
    )!;
    expect(view.totalRaw).toBe(123456789012345678n);
    expect(view.total).toBe('0,12');
  });

  it('no acepta un importe negativo: no es un saldo, es un error de lectura', () => {
    // Truncarlo a cero convertiría un bug del backend en un saldo de cero
    // pintado con toda la confianza del mundo.
    const view = normalizeDigitalDollars(
      body({
        total: { raw: '-1', amount: '-1', decimals: 6, unit: 'USDC' },
        complete: false,
        components: [okComponent()],
      }),
    )!;
    expect(view.total).toBeNull();
    expect(view.totalRaw).toBeNull();
  });

  it('usa el importe tal cual vino, no el `raw` reescalado', () => {
    // El backend manda `raw` y `amount` como el mismo número en dos
    // representaciones. La vista guarda el entero y pinta desde ahí; si
    // pintara desde `amount` en `double`, los 18 decimales de un aToken
    // perderían precisión justo en la última fila.
    const view = normalizeDigitalDollars(
      body({ components: [okComponent({ value: { raw: '1000000', amount: '1.000000', decimals: 6, unit: 'USDC' } })] }),
    )!;
    expect(asOk(view.parts[0]).formatted).toBe('1,00');
    expect(asOk(view.parts[0]).decimals).toBe(6);
  });
});

describe('sanidad del armador de pruebas', () => {
  it('el helper `amount` no inventa un `amount` distinto del `raw`', () => {
    // Trampa de los fixtures: si el helper fabricara un texto decimal
    // redondeado, todos los tests de este archivo estarían probando un cuerpo
    // que el backend nunca manda.
    expect(amount('1000000', 6).amount).toBe('1000000');
  });
});