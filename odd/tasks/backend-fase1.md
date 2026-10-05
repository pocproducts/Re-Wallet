# Backend Fase 1 — ReWALLET

<!--
> **RECONCILIADO 2026-09-29**
> **Estado real: partial.** This document is the authority for the backend, and its
> status is stale: T3, T8, T12 and T14 are now checked. T6, T7, T9, T11, T13 and T15
> have not started — they are the empty directories
> `Backend/src/application/{auth,contacts,payments}` and
> `Backend/src/infrastructure/{auth,custody,gas}`. T10 is half: the Aave read is real,
> the `yield_positions` / `yield_accruals` ledger is not written.
> The critical path is that **T6 and T7 are ONE piece of work** (nobody can request a
> session today, so `provider_wallet_id` stays `NULL` and the realtime client stands
> down), and **T15 is the proof they are worth anything**.
> **Map and contradictions: `odd/roadmap.md` section 2.**
-->

## Objective
Build the real ReWALLET backend in `Backend/` (currently empty) so the existing
`Front End/` can stop using mocks and talk to a real API. Backend owns everything:
identity verification, sessions, wallet custody (Privy TEE), transaction signing,
gas sponsorship, and yield. Two databases: local Postgres for tests + Neon for
production. Official schema: `ReWallet_Schema123.sql` (28 tables total; Fase 1 = 13).

## Problem
The front end is UI-only today and depends on `mockProvider.ts` and mock
transactions. bestpath (`01.Poc-bestpath`) was a lab used to validate risks
(Privy TEE custody, gas, sessions, passkeys) — it is a reference, NOT a blueprint.
Its structure, stub endpoints (`PATCH /me/profile`, `contacts {items:[]}`), guessed
Aave rate, and duplicated routes must NOT be copied. Account recovery was a
recurring problem in bestpath; ReWALLET solves it from day one via
`recovery_email` + `recovery_phone` on `users`.

## Why
Consumer product + payments. Zero friction onboarding (passkey login via Privy),
phone as key identity, email for verification and account recovery. The backend
is the single authority: the front never sees secrets, never signs, never
touches Privy directly beyond its own login flow.

## Scope (authorized)
- `Backend/` — new Hono 4 + TypeScript API (Node 22, currently installed).
- Schema: the 13 Fase 1 tables from `ReWallet_Schema123.sql`, mapped to Drizzle.
- Auth: Privy native login (passkey + phone + email as linked accounts). Front
  uses the Privy SDK only for the login gesture; the backend verifies tokens,
  mints its own httpOnly session, provisions the TEE wallet.
- Endpoints Fase 1: auth, wallet, movements, payments (send/request/deposit-intent
  with idempotency), yield summary, contacts, health.
- Tests: own vitest suite in `Backend/test/`. Do NOT copy bestpath tests.
- Two Postgres targets: local (test) + Neon (prod) via DATABASE_URL.

## Out of scope (Fase 2/3 tables stay empty)
assets, wallet_positions, swap_quotes, swap_executions, user_preferences (F2);
chains, bridge_*, cards, card_transactions, merchants, merchant_api_keys,
payment_intents, kyc_records, aml_alerts (F3). No Cloudflare worker entry yet
(dual entry via createApp() keeps that option open without building it).

## Constraints
- Money: NUMERIC(20,6) as STRING everywhere, USDC 6 decimals. Never float.
- Envelope: `ApiResponse<T>` = `{ok:true,data}` | `{ok:false,error,message,code}`.
- Sessions: httpOnly cookie, token hashed SHA-256 in DB, sliding 30d TTL.
- Custody: Privy TEE server-side. createOnLogin OFF. No key in browser.
- No git commits (user decision): working tree only; durable record = this file.
- API contract must satisfy `Front End/src/auth/contract.ts` shapes
  (`AuthSession {privyDid, address, providerWalletId}`, `RegisterInput`, errors).
- ARCHITECTURE: Hexagonal (ports & adapters). Domain core is framework-free;
  Hono/Postgres/Privy are adapters. Structure:

```
Backend/src/
├── domain/            # entities + value-objects + errors (NO deps externas)
│   ├── entities/      # user, wallet, movement, contact, payment-request, yield-position
│   ├── value-objects/ # money (NUMERIC(20,6) string), tag, email, phone
│   └── ports/         # auth-provider, wallet-custody, repository, session-store, gas-provider
├── application/       # use cases (orquestan puertos, sin IO)
│   ├── auth/ wallet/ payments/ yield/ contacts/
├── infrastructure/    # adapters concretos (driven)
│   ├── db/            # postgres.js + drizzle schema + repos .pg.ts
│   ├── auth/          # privy-auth.adapter.ts
│   ├── custody/       # privy-custody.adapter.ts
│   ├── session/       # cookie-session.adapter.ts
│   ├── gas/           # pimlico-gas.adapter.ts
│   └── webhooks/
├── interface/         # adapters primarios (driving) — Hono por fuera
│   ├── http/          # app.ts, server.ts, middleware/, routes/, dto/ (zod)
│   └── config/        # env.ts (zod validation)
└── container.ts       # composición root manual
```

Rule: domain imports NOTHING; application imports domain + ports only;
infrastructure implements ports; interface maps HTTP<->application.

## Checklist (stable task IDs)
- [x] T1 Scaffolding: package.json, tsconfig, deps (hono, drizzle, postgres,
      @privy-io/node, viem, zod, vitest, tsx), .env.example, folder layout
- [x] T2 Config: `src/interface/config/env.ts` con zod. **Fail-closed**: NODE_ENV ausente
      resuelve como produccion (isProduction=true, COOKIE_SECURE=true, LOG_LEVEL=info).
      Regla cruzada: COOKIE_SECURE debe ser true en produccion. Secretos redactados incluso
      en los mensajes de error. `src/index.ts` (entry) valida antes de construir nada y
      corta con exit 1 ante config invalida. Se elimino el fallback hardcodeado de DB
      del cliente y el `?? false` de isProduction en container/app. 225 tests.
- [x] T3a SQL base: `ReWallet_Schema123.sql` namespacesado a `rewallet`, ejecutable e
      idempotente. 28 tablas + 10 triggers + 113 indices aplicados en local (`rewallet_test`).
      Seed `ReWallet_Seed001_FirstUser.sql` con el usuario y la wallet con fondos.
      Falta el schema Drizzle equivalente + cliente + script de migracion.
- [x] T3 DB: drizzle schema + client (postgres.js) + migrate script. 28 tablas en el
      schema `rewallet`; migrado y verificado contra Postgres real. Supera los 13 de
      Fase 1: las de F2/F3 estan mapeadas y vacias, que era el punto.
- [x] T4 HTTP core: `src/interface/http/` con ApiResponse (`{ok:true,data}` |
      `{ok:false,error,message,code}`), jerarquia de errores, requestId, logger pino,
      rate limit en memoria detrás de un puerto, errorHandler terminal, `createApp()` y
      `GET /health`. 167 tests.
      Catalogo de codigos: validation_failed 400, unauthenticated 401, forbidden 403,
      not_found/route_not_found 404, conflict/idempotency_key_reuse 409,
      rate_limit_exceeded 429, internal_error 500.
      NOTA Hono 4: el router se congela tras la primera request. T5+ debe registrar
      todas las rutas de forma sincrona dentro de createApp.
- [x] T5 Sessions: token rw1_+32 bytes base64url, SHA-256 hasheado en DB (raw nunca persiste), cookie httpOnly+Secure+SameSite=Lax, sliding expiry 30d/techo 90d, refresh cuando queda <= 1/3 de la ventana, revoke idempotente. 279 tests.
- [ ] T6 Auth: Privy login verification (JWKS), user upsert, tag generation
      (@tag + tag_normalized), session mint, logout, recovery email/phone endpoints
- [ ] T7 Custody: provision TEE wallet via Privy server SDK, persist provider_wallet_id,
      wallet address + balance cache
- [x] T8 Wallet: GET /wallet, /wallet/movements, /wallet/assets; composicion de balance
      server-side (USDC + MON valuado), multi-chain con `chains[]` y cobertura declarada.
- [ ] T9 Payments: send, deposit-intent, payment_requests (nanoid id), idempotency_keys
      middleware (24h TTL), policy_decisions audit trail
- [~] T10 Yield PARCIAL: GET /yield/summary, /yield/pools, /yield/pools/:id con tasa REAL
      de Aave V3 on-chain (UiPoolDataProvider, MAINNET). FALTA el ledger
      `yield_positions` + `yield_accruals` (daily, apy_bps): hoy la tasa se lee y se
      publica, no se persiste. Los comentarios del codigo lo dicen explicitamente.
- [ ] T11 Gas: gas_sponsorships ledger (app_pays mode), sponsorship on send/deposit
- [x] T12 Webhooks: ledger `webhook_events`, verificacion Svix, idempotencia por
      `svix-id`, POST /webhooks/privy + GET /webhooks/events. Ver T3-T5 de
      odd/tasks/privy-webhooks-and-realtime.md.
- [ ] T13 Contacts: real CRUD (limit 20/user), NOT bestpath's empty stub
- [x] T14 Tests: 506 vitest, 506 verdes, todos propios (nada copiado de bestpath).
      NO cubre payments ni contacts porque esas tareas no existen todavia.
- [ ] T15 Integration: wire Front End auth provider to real API (replace mock with
      real provider, keep mock fallback), smoke test end-to-end

## Acceptance criteria
- `npm run typecheck` and `npm run test` pass in Backend/ with zero config errors.
- A fresh user can register via Privy passkey, get a session cookie, and their
  wallet is provisioned in the TEE; provider_wallet_id persisted.
- Deposits/sends respect idempotency keys; every money POST audits a policy decision.
- Movements list returns the same shapes the front's `contract.ts` expects.
- No secrets in `VITE_*` front vars (only VITE_PRIVY_APP_ID + VITE_API_BASE_URL already migrated).
- Two DB targets work: local Postgres (test) + Neon (prod) via DATABASE_URL switch.

## Effective TDD
- Mode: off (no existing project TDD config; user chose direct implementation).
  Ordinary functional checks apply: `tsc --noEmit` (typecheck) + `vitest run`
  (unit/integration tests written by us, not copied).
- Runner: vitest. Source of truth for runner: this doc (T1 will pin exact versions).

## Delivery strategy
- Strategy: ask-on-risk (default; no git remote yet, so no PRs this phase — recorded
  for when repo/remote exists).
- Forecast: far above 400 authored lines (full API). Will be sliced per task with
  work-unit boundaries in this doc when a remote exists.

## Progress / verification evidence

### T1 Scaffolding — DONE (2026-09-28)
Landed:
- `package.json`, `tsconfig.json`, `.env.example`, `node_modules` (90 packages,
  Node 22.21.1, npm 11.16.0).
- Folder layout completo: `src/{domain,application,infrastructure,interface}`,
  `src/container.ts` pendiente de contenido, mas `test/`.
- `drizzle.config.ts` (schema `./src/infrastructure/db/schema.ts`, out
  `./src/infrastructure/db/migrations`, dialect postgresql, casing snake_case).
- `vitest.config.ts` + `test/helpers/guard.ts` + `test/helpers/testDb.ts`.
- `test/helpers/testDb.test.ts` (4 tests).

Checks observados:
- `npm run typecheck` → exit 0.
- `npm run test` → 4 passed (1 file), exit 0.
- Guard probado en vivo, no solo compilado:
  - `DATABASE_URL=...neon.tech/neondb` → exit 1, se niega a correr.
  - `DATABASE_URL=...localhost:5432/rewallet_test` → exit 0, permitido.

### Decision: el guard de base de test es parte de T1, no de T14
`test/helpers/guard.ts` se escribio en T1 aunque T14 es la tarea de tests. Razon:
bestpath ya perdio datos reales una vez — la suite de integracion apunto a la
Neon de produccion y borro los usuarios `did:e2e:*` con cascada de wallets y
sesiones. Un guard destructivo sin test es un guard que no existe, y el primer
test que lo escribi se contradia solo y fallo. Era T1 o nunca.

Regla del guard: el NOMBRE de la base debe llevar un marker disposable
(`test`/`e2e`/`scratch`/`tmp`/`local`). El host de Neon NO descalifica, porque
una branch local de Neon es un target legitimo. Pero `neondb` — el nombre por
defecto de Neon, y el de la base de produccion que bestpath destruyo — NO lleva
marker y por lo tanto se rechaza. Esa asimetria es intencional.

## Next step

Reconciled against the code on 2026-09-29. The "Next step" line above used to
say T2, which had been done for two days: a stale pointer in a tracking document
is worse than none, because the next session reads it and believes it.

**The critical path is T6 and T7, and they are the same piece of work.** T5 minted
sessions; nothing can mint one. `src/application/auth/` and the custody code are
empty directories. Until a login exists there is no `users.id` that is not the
seeded row, no `provider_wallet_id` (the one wallet in the database has it NULL),
and every read that is scoped to a session is answering for a person who is not
there. T15 cannot be smoke-tested either, and it is the reason the realtime path
just shipped is correct but invisible: the client stands down because there is no
session to stand down with.

Then, in order: T9 payments, T13 contacts, T11 gas, the T10 accrual ledger, T15.

**What is NOT missing**, contrary to the checkboxes above this line: T3, T8, T12
and T14 are done, and T10 is half done on the read side with a real Aave rate.

## Rationale (meaningful accepted changes)
- (was decided) Backend owns all; bestpath structure rejected as lab-only.
- (was decided) Privy native login kept; recovery via linked accounts email/phone
  on `users` — the exact failure mode of bestpath, solved at schema level already.
- (T1) El guard de DB disposable seizo en T1, no T14: un mecanismo que impide
  borrar datos reales no puede esperar a la tarea de tests, y su propio test
  fallo al escribirse — lo que prueba que sin el no habriamos detectado nada.