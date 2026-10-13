/**
 * Formateo: lo de este archivo que no es un dato inventado.
 *
 * ── Lo que queda y por qué ─────────────────────────────────────────────────
 *
 * Este archivo era el simulacro del mercado: precios escritos a mano, saldos
 * inventados y el tipo de cambio fijo. De todo eso, en esta pasada se fueron
 * **los precios, los saldos y el tipo de cambio ARS**, que son las cosas que
 * la app se inventaba. Queda solo el formateador de números, que no es un dato
 * sino una convención.
 *
 * ── Por qué el precio no se reemplaza por otro número ───────────────────────
 *
 * Sería más fácil cambiar `BTC: 95400` por el precio de hoy. Es el error
 * exacto: dejaría una tabla que parece un mercado y que dentro de una semana
 * vuelve a mentir. El precio real llega con `GET /api/wallet-balance`, por
 * pieza, con su origen —`peg` o `chainlink`— y sin precio cuando no se pudo
 * valorar. No hay tabla que mantener acá.
 *
 * ── Por qué el saldo tampoco ────────────────────────────────────────────────
 *
 * El saldo real sale de `GET /api/portfolio`, por red. Y cuando no se pudo leer,
 * no se muestra: una fila sin saldo dice la verdad, y un `0` afirma que la
 * persona no tiene esa plata.
 *
 * ── Lo que este archivo todavía NO puede hacer ──────────────────────────────
 *
 * Convertir entre dos activos. No hay motor de swap todavía, así que no existe
 * un camino honesto de una moneda a otra acá: lo que había era un cociente de
 * dos constantes, que no es una cotización sino un número con la ropa de una.
 * Cuando el motor exista (1inch para EVM, Jupiter para Solana) la conversión
 * entra con su cotización real, no con una tabla.
 */

import { assetByTicker } from './assets';
import type { Asset } from './assets';
import type { AssetTicker } from './assets';

/**
 * Un número como se muestra en pantalla: `"0,00852543"`, `"250,00"`.
 *
 * Los componentes muestran cifras, no las arman. Centralizar el formato evita
 * que una pantalla muestre `0.00852543` y otra `0,00852543` en la misma app,
 * que es el tipo de detalle que después se reporta como bug.
 *
 * Esto **no es un mock**: formatea un número que le pasó otro, y no inventa el
 * número.
 *
 * Es la convención de **todas** las pantallas que muestran una cifra, sin
 * excepción ni bandera por mercado: separador de miles, coma decimal y la
 * cantidad de decimales que le pide quien llama. No hay conversión adentro ni
 * dehors —la equivalencia en pesos salió del producto— y no vuelve sin una
 * cotización real: un cociente de dos constantes no es un tipo de cambio.
 */
export function formatAmount(amount: number, decimals: number): string {
  return amount.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * El activo de un ticker, o el de dólares por defecto. Nunca devuelve null.
 *
 * Vive acá porque el detalle del cripto lo usa para armar su par de compra y
 * venta, y esa pantalla todavía no lee el catálogo del backend. Cuando lo lea,
 * esto se va con ella.
 */
export function assetOrDefault(ticker: string): Asset {
  return assetByTicker(ticker) ?? (assetByTicker('USDC') as Asset);
}

/** Los tipos re-exportados, para que un componente importe de un solo lugar. */
export type { Asset, AssetTicker };