# F2-B · El precio, y que el backend componga el balance

## Why this task

The product model, stated by the owner:

> **Total wallet balance = (Bitcoin y Crypto, valued at market price) + (Investments, what is in the pools).**

Each bucket sums in USD. The sum of the two is the headline. The backend
composes; the front shows.

Two consequences, and they are why this task exists:

1. **The price feed is on the critical path.** Without it there is no wallet
   balance at all, because the crypto bucket cannot be summed without prices.
   It is not a side improvement. It is half the equation of the app's main
   number.
2. **The front must not add anything.** Today it composes: `usdcTotal` from one
   endpoint and the Aave position from another. That is how two numbers ended
   up on one screen that a person had to add in their head. The backend returns
   the composition and the front becomes decorative.

## The live probe that de-risked this task

Verified against `https://rpc.monad.xyz` with `latestRoundData()`
(`0xfeaf968c`), using the official Monad registry at
`github.com/monad-crypto/protocols/main/mainnet/chainlink.jsonc`:

| pair | price | age |
|---|---|---|
| BTC/USD | $85.565,10 | 17s |
| ETH/USD | $2.689,39 | 78s |
| MON/USD | $0,028824 | 26s |
| USDC/USD | $0,999863 | **9837s (2,7 h)** |

Chainlink has Data Feeds on **Monad mainnet** and **Solana mainnet** (not on
Solana testnet). On Solana the mechanism differs — OCR with a program and an
account — so it is not the same `eth_call`. Solana pricing is out of scope here.

**The hardcoded prices in `config/markets.ts:78-86` are stale, not catastrophic.**
BTC is the worst: $95.400 against a live $85.565, a 12% frozen error.

## Two findings from the probe that change the design

### The two Chainlink channels use different decimals

| feed | `decimals()` |
|---|---|
| `MON_USD_Proxy` | **8** |
| `MON_USD_SVR_Proxy` | **18** |
| `USDC_USD_Proxy` | 8 |

`MON_USD` answers `286247...` (8 dec) and `MON_USD_SVR` answers
`28842000000000000` (18 dec). **Hardcoding 8 for both is a 10^10 error** — a
balance displayed as a trillion dollars. `decimals()` reverts on the
**aggregator**; it answers on the **proxy**. So the reader goes through the
proxy and **never hardcodes decimals**.

This is why the cross-check below is worth its second call: finding that
landmine was what it was for.

### USDC/USD has a 2,7-hour heartbeat

The stablecoin feed last updated 9837 seconds ago while every other feed was
under two minutes. A staleness rule would refuse it — correctly.

**This is why digital dollars are not oracle-sourced.** A dollar-pegged unit is
a *definition* here, not a market price: the contract calls them "Dólares
digitales" and they are counted at 1. Routing the headline through an oracle
with a two-hour heartbeat would make the main number of the app depend on a feed
that is stale by its own design. **Digital dollars are valued at 1 by definition.
Only non-peg assets are priced.**

## Tasks

### T1 — A price port and a Chainlink reader

A `PriceFeed` port and one adapter that reads Monad's Chainlink feeds over
JSON-RPC, through the proxy: `decimals()` first, then `latestRoundData()`.

The port returns, per asset, either an exact price with its `updatedAt`, or a
bounded failure reason. **Never a price and never a zero in the same field.**

**The circuit breakers, all three required:**

1. **Stale.** `updatedAt` older than a declared threshold is `unreadable`. An
   hour-old price is not a price.
2. **Non-positive.** An answer of zero or less is `unreadable`. That is an
   uninitialised feed, not a free asset.
3. **Cross-check.** Each pair has a second Chainlink channel — the SVR feed of
   the same pair. Both are read at their own decimals. If they diverge beyond a
   declared threshold, the price is `unreadable`, because a single channel
   reporting a number is an assertion, not a fact.

Each bound needs a written reason in the code. A bound nobody can justify is a
constant waiting to be wrong, which is the disease this task is curing.

**Tests run fully offline.** The port is injected and the tests use a fake
reader. The repository's README is explicit that tests run with no network and
no database, and that this is *the reason the architecture is shaped this way*.
A direct feed call from the use case would break that guarantee.

### T2 — The backend composes the balance

The response gains, alongside the existing total, the two buckets:

- `cryptoValue` — free crypto, valued at the feed. Per-asset, each with its own
  read state, so one stale asset does not take the whole bucket.
- `investedValue` — positions in pools. **Digital dollars, valued at 1.** No
  oracle involved.
- `total` — **computed by the backend**, never by the front.

The existing "a total that silently omits what it could not read is a lie" rule
extends: if a priced asset is unreadable, the crypto bucket is incomplete and
that must be visible, not smoothed over.

**No arithmetic in floats anywhere.** Exact `bigint` at feed decimals, with the
dollar value carried as an exact decimal string. A price read from a feed is
exact to that feed's decimals and must not be rounded before display.

### T3 — The front shows value above and quantity below

The display the owner asked for: **USD value on top, coin amount underneath.**
That way the person compares values without doing arithmetic, and still sees the
real quantity underneath.

Both cards show their own bucket total. The headline shows the composed total
from the backend. **The front adds nothing.**

## Allowed edit surfaces

- `07.PockBackend/src/domain/ports/**`
- `07.PockBackend/src/domain/price/**`
- `07.PockBackend/src/infrastructure/rpc/**`
- `07.PockBackend/src/application/portfolio/**`
- `07.PockBackend/src/application/pool/**`
- `07.PockBackend/src/interface/http/routes/**`
- `07.PockBackend/src/interface/http/app.ts`
- `07.PockBackend/src/container.ts`
- `07.PockBackend/test/**`
- `05. UI-UX/src/config/markets.ts`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/components/Wallet/WalletView.tsx`
- `05. UI-UX/src/components/Wallet/InvestmentsView.tsx`
- `05. UI-UX/src/components/Investments/**`
- `05. UI-UX/src/App.tsx`
- `odd/tasks/precio-y-balance.md`

## Out of scope

- **Solana pricing.** Chainlink's Solana feeds use OCR with a program and an
  account, not `eth_call`. Separate task.
- **Kamino.** Does not exist in this codebase. Solana token reading does not
  exist either — `readPortfolio.ts:126-127` reads lamports only.
- **BTC.** A Chainlink BTC/USD feed works and the price is available, but
  **there is no BTC wallet chain**: `ASSETS_BY_CHAIN` has USDC only. Listing it
  shows a permanent `U$0,00`, which is the "list what you cannot move" defect
  this repository already had with BTC, TRX, DOGE and USDT. The price is wired
  and available; the display waits for a wallet chain.
- **The `yield_positions` migration (T3 of the previous task).** Still deferred,
  still with no writer.
- **Aave on Base.** Separate task.

## Gates

- `npm test` green in the backend.
- `tsc --noEmit` clean on both sides.
- `vite build` green.
- A test proves a **stale** feed yields `unreadable`, not a number.
- A test proves a **disagreeing** cross-check yields `unreadable`.
- A test proves **decimals are read, not assumed**: a feed at 18 decimals and one
  at 8 must both produce the right dollar value.
- A test proves the front's headline equals the backend's `total`, and that no
  front code adds the two buckets together.