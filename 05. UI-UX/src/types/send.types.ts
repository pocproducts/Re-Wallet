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
 * ── Por qué hay **dos** formas de transacción ─────────────────────────────────
 *
 * Una transacción de Solana compilada no tiene `to` ni `data`: es un mensaje con
 * un blockhash, instrucciones y cuentas. Estirarla dentro de la forma EVM
 * (`{to, data:'0x', value, chainId: 0}`) produce algo que parece una
 * transacción, responde 200, y no se puede firmar en ninguna wallet de Solana.
 *
 * Por eso el backend contesta con `kind: 'solana'` y esta tabla tiene las dos
 * formas, y por eso el hook decide por **`kind`**. Escribirse por el nombre de la
 * red sería decidir por un dato del catálogo: hoy funciona, y el día que el
 * catálogo sume una red con el mismo nombre en otro espacio de nombres deja de
 * funcionar sin que ninguna prueba se entere.
 *
 * ── Por qué `value` NO es `'0'` como en el depósito ──────────────────────────
 *
 * `services/pool.types.ts` declara `value: '0'` porque un depósito de USDC no
 * mueve la moneda nativa. **Un envío nativo sí la mueve**, así que acá `value` es
 * un decimal arbitrario y el tipo no lo acota a `'0'`: un tipo que dijera `'0'`
 * haría que una conversión futura leyera un envío de MON como si no pagara nada.
 *
 * ── Por qué `address` es el campo que decide quién firma ─────────────────────
 *
 * `address` es la wallet **que el backend usó**: la de la fila de
 * `rewallet.wallets` de esta persona, la misma contra la que leyó el saldo y
 * armó la transacción. Viene en la respuesta porque el navegador tiene que firmar
 * por esa billetera y no puede deducirla: su propio `GET /api/deposit-info` es
 * una lectura de otro momento, y si las dos no coinciden el backend validó un
 * saldo y la persona firmó por otra billetera.
 *
 * Por eso el mismo nombre que en `pool.types.ts`: las dos rutas que mueven plata
 * contestan con el mismo campo, por la misma razón.
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
  /**
   * Nunca está en una transacción EVM, y por eso la forma ya la identifica: una
   * que llega con `kind: 'solana'` es la otra. Si algún día el backend empieza a
   * mandar `kind` en todas, esta propiedad acepta el valor y el resto del hook no
   * cambia.
   */
  readonly kind?: 'evm';
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
  /**
   * La wallet **del backend**: la fila de `rewallet.wallets` contra la que leyó
   * el saldo y armó la transacción. Nunca viene del pedido.
   *
   * Es la única dirección en la que se puede firmar: si no está, la preparación
   * no se entiende y no se firma. Mismo nombre que `POST /api/pool/deposit`.
   */
  readonly address: string;
  /**
   * El id de cadena donde hay que firmar.
   *
   * **No está** en una cadena que no tenga id EIP-155: en Solana esta propiedad
   * no existe en la respuesta, y no es `0`. El nombre de la red, en CAIP-2, está
   * en `network`, y es lo que se compara con la configuración de la app.
   */
  readonly chainId?: number;
  /** CAIP-2, que es como la wallet nombra la red. */
  readonly network: string;
  /** Siempre uno: un envío es una transferencia. Una forma u otra, nunca dos. */
  readonly transactions: readonly SendTransaction[];
  readonly movement: PendingSendMovement;
}

/**
 * El discriminador entre las dos formas de transacción.
 *
 * Se decide por `kind` y **nunca** por el nombre de la cadena: una transacción
 * serializada de Solana no tiene `to` ni `data`, y una de EVM no tiene
 * `serializedTransaction`, así que la forma es lo que dice de qué se trata. El
 * nombre de la red es un dato del catálogo, y el catálogo cambia.
 */
export type SendTransaction = SendUnsignedTransaction | SendUnsignedSolanaTransaction;

/** `true` cuando la transacción es un mensaje de Solana compilado. */
export const isSolanaSendTransaction = (
  transaction: SendTransaction,
): transaction is SendUnsignedSolanaTransaction => 'kind' in transaction && transaction.kind === 'solana';

/**
 * Una transacción de Solana, ya compilada por el backend y sin firmar.
 *
 * `serializedTransaction` es el **mensaje** en base64 —blockhash, instrucciones
 * y cuentas—, no una transacción firmada: la firma la pone la wallet de la
 * persona, en el navegador. Es la forma que espera `signAndSendTransaction` de
 * Privy, que toma bytes.
 */
export interface SendUnsignedSolanaTransaction {
  readonly purpose: 'transfer';
  /** El discriminador. La forma EVM no lo lleva: su forma ya lo dice. */
  readonly kind: 'solana';
  /** El mensaje sin firmar, en base64. */
  readonly serializedTransaction: string;
  /** `'solana'`: el mensaje nombra su propio clúster. */
  readonly chain: 'solana';
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