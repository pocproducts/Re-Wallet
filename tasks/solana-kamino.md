# F2-C · Solana: leer tokens y sumar un segundo venue

## Why this task

The owner chose the short road: **Kamino on Solana**. The money never leaves
Solana, there is no bridge and no bridge risk. The goal is that USDC or USDT
brought from Solana, put into a pool, appears under **Inversiones → Dólares
digitales** alongside what is already there.

## The live defect this task fixes first

**Today USDC can be deposited to Solana and the app will never show it.**

`07.PockBackend/src/domain/deposit/catalog.ts:206-217` offers USDC on Solana with
`balanceReadable: false`, and `src/domain/portfolio/assets.ts:75` lists only SOL.
The deposit address exists and the flow works, so anyone who deposits USDC to
that address has money the app reports as zero. That is reachable through the
normal "Dólares digitales" deposit path. It is not theoretical.

**P1 fixes this before anything else.**

## The research that settled the design

Kamino has two products and only one of them fits:

**Kamino Earn (KVaults)** — deposit one token, receive vault shares
(`kvUSDC`, `kvUSDT`) that appreciate as interest accrues. Read with
`vault.getUserShares(userAddress)`: **a single token balance, exactly the shape of
Aave's aToken.** Supports USDC, USDT, SOL and 40 more.

**Kamino Klend** — obligation accounts, up to 8 collateral deposits and 5
borrows, a structure to deserialize. **Rejected**: it is a different shape from
everything this backend does, and there is no reason to pay that cost first.

### The trap in Kamino Earn

> "If the vault has a farm attached, shares are automatically staked in the farm
> and **are not visible in the user's wallet**."

So reading the user's Solana token accounts does **not** find a vault position.
The position must be read from the vault's own user-shares account. A reader
that looked in the wallet would report an empty pool position while the money
was earning. That failure is silent, which makes it the kind worth designing
against rather than against.

## What this task does NOT need

**No `yield_positions` migration.** The Aave position is read live from the
aToken and never persisted; the Kamino position will be read live the same way.
The table is for the accrual ledger — recording what was earned per day — which
is a different feature and still has no writer.

## How a venue is listed

`readWalletBalance` already splits the way this needs:

| bucket | serves |
|---|---|
| `cryptoValue` | **Bitcoin & Crypto** — free crypto not pegged to the dollar |
| `digitalDollarsValue` | **Dólares digitales** — everything pegged: free USDC across chains + pool positions |
| `investedValue` | the positions, kept for the drill-down |

A venue becomes **one more piece in `investedValue`**, carrying its own chain and
label ("Kamino · USDC en Solana"). **The card total does not change in code** —
it already sums across chains — and the person still sees one number.

## Tasks

### P1 — SPL token reading on Solana

`solanaBalanceReader.http.ts` calls `solana.lamports(address)` and nothing else.
Read SPL token balances too, via `getTokenAccountsByOwner` filtered by `mint`
with `jsonParsed` encoding.

- Only the mints the catalog declares. Never "every token the wallet holds" —
  that is not our portfolio and would make the screen unbounded.
- Solana USDC / USDT stop being `balanceReadable: false`. They become ordinary
  pegged pieces valued at 1, **with no oracle**, like every other digital dollar.
- Exact `bigint` at the mint's decimals. The decimals come from the catalog, not
  from a guess and not from the RPC response.
- A mint that cannot be read is `unreadable`, never zero.

### P2 — Kamino Earn position on Solana

A reader for the vault's user shares, shaped like the existing Aave pool reader,
registered as a second venue so the composition adds it automatically.

- The position is read from the vault's user-shares account, **not** from the
  user's wallet, for the reason in the trap above.
- The shares are converted at the vault's exchange rate into the underlying
  amount. Both sides exact, `bigint`, no floats.
- Shares that cannot be read make the invested bucket incomplete and say so.
- Zero shares is `ok` with a zero, never `unreadable`.

## Allowed edit surfaces

- `07.PockBackend/src/domain/portfolio/**`
- `07.PockBackend/src/domain/deposit/**`
- `07.PockBackend/src/domain/ports/**`
- `07.PockBackend/src/domain/pool/**`
- `07.PockBackend/src/domain/yield/**`
- `07.PockBackend/src/infrastructure/rpc/**`
- `07.PockBackend/src/application/portfolio/**`
- `07.PockBackend/src/application/pool/**`
- `07.PockBackend/src/interface/http/routes/**`
- `07.PockBackend/src/interface/http/app.ts`
- `07.PockBackend/src/container.ts`
- `07.PockBackend/test/**`
- `07.PockBackend/sql/**`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/components/Investments/**`
- `05. UI-UX/src/components/Wallet/InvestmentsView.tsx`
- `05. UI-UX/src/App.tsx`
- `odd/tasks/solana-kamino.md`

## Out of scope

- **Klend.** Obligation accounts are a different shape and buy nothing here.
- **The bridge.** Not for this task. The money stays on Solana.
- **Depositing into Kamino.** Reading the position is P2. Building and signing
  the deposit transaction is a separate task; a position the app cannot create
  is still a position a person can arrive with.
- **`yield_positions` / `yield_accruals` schema changes.** Deferred to the
  accrual ledger task, which still has no writer.
- **OUSD.** Different issuer, different chains, and not verified as a pool
  asset here.

## Gates

- `npm test` green in the backend.
- `tsc --noEmit` clean on both sides.
- `vite build` green.
- A test proves Solana USDC is readable and appears as a pegged piece worth
  exactly 1, with no oracle consulted.
- A test proves a mint that cannot be read is `unreadable`, not zero.
- A test proves the Kamino position comes from the vault's user-shares account,
  **not** from the user's token accounts — the trap above.
- A test proves the second venue is added to the invested bucket and to the
  total, and that the buckets stay disjoint.
- Zero shares is `ok` with a zero.