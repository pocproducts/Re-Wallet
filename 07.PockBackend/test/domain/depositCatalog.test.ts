/**
 * EL CATÁLOGO DE DEPÓSITO, y su clasificación.
 *
 * ── Por qué la clasificación vive en el catálogo y no en la pantalla ──────────
 *
 * "Depositar → Cripto" y "Depositar → Dólares digitales" son **dos caminos de la
 * misma pantalla**, y el dueño los quiere separados sin que la separación se
 * vuelva a escribir en dos lugares. La pregunta "¿qué activos son dólares?" no
 * puede tener dos respuestas, así que no la responde ninguna pantalla: la
 * responde `kind`, una fila del catálogo, y las dos pantallas filtran por ella.
 *
 * Si en algún momento el catálogo declara un USDT, ese USDT aparece solo en el
 * camino de dólares, con su red y su dirección, sin tocar ninguna pantalla.
 *
 * ── Por qué `kind` y no un `isDollar` ────────────────────────────────────────
 *
 * Porque `isDollar: false` se lee como "todo lo demás", y en este dominio
 * "todo lo demás" no es una categoría honesta: es lo que no se clasificó todavía.
 * Un valor de dos opciones obliga a clasificar cada fila del catálogo, y una fila
 * sin clasificar es un error de compilación en vez de un activo listado en la
 * pantalla equivocada.
 *
 * ── Por qué este archivo es un test y no un comentario ────────────────────────
 *
 * Un comentario se queda viejo. Estas cuatro propiedades —toda fila clasificada,
 * toda fila con red, ninguna fila doblemente clasificada, la clasificación
 * viajando en la respuesta— son las que hacen que agregar un dólar sea una fila.
 */
import { describe, expect, it } from 'vitest';

import {
  DEPOSIT_NETWORKS,
  type DepositAssetKind,
  type DepositChain,
} from '../../src/domain/deposit/catalog';

/** Los valores que `kind` puede tomar. Cualquier otro es un error de catálogo. */
const KINDS: readonly DepositAssetKind[] = ['crypto', 'dollar'];

/** Cada fila del catálogo, con la red en la que está declarada. */
const everyAsset = (): { chain: DepositChain; symbol: string; kind: DepositAssetKind }[] =>
  DEPOSIT_NETWORKS.flatMap((network) =>
    network.assets.map((asset) => ({ chain: network.chain, symbol: asset.symbol, kind: asset.kind })),
  );

describe('el catálogo de depósito — toda fila está clasificada', () => {
  it('cada activo declara un kind, y el kind es uno de los dos valores', () => {
    for (const asset of everyAsset()) {
      expect(
        KINDS,
        `el activo ${asset.symbol} en ${asset.chain} declara un kind que no existe: ${String(asset.kind)}`,
      ).toContain(asset.kind);
    }
  });

  it('cada activo declara una red: está en una fila del catálogo, y en una sola', () => {
    // Un activo sin red no tiene adónde recibir, y uno declarado en dos filas es
    // la misma fila escrita dos veces.
    for (const asset of everyAsset()) {
      const rows = DEPOSIT_NETWORKS.filter((network) =>
        network.assets.some((entry) => entry.symbol === asset.symbol),
      );
      expect(rows, `${asset.symbol} no está en ninguna fila del catálogo`).not.toHaveLength(0);
      expect(rows.some((network) => network.chain === asset.chain)).toBe(true);
    }
  });

  it('un símbolo no puede ser dólar en una red y cripto en otra', () => {
    const kindsBySymbol = new Map<string, Set<DepositAssetKind>>();

    for (const asset of everyAsset()) {
      const kinds = kindsBySymbol.get(asset.symbol) ?? new Set<DepositAssetKind>();
      kinds.add(asset.kind);
      kindsBySymbol.set(asset.symbol, kinds);
    }

    for (const [symbol, kinds] of kindsBySymbol) {
      expect(
        [...kinds],
        `${symbol} está clasificado de más de una forma en el catálogo: ${[...kinds].join(', ')}`,
      ).toHaveLength(1);
    }
  });

  it('el mismo símbolo en dos redes es el mismo activo, con el mismo kind', () => {
    // USDC vive en siete redes con siete direcciones distintas: es un activo, no siete.
    const usdc = DEPOSIT_NETWORKS.flatMap((network) =>
      network.assets
        .filter((asset) => asset.symbol === 'USDC')
        .map((asset) => ({ chain: network.chain, kind: asset.kind, token: asset.token })),
    );
    expect(usdc.map((asset) => asset.chain)).toEqual(['monad', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana']);
    expect(new Set(usdc.map((asset) => asset.kind))).toEqual(new Set<DepositAssetKind>(['dollar']));
    // Y las direcciones NO son la misma: por eso la red es parte del activo. En
    // Solana la fila es un mint —una cuenta del Token Program— y no un contrato
    // desplegado, pero la regla es la misma: cada red declara la suya.
    expect(new Set(usdc.map((asset) => asset.token)).size).toBe(7);
    // La de Solana no es una dirección EVM: usarla donde vive otra sería el bug
    // que este catálogo ya pagó una vez.
    expect(usdc.find((asset) => asset.chain === 'solana')?.token).toBe(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
  });

  it('lo que el catálogo declara hoy: las cripto son cripto y los dólares son dólares', () => {
    const kindOf = (symbol: string): DepositAssetKind | undefined =>
      DEPOSIT_NETWORKS.flatMap((network) => network.assets)
        .find((asset) => asset.symbol === symbol)?.kind;

    expect(kindOf('MON')).toBe('crypto');
    expect(kindOf('ETH')).toBe('crypto');
    expect(kindOf('SOL')).toBe('crypto');
    expect(kindOf('USDC')).toBe('dollar');
    expect(kindOf('USDT')).toBe('dollar');
    expect(kindOf('POL')).toBe('crypto');
  });

  it('el camino de dólares no inventa activos: hoy es USDC y nada más', () => {
    const dollarSymbols = new Set(
      DEPOSIT_NETWORKS.flatMap((network) => network.assets)
        .filter((asset) => asset.kind === 'dollar')
        .map((asset) => asset.symbol),
    );

    // Lo que se recibe hoy: los dólares digitales declarados y nada más.
    expect([...dollarSymbols].sort()).toEqual(['USDC', 'USDT']);
  });
});
