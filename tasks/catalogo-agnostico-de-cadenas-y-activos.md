# Catálogo agnóstico de cadenas y activos

## Why this task

The product objective is to be a **chain-agnostic wallet**. Today it is not
agnostic in any meaningful sense, and it is not agnostic for a reason we chose:
the catalog is **hardcoded, duplicated across six places, and contradicts itself
on decimals**.

The current state, measured:

- The front advertises **8 assets**. The product can actually move **5**
  (`MON`, `ETH`, `SOL`, `USDC`). `BTC`, `TRX`, `DOGE`, `USDT` exist only in
  `config/assets.ts` and are rejected by the backend with `ASSET_NOT_ON_CHAIN`.
- **USDC has two different decimals**: `2` in `config/assets.ts:105`, `6` in the
  backend. The `6` is correct.
- **SOL has two different decimals**: `8` in `config/assets.ts:84`, `9` in the
  backend. The `9` is correct.
- **Solana USDC is sendable but invisible in the portfolio**: present in
  `deposit/catalog.ts:187-218`, absent from `portfolio/assets.ts:64-77`.
- The **USDC contract addresses are written three times**
  (`deposit/catalog.ts:145,166,196` and `portfolio/assets.ts:45-48`).
- `movements.type` has **no CHECK constraint** in the live database, but
  `movement-store.ts:16-17` documents one that lists `swap` and `bridge`.
  The comment describes a schema that does not exist.
- **No migration file creates any table.** `grep -rn "CREATE TABLE"` over the
  whole repo returns nothing. `sql/` holds two `ALTER TABLE` statements. The
  schema was applied by hand through the Neon MCP and was never versioned.
- The front has **zero tests**. There is no `*.test.*` file anywhere in
  `05. UI-UX`.

## The finding that reframes the goal

The architecture is already closer to agnostic than the catalog suggests:

- `WALLET_CHAIN_ORDER` is `['ethereum','solana']`
  (`domain/wallet/chains.ts:35`), and **Monad is deliberately not a wallet
  chain**. Monad deposits reuse the Ethereum address.
- Therefore **one EVM address serves every EVM chain**. Adding an EVM chain
  requires a new wallet, a new address, or a new signing path.

That is the right design and it is the thing to preserve. Agnosticism here is
not about holding more keys; it is about **a registry where adding a chain is a
data edit, not a code change**.

## Scope decisions (owner, this session)

1. **Cover the EVM chains Privy supports plus Solana.** Bitcoin, TRON, Stellar
   and Spark are **documented as out of scope**, not silently absent.
2. **The price feed is a separate task.** Not in this one.

### Why Bitcoin / TRON / Stellar are out of scope

Privy supports them at **Tier 1 and Tier 2 — create and sign, but not send**
(`docs.privy.io/wallets/overview/chains`). Listing an asset the wallet cannot
move is precisely the defect this repo already has with `BTC`, `TRX`, `DOGE` and
`USDT`. Scaling that defect is worse than not listing them.

### Consequence of deferring the price feed — accepted, on the record

`ASSET_PRICE_USD` (`config/markets.ts:78-86`) is 7 hardcoded constants,
`ARS_PER_USD = 1570` is fixed, and **`MON` has no price at all**
(`priceUsd('MON')` returns `0` through the fallback).

Assets added in this task will therefore appear **without a USD value**. That is
already true today for `MON`. The owner accepted this. **A follow-up task for
the price feed is owed**; this task must not pretend it solved that.

## Tasks

### T1 — One registry for chains and assets

A single data module that is the only place a chain or an asset is declared.
`deposit/catalog.ts`, `portfolio/assets.ts` and the three copies of the USDC
addresses all become **derived from it**, not parallel copies.

- The registry declares, per chain: CAIP-2 id, display label, wallet-family
  (`evm` | `svm`), whether it has its own wallet, and its assets.
- The registry declares, per asset: symbol, name, kind, decimals, native flag,
  and the **Privy well-known asset name** (`usdc`, `usdt0`, `ousd`, …) as the
  canonical identity, plus a per-chain resolved address for balance reading.
- Any existing consumer that needs a chain or an asset must read the registry.
  No second declaration may survive.

**Gate**: `npm test` green in the backend; `tsc --noEmit` clean on both sides;
`grep -rn "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" src` returns exactly one
hit per chain, not two.

### T2 — Reconcile the existing six rows against reality

- USDC decimals `2` → `6` everywhere the front declares them.
- SOL decimals `8` → `9` everywhere the front declares them.
- Solana USDC becomes visible in the portfolio.
- The `movements.type` CHECK comment in `movement-store.ts:16-17` is corrected
  to describe what the database actually enforces, which is nothing.
- The stale comment in `services/portfolioIdentity.ts:12-14` claiming MON is
  "not in the catalog" is corrected; MON has an unreachable duplicate identity
  at `portfolioIdentity.ts:41-43`.

**Gate**: `npm test` green; backend tests updated where they hard-code the old
values, and the update is visible in the diff.

### T3 — Add the assets Privy supports, on the chains we support

**Blocked on T1, and blocked on verified addresses.**

Privy exposes well-known assets as **symbols**, not addresses: `ousd`, `usdc`,
`usdc_e`, `usdt`, `usdt0`, `usdb`, `usdg`, `pathusd`, `eurc`, `eth`, `sol`,
`pol`, `trx`. Our balance reader and `prepareSend` need a **hex address per
chain**. The mapping must come from a verified source. **No address is to be
invented, guessed, or copied from an unverified page.**

Open question to settle inside this task, because it changes T1's shape:

> Should the registry resolve addresses from Privy at runtime rather than
> hardcoding them per chain?

Hardcoding is simpler and offline-testable, and matches how the balance reader
works today. Resolving from Privy is genuinely chain-agnostic — adding an asset
becomes adding a name — but it makes the registry depend on Privy at runtime
and complicates the offline tests the repo currently relies on. **This needs an
explicit decision before T1 is closed, not after.**

### T4 — Document the chains we deliberately do not support

A single, explicit place stating that Bitcoin, TRON, Stellar and Spark are
supported by Privy at Tier 1/2 and are **not** supported by ReWALLET, with the
reason. The goal is that the omission is a decision on the record rather than an
accident of the catalog.

### T5 — Version the database schema

The schema is not in the repo. Every future change to `movements`, or the new
tables the swap will need, must land as a numbered file in
`07.PockBackend/sql/` with the corresponding test.

## Allowed edit surfaces

- `07.PockBackend/src/domain/deposit/**`
- `07.PockBackend/src/domain/portfolio/**`
- `07.PockBackend/src/domain/wallet/**`
- `07.PockBackend/src/domain/ports/**`
- `07.PockBackend/src/application/deposit-info/**`
- `07.PockBackend/src/application/send/**`
- `07.PockBackend/src/interface/http/routes/depositInfo.ts`
- `07.PockBackend/src/container.ts`
- `07.PockBackend/src/config/**`
- `07.PockBackend/test/**`
- `07.PockBackend/sql/**`
- `05. UI-UX/src/config/**`
- `05. UI-UX/src/services/depositInfo.ts`
- `05. UI-UX/src/services/portfolioIdentity.ts`
- `05. UI-UX/src/types/deposit.types.ts`
- `05. UI-UX/src/hooks/useDepositInfo.ts`
- `05. UI-UX/src/components/Wallet/ActionFlowModal.tsx`
- `odd/tasks/catalogo-agnostico-de-cadenas-y-activos.md`

## Out of scope

- **The price feed.** A separate task, owed.
- **The swap.** Separate; see the roadmap. Note that `docs/contrato-dinero.md`
  claims Fase 1 already seeded a `SwapProvider`, an empty adapter, quote types,
  quote tables and a `501` endpoint. **None of those exist.** That document is
  wrong and correcting it belongs to the swap task.
- **New wallet chains.** EVM chains reuse the existing EVM address, so this task
  adds no wallet. If a chain ever needs its own address, that is a new task.
- **Bitcoin, TRON, Stellar, Spark.** Documented in T4, not implemented.
- **Cross-chain bridges.**
