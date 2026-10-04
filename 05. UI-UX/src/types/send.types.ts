/**
 * La respuesta de `POST /api/send/prepare`, tal como la manda el backend.
 *
 * ── Por qué los importes viajan como texto y no como número ──────────────────
 *
 * El monto es el entero de la unidad mínima (`"1500000"` = 1,5 USDC) y una
 * cadena de cadena es un entero de 256 bits. Un `number` de JavaScript tiene 53
 * bits: a partir de ~9·10¹⁵ cualquier conversión redondea, y redondear un monto
 * es mandar otra plata que la que la persona escribió. El texto decimal es
 * exacto de punta a punta y es lo que el backend ya valida y usa.
 *
 * ── Por qué `value` NO es `'0'` como en el depósito ──────────────────────────
 *
 * `services/pool.types.ts` declara `value: '0'` porque un depósito de USDC no
 * mueve la moneda nativa. **Un envío nativo sí la mueve**, así que acá `value` es
 * un decimal arbitrario y el tipo no lo acota a `'0'`: un tipo que dijera `'0'`
 * haría que una conversión futura leyera un envío de MON como si no pagara nada.
 */

/** La clave de red del catálogo, la misma que usa depósito. */
export type SendChainKey = 'monad' | 'ethereum' | 'solana';

/** El activo del envío, **con su escala**: el backend la compara con el catálogo. */
export interface SendAssetRequest {
  readonly symbol: string;
  /** Tiene que ser exactamente la del catálogo, o la respuesta es `INVALID_AMOUNT`. */
  readonly decimals: number;
}

/** El cuerpo de `POST /api/send/prepare`. */
export interface SendPreparationBody {
  /**
   * El identificador de **esta** intención de envío, generado por el cliente.
   *
   * Un UUID del navegador, uno por preparación: es lo que impide que un doble
   * toque prepare dos transferencias.
   */
  readonly requestId: string;
  readonly chain: SendChainKey;
  readonly asset: SendAssetRequest;
  readonly recipient: string;
  /** El monto en la unidad mínima, como texto decimal. */
  readonly amountRaw: string;
}

/**
 * Una transacción sin firmar. Un envío es **una** y de un solo `purpose`.
 *
 * `value` es `'0'` para un ERC-20 y el monto exacto para una moneda nativa; por
 * eso es `string` y no el `'0'` literal del depósito.
 */
export interface SendUnsignedTransaction {
  readonly purpose: 'transfer';
  readonly to: string;
  /** `transfer(recipient, amount)`, o `'0x'` para un envío nativo. */
  readonly data: string;
  /** El entero exacto, en la unidad mínima, como texto decimal. */
  readonly value: string;
  readonly chainId: number;
}

/**
 * El movimiento que el backend escribió al preparar.
 *
 * `status: 'pending'` significa exactamente eso: la transacción existe y
 * **nadie la firmó**. La pantalla no lo muestra como un envío hecho.
 */
export interface PendingSendMovement {
  readonly id: string;
  readonly status: 'pending';
}

export interface SendPreparationResponse {
  readonly requestId: string;
  readonly chain: SendChainKey;
  /** El id de cadena donde hay que firmar. `0` en una red sin id EIP-155. */
  readonly chainId: number;
  /** CAIP-2, que es como la wallet nombra la red. */
  readonly network: string;
  /** Siempre uno: un envío es una transferencia. */
  readonly transactions: readonly SendUnsignedTransaction[];
  readonly movement: PendingSendMovement;
}

/**
 * Los motivos por los que el backend rechaza un envío. Acotados, uno por caso.
 *
 * El orden en que se aplican está documentado en el README del backend y es
 * deliberado: lo que no depende de la cadena se responde antes de gastar un RPC.
 * La pantalla sólo traduce; el orden es del servidor.
 */
export type SendRejectionCode =
  | 'REQUEST_ID_INVALID'
  | 'IDEMPOTENT_REPLAY'
  | 'IDEMPOTENT_IN_FLIGHT'
  | 'CHAIN_UNKNOWN'
  | 'ASSET_NOT_ON_CHAIN'
  | 'INVALID_RECIPIENT'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'NO_GAS'
  | 'BALANCE_UNREADABLE'
  | 'WALLETS_UNAVAILABLE';