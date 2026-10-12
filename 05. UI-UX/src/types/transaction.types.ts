/**
 * TIPOS DE TRANSACCIONES.
 *
 * Este archivo define el tipo utilizado para las transacciones financieras
 * en el ActivityView.
 */

export interface TransactionItem {
  /** Identificador único de la transacción. */
  readonly id: string;
  /** Título corto de la transacción (ej: "Compra de Cryptos"). */
  readonly title: string;
  /** Fecha de la transacción. */
  readonly date: string;
  /** Monto formateado con signo y moneda (ej: "+ 7,193689 TRX"). */
  readonly amount: string;
  /** Indica si la transacción es un ingreso (true) o egreso (false). */
  readonly isPositive: boolean;
  /** Tipo de activo o transacción (usado para iconos: 'usdc', 'trx', 'qr_charge', etc.). */
  readonly type: string;
  /** Descripción opcional de la transacción. */
  readonly concept?: string;
  /** Fecha de expiración para cobros QR. */
  readonly expiresAt?: string;
  /** Payload del código QR para cobros QR. */
  readonly qrPayload?: string;
}

/**
 * Respuesta del endpoint de transacciones.
 */
export interface TransactionsResponse {
  /** Timestamp de cuando se generó el feed, o null si no está disponible. */
  readonly generatedAt: string | null;
  /** Lista de transacciones, del más nuevo al más viejo. */
  readonly transactions: TransactionItem[];
}