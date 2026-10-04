/**
 * Mercado simulado: precio de cada activo y saldo de la cuenta.
 *
 * ── Este archivo desaparece cuando exista el backend ───────────────────────
 *
 * Acá vive el dato que la app **se inventa**: cuánto vale cada moneda y cuánto
 * tiene el usuario. Los precios vienen de una API y los saldos de la cuenta,
 * así que el día que exista el backend, este archivo se borra junto con las
 * llamadas y lo que sobrevive es `config/assets.ts`, que es identidad de
 * producto y no mock.
 *
 * Que el precio esté acá y no en el componente no es una cuestión de orden:
 * es lo que hace que cambiar el precio de un activo sea cambiar un número. Antes
 * los precios estaban escritos dentro de los componentes y el mismo Bitcoin
 * costaba 64.250 en el flujo de comprar y 95.400 en el detalle del mismo
 * activo, en dos pantallas del mismo producto.
 *
 * ── Un precio por activo, y de paso un único camino entre dos monedas ──────
 *
 * `convert()` es el único lugar donde se pasa de una moneda a otra, y siempre
 * pasando por dólares: si mañana la tasa no es un número fijo sino una consulta
 * a un oráculo, se cambia acá y no en las siete pantallas que convierten.
 */

import { ASSETS, assetByTicker } from './assets';
import type { Asset } from './assets';
import type { AssetTicker } from './assets';

/** Cuántos decimales se muestran al formatear, según el catálogo. */
export const BALANCE_DECIMALS: Readonly<Record<string, number>> = Object.fromEntries(
  ASSETS.map((asset) => [asset.ticker, asset.decimals]),
);

/**
 * ── LA TASA DEL POOL NO VIVE ACÁ. NO VIVE EN NINGÚN LUGAR ─────────────────
 *
 * Antes este archivo tenía `POOL_SUPPLY_APR = 3.9` y `formatApr()`, y la billetera
 * y el detalle del pool lo llamaban para pintar `Rindiendo 3,90% anual`. El mismo
 * número escrito a mano en cuatro lugares de tres archivos, con dos valores
 * distintos, y **sin ninguna fuente**: todavía no hay conexión con Aave.
 *
 * Una tasa escrita a mano no es un dato viejo, es una promesa de rendimiento sobre
 * plata que la persona no tiene depositada. Por eso no se cambia por otro número
 * ni por un cero: se borra. La tasa entra cuando T5 conecte el pool y el backend
 * devuelva la lectura real, y lo único que hace falta entonces es
 * `formatAmount(bps / 100, 2)` —el formateador de más abajo, que no es mock.
 *
 * Quien necesite formatear una tasa cuando exista tiene `formatAmount`. Si no hay
 * de dónde sacar el número, la respuesta es que falta el dato, nunca un default.
 */

/**
 * Precio de cada activo, en dólares.
 *
 * ── Sigue siendo MOCK, y esta vez la razón es una pantalla ajena ────────────
 *
 * No se borra en esta pasada porque su cadena de consumidores termina en
 * `components/common/AssetTradeCard.tsx`, que no es de este cambio: ese componente
 * muestra el equivalente en dólares y la conversión entre dos activos, y los dos
 * salen de acá. Borrar el precio sin tocar esa pantalla no volvería la app
 * verdadera: la volvería peor, porque `priceUsd()` devolvería `0` y el
 * equivalente se mostraría como `$0,00`, que es una cifra falsa con forma de dato.
 *
 * Los dólares digitales valen 1 porque es lo que significa ser una stablecoin; no
 * es un número inventado para completar la tabla. Para los cripto es un precio de
 * ejemplo y va a ser reemplazado por el oráculo, junto con la pantalla de
 * conversión que lo consume.
 */
export const ASSET_PRICE_USD: Readonly<Record<string, number>> = {
  BTC: 95400,
  ETH: 2650,
  SOL: 118.27,
  TRX: 0.11,
  DOGE: 0.7,
  USDC: 1,
  USDT: 1,
};

/**
 * ── BORRADO: `POOL_SUPPLY_APR` y `formatApr()` ──────────────────────────────
 *
 * Eran la tasa anual del pool (3,9) y su formateo. No hay conexión con Aave, así
 * que ese número no tenía fuente: era una promesa de rendimiento sobre plata que
 * la persona no depositó. Se borró en vez de ajustarse.
 *
 * Reaparecen cuando T5 conecte el pool: la tasa llega del backend y se muestra
 * con `formatAmount(valor, 2)`, que sigue vivo más abajo. Lo que **no** vuelve
 * es un valor por defecto — una función que sabe mostrar una tasa sin que nadie
 * le pase una tasa es exactamente cómo la tasa inventada llegó a cuatro
 * pantallas.
 */

/**
 * Saldo de la cuenta, en la unidad del activo.
 *
 * ── Sigue siendo MOCK, por la misma razón que el precio ─────────────────────
 *
 * `balanceLabel()` lo renderiza `components/common/AssetSheet.tsx`, el selector de
 * activo del flujo de comprar y vender, y ese componente está fuera de este
 * cambio. Borrar el saldo sin tocarlo produciría un `0` en cada activo, y un `0`
 * en un saldo es una afirmación: la de que la persona no tiene plata.
 *
 * Cuando haya backend, esto se borra junto con el precio, cuando el selector
 * pase a leer el mismo `GET /api/portfolio` que lee el resto de la app.
 *
 * Los que no están acá valen 0, y es lo honesto dentro de la tabla: la cuenta no
 * tiene de esos. Un saldo inventado para que un activo "se vea" lleno es un
 * número falso en la pantalla de alguien.
 */
export const BALANCES: Readonly<Record<string, number>> = {
  BTC: 0.00852543,
  USDC: 250,
  USDT: 0,
  ETH: 0,
  SOL: 0,
  TRX: 0,
  DOGE: 0,
};

/**
 * El precio del dólar en pesos.
 *
 * Queda solo para las pantallas que muestran el equivalente en pesos. En los
 * flujos de comprar y vender ya no se usa: ahí el equivalente es en dólares,
 * que es la unidad en la que el usuario realmente piensa cuando compra.
 *
 * No se borra en esta pasada porque lo importa `config/displayCurrency.ts`, que no
 * es de este cambio y formatea el equivalente en pesos de varias pantallas.
 */
export const ARS_PER_USD = 1570;

/** El precio de un activo en dólares. 0 si no existe. */
export function priceUsd(ticker: string): number {
  return ASSET_PRICE_USD[ticker] ?? 0;
}

/** El saldo de un activo, en su unidad. 0 si no está en la tabla. */
export function balanceOf(ticker: string): number {
  return BALANCES[ticker] ?? 0;
}

/** Convierte una cantidad de cualquier activo a dólares. */
export function toUsd(amount: number, ticker: string): number {
  return amount * priceUsd(ticker);
}

/**
 * Convierte una cantidad de un activo a otro, pasando por dólares.
 *
 * El `0` cuando el precio destino es 0 no es un detalle: sin ese guarda, un
 * activo sin precio daba `NaN` y `NaN` en pantalla se ve como texto roto en
 * lugar de un número.
 */
export function convert(amount: number, from: string, to: string): number {
  const targetPrice = priceUsd(to);
  if (targetPrice === 0) return 0;
  return toUsd(amount, from) / targetPrice;
}

/** Convierte dólares a pesos. */
export function toArs(usd: number): number {
  return usd * ARS_PER_USD;
}

/** Convierte pesos a dólares. */
export function fromArs(ars: number): number {
  return ars / ARS_PER_USD;
}

/**
 * Un número como se muestra en pantalla: `"0,00852543"`, `"250,00"`.
 *
 * Los componentes muestran cifras, no las arman. Centralizar el formato evita
 * que una pantalla muestre `0.00852543` y otra `0,00852543` en la misma app,
 * que es el tipo de detalle que después se reporta como bug.
 */
export function formatAmount(amount: number, decimals: number): string {
  return amount.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Los decimales de un activo, según el catálogo. 8 si no se conoce. */
export function decimalsOf(ticker: string): number {
  return BALANCE_DECIMALS[ticker] ?? 8;
}

/** `"0,00852543"`: el saldo de un activo, formateado. */
export function balanceLabel(ticker: string): string {
  return formatAmount(balanceOf(ticker), decimalsOf(ticker));
}

/** `"0,00852543 BTC"`: el saldo con su ticker, como aparece en el detalle. */
export function balanceWithTicker(ticker: string): string {
  return `${balanceLabel(ticker)} ${ticker}`;
}

/**
 * El saldo de un activo listo para meter en el campo de monto.
 *
 * `balanceLabel` devuelve un string con coma decimal y el campo de monto también
 * trabaja con coma, así que los dos lados del MAX usan el mismo texto y no hay
 * una conversión escondida en el medio.
 */
export function balanceAsInput(ticker: string): string {
  return balanceLabel(ticker);
}

/** El activo de un ticker, o el deollars por defecto. Nunca devuelve null. */
export function assetOrDefault(ticker: string): Asset {
  return assetByTicker(ticker) ?? (assetByTicker('USDC') as Asset);
}

/** Los tipos re-exportados, para que un componente importe de un solo lugar. */
export type { Asset, AssetTicker };