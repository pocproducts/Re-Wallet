/**
 * La respuesta de `GET /api/pool` y de `POST /api/pool/deposit`, tal como las
 * manda el backend.
 *
 * ── Por qué cada campo trae su propio estado ─────────────────────────────────
 *
 * El pool de Aave y la posición de una persona son lecturas de cadena, y una
 * lectura de cadena falla. Lo que **no** puede pasar es que un fallo se pinte
 * como un cero: un `0` de APR se lee como "el pool no paga", y un `0` de saldo se
 * lee como "no tenés nada". Son las dos mentiras más caras que puede contar una
 * pantalla de dinero.
 *
 * Por eso el tipo no es `number | null` sino un estado explícito:
 *
 * | `status` | Qué es | Cómo se muestra |
 * |---|---|---|
 * | `ok` | Se leyó. `amount` puede ser `"0"`: una posición real de cero | El número, incluido el cero |
 * | `unreadable` | No se pudo leer (`reason` es un enum acotado) | "No pudimos leer…", nunca `0` |
 *
 * ── Por qué los importes son texto ────────────────────────────────────────────
 *
 * Vienen como el entero exacto de la cadena más su versión decimal sin redondear,
 * con los decimales y la unidad al lado. Un importe redondeado no se puede volver
 * a comparar con la cadena, y una transacción se construye a partir del entero.
 */

/** Los estados de un campo leído. `unreadable` no es `ok` con un cero. */
export type PoolFieldStatus = 'ok' | 'unreadable';

/** Un campo de la lectura, con su estado. */
export interface PoolField<T> {
  readonly status: PoolFieldStatus;
  /** Sólo si `status` es `ok`. */
  readonly value?: T;
  /** Sólo si `status` es `unreadable`. Enum acotado del backend, nunca prosa. */
  readonly reason?: string;
}

/** Un importe exacto, con la escala y la unidad para poderlo pintar. */
export interface PoolAmount {
  /** El entero que reportó la cadena, en la unidad mínima. */
  readonly raw: string;
  /** El mismo valor en su unidad, **sin redondear**. `"0"` es un cero real. */
  readonly amount: string;
  readonly decimals: number;
  readonly unit: string;
}

/** Un porcentaje con cuatro decimales, tal como lo entrega el backend. */
export type PoolPercent = string;

export interface PoolApr {
  readonly supply: PoolField<PoolPercent>;
  readonly borrow: PoolField<PoolPercent>;
}

export interface PoolTotals {
  readonly supplied: PoolField<PoolAmount>;
  readonly borrowed: PoolField<PoolAmount>;
  readonly available: PoolField<PoolAmount>;
  readonly utilisation: PoolField<PoolPercent>;
}

/** La posición de esta persona: lo suyo, no lo del pool. */
export interface PoolPosition {
  /** La dirección de la fila de la base. Nunca viene del pedido. */
  readonly address: string;
  /** `aMonUSDC`: el recibo de Aave en Monad. */
  readonly aTokenBalance: PoolField<PoolAmount>;
  /** USDC libre en la billetera: lo que un depósito movería de verdad. */
  readonly availableUsdc: PoolField<PoolAmount>;
  /** MON, que es lo que paga el gas. Sin esto, no hay depósito. */
  readonly gasBalance: PoolField<PoolAmount>;
}

export interface PoolResponse {
  readonly generatedAt: string;
  readonly network: { readonly name: string; readonly chainId: number; readonly protocol: string };
  readonly asset: { readonly symbol: string; readonly unit: string; readonly decimals: number };
  readonly reserve: { readonly status: PoolFieldStatus; readonly reason?: string };
  readonly reserveDecimals: number;
  readonly apr: PoolApr;
  readonly totals: PoolTotals;
  readonly lastUpdate: PoolField<{ readonly unix: number; readonly iso: string }>;
  /**
   * La tasa de dépôt reproducida desde la tasa de préstamo, la utilización y el
   * reserve factor. Cuando `agrees` es `false`, el número de arriba no es de fiar
   * y la pantalla tiene que decirlo en vez de mostrarlo como un hecho.
   */
  readonly reconciliation: PoolField<{ readonly percent: PoolPercent; readonly agrees: boolean }>;
  readonly position: PoolPosition;
}

/** Una transacción sin firmar, en el orden en que hay que firmarla. */
export interface UnsignedTransaction {
  readonly purpose: 'approve' | 'deposit';
  readonly to: string;
  readonly data: string;
  /** Siempre `'0'`: un depósito de USDC no envía MON. */
  readonly value: '0';
  readonly chainId: number;
}

/** Los motivos por los que un depósito se rechaza. Acotados, uno por caso. */
export type DepositRejectionCode =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_NOT_POSITIVE'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'BALANCE_UNREADABLE';

export interface DepositPreparationResponse {
  readonly chainId: number;
  readonly address: string;
  readonly asset: { readonly symbol: string; readonly unit: string; readonly decimals: number };
  readonly amount: PoolAmount;
  /** `false` cuando el allowance ya cubre exactamente este monto. */
  readonly approvalRequired: boolean;
  readonly allowance: PoolField<PoolAmount>;
  /** En orden. El `approve` está ausente exactamente cuando no hace falta. */
  readonly transactions: readonly UnsignedTransaction[];
  readonly gasBalance: PoolField<PoolAmount>;
}
