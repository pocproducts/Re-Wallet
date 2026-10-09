/**
 * UNISWAP V3 — Math & Encoding para Monad.
 *
 * ── Por qué esto vive en `domain` y no en `infrastructure` ────────────────────
 *
 * El math de Uniswap V3 (sqrtPriceX96, tick, quoter) es **puro dominio**:
 * no depende de RPC, no depende de red, es matemática pura que cualquier
 * implementación de Uniswap V3 debe respetar. El adaptador de infraestructura
 * llama a estas funciones, pero la lógica matemática vive aquí para ser
 * testeable sin red y reutilizable por cualquier adaptador (Uniswap, Sushi, etc.).
 *
 * ── Qué NO hay acá ───────────────────────────────────────────────────────────
 *
 * No hay llamadas RPC, no hay `fetch`, no hay direcciones de contratos.
 * Esas son detalles de infraestructura. Acá está la matemática que hace
 * que Uniswap V3 sea Uniswap V3.
 */

import { asciiHex, keccak256 } from '../send/keccak256';

/** `exactInputSingle(address,address,uint24,address,uint256,uint256,uint256,uint160)` */
export const EXACT_INPUT_SINGLE_SELECTOR = keccak256(
  asciiHex('exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))')
).slice(0, 10);

/** `quoteExactInputSingle(address,address,uint24,uint256,uint160)` */
export const QUOTE_EXACT_INPUT_SINGLE_SELECTOR = keccak256(
  asciiHex('quoteExactInputSingle(address,address,uint24,uint256,uint160)')
).slice(0, 10);

/** Un pool de Uniswap V3 identificado por sus dos tokens y fee tier. */
export interface UniswapV3PoolKey {
  readonly tokenA: string;      // address (checksummed)
  readonly tokenB: string;      // address (checksummed)
  readonly feeTier: number;     // 100, 500, 3000, 10000
}

/**
 * Encuentra el pool key para un par en el orden canónico (tokenA < tokenB).
 *
 * Uniswap V3 ordena los tokens por dirección. El fee tier es fijo por pool.
 */
export const poolKeyFor = (
  tokenA: string,
  tokenB: string,
  feeTier: number,
): UniswapV3PoolKey => {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
  return { tokenA: token0, tokenB: token1, feeTier };
};

/**
 * Calcula `amountOutMin` aplicando slippage en bips.
 *
 * `amountOutMin = amountOut * (10000 - slippageBips) / 10000`
 *
 * Redondea hacia abajo (floor) para que el usuario nunca reciba menos de lo prometido.
 */
export const applySlippage = (amountOut: bigint, slippageBips: number): bigint => {
  if (slippageBips < 0 || slippageBips > 10000) {
    throw new RangeError(`slippageBips must be 0..10000, got ${slippageBips}`);
  }
  return (amountOut * BigInt(10000 - slippageBips)) / 10000n;
};

/**
 * Codifica los parámetros de `exactInputSingle` para el calldata.
 *
 * Estructura del struct:
 * ```
 * struct ExactInputSingleParams {
 *   address tokenIn;
 *   address tokenOut;
 *   uint24 fee;
 *   address recipient;
 *   uint256 deadline;
 *   uint256 amountIn;
 *   uint256 amountOutMinimum;
 *   uint160 sqrtPriceLimitX96;
 * }
 * ```
 */
export const encodeExactInputSingle = ({
  tokenIn,
  tokenOut,
  feeTier,
  recipient,
  deadline,
  amountIn,
  amountOutMinimum,
  sqrtPriceLimitX96 = 0n,
}: {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly feeTier: number;
  readonly recipient: string;
  readonly deadline: bigint;
  readonly amountIn: bigint;
  readonly amountOutMinimum: bigint;
  readonly sqrtPriceLimitX96?: bigint;
}): string => {
  const encodeAddress = (addr: string): string => {
    const bare = addr.startsWith('0x') ? addr.slice(2) : addr;
    return bare.toLowerCase().padStart(64, '0');
  };
  const encodeUint256 = (value: bigint): string => value.toString(16).padStart(64, '0');
  const encodeUint24 = (value: number): string => value.toString(16).padStart(6, '0');
  const encodeUint160 = (value: bigint): string => value.toString(16).padStart(40, '0');

  return (
    EXACT_INPUT_SINGLE_SELECTOR +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
    encodeUint24(feeTier).padStart(64, '0') +
    encodeAddress(recipient) +
    encodeUint256(deadline) +
    encodeUint256(amountIn) +
    encodeUint256(amountOutMinimum) +
    encodeUint160(sqrtPriceLimitX96)
  );
};

/**
 * Decodifica el resultado de `quoteExactInputSingle`.
 *
 * El contrato devuelve `(uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`.
 * Nos interesa solo `amountOut` (primeros 32 bytes después del selector).
 */
export const decodeQuoteExactInputSingle = (result: string): bigint => {
  // Result viene como hex string con o sin 0x
  const hex = result.startsWith('0x') ? result.slice(2) : result;
  // Primer word (32 bytes = 64 hex chars) = amountOut
  if (hex.length < 64) {
    throw new Error(`quote result too short: ${hex.length} chars`);
  }
  const amountOutHex = hex.slice(0, 64);
  return BigInt(`0x${amountOutHex}`);
}

/**
 * Construye el calldata para `quoteExactInputSingle`.
 *
 * Parámetros: `(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)`
 */
export const encodeQuoteExactInputSingle = ({
  tokenIn,
  tokenOut,
  feeTier,
  amountIn,
  sqrtPriceLimitX96 = 0n,
}: {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly feeTier: number;
  readonly amountIn: bigint;
  readonly sqrtPriceLimitX96?: bigint;
}): string => {
  const encodeAddress = (addr: string): string => {
    const bare = addr.startsWith('0x') ? addr.slice(2) : addr;
    return bare.toLowerCase().padStart(64, '0');
  };
  const encodeUint256 = (value: bigint): string => value.toString(16).padStart(64, '0');
  const encodeUint24 = (value: number): string => value.toString(16).padStart(6, '0');
  const encodeUint160 = (value: bigint): string => value.toString(16).padStart(40, '0');

  return (
    QUOTE_EXACT_INPUT_SINGLE_SELECTOR +
    encodeAddress(tokenIn) +
    encodeAddress(tokenOut) +
    encodeUint24(feeTier).padStart(64, '0') +
    encodeUint256(amountIn) +
    encodeUint160(sqrtPriceLimitX96)
  );
}

/**
 * Parámetros para una ejecución de swap.
 */
export interface SwapExecutionParams {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly feeTier: number;
  readonly recipient: string;
  readonly deadline: bigint;
  readonly amountIn: bigint;
  readonly amountOutMinimum: bigint;
  readonly sqrtPriceLimitX96?: bigint;
}

/**
 * Fee tiers estándar de Uniswap V3 (en bips * 100).
 */
export const FEE_TIERS = {
  readonly LOW: 100,      // 0.01%
  readonly MEDIUM: 500,   // 0.05%
  readonly STANDARD: 3000, // 0.3%
  readonly HIGH: 10000,   // 1%
} as const;

/**
 * Verifica si un fee tier es válido.
 */
export const isValidFeeTier = (fee: number): fee is (typeof FEE_TIERS)[keyof typeof FEE_TIERS] =>
  Object.values(FEE_TIERS).includes(fee);