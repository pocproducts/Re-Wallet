/**
 * En qué moneda se le muestra el dinero a la persona.
 *
 * ── Por qué este archivo existe ─────────────────────────────────────────────
 *
 * Antes de esto cada pantalla escribía su unidad a mano: unas ponían `" USD"` en
 * el texto, otras `" ARS"`, otras el precio del activo con un interruptor. Cambiar
 * la política monetaria de la app era cambiar quince lugares y rezar para no
 * dejar uno. Acá hay un solo lugar donde se decide.
 *
 * ── Lo que todavía NO se puede decidir, y por qué ───────────────────────────
 *
 * **No hay rampas.** Entra dinero a la cuenta y sale de la cuenta por canales que
 * todavía no existen, así que no hay manera de convertir de una moneda a otra en
 * el momento en que la persona la está mirando. Mostrarle un número en una moneda
 * que no puede conseguir sería mostrarle algo que no es cierto.
 *
 * Por eso hoy la respuesta es **dólares**, para todos los países: es la unidad en
 * la que el backend mide todo y la única que se puede leer sin conversion.
 *
 * ── El día que haya rampas, se cambia SOLO acá ─────────────────────────────
 *
 * La decisión va a ser por país y no global: un usuario en un país con rampa ve
 * su moneda local, y uno en un país sin rampa sigue viendo dólares. Ese caso
 * necesita el país de la persona, así que la función va a pasar a recibirlo —o a
 * leerlo de la sesión— cuando esa información exista.
 *
 * Mientras tanto la decisión está escrita en un solo lugar y no depende de
 * ninguna pantalla. Cambiarla es cambiar esta función.
 */

import { ARS_PER_USD } from './markets';
import { formatAmount } from './markets';

/** Las dos monedas en las que la app sabe mostrar un valor fiat. */
export type DisplayCurrency = 'USD' | 'ARS';

/** Cuántos decimales muestra un importe fiat. */
export const FIAT_DECIMALS = 2;

/**
 * La moneda por defecto de toda la app.
 *
 * Hoy, dólares. Ver la nota de arriba: sin rampas no hay conversión posible, y
 * una moneda que la persona no puede conseguir no es información, es decorado.
 */
export function defaultDisplayCurrency(): DisplayCurrency {
  return 'USD';
}

/** El símbolo que va delante del número. */
export function fiatSymbol(currency: DisplayCurrency): string {
  return currency === 'ARS' ? '$' : 'U$';
}

/** Convierte dólares a la moneda elegida. */
export function fiatAmount(usd: number, currency: DisplayCurrency = defaultDisplayCurrency()): number {
  return currency === 'ARS' ? usd * ARS_PER_USD : usd;
}

/**
 * Un importe fiat listo para pintar: `"U$813,33"` o `"$1.276.848,00"`.
 *
 * El símbolo va adelante y el código no: `"U$813,33"` se lee de un vistazo y
 * `"813,33 USD"` obliga a volver a leer. Cuando haya un símbolo que se confunda
 * con otro, el código vuelve a hacer falta, y ese cambio se hace acá.
 */
export function formatFiat(
  usd: number,
  currency: DisplayCurrency = defaultDisplayCurrency(),
): string {
  return `${fiatSymbol(currency)}${formatAmount(fiatAmount(usd, currency), FIAT_DECIMALS)}`;
}

/**
 * El mismo importe con el código explícito, para los lugares donde hace falta.
 *
 * Solo para la línea que compara un valor con un saldo o un total, donde dos
 * números distintos uno al lado del otro necesitan que se diga de qué son.
 */
export function formatFiatWithCode(
  usd: number,
  currency: DisplayCurrency = defaultDisplayCurrency(),
): string {
  return `${formatFiat(usd, currency)} ${currency}`;
}