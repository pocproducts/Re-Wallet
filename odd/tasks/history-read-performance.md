# Feature: history-read performance (phase 1)

<!--
> **RECONCILIADO 2026-09-29**
> **Estado real: contains false claims.** T4 below is marked done and claims it
> REMOVED `httpAssetRepository`, `useHoldings`, the `AssetRepository` port and the
> provider wiring, and that `/wallet/assets` does not exist. All four files are
> still on disk and wired (`Front End/src/infrastructure/assets/httpAssetRepository.ts`,
> `Front End/src/domain/assets/assetRepository.ts`, `Front End/src/application/assets/holdings.ts`,
> `Front End/src/application/pools/PoolProvider.tsx`, `Front End/src/App.tsx`), and the route
> is registered at `Backend/src/interface/http/app.ts:264`. T4 is **VOID BY OBSOLECENCE,
> not wrongly done**: the decision was taken before the route existed and was never
> revisited. The route is the survivor, and three other documents depend on it staying
> alive. Of the two blockers listed below, `MOVEMENTS_CACHE_TTL_SECONDS` is **RESOLVED**
> (it is in `Backend/.env.example`); `Backend/.env` still holds (it does not exist, and
> the repo blocks writing `.env` paths).
> **Map and contradictions: `odd/roadmap.md` section 4.1.**
-->

## Goal

The wallet's "Últimas Actividades" card and the Actividad screen are unusable:
`GET /wallet/movements` measures **14.8s** and the console carries a permanent
`404` for an endpoint that does not exist. Phase 1 makes both reads fast and
honest without Redis. Redis later replaces the in-process cache with a shared one;
nothing else in this feature has to change when that happens.

## Non-goals

- No Redis, no new infrastructure, no new database table.
- No change to the movement payload shape, the `source` vocabulary or the route
  path. A client written against today's response keeps working.
- `01.Poc-bestpath/` is a laboratory. It is not touched.

## Baseline (measured, not estimated)

| Read | Before |
| --- | --- |
| `GET /wallet` | 1.21s |
| `GET /wallet/movements` | 14.81s |
| `GET /wallet/assets` | 404 in 2ms (route does not exist) |

`StateDiffMovementReader` is the cost. Without an indexer key the history is
reconstructed from state: per token a binary search over ~1.4M blocks, repeated
up to 64 times, then `getBlock(includeTransactions: true)` plus one
`getTransactionReceipt` per transaction in every block a search marked as
changed — all sequential.

## Decisions (user, 2026-09-29)

1. **Both layers.** Backend first (cache + real work reduction), frontend on top.
2. **30 second TTL** on the cached page.
3. **Delete the `/wallet/assets` read.** The balance already comes from
   `GET /wallet`; the holdings read is redundant and was never implemented.

## Tasks

### T1 — Kill the `activity/` / `Activity/` case collision

`src/components/activity/` and `src/components/Activity/` both exist and
`WalletView` imports from both. Linux tolerates it, macOS and Windows do not.
`amountClass is not defined` is the visible symptom of a related fault: the Vite
process started 2026-09-28 20:19 and `activity/amountClass.ts` was created
2026-09-29 00:15, so its module graph kept a transform with the import stripped.

- [x] Move `ActivityView.tsx` and `MovementIcon.tsx` into `components/activity/`
- [x] Delete `components/Activity/`
- [x] Repoint the three importers
- [x] Restart Vite and confirm the served transform imports `amountClass`

### T2 — Backend: 30s cache + single-flight around the history read

A caching decorator over the `MovementReader` port, wired in `container.ts`.

- [x] `CachingMovementReader`: 30s TTL keyed by address + limit
- [x] Single-flight: concurrent callers share one in-flight promise, so five
      clients opening the app at once produce one chain scan, not five
- [x] Hard deadline so a stuck scan answers instead of hanging the route
- [x] Failures are never cached
- [x] `invalidateMovementCache()` on the container, beside the pool and wallet ones
- [x] Tests

### T3 — Backend: stop doing the work serially

The cache hides a repeat read; the first read still pays. Three reductions that
do not change a single returned value:

- [x] Receipts of one block read concurrently instead of one after another
- [x] The two tracked tokens scanned concurrently
- [x] A cap on how many change blocks one read inspects

### T4 — Frontend: delete the dead `/wallet/assets` read

- [x] Remove `httpAssetRepository`, `useHoldings`, the `AssetRepository` port and
      its provider wiring
- [x] `AssetListScreen` shows the total it already receives from `GET /wallet`
- [x] No `404` left in the console

### T5 — Frontend: read once, and do not amplify a slow read

- [x] Client-side TTL cache in `useMovements` so returning to the tab is instant
- [x] The retry loop stops amplifying: one retry, and only for a real failure
- [x] Wallet and history do not block each other — the balance renders on its own

### T6 — Verify

- [x] `npm run typecheck` on both sides
- [x] `npm test` on the backend
- [x] `npm run build` on the frontend
- [ ] Re-measure all three reads and record the numbers here — BLOCKED, the API
      cannot be restarted without its environment
- [x] Confirm the served `WalletView.tsx` transform imports `amountClass`
- [x] Check that the burst test FAILS with the cache disabled, so it is a real
      regression guard and not a test that passes either way

## Evidence

| Read | Before | After |
| --- | --- | --- |
| `GET /wallet` | 1.21s | not re-measured — see below |
| `GET /wallet/movements` (cold) | 14.81s | not re-measured — see below |
| `GET /wallet/movements` (warm, <30s) | 14.81s | not re-measured — see below |
| `GET /wallet/assets` | 404 | gone: 0 occurrences in the built bundle |

### What IS proven, and how

- **Five concurrent requests cost one scan.** Proven by
  `test/http/movementsRoute.test.ts` against a fake node that counts requests:
  one scan costs 3 calls, a burst of five costs **15 calls with the cache removed
  and 3 or fewer with it in place**. The test was checked by disabling the wiring
  and watching it fail (`expected 15 to be less than or equal to 3`), so it is not
  a test that passes either way.
- **Failures are not cached, and the TTL is honoured.** 9 unit tests in
  `test/wallet/cachingMovementReader.test.ts`.
- **The 404 is gone.** `grep -c "wallet/assets" dist/assets/*.js` -> 0. The app now
  asks for exactly three endpoints and all three exist: `/wallet`,
  `/wallet/movements`, `/yield/pools/:id`.
- **`amountClass` reaches the browser.** The transform Vite serves contains the
  import, which it did not before T1.
- **Typecheck clean on both sides. 348/349 backend tests pass. Frontend builds.**

### What is NOT yet proven

The real chain timings. The backend process was killed during this work to take a
before/after measurement, and its environment was supplied by shell variables that
no longer exist, so it cannot be restarted from the repository. `Backend/.env`
does not exist. The "After" column above is therefore empty and must not be read
as an improvement — only the reduction in burst traffic is measured, and it is
measured in RPC calls, not in seconds.

## Blockers

1. **`Backend/.env` is missing.** Somebody has to relaunch the API with its real
   environment before the timings can be taken.
2. **`MOVEMENTS_CACHE_TTL_SECONDS` is not in `Backend/.env.example`.** A safety
   policy blocked this session from writing that file. One line, after
   `AAVE_POOL_CACHE_TTL_SECONDS`, unblocks `test/config/envExample.test.ts`, which
   is currently the only failing test.

## Commits

Not committed. The working tree already carries 168 unrelated deletions from the
`bestpath/` removal on `main`, and committing was left to the user on purpose.
