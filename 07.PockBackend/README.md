# ReWALLET — Backend

Hono sobre Cloudflare Workers. Arquitectura hexagonal, con los puertos
definidos en `domain/` y los adapters en `infrastructure/`.

El Worker sirve **el API y el front desde un solo origen**. No es una comodidad:
la sesión es una cookie `httpOnly` con prefijo `__Host-`, y con dos orígenes
esa cookie tiene que volverse cross-site. Un origen evita de entrada un par de
cambios de seguridad.

## Scripts

```bash
npm install
npm run dev        # wrangler dev
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # bundle a dist-worker.js
npm run deploy     # wrangler deploy
```

## Configuración

Se lee de variables de entorno. Los secretos **no** están en `wrangler.jsonc`
y tampoco en el repo:

```bash
wrangler secret put PRIVY_APP_ID
wrangler secret put PRIVY_APP_SECRET
wrangler secret put DATABASE_URL
wrangler secret put SESSION_SECRET
wrangler secret put UNISWAP_API_KEY
```

`UNISWAP_API_KEY` es la del Trading API de Uniswap. Sin ella el swap no cotiza y
responde `RPC_UNAVAILABLE` — que es "no pude preguntar", no "no hay mercado".

## La regla de este proyecto

**Si no se pudo leer, se dice que no se pudo leer.** Nunca se sustituye una
lectura ausente por un `0`. Un `0` afirma que la persona no tiene esa plata, y
casi siempre sería mentira.

Eso se traduce en tipos: los campos que pueden no leerse son `null` o
`unreadable`, nunca `0`. Un número que no se pudo leer no tiene un valor que
mostrar.

## Estructura

```
src/
├── domain/            ← qué significa cada cosa. Sin I/O.
│   ├── ports/         ← interfaces: SwapProvider, MovementStore, PolicyStore
│   ├── portfolio/     ← networks, assets, valuation
│   ├── deposit/       ← el catálogo: qué activo existe en qué red
│   ├── swap/          ← reglas de Uniswap, fee tiers
│   └── yield/         ← Aave y Kamino
├── application/       ← casos de uso. Orquestran, no calculan.
│   ├── portfolio/     ← readWalletBalance, readDigitalDollars
│   ├── send/          ← prepareSend
│   ├── swap/          ← swapUseCase
│   ├── policy/        ← las tres reglas de gasto
│   └── payment-requests/
├── infrastructure/    ← adapters: RPC, Postgres, Privy, HTTP
├── interface/http/    ← rutas Hono
└── container.ts       ← wiring de dependencias
test/                  ← sin red y sin base
sql/                   ← migraciones, en orden
```

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/portfolio` | balances por cadena y activo |
| `GET` | `/api/wallet-balance` | el número único, con su desglose y su estado |
| `GET` | `/api/deposit-info` | catálogo y direcciones de depósito |
| `GET` | `/api/pool` | posición en Aave y APR |
| `POST` | `/api/send` | prepara una transferencia sin firmar |
| `POST` | `/api/pool/deposit` | prepara un depósito |
| `GET` | `/api/wallet/swap/pairs` | pares que el swap resuelve |
| `POST` | `/api/wallet/swap/quote` | cotiza una conversión |
| `POST` | `/api/wallet/policy/evaluate` | veredicto de la política de gasto |
| `POST` | `/api/payment-requests` | crea un link de cobro |

## Tests

Toda la suite corre **sin red y sin base de datos**. No es una comodidad: es
lo que permite ejercitar el flujo completo de sesión, los lectores y los
stores inyectando dobles.

Un test que necesita que la RPC esté arriba es un test que solo corre el día
que la RPC está arriba. Lo que la red puede confirmar se verifica una vez a
mano y el resultado queda escrito en el docstring del módulo.