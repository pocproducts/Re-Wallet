/**
 * The figure a money event may state, and the catalog row it comes from.
 *
 * ── Why this module exists at all ────────────────────────────────────────────
 *
 * `wallet.funds_deposited` carries `amount: "6006650"` and **nothing that says
 * what unit that is**. It is not lamports, not wei and not USDC base units — the
 * payload does not know, and neither does anybody who reads it. Formatting it
 * from the payload alone would be a guess, and a wrong guess is not an ugly
 * number: it tells somebody they received a million times their money.
 *
 * So the exponent comes from `../deposit/catalog`, which is **our own** list of
 * what can be received and how many decimals each of those things has. The
 * catalog is the same place that already forbids the deposit screen from
 * guessing (`Cuántos decimales tiene el token. La pantalla no lo adivina`), and
 * this is that rule applied to the notification feed.
 *
 * ── Why the chain is matched on `caip2` and the asset on `asset` ──────────────
 *
 * Both are in the payload, and together they name exactly one catalog row:
 * `caip2` says which chain (chain + cluster, not just "an EVM chain"), and
 * `asset` says which token on it — `native-token` for the coin of the chain, a
 * contract or mint address for anything else. Either one alone is ambiguous:
 * the USDC of Monad, of Ethereum and of Solana are three different contracts
 * with the same six decimals, and reading the wrong one is how this product
 * already shipped a broken balance once (`../portfolio/assets.ts`).
 *
 * ── Why an unresolved chain or asset yields `null` and not a default ─────────
 *
 * There is no default decimals, no default chain, and no "assume lamports".
 * `null` is the answer that keeps the sentence true: the caller falls back to
 * the sentence that says what happened and names no figure. An amount we cannot
 * place is not an amount we may print.
 */
import { DEPOSIT_NETWORKS } from '../deposit/catalog';
import type { DepositAssetSpec, DepositChain } from '../deposit/catalog';

/**
 * The genesis hash prefix Solana mainnet-beta is named by in CAIP-2
 * (`solana:5eykt…`).
 *
 * It is compared as an **allow-list**, not as a place to add networks: a deposit
 * arriving on a devnet or testnet chain carries a different reference, and
 * reading its lamports as mainnet SOL would be a figure about money this
 * product does not hold. A reference we do not know resolves to no chain, and a
 * no chain resolves to no amount.
 */
const SOLANA_MAINNET_REFERENCE = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

/** An amount as a person reads it, with the symbol of the asset it is in. */
export interface ResolvedAmount {
  /** Base units scaled by the catalog's decimals: `"0.00600665"`, not `0.006`. */
  readonly value: string;
  /** `SOL`, `MON`, `ETH`, `USDC`. From the catalog, never from the payload. */
  readonly symbol: string;
}

/**
 * Base units, as Privy sends them: digits, as a string.
 *
 * The length is bounded because this is a string that goes into arithmetic; a
 * payload is provider input, and a 10.000-digit "amount" is a row nobody is
 * waiting to see a sentence about. Non-digits — `"1.5"`, `"6e6"`, `"-1"`,
 * `"6006650 lamports"` — are refused rather than coerced: each of them means
 * something different, and guessing which is the mistake this module exists to
 * prevent.
 */
const BASE_UNITS = /^\d{1,40}$/;

/**
 * The chain a `caip2` names, or `null`.
 *
 * An EVM network is matched on the **whole** id (`eip155:143`), because the
 * reference is the chain id and matching only the namespace would read a
 * Polygon deposit as a Monad one. Solana is not EVM and has no chain id, so it is
 * matched on the namespace plus a reference this catalog recognises.
 */
const chainFor = (caip2: unknown): DepositChain | null => {
  if (typeof caip2 !== 'string') return null;
  const separator = caip2.indexOf(':');
  if (separator < 0) return null;
  const namespace = caip2.slice(0, separator);
  const reference = caip2.slice(separator + 1);

  for (const network of DEPOSIT_NETWORKS) {
    if (network.evmNetwork !== null) {
      if (caip2 === network.evmNetwork) return network.chain;
      continue;
    }
    // CAIP-2 names a non-EVM chain by its own id, so the namespace is the chain.
    if (namespace === network.chain && (reference === '' || reference === SOLANA_MAINNET_REFERENCE)) {
      return network.chain;
    }
  }
  return null;
};

/**
 * The catalog row for this chain's `asset`, or `null`.
 *
 * `native-token` is the coin of the chain — no address to check, and the
 * catalog has exactly one such row per chain. Anything else is matched on its
 * address against the tokens of **this** chain, case-insensitively because EVM
 * addresses are not case-stable in transit.
 */
const assetFor = (chain: DepositChain, asset: unknown): DepositAssetSpec | null => {
  const network = DEPOSIT_NETWORKS.find((candidate) => candidate.chain === chain);
  if (network === undefined || typeof asset !== 'object' || asset === null || Array.isArray(asset)) return null;

  const { type, address } = asset as { readonly type?: unknown; readonly address?: unknown };

  if (type === 'native-token') return network.assets.find((candidate) => candidate.native) ?? null;
  if (typeof address !== 'string' || address === '') return null;

  const wanted = address.toLowerCase();
  return (
    network.assets.find(
      (candidate) => !candidate.native && candidate.token !== null && candidate.token.toLowerCase() === wanted,
    ) ?? null
  );
};

/**
 * Base units in the decimals the catalog declares, as a decimal string.
 *
 * Written as digits and not as a division: `6006650 / 1e9` in a float is
 * `0.006006650000000001` in some runtimes, and the number a person reads about
 * their own money is the one place where "close enough" is not allowed. Trailing
 * zeros are dropped, and an empty fraction leaves a bare integer (`12`, not
 * `12.000000000`).
 */
const scaleToDecimals = (baseUnits: bigint, decimals: number): string => {
  const digits = baseUnits.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? '' : digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
};

/**
 * What this event's payload says the amount was, in units a person can read.
 *
 * `null` whenever any of the three is missing or unrecognised — no `caip2`, a
 * chain this catalog does not carry, an `asset` that is not on that chain, a
 * missing `amount`, or an `amount` that is not base units. The caller must treat
 * `null` as "say nothing about the amount", never as "no amount arrived".
 *
 * Reads three fields and nothing else: `sender`, `recipient` and `wallet_id` are
 * in the same payload and are deliberately unreachable from here. A sentence may
 * carry a figure and a symbol; it may not carry an address
 * (`docs/contrato-dinero.md`).
 */
export const resolveEventAmount = (payload: unknown): ResolvedAmount | null => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const { caip2, asset, amount } = payload as { readonly caip2?: unknown; readonly asset?: unknown; readonly amount?: unknown };

  const chain = chainFor(caip2);
  if (chain === null) return null;

  const spec = assetFor(chain, asset);
  if (spec === null) return null;

  if (typeof amount !== 'string' || !BASE_UNITS.test(amount)) return null;

  return { value: scaleToDecimals(BigInt(amount), spec.decimals), symbol: spec.symbol };
};