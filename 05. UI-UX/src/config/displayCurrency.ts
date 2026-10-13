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
 * ── Solo USD ──────────────────────────────────────────────────────────────────
 *
 * La app muestra todo en USD. Sin rampas de conversión, no hay manera honesta
 * de mostrar otra moneda. Este archivo queda como punto único de decisión.
 */
export type DisplayCurrency = 'USD';

/** Cuántos decimales muestra un importe fiat. */
export const FIAT_DECIMALS = 2;

/** La moneda por defecto de toda la app: USD. */
export function defaultDisplayCurrency(): DisplayCurrency {
  return 'USD';
}

/** El símbolo que va delante del número. */
export function fiatSymbol(_currency: DisplayCurrency): string {
  return 'U$';
}

/** Convierte dólares a la moneda elegida (solo USD, sin conversión). */
export function fiatAmount(usd: number, _currency: DisplayCurrency = defaultDisplayCurrency()): number {
  return usd;
}

/**
 * Un importe fiat listo para pintar: `"U$813,33"`.
 */
export function formatFiat(
  usd: number,
  _currency: DisplayCurrency = defaultDisplayCurrency(),
): string {
  return `U${usd.toLocaleString('en-US', { minimumFractionDigits: FIAT_DECIMALS, maximumFractionDigits: FIAT_DECIMALS })}`;
}

/**
 * El mismo importe con el código explícito.
 */
export function formatFiatWithCode(
  usd: number,
  _currency: DisplayCurrency = defaultDisplayCurrency(),
): string {
  return `${formatFiat(usd)} USD`;
}