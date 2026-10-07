/**
 * The Chainlink Data Feeds on **Monad mainnet**, as the official registry states
 * them, and the two selectors this codebase calls.
 *
 * Source: `github.com/monad-crypto/protocols`, `mainnet/chainlink.jsonc`.
 * Endpoint: `https://rpc.monad.xyz` (chain id 143, verified `eth_chainId = 0x8f`).
 *
 * ── Why three addresses per feed and only one is ever called ────────────────
 *
 * Chainlink's data feeds are three contracts:
 *
 * ```
 *   AggregatorV3Interface        AggregatorProxy            Aggregator
 *   latestRoundData(), decimals() ───────► delegates ───────► holds the data
 * ```
 *
 * **`decimals()` reverts on the aggregator and answers on the proxy.** Reading
 * decimals from the aggregator is not a silent failure to be discovered later:
 * it is the exact mistake the next section exists to prevent.
 *
 * ── Why `decimals()` is read and never written down ──────────────────────────
 *
 * The two channels of the same pair do **not** share a scale, and this is the
 * most dangerous fact in the price path:
 *
 * | feed                    | `decimals()` | a MON/USD round answers     |
 * |-------------------------|--------------|-----------------------------|
 * | `MON_USD_Proxy`         | **8**        | `286247…`  (~0.0286247)    |
 * | `MON_USD_SVR_Proxy`     | **18**       | `28842000000000000`        |
 * | `ETH_USD_SVR_Proxy`     | **18**       |                            |
 * | `BTC_USD_SVR_Proxy`     | **18**       |                            |
 * | `USDC_USD_Proxy`        | **8**        |                            |
 *
 * Hardcoding 8 for both is an error of **10^10**: the SVR round is read as a
 * trillion dollars, and a wallet balance rendered with it shows a number no
 * person has. Nothing here stores a decimals constant per feed on purpose —
 * `decimals()` is asked of the proxy on every read, and `test/` proves that a
 * feed at 8 and a feed at 18 both produce the right dollar value.
 *
 * ── Why the addresses are here and not in the adapter ───────────────────────
 *
 * Same rule as `domain/pool/aaveMonad.ts`: a contract address is a fact about a
 * deployment, not a parameter of a call. A port whose methods took a proxy
 * address could be pointed at another contract by whoever wired it, and this
 * number ends up multiplied by somebody's balance.
 *
 * ── Why a selector is a constant with a test and not a comment ───────────────
 *
 * `0xfeaf968c` for `latestRoundData()` and `0x313ce567` for `decimals()` are the
 * first four bytes of the keccak of those signatures — four bytes of ABI. This
 * repository already paid for a remembered selector once (`getReserveData` V2
 * `0x026b1d5f` against a V3 pool, which reverts), so both constants here are
 * re-derived with `viem` in `test/domain/price.test.ts`. `viem` is a
 * **devDependency**: a Worker cannot ship it, so production code here is raw
 * JSON-RPC and the derivation lives in the test that is allowed to use it.
 */

/** `latestRoundData()`, the four bytes that keccak gives the empty signature. */
export const LATEST_ROUND_DATA_SELECTOR = '0xfeaf968c';

/** `decimals()`, which answers on the proxy and reverts on the aggregator. */
export const DECIMALS_SELECTOR = '0x313ce567';

/** The default Monad mainnet endpoint. Overridable per deployment. */
export const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';

export interface ChainlinkFeed {
  /** The pair as the registry names it, e.g. `MON_USD_SVR`. */
  readonly pair: string;
  /**
   * The aggregator proxy. **Everything is read through this address**: the feed's
   * scale (`decimals()`) and its rounds (`latestRoundData()`).
   */
  readonly proxy: string;
  /**
   * The aggregator behind it. Recorded for the operator, never called: calling
   * it is how `decimals()` comes back as a revert.
   *
   * **Optional, and deliberately absent on the two SVR proxies added from a
   * registry entry that publishes proxies only.** A zero address here would look
   * authoritative and mean nothing, so nothing is written down instead: the
   * field is never read by any code path, and the only address the price path
   * ever uses is `proxy`.
   */
  readonly aggregator?: string;
}

/**
 * Every priced asset, and every Chainlink channel Monad mainnet publishes for it.
 *
 * **`MON`, `ETH` and `BTC` have two channels each**: the primary feed and its SVR
 * (single-validator-round) counterpart. `SOL` has one. That is what makes the
 * cross-check possible at all, and it is how the decimals landmine was found —
 * every SVR channel is at **18** decimals against a primary at **8**.
 *
 * Two healthy channels of the same pair are **not** the same number. Measured
 * live at one pinned block, the same-block divergence is 0 bps for `MON`,
 * 5.403 bps for `ETH` and 0.136 bps for `BTC` — see `MAX_CHANNEL_DIVERGENCE_BPS`
 * in `priceRules.ts`, which is sized from those measurements and not from the one
 * pair that happened to agree. Every SVR feed below was verified live through its
 * proxy: `decimals()` answers **18** (it reverts on the aggregator) and
 * `latestRoundData()` returns a sane price at that scale.
 *
 * A second channel is **not** optional decoration. Where one exists, it is read
 * at its own decimals and compared; the price is `unreadable` when the two
 * disagree beyond the declared bound, because a single channel reporting a
 * number is an assertion, not a fact.
 */
export const CHAINLINK_FEEDS_ON_MONAD: Readonly<
  Record<'MON' | 'ETH' | 'SOL' | 'BTC', readonly ChainlinkFeed[]>
> = {
  MON: [
    {
      pair: 'MON_USD',
      proxy: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
      aggregator: '0x2A347b30e1DA22Ec136142cdA88Bec59fDB6e9d3',
    },
    {
      // The SVR channel's proxy, confirmed by a live probe on Monad mainnet:
      // `decimals()` answers **18** through this address (it reverts on the
      // aggregator) and `latestRoundData()` returns a price at that scale.
      //
      // Both channels were then read at the **same block** and returned
      // $0.02864200 — identical to the cent. The 0.76% divergence first
      // measured was an artefact of reading the two channels seconds apart,
      // not a disagreement between them: a fast-moving token moves between two
      // blocks. That is why both channels are pinned to one block.
      //
      // MON is also the pair that happened to agree exactly, which is what
      // produced the 5 bps bound this file used to carry. `ETH` and `BTC` do
      // not agree — see the header. One agreeing pair is not the evidence base
      // for a bound.
      pair: 'MON_USD_SVR',
      proxy: '0xFB504aD06Ab5E6c63FE0A46FEa245214838E8015',
      aggregator: '0x810D5E3Db355bfD2C80c06D89F08523111C6D0f1',
    },
  ],
  ETH: [
    {
      pair: 'ETH_USD',
      proxy: '0x1B1414782B859871781bA3E4B0979b9ca57A0A04',
      aggregator: '0x3d21E2E680E2a60b440da427820aEe2391375EB7',
    },
    {
      // The registry's SVR channel for the same pair, confirmed by a live probe
      // on Monad mainnet: `decimals()` answers **18** through this proxy (it
      // reverts on the aggregator) and `latestRoundData()` returns a sane price
      // at that scale. Read against the 8-decimal primary at one block it
      // diverged by **5.403 bps** — two healthy feeds, and the measurement the
      // cross-check bound is now sized from.
      pair: 'ETH_USD_SVR',
      proxy: '0x38057D0458ca56068e1A57E62D3874cA129A7A78',
    },
  ],
  SOL: [
    {
      // **One channel, deliberately.** The Monad registry declares no SVR feed
      // for `SOL/USD`, so there is nothing to cross-check this pair against and
      // inventing a second address would be a claim about the registry that
      // nobody verified. The price therefore travels with `crossChecked: false`
      // — stated, not hidden. The asymmetry with `MON`, `ETH` and `BTC` below
      // is the registry's, not an oversight here; `test/domain/price.test.ts`
      // pins it so it cannot drift silently in either direction.
      pair: 'SOL_USD',
      proxy: '0x16F8008c3e89f62e5e2b909Ce70999370D38F4F2',
      aggregator: '0x10da0c6188A7d74d8556e1d6A193D58721e5E102',
    },
  ],
  BTC: [
    {
      pair: 'BTC_USD',
      proxy: '0xc1d4C3331635184fA4C3c22fb92211B2Ac9E0546',
      aggregator: '0xC6D6f57EFe5Ce2769aF0e0D8708477e4819F92d0',
    },
    {
      // As with `ETH`: the registry's SVR channel for the same pair, confirmed
      // by a live probe — `decimals()` answers **18** through this proxy and
      // `latestRoundData()` returns a sane price at that scale. Read against the
      // 8-decimal primary at one block it diverged by **0.136 bps**.
      pair: 'BTC_USD_SVR',
      proxy: '0x187efD8ba8483105f2735740D956f7CD23723deC',
    },
  ],
} as const;
