# Feature: price feeds, and a valuation that can be wrong in only one direction

<!--
> **RECONCILIADO 2026-09-29**
> **Estado real: contains false claims.** T1–T5 below are all unchecked and the
> Evidence section says "To be collected", but the work shipped: `Backend/src/infrastructure/oracle/chainlinkFeeds.ts`
> (not `config/priceFeeds.ts`, as the architecture section below says),
> `Backend/src/domain/ports/price-reader.ts`, `Backend/src/infrastructure/oracle/chainlinkPriceReader.ts`,
> `Backend/src/domain/pricing/valuation.ts`, `Backend/test/wallet/priceReader.test.ts`,
> and `valueIn` is called from `Backend/src/application/wallet/getWalletBalances.ts`
> and `Backend/src/application/wallet/listMovements.ts`. The unchecked boxes are
> stale, not the work.
> **Map and contradictions: `odd/roadmap.md` section 4.2.**
-->

## The measurement, taken before anything was designed

`scripts/probe-feeds.ts`, against the live public node. Read twice, an hour apart,
because the numbers that matter here are the ones that REPRODUCE.

```
             descripcion    precio            antiguedad   decimales
MON / USD    0.028408       U$ 0,028408      12s          8
USDC / USD   0.9999659      U$ 0,9999659     514s         8
BTC / USD    84001.22749638 U$ 84.001,23     27s          8
SOL / USD    119.49224832   U$ 119,49        63s          8
```

Sources for the addresses: `monad-crypto/protocols` → `mainnet/chainlink.jsonc`,
which is Monad's own published list. An address in a repository is not evidence that
a contract answers, which is why all four were read before a line was designed.

### Three findings that the plan below exists to handle

**1. `USDC/USD` is 514 seconds old and the others are not.** Twice, an hour apart:
514s and 12s/27s/63s. Chainlink publishes a deviation threshold and a heartbeat per
feed, and a stablecoin does not need the heartbeat a volatile asset does. So:

> A single global staleness threshold would reject the one feed the conversion
> needs. A "reject anything older than 60 seconds" rule — the obvious first
> version — refuses to value USDC at all, and the product would ship with no
> valuation and a plausible-looking reason for it.

**The staleness budget is therefore per feed, from the same table as the address.**

**2. `USDC/USD` is `0.9999659`, not `1`.** The plan of record said "USDC/USD (~1),
so MON/USDC = MON/USD". It is not 1, and the difference compounds: valuing a
holding as `amount * MON_USD` and then labelling the result "USDC" is off by the
USDC depeg, which is small and real and moves in exactly the direction a customer
would notice. The division is the correct one and it is one operation.

**3. All four are 8 decimals and answer a complete round.** `answeredInRound ==
roundId` on every read. That is the happy path, and it is the path that makes the
unhappy paths untested unless they are tested on purpose — see the tasks.

### What this buys that was not on the plan

**`BTC/USD` and `SOL/USD` exist on Monad, from the same publisher, at the same
address table.** So "convert Solana or BTC to USDC later" is not a project that
starts with finding a price. It starts with the price already being there and the
conversion being the part that has to be built — which is the whole reason to
design the table for N pairs instead of wiring MON once.

## Goal

A price this product can read, an amount converted to a target token, and a
valuation that **degrades to nothing rather than to a guess** when the price is
missing, stale, or incomplete. The base has to be laid for a second pair, because
the user has already said the second pair is coming.

## Non-goals

- No swaps, no routing, no execution. This is a READ and a multiplication.
- No price stored per holding. A price is observed, not owned; a wallet that keeps
  its own copy of a market number is a wallet that will show it after it stopped
  being true.
- No display of a dollar figure anywhere that cannot say when it was observed.

## Architecture

The hexagonal rule the codebase already enforces: the domain names a port, the
infrastructure satisfies it, and the composition root chooses which. Adding a pair
must not touch the domain.

**Port** — `domain/ports/price-reader.ts`

```ts
interface PriceReader {
  /** `null` when the pair has no feed wired. Absent is not zero. */
  readPrice(pair: PricePair): Promise<PriceObservation | null>;
}
```

`PriceObservation` carries the value, the pair, the block it was read at, the
round, and the age in seconds — so a caller can decide what "too old" means for
that pair instead of the port deciding it for everyone.

**Adapter** — `infrastructure/oracle/chainlinkPriceReader.ts`

One `latestRoundData` read per pair through `AggregatorV3Interface`, declared as an
ABI so **viem computes the selectors**. This project has already shipped one
hand-written selector that produced a confident wrong answer, and the header on
that file says why.

**The feed table** — `config/priceFeeds.ts`

Pair, proxy address, and staleness budget together, in ONE entry. The alternative
is an address in one place and a timeout in another, and the day they disagree the
product rejects a fresh price or accepts a dead one, depending on which file was
read last.

**Conversion** — `domain/pricing/valuation.ts`

Pure functions. `valueIn(quantity, fromUsd, toUsd)`, bigint in, decimal string
out, no float — the same rule `domain/wallet/balances.ts` already follows and
already explains why. A float in this path loses precision on the one number a
customer is about to trust with money.

**Publication** — the existing `/wallet/assets` gains a valuation per row, beside
the quantity, carrying its own observed-at and age. The client is not left to
decide whether an old price is acceptable, because the client does not know what
the feed's heartbeat is and the table does.

## The three ways this must refuse, and why refusing is the feature

A price read can return successfully and still be wrong, which is the single most
expensive shape of bug in a product that shows balances.

1. **`answer <= 0`** — a feed that has not started, or a deviated-out answer. Zero
   would value a holding at zero, which is the most alarming false number available.
2. **`answeredInRound < roundId`** — the round is incomplete. The answer is from
   an earlier round wearing this round's name. Chainlink's own consumer guide makes
   this check non-optional.
3. **`age > the pair's own budget`** — measured, not guessed. See finding 1.

All three produce **no valuation**, and the row says which one, the way
`unsourceableTokens` says what a history could not cover. A missing valuation and a
zero valuation must stay distinguishable, or the product ships a confident `U$0,00`
for money it simply did not price — the exact failure this project has refused
three times now and does not refuse a fourth.

## Tasks

### T1 — The feed table

- [ ] Pair, proxy address and staleness budget in ONE entry each
- [ ] MON/USD, USDC/USD, BTC/USD, SOL/USD, with the budgets the measurement supports
- [ ] A test that the table has no duplicate pair and no address that is not
      lowercase-safe — the USDC checksum in Monad's own JSON is wrong, and a table
      that fails to load on a bad checksum takes the whole valuation down

### T2 — The port and the adapter

- [ ] `PriceReader` port, with the header argument this codebase writes
- [ ] Chainlink adapter, ABI-declared, one read per pair
- [ ] All three refusals, each with its own reason string
- [ ] Tests: a fresh answer, a zero answer, an incomplete round, a stale answer, a
      missing feed, and a node failure. The happy path is the easy one.

### T3 — Valuation, as a pure function

- [ ] Bigint in, decimal string out, no float anywhere
- [ ] `valueIn(quantity, fromUsd, toUsd)` dividing rather than assuming the target
      is pegged, per finding 2
- [ ] Tests including the rounding direction, because truncating a valuation UP is
      how a product overstates what it owes someone

### T4 — Publication and the client

- [ ] `/wallet/assets` gains a valuation per row, with observed-at and age
- [ ] The client draws the figure, and draws the reason when there is none
- [ ] The category total, which today is a quantity, becomes a dollar total the
      moment the valuation exists — and the quantity STAYS, because it is still
      true when the price is not

### T5 — Verify against the chain

- [ ] Read all four live, twice, and record the numbers here
- [ ] Assert the refusals against a fake, not against hope
- [ ] Confirm the client shows a valuation for MON and a reason for BTC and SOL if
      no feed is wired for them yet

## Evidence

To be collected. The header measurement is the only claim made so far and it is
reproducible with `scripts/probe-feeds.ts`.
