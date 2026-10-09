# F2-A · La médula de agregación: un solo número

## Why this task

The product promise is one number: *"$100 en dólares"*. Today the product
cannot keep that promise even with a single protocol implemented.

The money is real and already works. Aave V3 on Monad is fully implemented,
wired and well tested. The user is funded. What is missing is that **the front
shows two separate numbers for the same money and never adds them.**

- `usdcTotal` (`05. UI-UX/src/hooks/usePortfolio.ts:303-319`) sums free wallet
  balances across chains.
- The Aave position comes from a different endpoint (`GET /api/pool`) and is
  rendered in a separate card (`components/Investments/DigitalDollarsView.tsx:112-231`).
- **No `usdcTotal + aTokenBalance` sum exists anywhere in the front.**

So a person with $40 idle and $60 deposited sees two cards and has to add them
in their head. The backend owns the composition and the front does not compose.

This task makes the backend return the total.

## The decision that shapes this task: the total is denominated in digital dollars

Every component summed here is USD-pegged: free `USDC` from the wallet, and the
Aave `aTokenBalance`, which is USDC principal **plus accrued interest**, because
the aToken rebases. USDC and aMonUSDC are the same unit at the same decimals and
add exactly, with no price needed.

The owner deferred the price feed to a later task. That decision does not block
this one, and this task must not quietly reintroduce a hardcoded price to make a
total appear.

**This is why no price feed is required.**

Native assets (SOL, MON, ETH) stay out of this total. They are not digital
dollars and valuing them requires the price feed, which is a separate task.

## The rule this task exists to enforce: an incomplete total must say so

A total that silently omits an unreadable component is **a lie**, and it is the
most dangerous thing this product could ship. It is more dangerous than a wrong
number, because a wrong number can be checked.

The discipline already exists in this codebase and must be preserved exactly:

- `services/pool.ts:310-327` — `displayableSupplyApr` is `null` unless the APR
  reconciles. "Could not read" is never drawn as zero.
- `test/interface/pool.test.ts:214` — a position of zero is `ok`, not
  `unreadable`.
- `test/interface/pool.test.ts:227,244` — an unreadable reserve or position is
  never zero.

So the total is **not a number alone**. It is a number plus a completeness
statement. If any component is unreadable, the total is marked incomplete and
the screen says which part is missing. It never rounds down to a confident lie.

## Tasks

### T1 — The backend computes the total

A use case that aggregates every digital-dollar component for the person the
cookie proved, and returns:

- `total` — the sum, as an exact `bigint`-derived decimal string, plus the unit.
- `complete` — whether every component was readable.
- `components` — each contributing piece with its own read status, so a screen
  can explain the number instead of just showing it.

Rules:

- **Nothing is read from the request.** No address, no chain, no user id. The
  components come from `rewallet.wallets` for the cookie's user, exactly like
  `readPool` does (`evmAddressFrom`, `readPool.ts:139-145`). The same property
  that `pool.test.ts:258` and `:319` assert must hold for this route.
- One unreadable component must not destroy the others. The partial sum is still
  returned, marked incomplete. This mirrors how `readPool` reads the reserve and
  the position independently so one failure leaves the other intact.
- A zero component is `ok` with value zero. It is not unreadable. This distinction
  is already tested and must carry over.

### T2 — The front shows one number

Replace the split presentation with a single total, keeping the honesty rule:
when the backend says the total is incomplete, the screen says which part is
missing rather than showing a confident number.

The existing cards do not disappear; they become the explanation of the number.
`usdcTotal` and the Aave position stop being two answers and become two
contributions to one.

### T3 — The position ledger migration (deferred, on the record)

**Deliberately not in this task.**

`yield_positions` today is `wallet_id NOT NULL UNIQUE`
(`02. Contexto iniciar del proyecto/ReWallet_Schema123.sql:298`) — one row per
wallet, with no `chain`, no `protocol` and no `asset` column. It cannot represent
"USDC in Aave on Monad" and "USDC in Aave on Base" as separate rows.

That is a real limitation, and it will block the first accrual ledger. **It does
not block this task**, because nothing writes that table: the Aave position is
read live from the contract and never persisted. Aggregating live reads needs no
migration.

The migration belongs to the task that introduces accruals, at which point it
has a writer. Migrating an empty, unwritten table now is precisely the
"sembrad[o] that does not exist" pattern that `docs/contrato-dinero.md` already
commits and that this repo had to undo.

## Allowed edit surfaces

- `07.PockBackend/src/application/portfolio/**`
- `07.PockBackend/src/application/pool/**`
- `07.PockBackend/src/domain/ports/**`
- `07.PockBackend/src/interface/http/routes/**`
- `07.PockBackend/src/interface/http/app.ts`
- `07.PockBackend/src/container.ts`
- `07.PockBackend/test/**`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/usePortfolio.ts`
- `05. UI-UX/src/hooks/usePool.ts`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/components/Investments/**`
- `05. UI-UX/src/components/Wallet/WalletView.tsx`
- `05. UI-UX/src/components/Wallet/InvestmentsView.tsx`
- `odd/tasks/medula-de-agregacion.md`

## Out of scope

- **The price feed.** A separate task, owed. This task must not add a hardcoded
  price to make a total appear.
- **`yield_positions` / `yield_accruals` schema changes.** Deferred to the
  accrual ledger task. See T3.
- **New protocols or chains.** Aave on Base is the cheapest next venue, but it is
  the next task. This task must not add one, or it will not prove the spine.
- **The bridge.** Comes after venues exist to sum into.
- **The swap.** See the roadmap; the contract's claim that it was seeded is false.
- **Solana token reading.** `readPortfolio.ts:126-127` reads lamports only.
  Solana SPL reading does not exist and is its own task.

## Gates

- `npm test` green in the backend.
- `tsc --noEmit` clean on both sides.
- A test asserts that an unreadable component yields an incomplete total, and
  that it is never rendered as a complete one.
- A test asserts that nothing in the request is read to build the total.