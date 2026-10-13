# Feature: native currency (MON) across the stack


# Feature: native currency (MON) across the stack

<!--
> **RECONCILIADO 2026-09-29**
> **Estado real: closed** — 15 of 15 claimed paths verified real against the tree.
> One thing to flag while reading it: its T4 (build the frontend assets read) and
> `history-read-performance` T4 (delete it) are THE SAME FOUR FILES, and the delete
> never happened. The route lives; this document's T4 is the reason it exists.
> **Map and contradictions: `odd/roadmap.md` section 3.**
-->

## The measurement, and the two wrong answers that came before it

The public Monad node at `rpc.monad.xyz` **does not keep historical native
state**. The decisive test is the genesis block, read against an address that
holds 101.04 MON today:

```
### publico (https://rpc.monad.xyz)
  getBalance @bloque 1  -> ERROR "Block requested not found... historical state no longer available"
```

**But that is not the end of it.** Monad publishes a separate archive node, and
it keeps full history — free, with no key and no indexer:

```
### archivo (https://rpc-mainnet.monadinfra.com)
  getBalance @bloque 1          -> 0.000000 MON    (nonce 0)
  getBalance @bloque 54472293   -> 100.000000 MON
  getBalance @latest            -> 101.040000 MON
```

A different value per block, which is what a node with real state looks like.

### The two probes that got it wrong first, and why

Written down because both failed the same way and both would have produced a
confidently wrong architecture.

1. **A wallet with a zero balance.** The first probe asked about the address
   under test, which holds no MON. Every block answered `0`. That is
   indistinguishable from "the node has no history", so the probe could not
   answer the question it was written to answer.
2. **A verdict that could not tell the two cases apart.** The second probe
   compared six historical readings and called "all the same" a failure to serve
   history. But if an address genuinely did not move in the last million blocks,
   six identical readings are the CORRECT answer. The conclusion was an artifact
   of the probe's own logic.

The test that settles it reads the GENESIS block of an address that holds funds
now. A node with no history answers with today's balance; a node with history
answers with what was true then. There is no third interpretation, so it has no
false-negative to give.

### Does switching break what already works?

Checked, because the working USDC history is a regression risk and not a
sacrifice. Both nodes return identical values:

```
                                      publico    archivo
balanceOf USDC @108468847              826004     826004
balanceOf USDC @107468847 (1M antes)         0          0
getBlockByNumber(108468847)                 9 txs      9 txs
receipt de una tx de ese bloque          1 logs    1 logs
eth_getLogs                          ERROR      ERROR
```

Same state, same blocks, same receipts, and `eth_getLogs` broken on both — which
is the limitation the code already documents. **Switching costs nothing.**

### What the measurements settle

| | Balance de MON | Historial de MON |
| --- | --- | --- |
| `rpc.monad.xyz` | works at head | **no** — history rejected |
| `rpc-mainnet.monadinfra.com` | works | **works** — free, no key |

**No indexer, no API key and no payment are required.** The binary-search
technique in `StateDiffMovementReader` applies to the native token unchanged,
against the archive node.

## The part that is still genuinely hard

A balance diff finds THAT a balance changed. It does not say what moved it.

An ERC-20 transfer leaves a `Transfer` log, and `movementsInBlock` reads it. A
**native** transfer leaves no log at all — it is a value transfer, and
`movementsInBlock` will find nothing and report an empty history for a wallet that
demonstrably moved MON. The same blind spot already documented for smart-account
wallets applies, and it is worse for the native token because there is not even a
trace in the logs.

Gas makes the arithmetic worse rather than better: a wallet that receives 10 MON
and spends gas in the same block nets to 10 minus the fee, so the balance diff
never equals the amount transferred.

So this feature delivers the native **balance** from the archive node, and for
native **history** it reconstructs only what can be reconstructed honestly:
direct transfers to and from the address. Internal native movements stay
unreported, and the page says which tokens it covered rather than implying
completeness.

## Goal

MON becomes a real, visible asset: a balance that is a measurement rather than a
hardcoded zero, and a history that reports its own coverage instead of implying
it saw everything. `Bitcoin & Crypto` stops rendering `U$0,00` from nothing.

## Non-goals

- No indexer is purchased, configured or required. Measured: none is needed.
- No native history fabricated from a balance diff. Refusing is the deliverable
  where reconstruction is not possible.
- No change to the USDC/aUSDC read, which works and is tested. Verified above
  that the archive node returns identical values for it.

**Backend**

- `BalanceReader` grows an optional native read. The port documents that native
  state at head is available while history is not, so the next reader does not
  re-derive this.
- `MovementReader` gains a way to say "I cannot see this token" that is
  distinguishable from "there were no movements in it". The state-diff reader
  must report that for the native token rather than returning an empty page.
- `GET /wallet` returns the native balance in the same envelope shape, with the
  token identified by symbol and decimals like every other entry.
- `GET /wallet/movements` gains a `unsourceableTokens` field naming the tokens it
  could not cover, so the client can say so instead of rendering a clean empty
  list that looks like a quiet account.

**Frontend**

- `AssetRepository` comes back, satisfied by an adapter over a real endpoint.
  The rows still come from `config/assets.ts` — a row is a product intention —
  but the values are now a measurement.
- `useHoldings` returns a real state again: loading, ready, unavailable, and
  per-token "not covered", which is a fourth state the previous design could not
  express.
- `AssetListScreen` renders those four states. The copy says why a zero is a
  zero, and it must be able to say "this token is not covered" without saying
  "we could not read your balances", which is a different failure.

## Tasks

### T1 — Backend: the archive node, as configuration

- [x] A configured historical RPC alongside the current-state one, validated by
      the same env rules, with the measured limitation written next to it
- [x] `dev-local.sh` carries both, and the boot line shows which is which
- [x] A test proving the reader picks the right endpoint per call, and that with
      no archive node configured it degrades to the current balance rather than
      failing or inventing history

### T2 — Backend: the native balance read

- [x] `BalanceReader` port: native at head, with the history limitation written
      where the next implementer will read it
- [x] `viemBalanceReader` reads the native balance
- [x] `GetWalletBalances` projects it alongside the ERC-20 amounts
- [x] Tests — 15 new, and two real bugs caught by them during the run

### T3 — Backend: the native token in the history read

- [x] The balance-diff search runs for the native token against the archive node
- [x] `movementsInBlock` reconstructs a native movement from the transaction
      value and parties, and says nothing it cannot source
- [x] The page names what it covered and what it did not — `unsourceableTokens`
      for a change it could not reconstruct, `truncatedTokens` for a search that
      ran out of budget. Two lists, because the two are different sentences.
- [x] Tests, including the case that must NOT produce a fabricated row, and the
      no-archive-node degradation — 8 + 9
- [x] A WORK BUDGET, added after the first implementation proved unusable. See
      below; the budget was not in the original plan and is the reason this task
      is closed rather than rewritten.

### T4 — Frontend: the assets read, for real this time

- [x] `AssetRepository` port and HTTP adapter over the real endpoint
- [x] `useHoldings` with the states the backend can now produce
- [x] `AssetListScreen` renders them, and distinguishes a zero from a token that
      was not covered
- [ ] Tests — **NOT DONE, and the reason is a decision, not an oversight.** The
      frontend has no test runner. Adding one is a real choice about the project's
      build, not a task to be done quietly inside a feature.

### T5 — Verify

- [x] Typecheck and tests on both sides — backend 401/402 passing, frontend clean
- [x] Real reads measured against both nodes, before and after
- [x] A real MON transfer shows up, or is reported as not reconstructable — never
      silently missing. Verified: an 18.00 MON inbound, hash byte-identical to the
      chain's, with `truncatedTokens` declared

## Evidence

### T4, verified end to end

All three endpoints the app consumes now answer, through the proxy the browser
uses — and the 404 that opened this session is gone:

```
/api/wallet           -> 200 en 1.49s
/api/wallet/assets    -> 200 en 0.73s
/api/wallet/movements -> 200 en 8.24s
```

`GET /wallet/assets` returns Bitcoin and Solana PRESENT and `unsourceable`, not
absent and not zero:

```json
{ "id": "bitcoin", "coverage": "unsourceable", "amount": null }
{ "id": "solana",  "coverage": "unsourceable", "amount": null }
{ "id": "mon",     "coverage": "covered", "symbol": "MON", "amount": "0" }
```

Adding Solana later is one catalogue entry on each side. That was the requirement
and it is what shipped.

**A contract drift found by the frontend half and fixed at the source.** The live
page published `truncatedTokens: ["MON", "0x754704…", "0x35a73b…"]` — a symbol
for the native token and raw contract addresses for the ERC-20s. Cause:
`symbolNames` was only filled as a side effect of EMITTING A ROW, so a track that
was truncated before opening any block never learned its own name — and truncation
is precisely the case that publishes the declaration. The names are now resolved
before the searches start, and the live page reads:

```
truncatedTokens: ['MON', 'USDC', 'aMonUSDC']
```

Note `aMonUSDC`, not `aUSDC`. Nobody had checked; the chain knows what its receipt
token is called, and a hand-written symbol in a client would have been wrong. A
test that had ENCODED the address as expected output was corrected rather than
satisfied, and a new one pins that a coverage entry is never a `0x…`.

### T3, verified against the chain

The first implementation of T3 worked and was unusable: for an ACTIVE wallet it
took **276 chain calls and 60.1 seconds**, and the 20s deadline answered 500.
Measured, not estimated:

```
bloques de cambio hallados : 12
llamadas de la busqueda     : 264      (~22 per change block, repeated)
llamadas de abrir bloques  : 12
llamadas TOTALES            : 276
tiempo real                 : 60.1s
```

**Parallelism was measured and rejected as the fix.** Ten concurrent calls:

```
publico   secuencial 10: 2794ms   paralelo 10: 1950ms   speedup 1.4x
archivo   secuencial 10: 2289ms   paralelo 10: 1937ms   speedup 1.2x
```

Both nodes serialise, so concurrency buys almost nothing. The archive node is not
slower than the public one either (328ms vs 861ms for a head balance). **The only
lever is fewer calls**, which is what the budget does: 64 calls at the measured
218ms is a 13.9s worst case.

The same wallet, before and after:

| | before | after |
| --- | --- | --- |
| HTTP | 500 after 20s | **200 in 7.58s** |
| rows | none | `depositado 18.00 MON` |

And that row is the chain's, not the product's — checked directly against the node:

```
bloque 108953196, tx 0x2b188e8f...5b9
  from  0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e
  to    0x0000000000000000000000000000000000001000
  value 18 MON
```

**The hash in the API response is byte-identical to the chain's**, and the same
read declared `truncatedTokens: [USDC, MON, aUSDC]` — so it told the client that
the history it showed is recent, not complete.

A quiet wallet is byte-identical with and without the budget, which is the
regression that mattered: a budget that silently truncates an ordinary account
would be worse than the 60 seconds it fixed. There is a test asserting exactly
that with `toEqual` on the whole page.

### T1 + T2, verified against the chain

Typecheck clean. `363 passed | 1 failed` — the failure is `envExample.test.ts`
waiting on a `.env.example` line this session is blocked from writing.

`GET /wallet` against the live node, for a wallet with no MON:

```json
"total": { "amount": "0.826004" },                  <- USDC, byte-for-byte unchanged
"native": { "amount": "0", "symbol": "MON",
            "decimals": 18, "atRequestedBlock": true }
```

and for a wallet holding 101.04 MON:

```
USDC total  : 0
MON nativo  : 101.04 MON | atRequestedBlock: True
```

**101.04 is the same figure the raw probe read by hand**, so the value is the
chain's and not the product's.

Two design facts this locked in, both checked rather than assumed:

- **`total` means USDC and still does.** Adding 101.04 MON to twenty cents of
  USDC and calling the sum a balance is the kind of number that looks right. The
  native amount is an additive sibling field, and a client that reads
  `balances.total` today is unaffected.
- **Absent is not zero.** `native` is omitted when the read did not happen, and
  `atRequestedBlock: false` says out loud when a historical request was served
  with the current number.

Two bugs the tests caught during the run, both fixed in the source rather than in
the assertions: the head native read was going to the archive client whenever one
was configured, and the fake client answered historical blocks successfully, so
the degradation path was never actually exercised.

## Commits

Not committed — the tree carries unrelated pending deletions and no commit has
been requested.
