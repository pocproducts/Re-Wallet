/**
 * La respuesta de `GET /api/digital-dollars`: **un solo número**, con la
 * declaración de si ese número es toda la verdad.
 *
 * ── Por qué esto es una unión discriminada y no campos opcionales ────────────
 *
 * `components` es una unión, y no una lista de objetos con `value?` y `reason?`:
 *
 * | `status` | Qué es | Qué puede llevar |
 * |---|---|---|
 * | `ok` | Se leyó. El importe **puede ser cero**: cero real | `value`, y `reason: null` |
 * | `unreadable` | No se pudo leer | `reason`, y `value: null` |
 *
 * Con campos opcionales, un `0` y un "no lo sé" son el mismo objeto, y una
 * pantalla que los pinta igual cuenta una mentira. Con la unión, TypeScript no
 * deja leer `value` de un componente ilegible, ni `reason` de uno legible: el
 * error más caro de esta pantalla deja de ser representable.
 *
 * ── Por qué el total NO tiene estado propio ─────────────────────────────────
 *
 * Deliberado, del lado del servidor. El total es "lo que se pudo leer", y eso es
 * una afirmación verdadera; si fuera el total entero, su estado tendría que ser
 * `ok` o `unreadable`, y cualquier elección mentiría en un sentido o en el otro.
 * La completitud viaja **al lado**, en `complete`, que está **siempre** presente:
 * `false` significa que el número es parcial, y `components` dice qué parte
 * falta. Por eso acá no hay `status` para el total y no se le inventa uno.
 */

import type { PoolAmount } from './pool.types';

/** De dónde sale la pieza: la billetera o el rendimiento. */
export type DigitalDollarSource = 'free_wallet' | 'yield';

/** Una pieza leída. `value` está siempre, y puede valer cero. */
export interface DigitalDollarComponentOk {
  readonly key: string;
  /** Texto ya en castellano del backend: `"USDC en Monad"`. */
  readonly label: string;
  readonly source: DigitalDollarSource;
  readonly status: 'ok';
  readonly reason: null;
  readonly value: PoolAmount;
}

/** Una pieza que no se pudo leer. `value` es `null`: nunca un cero. */
export interface DigitalDollarComponentUnreadable {
  readonly key: string;
  readonly label: string;
  readonly source: DigitalDollarSource;
  readonly status: 'unreadable';
  /** Enum acotado del backend. La frase la pone la pantalla. */
  readonly reason: string;
  readonly value: null;
}

export type DigitalDollarComponent = DigitalDollarComponentOk | DigitalDollarComponentUnreadable;

export interface DigitalDollarsResponse {
  readonly generatedAt: string;
  /** La unidad de todos los importes y del total: `"USDC"`. */
  readonly unit: string;
  /** La suma exacta de lo que se pudo leer. Sin estado propio, a propósito. */
  readonly total: PoolAmount;
  /** `false` significa que el total es **parcial**. Siempre presente. */
  readonly complete: boolean;
  readonly components: readonly DigitalDollarComponent[];
}