/**
 * Aave V3 on **Monad mainnet**: the addresses, the chain, and the four selectors.
 *
 * ── Why these addresses exist only here ───────────────────────────────────────
 *
 * They were cross-checked on 2026-10-04 against three independent sources:
 * `@aave-dao/aave-address-book` (`AaveV3Monad.POOL`,
 * `AAVE_PROTOCOL_DATA_PROVIDER`, `ASSETS.USDC.UNDERLYING` / `.A_TOKEN`) and the
 * chain itself (`aMonUSDC.POOL()` answers `0x69a5f9ad…`, `symbol()` answers
 * `aMonUSDC`). They are written down once, here, and the frontend never sees a
 * contract to call: `POST /api/pool/deposit` answers with transactions already
 * built.
 *
 * ── Why the selector is a constant and not a comment ──────────────────────────
 *
 * `getReserveData(address)` is `0x35ea6a75` on **V3**. `0x026b1d5f` is the **V2**
 * selector and it *reverts* on a V3 pool — and a revert was read for a whole
 * session as "the pool moved". A selector is four bytes of ABI, so it belongs in
 * code where a test can assert it, not in prose somebody has to trust.
 */

/** Monad mainnet. `eth_chainId` on `rpc.monad.xyz` is `0x8f`. */
export const MONAD_CHAIN_ID = 143;

/** The public endpoint these reads go through. Overridable per environment. */
export const DEFAULT_MONAD_POOL_RPC_URL = 'https://rpc.monad.xyz';

export const AAVE_V3_MONAD = {
  /** `AaveV3Monad.POOL`, cross-checked with `aMonUSDC.POOL()`. */
  pool: '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef',
  /** `AaveV3Monad.AAVE_PROTOCOL_DATA_PROVIDER`. */
  dataProvider: '0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad',
  /** `ASSETS.USDC.UNDERLYING`. Reserve id 1. */
  asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  /** `ASSETS.USDC.A_TOKEN`. Its `symbol()` is `aMonUSDC`, not `aUSDC`. */
  aToken: '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042',
} as const;

/** The receipt token's symbol on this deployment. Shown next to the position. */
export const A_TOKEN_SYMBOL = 'aMonUSDC';

/** The deposited asset. Its `symbol()` is USDC. */
export const ASSET_SYMBOL = 'USDC';

/**
 * USDC has six decimals.
 *
 * Also read from the chain on every `GET /api/pool` — `getReserveConfigurationData`
 * answers `decimals` — because "six" is what the reserve says, not what this file
 * remembers. This constant is the fallback for a reserve that cannot be read, and
 * it is used to render a position that can.
 */
export const USDC_DECIMALS = 6;

/** `getReserveData(address)`. **V3**. */
export const GET_RESERVE_DATA_SELECTOR = '0x35ea6a75';

/** `getReserveConfigurationData(address)`. */
export const GET_RESERVE_CONFIGURATION_SELECTOR = '0x028a2c12';

/** `balanceOf(address)`. */
export const BALANCE_OF_SELECTOR = '0x70a08231';

/** `allowance(address,address)`. */
export const ALLOWANCE_SELECTOR = '0xdd62ed3e';

/** `approve(address,uint256)`, on the USDC contract. */
export const APPROVE_SELECTOR = '0x095ea7b3';

/** `deposit(address,uint256,address,uint16)`, on the pool. */
export const DEPOSIT_SELECTOR = '0xe8eda9df';
