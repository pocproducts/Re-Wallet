/**
 * What the portfolio shows on each chain, and how a raw integer becomes a number
 * a screen can render without losing a digit.
 *
 * ── Why the decimals live here and not in the screen ──────────────────────────
 *
 * "USDC has six decimals" is a fact about the token, and it is what makes an
 * amount meaningful. If the screen carried it, the backend could return an
 * integer and the screen would guess the exponent — and a wrong exponent is not a
 * wrong picture, it is wrong money. So the response states `decimals` next to the
 * amount, and the screen divides by nothing it had to remember.
 *
 * ── Why the USDC contract is a constant here ─────────────────────────────────
 *
 * USDC has the same address on Monad and on Ethereum mainnet. It is written down
 * once, with the two networks that answer for it, and both are read through the
 * same port. Copying the address into a second place is how a balance of one
 * token gets read from a contract that does not exist on that chain.
 */
import type { PortfolioChain } from './networks';
import type { PortfolioAsset, PortfolioFailureReason } from '../../application/portfolio/readPortfolio';
import { DEPOSIT_NETWORKS, type DepositAssetSpec } from '../deposit/catalog';

/**
 * USDC on Monad mainnet **and** on Ethereum mainnet: one address, two networks.
 *
 * Verified against `balanceOf` on both chains. It is not copied from memory and
 * not from another chain's list — an address that answers on one EVM chain and
 * reverts on another is exactly the failure this codebase already paid for once
 * (see `odd/tasks/datos-reales-monad-aave.md`).
 */
/**
 * USDC **por cadena**. Una sola direccion para todas las cadenas EVM no es un
 * atajo: es un contrato equivocado.
 *
 * El bug que produjo: la direccion de Monad se usaba tambien para Ethereum, ahi
 * no hay contrato, `balanceOf` responde `0x` (vacio) y el lector declaraba la
 * respuesta corrupta. El sintoma era "no pudimos leer tu saldo en Ethereum"
 * mientras la misma llamada contra la cadena de al lado funcionaba, porque el
 * codigo era identico y lo unico que cambiaba era la direccion.
 *
 * Ambas verificadas en cadena antes de escribirlas: contracto con bytecode,
 * `symbol()` = USDC y `decimals()` = 6 en cada una.
 */
export const USDC_ADDRESS_BY_CHAIN = {
  monad: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
} as const;

export interface PortfolioAssetSpec {
  readonly symbol: string;
  readonly decimals: number;
  /** Absent for a native coin: there is no contract to ask. */
  readonly token?: string;
}

/**
 * The Solana row of `ASSETS_BY_CHAIN`, **derived from the deposit catalog**
 * rather than written out here.
 *
 * ── Why the mints come from the catalog and are not copied ───────────────────
 *
 * The catalog is where a token on a network is declared, with its decimals, and
 * it is the list the deposit screen reads: it says a USDC can be received at
 * that mint. A portfolio that read a *different* mint would report a balance of
 * a token nobody can deposit here, and a catalog that grew a mint would leave a
 * second list behind, undeclared, that this read would never ask about — which
 * is the same class of bug as a balance read from a contract that does not exist
 * on that chain. One declaration, two consumers.
 *
 * The order is the catalog's own: native coin first, then the tokens, and a new
 * catalogued token appears here without an edit in this file.
 */
const solanaSpecs = (): readonly PortfolioAssetSpec[] =>
  (DEPOSIT_NETWORKS.find((network) => network.chain === 'solana')?.assets ?? []).map((asset: DepositAssetSpec) => ({
    symbol: asset.symbol,
    decimals: asset.decimals,
    // The native coin has no contract to ask; everything else has its own
    // address on this chain, which for an SPL token is a mint.
    ...(asset.native ? {} : { token: asset.token ?? undefined }),
  }));

/**
 * The assets read per chain, in the order they are read.
 *
 * Native coin first: it is the one the screen shows at the top, and it is the
 * balance that pays gas. The order is display order, not importance.
 */
export const ASSETS_BY_CHAIN: Readonly<Record<PortfolioChain, readonly PortfolioAssetSpec[]>> = {
  monad: [
    { symbol: 'MON', decimals: 18 },
    { symbol: 'USDC', decimals: 6, token: USDC_ADDRESS_BY_CHAIN.monad },
  ],
  ethereum: [
    { symbol: 'ETH', decimals: 18 },
    { symbol: 'USDC', decimals: 6, token: USDC_ADDRESS_BY_CHAIN.ethereum },
  ],
  solana: solanaSpecs(),
};

/**
 * The exact decimal string for `raw` in a token with `decimals` decimals.
 *
 * ── Why this is `bigint` arithmetic and not division ─────────────────────────
 *
 * `raw / 10 ** decimals` in JS produces `123.4567890123456789` — a double, rounded
 * at the 17th significant digit and printed without its tail. A balance is the
 * number a transfer is built from; a silently truncated one is a transfer that is
 * off by dust and nobody can see why. So the integer and the fraction are
 * **string surgery**: no arithmetic, no rounding, no possibility of either.
 *
 * Trailing zeros in the fraction are dropped (`1500000` at six decimals is `1.5`,
 * not `1.500000`) because a screen appends its own decimals anyway, and keeping
 * them would only make two representations of one number.
 */
export const formatUnits = (raw: bigint, decimals: number): string => {
  if (decimals < 0) throw new RangeError(`decimals must not be negative: ${decimals}`);
  if (raw < 0n) throw new RangeError('a balance cannot be negative');
  if (decimals === 0) return raw.toString();

  const digits = raw.toString().padStart(decimals + 1, '0');
  const integer = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');

  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
};

/** Builds the response's view of one asset, exact, from what the chain reported. */
export const toAsset = (spec: PortfolioAssetSpec, raw: bigint): PortfolioAsset => ({
  symbol: spec.symbol,
  unit: spec.symbol,
  decimals: spec.decimals,
  raw: raw.toString(),
  amount: formatUnits(raw, spec.decimals),
});

/**
 * The view of one asset whose read **failed**.
 *
 * A union member, not a `raw` of `'0'`: this shape cannot be mistaken for an
 * amount, because there is no amount in it to mistake. `null` is the only thing
 * that can be here, and `null` is not a balance.
 */
export const toUnreadableAsset = (spec: PortfolioAssetSpec, reason: PortfolioFailureReason): PortfolioAsset => ({
  symbol: spec.symbol,
  unit: spec.symbol,
  decimals: spec.decimals,
  raw: null,
  amount: null,
  error: { code: 'ASSET_READ_FAILED', reason },
});