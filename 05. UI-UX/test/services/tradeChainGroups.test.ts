/**
 * LA AGRUPACIÓN POR RED.
 *
 * ── Por qué esto merece un test ─────────────────────────────────────────────
 *
 * Porque el error que evita es el más caro de una pantalla de conversión:
 * elegir USDC-de-Monad cuando se quería USDC-de-Base. Cuatro filas idénticas en
 * una lista plana se distinguen solo por un texto chico; con la red de
 * encabezado, el ojo elige dentro de un grupo.
 *
 * ── La propiedad que más importa ────────────────────────────────────────────
 *
 * Que ninguna fila se pierda ni se duplique al agrupar. Una fila perdida es un
 * activo que no se puede elegir; una duplicada es una que parece estar en dos
 * redes a la vez.
 */
import { describe, expect, it } from 'vitest';

import { groupAssetsByChain } from '../../src/hooks/useAssetTrade';
import type { TradeAssetRow } from '../../src/types/trade.types';

const fila = (key: string, chainLabel: string | null): TradeAssetRow => ({
  key,
  ticker: key.split(':').at(-1) ?? key,
  name: key,
  glyph: 'U',
  iconBg: 'bg-slate-200',
  decimals: 6,
  chainLabel,
  kind: 'dollar',
  balanceText: '0',
  priceText: '1.00',
});

describe('groupAssetsByChain', () => {
  it('agrupa por red, conservando el orden de entrada', () => {
    const grupos = groupAssetsByChain([
      fila('monad:USDC', 'Monad'),
      fila('base:USDC', 'Base'),
      fila('monad:USDT0', 'Monad'),
    ]);

    // Monad aparece primero porque fue la primera red del catálogo, no porque
    // "Monad" venga antes que "Base" en el abecedario — el catálogo ya trae un
    // orden elegido y cambiarlo acá sería una segunda fuente de verdad.
    expect(grupos.map((g) => g.chainLabel)).toEqual(['Monad', 'Base']);
    expect(grupos[0]?.rows.map((r) => r.key)).toEqual(['monad:USDC', 'monad:USDT0']);
  });

  it('no pierde ni duplica ninguna fila', () => {
    const entrada = [
      fila('monad:USDC', 'Monad'),
      fila('base:USDC', 'Base'),
      fila('arbitrum:USDC', 'Arbitrum'),
      fila('monad:USDT0', 'Monad'),
    ];

    const salida = groupAssetsByChain(entrada).flatMap((g) => g.rows);

    expect(salida).toHaveLength(entrada.length);
    expect(salida.map((r) => r.key).sort()).toEqual(entrada.map((r) => r.key).sort());
  });

  it('deja las filas sin red en su propio grupo, con encabezado propio', () => {
    const grupos = groupAssetsByChain([
      fila('sin-red:LOQUE', null),
      fila('monad:USDC', 'Monad'),
    ]);

    // Una fila sin red no se reparte en la primera: no hay red que la nombre, y
    // meterla en un grupo cualquiera le inventaría una.
    const sinRed = grupos.find((g) => g.chainLabel === null);
    expect(sinRed?.rows.map((r) => r.key)).toEqual(['sin-red:LOQUE']);
  });

  it('una lista vacía no inventa un grupo', () => {
    expect(groupAssetsByChain([])).toEqual([]);
  });

  it('una sola red no necesita encabezado de la nada', () => {
    const grupos = groupAssetsByChain([fila('monad:USDC', 'Monad'), fila('monad:MON', 'Monad')]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.chainLabel).toBe('Monad');
  });
});