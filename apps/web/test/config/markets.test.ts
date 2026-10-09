/**
 * `src/config/markets.ts`: el formateador y el tipo de cambio.
 *
 * Lo que **no** está acá también importa: este archivo ya no tiene precios ni
 * saldos inventados. Los tests de abajo no pueden proteger una tabla que ya no
 * existe; protegen lo que queda, que es la convención de formato con la que se
 * pintan los números.
 */

import { describe, expect, it } from 'vitest';
import { ARS_PER_USD, assetOrDefault, formatAmount, fromArs, toArs } from '../../src/config/markets';

describe('formatAmount — el mismo formato en todas las pantallas', () => {
  it('separa con coma y rellena los decimales que se pidieron', () => {
    // Una pantalla con `0.00852543` y otra con `0,00852543` en la misma app es
    // el tipo de detalle que después se reporta como bug.
    expect(formatAmount(0.00852543, 8)).toBe('0,00852543');
    expect(formatAmount(250, 2)).toBe('250,00');
    expect(formatAmount(0, 2)).toBe('0,00');
  });

  it('agrupa los miles con punto, como el resto de la app', () => {
    expect(formatAmount(1234567.89, 2)).toBe('1.234.567,89');
  });

  it('no inventa decimales que no se pidieron', () => {
    // `maximumFractionDigits` es el que impide que un número con más precisión
    // del declarado aparezca igual. Un importe de dinero con decimales de más
    // es un número que la app no puede reproducir.
    expect(formatAmount(1.23456, 2)).toBe('1,23');
    expect(formatAmount(1.5, 0)).toBe('2');
  });

  it('pinta el signo de un número negativo', () => {
    expect(formatAmount(-12.5, 2)).toBe('-12,50');
  });

  it('usa un número sin pérdida para un entero grande, no notación científica', () => {
    // `1e21` impreso como notación científica en pantalla es el signo de un
    // formato que se rompió.
    expect(formatAmount(1e15, 2)).toBe('1.000.000.000.000.000,00');
  });
});

describe('toArs / fromArs — el tipo de cambio que quedó', () => {
  it('convierte y vuelve sin perder un centavo', () => {
    // La ida y vuelta tiene que devolver el mismo número: si no, el
    // equivalente en pesos que muestra una pantalla contradice al de otra.
    expect(toArs(100)).toBe(157000);
    expect(fromArs(157000)).toBe(100);
  });

  it('es exactamente el valor declarado, sin comisión ni redondeo escondido', () => {
    expect(ARS_PER_USD).toBe(1570);
    expect(toArs(0)).toBe(0);
    expect(fromArs(0)).toBe(0);
  });

  it('mantiene el centavo al ida y vuelta a dos decimales', () => {
    // El tipo de cambio es el único número de la app que sigue siendo `double`,
    // porque acá no hay aritmética de dinero: hay una convención de pantalla.
    // Lo que se protege es que la ida y la vuelta no pierdan el centavo que se
    // va a pintar.
    expect(fromArs(toArs(12.34))).toBeCloseTo(12.34, 10);
    expect(formatAmount(toArs(12.34), 2)).toBe('19.373,80');
  });
});

describe('assetOrDefault — nunca devuelve null', () => {
  it('devuelve el activo del catálogo cuando el ticker existe', () => {
    expect(assetOrDefault('USDC').ticker).toBe('USDC');
    expect(assetOrDefault('MON').ticker).toBe('MON');
  });

  it('cae en el activo por defecto en vez de romper la pantalla de comprar', () => {
    // Un ticker desconocido devuelve el de dólares, que es lo que la pantalla
    // sabe pintar. Devolver `null` obligaría a cada pantalla a manejar el
    // caso, y una lo manejaría mostrando cero.
    const fallback = assetOrDefault('TICKER_QUE_NO_EXISTE');
    expect(fallback).toEqual(assetOrDefault('USDC'));
  });
});