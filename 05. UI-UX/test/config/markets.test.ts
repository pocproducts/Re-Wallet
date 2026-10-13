/**
 * `src/config/markets.ts`: el formateador y el catálogo.
 *
 * Lo que **no** está acá también importa: este archivo ya no tiene precios,
 * saldos inventados ni tipo de cambio. Los tests de abajo no pueden proteger
 * una tabla que ya no existe; protegen lo que queda, que es la convención de
 * formato con la que se pintan los números y el fallback del catálogo.
 */

import { describe, expect, it } from 'vitest';
import { assetOrDefault, formatAmount } from '../../src/config/markets';

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

/*
 * ── El bloque `toArs / fromArs` que estaba acá se borró a propósito ──────────
 *
 * Este archivo pruebaba un tipo de cambio fijo (`ARS_PER_USD = 1570`) con ida
 * y vuelta sin pérdida de centavo. Esa conversión **se eliminó del producto y
 * no se reemplaza por nada**: un cociente de dos constantes en el cliente no es
 * una cotización, es un número con la ropa de una.
 *
 * El bug concreto que motivó borrarla: el mismo Bitcoin valía 1.573,41 en pesos
 * en una pantalla y 813,33 dólares en las otras cuatro, porque cada pantalla
 * armaba su propio número. `CryptoAssetDetailModal.tsx` lo deja escrito donde
 * importaba: el «≈ en pesos» desapareció y no se reemplaza por nada.
 *
 * Por qué esto importa para el archivo que queda: si en seis meses alguien
 * reimplementa `toArs` sobre un tipo de cambio fijo y lo reintroduce, este test
 * vuelve a pasar y el bug vuelve con él. No lo resucites.
 *
 * Si la conversión vuelve, entra con su cotización real —el motor de swap, 1inch
 * para EVM y Jupiter para Solana, con el precio del activo y su origen—, no con
 * una tabla en el cliente. Y cuando vuelva, este test vuelve con ella.
 */

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