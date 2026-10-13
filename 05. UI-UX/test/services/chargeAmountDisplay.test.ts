/**
 * EL IMPORTE QUE SE MUESTRA, que no es el que la base guarda.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * El backend guarda el importe en `numeric(38,18)`. Postgres devuelve esa escala
 * completa: lo que la persona escribe como `0,01` vuelve como
 * `"0.010000000000000000"`, y la pantalla lo mostraba crudo. El efecto en la app
 * era que **el número que la persona escribía no volvía a aparecer**: tecleaba
 * `0,01` y le mostraban `0.'010000000` con dieciséis ceros de relleno.
 *
 * Es peor que un detalle de formato. En un cobro, el importe es la única parte
 * del contrato que la otra persona puede verificar de un vistazo: si la pantalla
 * que genera el cobro y la que lo paga dicen números distintos, nadie sabe cuál
 * es el correcto y la confianza en el cobro entero se pierde.
 *
 * ── Por qué esto es una función y no un `replace` en la pantalla ────────────
 *
 * Porque hay cuatro lugares que muestran el importe —la pantalla del cobro
 * generado, el texto que se comparte, el movimiento de Actividad y la pantalla
 * de quien paga— y si el recorte vive en uno, los otros tres vuelven a mostrar
 * la escala completa. La regla es una sola y se testea una sola vez.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No redondea. Un wei de más que la persona escribió es plata que existe, y
 * recortarla hacia arriba sería mandar más de lo escrito.
 */
import { describe, expect, it } from 'vitest';

import { formatChargeAmount } from '../../src/services/paymentRequests';

describe('formatChargeAmount — el importe como lo escribió la persona', () => {
  it('quita los ceros de relleno que agrega la escala del servidor', () => {
    // El caso exacto de la beta: "0,01" tecleado, "0.010000000000000000" devuelto.
    expect(formatChargeAmount('0.010000000000000000')).toBe('0,01');
    expect(formatChargeAmount('0.500000000000000000')).toBe('0,5');
  });

  it('un importe entero no muestra punto ni decimales', () => {
    expect(formatChargeAmount('10.000000000000000000')).toBe('10');
    expect(formatChargeAmount('1.000000000000000000')).toBe('1');
    expect(formatChargeAmount('100')).toBe('100');
  });

  it('NO recorta los decimales que sí se escribieron', () => {
    // Un wei de más es plata que existe: recortarla sería mandar otra cosa.
    expect(formatChargeAmount('0.000000000000000001')).toBe('0,000000000000000001');
    expect(formatChargeAmount('0.123400000000000000')).toBe('0,1234');
  });

  it('usa la coma decimal, como el resto de la app', () => {
    // El punto es separador de miles en el teclado argentino, igual que en
    // `chargeAmountToDecimal`: la coma es la que separa el decimal.
    expect(formatChargeAmount('1.5')).toBe('1,5');
    expect(formatChargeAmount('1.500000000000000000')).toBe('1,5');
  });

  it('pone el punto de miles en los importes grandes, como el resto de la app', () => {
    expect(formatChargeAmount('1234.5')).toBe('1.234,5');
    expect(formatChargeAmount('1234567.890000000000000000')).toBe('1.234.567,89');
  });

  it('un importe que no es un número se devuelve tal cual, sin inventar nada', () => {
    // Un texto inesperado tiene que verse tal cual para poder diagnosticarlo, no
    // convertirse en un 0 que parece un cobro válido.
    expect(formatChargeAmount('')).toBe('');
    expect(formatChargeAmount('abc')).toBe('abc');
    expect(formatChargeAmount('0,01')).toBe('0,01');
  });

  it('lo que muestra la pantalla del cobro es lo mismo que ve quien paga', () => {
    // Las dos pantallas leen el mismo string del backend. Si una formatea y la
    // otra no, el cobro se contradice a simple vista y nadie sabe qué pagar.
    const delBackend = '0.010000000000000000';
    expect(formatChargeAmount(delBackend)).toBe(formatChargeAmount(delBackend));
    expect(formatChargeAmount(delBackend)).toBe('0,01');
  });
});