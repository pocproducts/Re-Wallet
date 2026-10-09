/**
 * Los tipos del flujo de comprar y vender, y de la lista de activos que elige.
 *
 * ── Por qué existe esta fila y no la de `config/assets.ts` ──────────────────
 *
 * La fila del selector de trade no es "un activo": es **un activo en una red**.
 * El catálogo del backend trae USDC en Monad, en Ethereum y en Solana, y una
 * persona puede tenerlo en más de una. Una fila que dice solamente "USDC" no dice
 * si esos dólares están en una red, en dos o en ninguna, así que no es una
 * verdad: es una palabra. Por eso la fila se identifica por `key` —red y símbolo
 * juntos— y siempre nombra su red.
 *
 * ── Por qué los números son `string | null` y no `number` ───────────────────
 *
 * `null` es **"no lo sé"** y el texto es la cifra que el backend ya formateó
 * para pintar. Un saldo o un precio que nadie pudo leer llega como `null` y la
 * pantalla no muestra nada en su lugar; nunca `0`. La diferencia no es de estilo:
 * `0` afirma que la persona no tiene esa plata, y eso es una afirmación que acá
 * casi siempre sería mentira.
 *
 * ── Por qué el precio es un texto y no un número ────────────────────────────
 *
 * Porque no se opera: no hay motor de swap todavía, así que nadie multiplica
 * esta cifra por un monto. Es lo que el backend ya formateó (`formatUnitPrice`),
 * y que exista no obliga a que se use para calcular nada.
 */

import type { DepositAssetKind } from './deposit.types';

/**
 * Lo mínimo que hace falta para dibujar una fila: identidad, no datos.
 *
 * Es un tipo propio y no `Asset` de `config/assets` a propósito: la identidad de
 * producto sigue viviendo allá, pero el flujo de trade no depende de ese
 * catálogo —que además contiene activos que el backend no conoce— y no debe
 * seguir atado a él.
 */
export interface TradeAssetIdentity {
  /** El símbolo del activo: `USDC`, `MON`. */
  readonly ticker: string;
  /** Lo que ve la persona: `Dólares digitales`, `Monad`. */
  readonly name: string;
  /** El glifo del círculo de color. */
  readonly glyph: string;
  /** La clase Tailwind del círculo. Es una clase, no un color. */
  readonly iconBg: string;
  /** Cuántos decimales tiene el activo, según el catálogo del backend. */
  readonly decimals: number;
}

/** Una fila real de la lista de trade: un activo, en una red, con lo que se leyó. */
export interface TradeAssetRow extends TradeAssetIdentity {
  /**
   * La identidad estable de la fila: red y símbolo juntos, `"monad:USDC"`.
   *
   * Nunca el símbolo solo. Con USDC en tres redes, el símbolo no identifica a
   * una fila y usarlo como clave haría que elegir una tocara las otras dos.
   */
  readonly key: string;
  /** La red de esta fila, tal como la nombra el backend. `null` si no aplica. */
  readonly chainLabel: string | null;
  /** En qué camino de la pantalla se ofrece: cripto o dólares digitales. */
  readonly kind: DepositAssetKind;
  /**
   * El saldo real, ya formateado. `null` cuando la cadena no lo dio.
   *
   * Un cero real llega como `"0"` y se muestra como cero: ahí sí sabemos que no
   * hay plata. Lo que no se muestra es lo que nadie leyó.
   */
  readonly balanceText: string | null;
  /**
   * El precio en dólares que salió de `/api/wallet-balance`, ya formateado.
   *
   * `null` cuando esa pieza no se pudo valorar. No se sustituye por `1` ni por
   * `0`: una stablecoin vale uno por definición y una cripto vale lo que diga el
   * oráculo, y si no lo dijo, no lo sabemos.
   */
  readonly priceText: string | null;
}
