/**
 * Identidad de presentación de los activos que reporta `GET /api/portfolio`.
 *
 * ── Por qué existe y por qué es chico ────────────────────────────────────────
 *
 * El catálogo de producto vive en `config/assets.ts`, y ese archivo no entra en
 * esta tarea. Lo que falta ahí es **MON**, que es un ticker que el backend ya
 * devuelve y que la lista de criptoactivos tiene que poder dibujar.
 *
 * Lo único que se agrega acá es identidad de pantalla: el nombre, el glifo del
 * círculo y el color. **Ninguna cantidad, ningún saldo, ningún precio.** Eso no
 * puede salir de una fuente que no sea `GET /api/portfolio`.
 *
 * ── La regla que importa ─────────────────────────────────────────────────────
 *
 * Un ticker que no está ni en el catálogo ni acá **no se muestra**. No sale con
 * un nombre inventado ni con un saldo de ejemplo: no sale. Un activo que el
 * backend no reporta tampoco llega nunca a este archivo.
 *
 * ── El color de MON es deliberadamente neutro ────────────────────────────────
 *
 * En este proyecto no se escribe un valor de una fuente externa de memoria: se
 * deriva y se verifica. El color de marca de Monad no se verificó, así que el
 * círculo va en gris oscuro. Es lo único honesto hasta que se compruebe.
 */

import { assetByTicker } from '../config/assets';

/** Lo que hace falta para dibujar un activo: identidad, no datos. */
export interface PortfolioAssetIdentity {
  readonly name: string;
  readonly glyph: string;
  readonly iconBg: string;
}

/**
 * Identidades que el catálogo de producto todavía no tiene.
 *
 * Sólo entran los tickers que **`GET /api/portfolio` ya devuelve**. Un ticker
 * inventado acá sería un activo que la app puede pintar y la cadena nunca tuvo.
 */
const EXTRA_IDENTITIES: Readonly<Record<string, PortfolioAssetIdentity>> = {
  MON: { name: 'Monad', glyph: 'M', iconBg: 'bg-slate-800' },
};

/**
 * La identidad de un ticker, o `null` si nadie sabe quién es.
 *
 * Primero se consulta el catálogo de producto, que es la fuente de identidad
 * que ya usa el resto de la app; recién después se mira el mapa de arriba.
 */
export const identityOf = (ticker: string): PortfolioAssetIdentity | null => {
  const fromCatalog = assetByTicker(ticker);
  if (fromCatalog) {
    return {
      name: fromCatalog.name,
      glyph: fromCatalog.glyph,
      iconBg: fromCatalog.iconBg,
    };
  }

  return EXTRA_IDENTITIES[ticker] ?? null;
};

/**
 * ¿Es un dólar digital?
 *
 * Sale del catálogo de producto, no de una lista escrita acá: los dólares
 * digitales son USDC y USDT porque el producto los llama así, no porque este
 * archivo lo decida.
 */
export const isDigitalDollar = (ticker: string): boolean => {
  const asset = assetByTicker(ticker);
  return asset !== undefined && asset.name === 'Dólares digitales';
};