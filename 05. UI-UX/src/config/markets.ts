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
 * Precio de cada activo, en dólares.
 *
 * Los dólares digitales valen 1 porque es lo que significa ser una stablecoin;
 * no es un número invented para completar la tabla. Para los cripto es un precio
 * de ejemplo y va a ser reemplazado por el oráculo.
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
 * La tasa anual del pool donde rinde el dinero del usuario, en porcentaje.
 *
 * ── Esto es MOCK, y es el único lugar donde vive ────────────────────────────
 *
 * Antes el mismo número estaba escrito a mano en cuatro lugares de tres
 * archivos, y con dos valores distintos: la billetera y las pantallas de
 * dólares decían 3,90 y el detalle del pool decía 2,90. Dos tasas en la misma
 * app, y ninguna fuente de verdad.
 *
 * Cuando el backend exista, este valor deja de escribirse acá: llega de la
 * lectura del pool. El laboratorio (`Front End/src/data/poolSummary.ts`) ya lee
 * `GET /yield/summary` y devuelve `supplyAprBps` en puntos básicos, así que la
 * conexión es—fromBps(ese valor)— y **esta línea se borra**. Eso es justo lo que
 * hace que valga la pena tenerla en un solo lugar: cambiar el dato del backend es
 * cambiar una línea, no cuatro.
 *
 * Un punto porcentual está escrito como número y formateado con `formatApr()`,
 * no como texto con coma: el número es el dato, la coma es cómo se muestra.
 */
export const POOL_SUPPLY_APR = 3.9;

/** La tasa del pool como se muestra: `"3,90"`. */
export function formatApr(value: number = POOL_SUPPLY_APR): string {
  return formatAmount(value, 2);
}

/**
 * Saldo de la cuenta, en la unidad del activo.
 *
 * Los que no están acá valen 0, y es lo honesto: la cuenta no tiene de esos. Un
 * saldo inventado para que un activo "se vea" lleno es un número falso en la
 * pantalla de alguien.
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