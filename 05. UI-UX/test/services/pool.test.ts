/**
 * `src/services/pool.ts`: la aritmética de dinero del pool y la condición que
 * decide si una tasa se muestra.
 *
 * Cada caso dice **qué mentira evita**, en castellano, como el resto del repo.
 * Un test que pasa con el código roto no está acá.
 */

import { describe, expect, it } from 'vitest';
import {
  AMOUNT_DISPLAY_DECIMALS,
  APR_DISPLAY_DECIMALS,
  formatAmount,
  formatPercent,
  formatScaled,
  normalizePool,
  projectYearlyGain,
  roundScaled,
  toScaled,
} from '../../src/services/pool';
import { amount } from '../fixtures';

describe('formatPercent — el porcentaje del backend es un decimal de máquina', () => {
  it('lee "4.1196" como 4,12% y no como 411,96%', () => {
    // El punto es un separador de máquina: "4.1196" son cuatro con mil ciento
    // noventa y seis, NO cuatro mil ciento noventa y seis. Parsearlo con el
    // formateador de importes —que se come los puntos— mostraría 411,96%, que
    // es una tasa cien veces más grande sobre plata de otra persona.
    expect(formatPercent('4.1196')).toBe('4,12%');
  });

  it('se niega a leer "4,1196" con coma en vez de inventar 411,96%', () => {
    // La coma no es formato de máquina. Aceptarla en silencio sería la mitad
    // del defecto anterior: un backend que cambiara el separador viraría
    // "4,1196" en una tasa cien veces mayor, sin ningún error visible.
    expect(() => formatPercent('4,1196')).toThrow(RangeError);
  });

  it('redondea 4,125% hacia arriba, que es exactamente la mitad', () => {
    // El redondeo documentado es "mitad hacia arriba", hecho en enteros. En la
    // mitad exacta no hay margen: cualquier redondeo distinto (o un `toFixed`
    // sobre un `double`) cambia el último dígito de una tasa real.
    expect(formatPercent('4.1250')).toBe('4,13%');
  });

  it('redondea 4,135% hacia arriba y no hacia abajo como haría un float', () => {
    // 4.135 no es representable en binario: como `double` queda un pelo por
    // debajo de la mitad y un `toFixed(2)` devuelve "4.13". La cuenta entera
    // ve 4,135 exacto y sube. Es el caso donde un doble se delata.
    expect(formatPercent('4.1350')).toBe('4,14%');
  });

  it('deja 4,1349% en 4,13% y no lo infla a la mitad', () => {
    // El vecino del caso anterior: si el redondeo fuera "hacia el siguiente
    // entero" en vez de "mitad hacia arriba", 4,1349 también saltaría.
    expect(formatPercent('4.1349')).toBe('4,13%');
  });

  it('pinta el signo de una tasa negativa', () => {
    expect(formatPercent('-1.5000')).toBe('-1,50%');
  });

  it('devuelve null, y no "0,00%", cuando no se pudo leer la tasa', () => {
    // Un "0,00%" de rendimiento afirma "este pool no paga". Cuando lo que pasó
    // es que no lo supimos leer, esa afirmación es falsa y cuesta plata.
    expect(formatPercent(null)).toBeNull();
  });

  it('se niega a truncar una tasa con más decimales de los declarados', () => {
    // El backend publica cuatro. Un quinto decimal no se recorta en silencio:
    // se corta el resto del número y el resto es la tasa entera.
    expect(() => formatPercent('4.11965')).toThrow(RangeError);
  });

  it('no acepta un porcentaje que no sea texto decimal', () => {
    expect(() => formatPercent('cuatro')).toThrow(RangeError);
    expect(() => formatPercent('')).toThrow(RangeError);
  });
});

describe('roundScaled y formatScaled — un solo redondeo, en enteros', () => {
  it('sube la mitad exacta y deja el número justo debajo', () => {
    // El redondeo ocurre una vez, acá, y es "mitad hacia arriba". Con 0,5 el
    // entero va a 1; con 0,4 va a 0. Cualquier otra regla cambia el centavo.
    expect(formatScaled(5n, 1, 0)).toBe('1');
    expect(formatScaled(4n, 1, 0)).toBe('0');
  });

  it('no imprime un "-0" cuando el número negativo redondea a cero', () => {
    // -0,40 a dos decimales es 0, no menos cero: un "-0,00" en pantalla parece
    // una pérdida de plata que no existe.
    expect(formatScaled(-40n, 2, 0)).toBe('0');
    expect(formatScaled(-5n, 1, 0)).toBe('-1');
  });

  it('agrupa los miles en formato argentino y separa los centavos con coma', () => {
    expect(formatScaled(1234567890n, 6, 2)).toBe('1.234,57');
    expect(formatScaled(0n, 6, 2)).toBe('0,00');
  });

  it('redondea un importe grande sin perder el centavo que un double perdería', () => {
    // 123.456,789012345678901234: el centavo vive en la posición 19 del entero.
    // Un `double` no tiene 19 dígitos significativos, así que cualquier
    // implementación en `number` redondea este número a otra cosa. Acá es
    // "123.456,79" y punto.
    expect(formatScaled(123456789012345678901234n, 18, 2)).toBe('123.456,79');
  });

  it('no toca el número cuando los decimales a pintar son más que los del dato', () => {
    // Sin redondeo no hay pérdida posible: este es el invariante que permite
    // pintar primero y redondear después sin drama.
    expect(roundScaled(12345n, 2, 4)).toBe(12345n);
  });
});

describe('formatAmount — el prefijo y nada más', () => {
  it('antepone el símbolo sin tocar el número', () => {
    expect(formatAmount(1234567890n, 6, 'U$')).toBe('U$1.234,57');
    expect(formatAmount(0n, 6)).toBe('0,00');
  });

  it('redondea a los dos decimales que el resto de la app usa', () => {
    expect(AMOUNT_DISPLAY_DECIMALS).toBe(2);
    expect(APR_DISPLAY_DECIMALS).toBe(2);
  });
});

describe('toScaled — el importe argentino es un entero exacto', () => {
  it('lee "173.874.477,77" como 173.874.477,77 y no como 173,87', () => {
    // Los puntos son separadores de miles acá. Comerse uno —el error por
    // defecto al reutilizar el parser de porcentajes— pierde seis dígitos de
    // plata de golpe.
    expect(toScaled('173.874.477,77', 2)).toBe(17387447777n);
  });

  it('rellena los decimales que faltan sin inventar el número', () => {
    expect(toScaled('12', 2)).toBe(1200n);
    expect(toScaled('12,5', 2)).toBe(1250n);
  });

  it('se niega a leer un importe con más decimales de los declarados', () => {
    expect(() => toScaled('1,234', 2)).toThrow(RangeError);
  });

  it('lee un importe de precisión arbitraria sin perder un dígito', () => {
    // 18 decimales: por debajo de `Number`, el redondeo por `number` no aparece
    // como un decimal raro sino como un número completamente distinto.
    expect(toScaled('0,000000000000000001', 18)).toBe(1n);
  });
});

describe('projectYearlyGain — la proyección de un año', () => {
  it('devuelve null cuando no hay tasa, en vez de proyectar cero', () => {
    // Una ganancia proyectada de cero afirma "este pool no rinde nada". Cuando
    // lo que no se pudo leer es la tasa, esa frase es inventada.
    expect(projectYearlyGain(100_000_000n, 6, null)).toBeNull();
  });

  it('proyecta el 100% de 100 USDC como 100,00, no como 1,00', () => {
    // Un 100% de APR sobre 100 USDC son 100 USDC. El código dividía por
    // 1e6 * 100 = 1e8 cuando la cuenta es raw x aprScaled / (1e4 * 100) =
    // /1e6: cien veces menos de lo que el pool paga, y esa cifra se pintaba
    // como estimación de un año. Defecto real, corregido; el caso queda como
    // guarda de que el divisor no vuelva a ser 1e8.
    expect(projectYearlyGain(100_000_000n, 6, '100.0000')).toEqual({
      gain: 100_000_000n,
      label: '100,00',
    });
  });

  it('proyecta una tasa chica sobre un saldo grande con el centavo exacto', () => {
    // 123.456,789012 al 4,1196% son 5.085,925880… USDC. Con `double` el último
    // dígito se pierde; en `bigint` el truncado es el único redondeo y es el
    // declarado. El mismo defecto del caso anterior, en una magnitud donde el
    // error no se ve como un factor sino como plata que falta.
    expect(projectYearlyGain(123456789012n, 6, '4.1196')).toEqual({
      gain: 5085925880n,
      label: '5.085,93',
    });
  });
});

/* ── `displayableSupplyApr`: la condición que decide si hay una tasa ───────── */

const poolBody = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2024-05-01T00:00:00.000Z',
  network: { name: 'Monad', chainId: 143, protocol: 'aave-v3' },
  asset: { symbol: 'USDC', unit: 'USDC', decimals: 6 },
  reserve: { status: 'ok' as const },
  reserveDecimals: 6,
  apr: {
    supply: { status: 'ok' as const, value: '4.1196' },
    borrow: { status: 'ok' as const, value: '5.5000' },
  },
  totals: {
    supplied: { status: 'ok' as const, value: amount('1000000', 6, 'USDC') },
    borrowed: { status: 'ok' as const, value: amount('100000', 6, 'USDC') },
    available: { status: 'ok' as const, value: amount('900000', 6, 'USDC') },
    utilisation: { status: 'ok' as const, value: '0.1000' },
  },
  lastUpdate: { status: 'unreadable' as const, reason: 'STALE' },
  reconciliation: {
    status: 'ok' as const,
    value: { percent: '4.1196', agrees: true },
  },
  position: {
    address: '0xabc',
    aTokenBalance: { status: 'ok' as const, value: amount('0', 6, 'USDC') },
    availableUsdc: { status: 'ok' as const, value: amount('0', 6, 'USDC') },
    gasBalance: { status: 'ok' as const, value: amount('0', 6, 'MON') },
  },
  ...overrides,
});

describe('normalizePool — `displayableSupplyApr` es `reconciles ? supplyApr : null`', () => {
  it('muestra la tasa de depósito cuando el pool reconcilia su propio número', () => {
    const view = normalizePool(poolBody());
    expect(view?.displayableSupplyApr).toBe('4.1196');
    expect(view?.aprReconciles).toBe(true);
    expect(view?.apr.supply.status).toBe('ok');
  });

  it('retira la tasa cuando la reconciliación no cierra, aunque el APR venga', () => {
    // `agrees: false` significa que el APR de la pantalla y el que sale de la
    // reserva no son el mismo número. Publicar cualquiera de los dos es
    // publicar un número que no se puede reproducir.
    const view = normalizePool(
      poolBody({
        reconciliation: { status: 'ok', value: { percent: '4.1196', agrees: false } },
      }),
    );
    expect(view?.displayableSupplyApr).toBeNull();
    expect(view?.apr.supply.status).toBe('unreadable');
    expect(view?.aprReconciles).toBe(false);
  });

  it('retira la tasa cuando la reconciliación no se pudo leer', () => {
    // Sin reconciliación no hay con qué reproducir el APR. Ausente es
    // ilegible, no "reconcilia bien".
    const view = normalizePool(
      poolBody({ reconciliation: { status: 'unreadable', reason: 'RPC_UNAVAILABLE' } }),
    );
    expect(view?.displayableSupplyApr).toBeNull();
    expect(view?.apr.supply.status).toBe('unreadable');
  });

  it('retira la tasa cuando el APR de depósito tampoco se pudo leer', () => {
    const view = normalizePool(
      poolBody({ apr: { supply: { status: 'unreadable', reason: 'STALE' }, borrow: { status: 'ok', value: '5.5000' } } }),
    );
    expect(view?.displayableSupplyApr).toBeNull();
  });

  it('marca la reserva ilegible cuando la reserva no se leyó', () => {
    const view = normalizePool(
      poolBody({ reserve: { status: 'unreadable', reason: 'RESERVE_DECODE_FAILED' } }),
    );
    expect(view?.reserveReadable).toBe(false);
  });

  it('deja la tasa de préstamo intacta: la reconciliación es sólo del depósito', () => {
    // La condición es del APR de depósito y sólo de él. Aplicarla al de
    // préstamo escondería una tasa que sí se pudo leer y que es información
    // real de la reserva.
    const view = normalizePool(
      poolBody({
        reconciliation: { status: 'ok', value: { percent: '4.1196', agrees: false } },
      }),
    );
    expect(view?.apr.borrow.status).toBe('ok');
  });

  it('no inventa una lectura cuando el cuerpo no tiene posición', () => {
    // Sin `position` no hay lectura: la pantalla tiene que poder decir que no
    // leyó, no mostrar ceros de una posición que nadie mandó.
    expect(normalizePool(poolBody({ position: undefined }))).toBeNull();
    expect(normalizePool(null)).toBeNull();
    expect(normalizePool('texto')).toBeNull();
  });

  it('deja la fecha en null cuando el campo vino ilegible', () => {
    // `formatLastUpdate` deriva de `new Date(iso)`: es la función de este módulo
    // atada al reloj del navegador. Se prueba el camino sin reloj —el que
    // decide si se pinta algo— y no la fecha en sí.
    const view = normalizePool(poolBody());
    expect(view?.lastUpdate).toBeNull();
  });
});