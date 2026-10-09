# ReWALLET — Multi-Chain Smart Wallet

> **Una billetera que no miente: balance real, rendimiento real, sin inventar números.**

---

## 🎯 Visión General

ReWALLET es una billetera multi-chain (EVM + Solana) que muestra **exactamente lo que tenés**, no lo que un backend inventa. Cada número viene de la cadena, con su procedencia y su estado de lectura.

### Principios Fundamentales

| Principio | Qué Significa |
|-----------|---------------|
| **Cero inventado** | Si no se pudo leer, se dice "no pudimos leerlo", no se muestra 0 |
| **Una sola fuente** | Balance = cryptoValue + digitalDollarsValue (calculado en backend) |
| **Rendimiento honesto** | Media ponderada real, no promedio simple. Si falta un venue, no hay tasa combinada |
| **USD only** | Sin conversiones inventadas. Solo dólares, la unidad en que el backend mide todo |
| **Tu dirección, tu plata** | Cada depósito usa TU dirección en ESA cadena. Nunca la de otro |

---

## 🏗 Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (05. UI-UX)                     │
│  React + Vite + Tailwind  →  Cloudflare Pages / Worker Assets  │
│  - WalletView, InvestmentsView, CryptoAssetDetailModal         │
│  - PriceChart (SVG, tooltip hover, CoinGecko)                  │
│  - Hooks: useWalletBalance, usePriceHistory, useAssetTrade     │
└─────────────────────────────────────────────────────────────────┘
                              │
                    HTTPS (same origin, httpOnly cookie)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (07.PockBackend)                 │
│  Hono + Cloudflare Workers  →  app-dev.rewallet.win            │
│  - GET /api/wallet-balance     →  balance compuesto real       │
│  - GET /api/portfolio          →  balances por cadena/asset    │
│  - GET /api/pool               →  posición Aave + APR          │
│  - GET /api/deposit-info       →  catálogo real de depósitos   │
│  - POST /api/pool/deposit      →  prepare deposit (Aave/Kamino)│
│  - POST /api/send              →  prepare transfer             │
│  - Webhooks (Privy)            →  claim wallets, notificaciones│
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │  Monad   │    │ Ethereum │    │  Solana  │
        │  RPC     │    │  RPCs    │    │  RPC     │
        │ (Alchemy)│    │ (Alchemy)│    │ (Alchemy)│
        └──────────┘    └──────────┘    └──────────┘
              │               │               │
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Chainlink│    │  Aave V3 │    │ Kamino   │
        │  Feeds   │    │  Pool    │    │  Earn    │
        └──────────┘    └──────────┘    └──────────┘
```

---

## 📦 Estructura del Proyecto

```
ReWALLET/
├── 03. Auditorias/              # Auditorías técnicas y MVP
├── 04. Landing Page/            # Next.js landing (marketing)
├── 05. UI-UX/                   # FRONTEND — React + Vite + Tailwind
│   ├── src/
│   │   ├── components/          # UI components (Wallet, Investments, Yield)
│   │   ├── config/              # Assets, chains, displayCurrency, markets
│   │   ├── hooks/               # useWalletBalance, usePriceHistory, useAssetTrade...
│   │   ├── services/            # coinGecko, walletBalance, portfolio, api
│   │   ├── types/               # TypeScript types (walletBalance, portfolio, etc.)
│   │   └── App.tsx
│   └── odd/tasks/               # ODD task documents (CoinGecko, balance, etc.)
├── 07.PockBackend/              # BACKEND — Hono + Cloudflare Workers
│   ├── src/
│   │   ├── application/         # Use cases (readWalletBalance, readPortfolio, readPool...)
│   │   ├── domain/              # Core logic (valuation, combinedYield, chains, assets)
│   │   ├── infrastructure/      # RPC adapters (Alchemy, Chainlink, Solana, Kamino)
│   │   ├── interface/http/      # Hono routes (wallet-balance, portfolio, pool...)
│   │   └── container.ts         # Dependency wiring
│   └── test/                    # Unit + integration tests (700+)
├── docs/                        # Contratos: dinero, identidad, interfaz, núcleo
├── odd/                         # ODD roadmap & tasks
│   ├── roadmap.md
│   └── tasks/                   # 40+ task documents
├── .atl/                        # Skill registry (Gentle AI)
└── .github/workflows/           # CI/CD
```

---

## 🔑 Features Implementadas

### ✅ Balance Real (`GET /api/wallet-balance`)
- **3 buckets**: `cryptoValue` (MON, ETH, SOL, BTC), `digitalDollarsValue` (USDC/USDT free + pool), `investedValue` (pool positions = vista, no tercer término)
- **Precios**: Chainlink en Monad (MON, ETH, SOL, BTC) — *peg $1 para stablecoins*
- **Completitud**: `complete: true/false` + `incompletenessNote` nombrando qué falló
- **Nunca 0 inventado**: `unreadable` ≠ `0`. Un 0 real es `ok` con `raw: "0"`

### ✅ Portfolio Multi-Chain (`GET /api/portfolio`)
- 7 cadenas: Monad, Ethereum, Base, Arbitrum, Optimism, Polygon, Solana
- EVM: `eth_getBalance` + `eth_call balanceOf` (USDC/USDT por contrato verificado)
- Solana: `getBalance` (lamports) + `getTokenAccountsByOwner` (SPL USDC)
- Por asset: `ok` con cantidad exacta | `unreadable` con razón acotada

### ✅ Pool Aave V3 Monad (`GET /api/pool`)
- Posición `aMonUSDC` (aToken balance) valuada al peg
- Supply APR reconciliado: `borrow × utilisation × (1 - reserveFactor)`
- `availableUsdc` + `gasBalance` leídos pero **no sumados** (evita double-count)

### ✅ Kamino Earn Solana
- Vault shares × share price (Kamino API)
- APY publicado por Kamino
- Deposit readiness: `not_ready` con motivo (`DEPOSIT_INSTRUCTIONS_UNVERIFIED`)

### ✅ Deposit Info (`GET /api/deposit-info`)
- Catálogo servido por backend (no frontend): qué se puede depositar, en qué red, con qué dirección
- Por asset: `balanceReadable` + dirección real de la persona en esa red

### ✅ CoinGecko Metrics (Frontend)
- `usePriceHistory(ticker, timeframe)` → historial + market data (precio, 24h change, market cap)
- `PriceChart` SVG: tooltip on hover (precio + fecha), línea suave, área, sin labels Y
- Timeframes: 24H, 7D, 1M, 1A, MAX
- Assets: BTC, ETH, SOL, MON, POL, TRX, DOGE (USDC/USDT = mock $1)

### ✅ Auth & Wallets (Privy)
- Embedded wallets (EVM + Solana)
- `claimWalletsFor`: verifica ownership en Privy antes de escribir en BD
- Session JWT httpOnly SameSite=Lax cookie

### ✅ Send & Payments
- `prepareSend`: EVM (ERC20/native) + Solana (SPL/native) con idempotency
- `createPaymentRequest` / `payPaymentRequest`: cobrar via link

---

## 🎨 UI/UX — Patrones de Diseño

| Patrón | Implementación |
|--------|----------------|
| **Container/Presentational** | Hooks leen datos, componentes solo pintan |
| **Optimistic UI** | Balance se lee una vez por sesión, `reload()` manual |
| **Estados honestos** | Loading → Ready (complete/partial) → Error. Nunca "cargando para siempre" |
| **Zero-invented** | Gráfico: "Todavía no hay gráfico" si no hay datos. Precio: "—" si no hay feed |
| **Timeframe selector** | 24H/7D/1M/1A/MAX recarga datos reales |
| **Hover tooltip** | Precio + fecha exacta al pasar mouse por gráfico |

---

## 🔐 Seguridad & Confiabilidad

- **Same-origin**: Frontend + API en mismo Worker → cookie `__Host-` httpOnly
- **Idempotency**: Send/deposit usan claves idempotentes (evita double-spend)
- **Rate limits**: RPC calls con timeout 3-5s, fallback endpoints
- **Caché**: CoinGecko 60s (history) / 30s (market data) en memoria
- **Tests**: 700+ unit/integration tests, sin red (adapters injected)

---

## 🚀 Deploy

### Backend (Cloudflare Workers)
```bash
cd 07.PockBackend
wrangler secret put ETHEREUM_RPC_URL      # https://eth-mainnet.g.alchemy.com/v2/KEY
wrangler secret put BASE_RPC_URL          # https://base-mainnet.g.alchemy.com/v2/KEY
wrangler secret put ARBITRUM_RPC_URL      # https://arb-mainnet.g.alchemy.com/v2/KEY
wrangler secret put OPTIMISM_RPC_URL      # https://opt-mainnet.g.alchemy.com/v2/KEY
wrangler secret put POLYGON_RPC_URL       # https://polygon-mainnet.g.alchemy.com/v2/KEY
wrangler secret put SOLANA_RPC_URL        # https://solana-mainnet.g.alchemy.com/v2/KEY
wrangler secret put MONAD_POOL_RPC_URL    # https://rpc.monad.xyz
wrangler deploy
```

### Frontend (Cloudflare Pages / Worker Assets)
```bash
cd 05.UI-UX
npm run build
wrangler deploy
```

### Variables de Entorno Requeridas (Backend)
| Variable | Descripción |
|----------|-------------|
| `PRIVY_APP_ID` | Privy App ID |
| `PRIVY_APP_SECRET` | Privy App Secret |
| `PRIVY_WEBHOOK_SIGNING_SECRET` | Para validar webhooks |
| `DATABASE_URL` | Postgres (Neon) |
| `SESSION_SECRET` | JWT signing |
| `ETHEREUM_RPC_URL` | Alchemy Ethereum Mainnet |
| `BASE_RPC_URL` | Alchemy Base Mainnet |
| `ARBITRUM_RPC_URL` | Alchemy Arbitrum Mainnet |
| `OPTIMISM_RPC_URL` | Alchemy Optimism Mainnet |
| `POLYGON_RPC_URL` | Alchemy Polygon Mainnet |
| `SOLANA_RPC_URL` | Alchemy Solana Mainnet |
| `MONAD_POOL_RPC_URL` | Monad RPC (para Aave) |

---

## 🧪 Testing

```bash
# Backend
cd 07.PockBackend
npm test          # 700+ tests (vitest)

# Frontend
cd 05.UI-UX
npm test          # vitest (services, components)
npm run build     # Vite build check
```

---

## 📋 Roadmap (ODD Tasks)

| Estado | Task | Descripción |
|--------|------|-------------|
| ✅ Done | `balance-onchain-y-wallet-visible` | Balance real on-chain + wallet visible |
| ✅ Done | `datos-reales-monad-aave` | Aave V3 Monad real data |
| ✅ Done | `catalogo-evm-cuatro-redes` | Base, Arbitrum, Optimism, Polygon |
| ✅ Done | `solana-kamino` | Kamino Earn integration |
| ✅ Done | `coingecko-metrics-integration` | Gráficos + métricas reales |
| 🔄 In Progress | `comprar-o-vender` | Motor de swap (1inch/Jupiter) |
| ⏳ Pending | `enviar-solana` | Send Solana SPL/native |
| ⏳ Pending | `pagar-enviar` | Payment requests flow |
| ⏳ Pending | `multi-chain-wallets` | Wallets por cadena (no solo EVM+Solana) |

Ver [`odd/roadmap.md`](odd/roadmap.md) y [`odd/tasks/`](odd/tasks/) para detalle completo.

---

## 📚 Contratos de Diseño (Docs)

| Documento | Qué Define |
|-----------|------------|
| [`docs/contrato-dinero.md`](docs/contrato-dinero.md) | Balance buckets, valuation, completeness, no double-count |
| [`docs/contrato-identidad.md`](docs/contrato-identidad.md) | Auth, wallets, sessions, claim flow |
| [`docs/contrato-interfaz.md`](docs/contrato-interfaz.md) | UI patterns, honest states, zero-invented |
| [`docs/contrato-nucleo.md`](docs/contrato-nucleo.md) | Arquitectura, dependency rule, testing strategy |

---

## 🤝 Contribuir

1. Lee los contratos en `docs/`
2. Cada feature = ODD task en `odd/tasks/`
3. Tests obligatorios (backend: vitest, frontend: vitest)
4. No inventes números: si no hay dato, estado `unreadable`
5. PRs pequeños, descriptivos, con tests

---

## 📄 Licencia

Proyecto privado — ReWALLET team.

---

> **"No es que no tengas: es que no lo supimos leer."** — *Error honesto > mentira cómoda*