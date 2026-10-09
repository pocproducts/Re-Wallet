/**
 * PORT: cotización y ejecución de un swap entre dos activos.
 *
 * ── Por qué un puerto y no `fetch` en el caso de uso ─────────────────────────
 *
 * Un swap tiene tres fases: cotizar, congelar la cotización, ejecutar. El
 * transporte (Uniswap V3, 1inch, Privy) es un detalle de infraestructura. El
 * caso de uso decide qué par se puede cotizar, cuánto tiempo dura la cotización
 * y qué pasa si la ejecución falla. Inyectar el proveedor permite testear sin
 * red y cambiar de DEX sin tocar el caso de uso.
 *
 * ── Por qué la cotización tiene expiración ────────────────────────────────────
 *
 * Una cotización en DeFi es válida por segundos. El usuario la ve, la confirma,
 * y la transacción se envía. Si la cotización expiró, la ejecución falla o
 * peor, se ejecuta a un precio distinto. El puerto exige `validUntil` y el
 * caso de uso rechaza cotizaciones expiradas antes de firmar.
 *
 * ── Por qué `quoteId` y no la cotización completa ─────────────────────────────
 *
 * La cotización completa (con ruta, amountIn, amountOut, etc.) es interna al
 * adaptador. El caso de uso sólo guarda un `quoteId` y lo pasa a la ejecución.
 * Así el adaptador puede mantener estado (la ruta exacta, el slippage, el
 * deadline) sin que el caso de uso tenga que serializarlo.
 */

import type { EvmNetwork } from '../portfolio/networks';
import type { DepositChain } from '../deposit/catalog';

/** Qué puede fallar al cotizar o ejecutar. Bounded, para que el caso de uso decida. */
export type SwapFailure =
  | 'PAIR_NOT_SUPPORTED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_NOT_FOUND'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'SLIPPAGE_EXCEEDED'
  | 'RPC_UNAVAILABLE'
  | 'RPC_REJECTED'
  | 'RPC_MALFORMED_RESPONSE'
  | 'USER_REJECTED'
  | 'UNKNOWN_ERROR';

/** Lo que el adaptador sabe de un par. */
export interface SwapPairInfo {
  /** El ticker del activo origen (ej: 'USDC'). */
  readonly sourceSymbol: string;
  /** El ticker del activo destino (ej: 'USDT'). */
  readonly destinationSymbol: string;
  /** La red donde se ejecuta el swap (ej: 'monad'). */
  readonly chain: DepositChain;
  /** La dirección del contrato del router (ej: Uniswap V3 Router). */
  readonly routerAddress: string;
  /** El fee tier del pool (ej: 3000 para 0.3%). */
  readonly feeTier: number;
}

/** Una cotización congelada, lista para ejecutarse. */
export interface SwapQuote {
  /** Identificador opaco que el adaptador usa para recuperar la ruta exacta. */
  readonly quoteId: string;
  /** Qué se entrega (unidades mínimas del activo origen). */
  readonly amountIn: bigint;
  /** Qué se recibe (unidades mínimas del activo destino), **con slippage aplicado**. */
  readonly amountOut: bigint;
  /** Qué se recibe **mínimo** (protección contra slippage). */
  readonly amountOutMin: bigint;
  /** Timestamp (ms) hasta el que la cotización es válida. */
  readonly validUntil: number;
  /** Precio implícito: 1 destino = X origen (ej: 1 USDT = 0.999 USDC). */
  readonly price: string;
  /** El fee del pool en bips (ej: 3000 = 0.3%). */
  readonly feeTier: number;
  /** La red donde se ejecuta. */
  readonly chain: DepositChain;
}

/** Lo que el caso de uso necesita para ejecutar el swap. */
export interface SwapExecutionInput {
  /** El quoteId que devolvió `getQuote`. */
  readonly quoteId: string;
  /** La dirección que firma (la wallet de la persona). */
  readonly signer: string;
  /** El slippage máximo tolerado en bips (ej: 50 = 0.5%). */
  readonly slippageBips: number;
  /** El deadline en segundos desde ahora (ej: 300 = 5 min). */
  readonly deadlineSeconds: number;
}

/** Resultado de una ejecución de swap. */
export interface SwapExecutionResult {
  /** El hash de la transacción (para EVM). */
  readonly txHash: string;
  /** Lo que realmente se recibió. */
  readonly amountOut: bigint;
  /** Gas usado (en wei). */
  readonly gasUsed: bigint;
}

/** El contrato del puerto. */
export interface SwapProvider {
  /**
   * Lista los pares que este proveedor soporta.
   *
   * El caso de uso filtra el catálogo contra esto: si un par no está acá,
   * no se ofrece al usuario.
   */
  readonly getSupportedPairs: () => Promise<readonly SwapPairInfo[]>;

  /**
   * Cotiza un swap.
   *
   * - `amountIn` está en unidades mínimas del activo origen.
   * - Devuelve la cotización con `amountOut` y `amountOutMin` (con slippage).
   * - `validUntil` es un timestamp en ms. El caso de uso rechaza si expiró.
   */
  readonly getQuote: (
    sourceSymbol: string,
    destinationSymbol: string,
    chain: DepositChain,
    amountIn: bigint,
    slippageBips: number,
  ) => Promise<{ status: 'ok'; value: SwapQuote } | { status: 'unreadable'; reason: SwapFailure }>;

  /**
   * Ejecuta un swap ya cotizado.
   *
   * El `quoteId` es opaco para el caso de uso: el adaptador sabe qué ruta,
   * qué pool, qué slippage y qué deadline usar.
   */
  readonly executeSwap: (
    input: SwapExecutionInput,
  ) => Promise<{ status: 'ok'; value: SwapExecutionResult } | { status: 'unreadable'; reason: SwapFailure }>;
}