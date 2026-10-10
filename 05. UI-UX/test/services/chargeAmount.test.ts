/**
 * El importe del cobro, del teclado al backend.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * `chargeAmountToDecimal` validaba el importe contra `` `${whole}.${fraction}` ``,
 * una cadena que siempre lleva un punto. Cuando el importe no tenía decimales,
 * `fraction` venía vacío, la cadena evaluada terminaba en punto —`"1."`— y el
 * patrón `^\d{1,14}(?:\.\d{1,6})?$` la rechazaba porque exige de uno a seis
 * dígitos después del punto.
 *
 * El efecto en la app fue que **todo importe entero era imposible de cobrar**:
 * `1`, `10`, `100` devolvían "El importe no es un número válido", mientras que
 * `1,5` pasaba sin problema. El mensaje señalaba un problema de formato y el
 * bug era de una línea, así que nadie lo conectó con el cobro.
 *
 * Lo que把这些 tests fijan es la **forma del importe completo**, no un caso
 * suelto: si alguien vuelve a validar una reconstrucción distinta de la que
 * devuelve, el caso entero vuelve a fallar acá.
 */
import { describe, expect, it } from 'vitest';

import { chargeAmountToDecimal } from '../../src/services/paymentRequests';

describe('chargeAmountToDecimal — los importes enteros', () => {
  it('acepta un importe sin decimales, que es el caso que estaba roto', () => {
    // El que fallaba en la beta: teclear `1` y que la app lo rechazara.
    expect(chargeAmountToDecimal('1')).toBe('1');
    expect(chargeAmountToDecimal('10')).toBe('10');
    expect(chargeAmountToDecimal('100')).toBe('100');
    expect(chargeAmountToDecimal('1')).not.toContain('.');
  });

  it('no le agrega un punto decimal que la persona no escribió', () => {
    // `1` es `1`, no `1.` ni `1.0`: el backend recibe lo que se tecleó.
    expect(chargeAmountToDecimal('7')).toBe('7');
    expect(chargeAmountToDecimal('250')).toBe('250');
  });

  it('sigue aceptando los importes con decimales que ya funcionaban', () => {
    expect(chargeAmountToDecimal('1,5')).toBe('1.5');
    expect(chargeAmountToDecimal('1,50')).toBe('1.50');
    expect(chargeAmountToDecimal('0,001')).toBe('0.001');
    expect(chargeAmountToDecimal('12,999999')).toBe('12.999999');
  });

  it('entiende el punto como separador de miles, como el resto de la app', () => {
    expect(chargeAmountToDecimal('1.234')).toBe('1234');
    expect(chargeAmountToDecimal('1.234,56')).toBe('1234.56');
  });
});

describe('chargeAmountToDecimal — lo que tiene que seguir rechazado', () => {
  it('rechaza el cero y los ceros con decimales de relleno', () => {
    // Un cobro de $0 no es un cobro, y mandarlo rompe el CHECK de la base
    // (`payment_requests_amount_positive`). El backend no tiene que ser el
    // que lo descubra.
    for (const text of ['0', '0,00', '0,000', '000']) {
      expect(() => chargeAmountToDecimal(text)).toThrow(RangeError);
    }
  });

  it('rechaza lo que no es un importe', () => {
    for (const text of ['', '   ', 'abc', '-1', '1,5,5']) {
      expect(() => chargeAmountToDecimal(text)).toThrow(RangeError);
    }
  });

  it('lee todos los puntos como separadores de miles, y eso es lo que dice', () => {
    // `1.2.3` son mil doscientos treinta y tres, no un importe mal formado: el
    // punto es separador de miles en el teclado argentino y se quitan todos.
    // Fijarlo acá evita que alguien "corrija" esto creyendo que es un error de
    // formato, y rompa `1.234` que sí es el caso real.
    expect(chargeAmountToDecimal('1.2.3')).toBe('123');
    expect(chargeAmountToDecimal('1.234.567')).toBe('1234567');
  });

  it('recorta los decimales de más en vez de redondear', () => {
    // Mandar plata que no se escribió, y hacia arriba, es peor que recortarla.
    expect(chargeAmountToDecimal('0,1234567')).toBe('0.123456');
    expect(chargeAmountToDecimal('1,9999999')).toBe('1.999999');
  });
});