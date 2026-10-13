/**
 * DIRECCIONES UNISWAP V3 EN MONAD MAINNET (chain ID 143).
 *
 * ── Fuente ───────────────────────────────────────────────────────────────────
 *
 * Uniswap V3 está desplegado en Monad mainnet y reconocido por Uniswap
 * governance el 2025-11. La dirección canónica de la factory es la que
 * resuelve el subdomain ENS `v3-factory.uniswap.org`, y en Monad es
 * distinta de la de Ethereum:
 *
 * - https://developers.uniswap.org/docs/protocols/v3/deployments/v3-monad-deployments
 * - https://blog.uniswap.org/monad-mainnet-is-now-live-on-uniswap
 * - https://gov.uniswap.org/t/official-uniswap-v3-deployments-list/24323
 *
 * ── Cómo verificar ───────────────────────────────────────────────────────────
 *
 * La documentación de Uniswap es explícita en que las direcciones **no** son
 * iguales entre cadenas ("integrators should no longer assume that they are
 * deployed to the same addresses across chains"). Este archivo ya cyclo de
 * tener las de Ethereum con las de Monad, por eso el procedimiento queda
 * escrito y es el que se ejecutó:
 *
 * 1. `eth_getCode` en cada dirección contra `https://rpc.monad.xyz`
 * 2. `eth_call` a `factory.getPool(USDC, USDT0, fee)` en cada fee tier
 * 3. `eth_call` a `slot0()` en los pools devueltos: precio y liquidity
 * 4. `symbol()` y `decimals()` en cada token
 *
 * ── Lo que encontró esa verificación (2026-10) ───────────────────────────────
 *
 * Los cuatro contratos responden bytecode, y los pools existen, pero no todos
 * sirven: los fee tiers 3000 y 10000 están **vacíos** (`liquidity() == 0`).
 * Por eso `DEFAULT_FEE_TIER` es 100 y no 3000. Cotizar contra un pool vacío
 * devuelve `amountOut = 0`, que es un número cierto y por eso es peor que no
 * cotizar: hay que leer la liquidez antes de prometer un precio.
 */

export const UNISWAP_V3_MONAD_ADDRESSES = {
  /** Factory V3 — crea pools, consulta pool por token pair. */
  FACTORY_V3: '0x204faca1764b154221e35c0d20abb3c525710498',

  /**
   * Universal Router **2.1.2** — el que usa el Trading API.
   *
   * ── Por qué este y no el de la página de deployments ───────────────────────
   *
   * Hay dos Universal Routers vivos en Monad y no son el mismo contrato:
   *
   * - `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` (19.499 bytes) — el de la
   *   página de deployments de Uniswap v3.
   * - `0xa6CE4F10d83dBdDAc17E68e1837ca9cE6a1b596e` (24.380 bytes) — el 2.1.2
   *   que lista "Supported Chains & Tokens" de la Trading API.
   *
   * Cuando el Trading API arma la transacción, la arma apuntando al 2.1.2. Si
   * se guardara el otro para reconstruir el calldata a mano, la persona
   * firmaría contra un contrato distinto del que el API fotografo.
   */
  UNIVERSAL_ROUTER: '0xa6CE4F10d83dBdDAc17E68e1837ca9cE6a1b596e',

  /**
   * Universal Router de la página de deployments de Uniswap v3.
   *
   * Se conserva porque sirve para leer pools y cotizar contra la Factory. No
   * debe usarse como destino de la transaccion de un swap ejecutado por el API.
   */
  ROUTER_V3_DEPLOYMENTS: '0x0d97dc33264bfc1c226207428a79b26757fb9dc3',

  /** Position Manager (NFT) — para mint/collect/burn positions. */
  POSITION_MANAGER: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
} as const;

/**
 * ── Por qué no hay un Quoter ────────────────────────────────────────────────
 *
 * La documentación oficial de Uniswap lista cuatro contratos para Monad
 * (Factory, Universal Router, Multicall, TickLens). **El Quoter no esta
 * entre ellos.** El `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` canonico tiene
 * bytecode y expone `0x38571708`, pero `quoteExactInputSingle` devuelve `0x` a
 * 1, 10 y 100 USDC: es un stub en esta cadena.
 *
 * Por eso la cotizacion no va contra un Quoter on-chain sino contra el Trading
 * API, que corre la misma logica de ruteo del web app de Uniswap y devuelve la
 * transaccion ya armada. Es la unica via que produce un `amountOut` real.
 */
export const UNISWAP_TRADING_API = {
  /** Base del endpoint de cotizacion. */
  BASE_URL: 'https://trade-api.gateway.uniswap.org/v1',
  /** Header donde viaja la API key. */
  API_KEY_HEADER: 'x-api-key',
  /** El header de la API key es obligatorio: sin el responde 401. */
  UNAUTHENTICATED_STATUS: 401,
} as const;

/**
 * ── Por qué estas y no otras ─────────────────────────────────────────────────
 *
 * USDC y USDT0 son los dos activos que BestPath ofrece para mover entre redes
 * sin que la persona elija. En Monad **no existe un token llamado `USDT`**:
 * el equivalente es USDT0, un token distinto con contrato propio. Por eso el
 * símbolo del registry es `USDT0` y no `USDT` — escribir `USDT` acá sería
 * un nombre que la cadena no reconoce.
 *
 * `symbol()` y `decimals()` verificados por `eth_call` en ambos:
 * USDC → "USDC", 6 decimales · USDT0 → "USDT0", 6 decimales.
 */
export const MONAD_STABLECOIN_ADDRESSES = {
  /** USDC nativo de Circle en Monad. */
  USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  /** USDT0 en Monad. */
  USDT0: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d',
} as const;

/**
 * Fee tier por el que se cotiza cuando el par no dice otro.
 *
 * 100 = 0.01%. Es el pool con más liquidez de los dos que sirven
 * (13.589B contra 196.766M del de 500). Los de 3000 y 10000 existen
 * pero están vacíos, así que no son una opción.
 */
export const DEFAULT_FEE_TIER = 100 as const;

/**
 * Fee tiers oficiales de Uniswap V3.
 */
export const FEE_TIERS = {
  /** 0.01% — para stablecoins muy estables (USDC/USDT). */
  LOW: 100,
  /** 0.05% — para pares estables correlacionados. */
  MEDIUM: 500,
  /** 0.30% — estándar para la mayoría de pares. */
  STANDARD: 3000,
  /** 1.00% — para pares exóticos/volátiles. */
  HIGH: 10000,
} as const;

/**
 * Verifica si un fee tier es válido.
 *
 * Misma decisión que en `uniswapV3.ts`: se compara con `some` porque
 * `Object.values` sobre un objeto `as const` devuelve un array de literales, y
 * `includes` pediría un argumento ya estrechado a uno de ellos — que es
 * precisamente lo que el guard está por decidir.
 */
export const isValidFeeTier = (fee: number): boolean =>
  Object.values(FEE_TIERS).some((tier) => tier === fee);

/**
 * Tick spacing por fee tier (regla Uniswap V3).
 */
export const TICK_SPACING = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
} as const;

/**
 * MAX_UINT256 para approve infinito.
 */
export const MAX_UINT256 = (2n ** 256n) - 1n;

/**
 * Tipo de cambio implícito desde sqrtPriceX96.
 *
 * price = (sqrtPriceX96 / 2^96)^2
 * Para token0/token1: price0 = (sqrtPriceX96^2) / 2^192
 */
export const sqrtPriceX96ToPrice = (sqrtPriceX96: bigint, decimals0: number, decimals1: number): number => {
  const Q96 = 2n ** 96n;
  const priceX192 = (sqrtPriceX96 * sqrtPriceX96) / Q96; // price * 2^96
  const price = Number(priceX192) / 2 ** 96;
  // Ajustar por decimales: price = (token1/token0) * 10^(decimals0 - decimals1)
  return price * 10 ** (decimals0 - decimals1);
};

/**
 * Calcula amountOut para exactInputSingle dado sqrtPriceX96, liquidez y amountIn.
 * Basado en la fórmula de Uniswap V3 (ver `SwapMath.sol`).
 */
export const computeAmountOut = ({
  amountIn,
  sqrtPriceX96,
  liquidity,
  feeTier,
  tokenInIsToken0,
}: {
  readonly amountIn: bigint;
  readonly sqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly feeTier: number;
  readonly tokenInIsToken0: boolean;
}): bigint => {
  // Implementación simplificada: en producción usar la librería oficial @uniswap/v3-sdk
  // o replicar SwapMath.computeSwapStep de Uniswap.
  // Aquí devolvemos un placeholder para que el código compile.
  // La implementación real está en @uniswap/v3-core/contracts/libraries/SwapMath.sol
  throw new Error('computeAmountOut not implemented - use @uniswap/v3-sdk or replicate SwapMath');
};

/**
 * Ticks por fee tier.
 */
export const getTickSpacing = (feeTier: number): number => {
  switch (feeTier) {
    case 100: return 1;
    case 500: return 10;
    case 3000: return 60;
    case 10000: return 200;
    default: throw new Error(`Invalid fee tier: ${feeTier}`);
  }
};

/**
 * Convierte precio a sqrtPriceX96.
 */
export const priceToSqrtPriceX96 = (price: number, decimals0: number, decimals1: number): bigint => {
  const adjustedPrice = price * 10 ** (decimals1 - decimals0);
  const sqrtPrice = Math.sqrt(adjustedPrice);
  return BigInt(Math.floor(sqrtPrice * 2 ** 96));
};

/**
 * ABI minimal para QuoterV2.
 */
export const QUOTER_V2_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
] as const;

/**
 * ABI minimal para Router V3 (SwapRouter02).
 */
export const ROUTER_V3_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
] as const;

/**
 * ABI minimal para ERC-20.
 */
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
] as const;