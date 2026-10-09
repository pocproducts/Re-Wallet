# ReWALLET

> Una billetera que no miente: el balance real, el rendimiento real, y cuando
> algo no se pudo leer, lo dice.

Para gente que no usa cripto. Deposita dólares digitales, su dinero rinde solo,
y envía a una persona — no a una dirección hexadecimal.

---

## Qué es

Una billetera multi-chain (EVM + Solana) donde **cada número viene de la
cadena**. No hay tabla de precios escrita a mano, no hay saldo estimado, no
hay promedio que parece una tasa.

La regla que la sostiene:

> **Si no se pudo leer, se dice que no se pudo leer.** Nunca se sustituye una
> lectura ausente por un `0`.

Un `0` afirma que la persona no tiene esa plata. Casi siempre sería mentira.

## Qué hace hoy

| | |
|---|---|
| **Balance compuesto** | Crypto libre + dólares digitales + posiciones invertidas, con el estado de lectura de cada parte |
| **Rendimiento** | Aave V3 en Monad, Kamino en Solana. APR ponderado por posición real, no promedio simple |
| **Envío** | A un tag (`@nombre`) o a una dirección, con idempotencia para que un doble toque no mande dos veces |
| **Política de gasto** | Tres reglas antes de firmar: magnitud, ritmo por hora, destino nuevo |
| **Conversión** | Cotización real vía Uniswap Trading API en Monad |
| **Links de cobro** | Pedir un monto, compartir el link, que lo paguen sin instalar nada |

**Cadenas:** Monad · Ethereum · Base · Arbitrum · Optimism · Polygon · Solana

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + Tailwind |
| Backend | Hono + Cloudflare Workers |
| Base de datos | Neon Postgres |
| Auth + Wallets | Privy (EVM + Solana) |
| Rendimiento | Aave V3 (Monad) · Kamino (Solana) |
| Oráculos | Chainlink |
| Conversión | Uniswap Trading API |

## Estructura

07.PockBackend/   Backend — Hono, arquitectura hexagonal
05. UI-UX/       Frontend — React, Vite, Tailwind

04. Landing Page/   Landing page (marketing, ciclo de vida aparte)

docs/
├── contratos/   Las reglas de diseño que no se rompen
├── decisiones/   Hallazgos verificados, con cómo se comprobaron
└── 03. Auditorias/   Revisiones técnicas

tasks/          Roadmap operativo y tareas
02. Contexto iniciar del proyecto/       Borradores del diseño

## Cómo correr

```bash
# Backend
cd 07.PockBackend
npm install
npm run dev

# Frontend
cd 05. UI-UX
npm install
npm run dev
```

El Worker sirve el API y el front desde **un solo origen**. No es una
comodidad: la sesión es una cookie `httpOnly` con prefijo `__Host-`, y con dos
orígenes esa cookie tendría que volverse cross-site.

Secretos: no están en el repo.

```bash
cd 07.PockBackend
wrangler secret put PRIVY_APP_ID
wrangler secret put PRIVY_APP_SECRET
wrangler secret put DATABASE_URL
wrangler secret put SESSION_SECRET
wrangler secret put UNISWAP_API_KEY
```

## Tests

```bash
cd 07.PockBackend && npm test    # backend
cd 05. UI-UX && npm test    # frontend
```

Toda la suite corre **sin red y sin base de datos**. No es una comodidad: es lo
que permite ejercitar el flujo completo de sesión, los lectores de cadena y los
stores inyectando dobles. Un test que necesita que la RPC esté arriba es un test
que solo corre el día que la RPC está arriba.

## Estado

Beta privada. El producto está detrás de sesión y las operaciones que mueven
dinero reales se firman contra wallets de prueba.

Dos cosas que **no** existen todavía, y que conviene que el repo no aparente
lo contrario:

- La conversión **cotiza** pero no ejecuta. Hacen falta dos firmas —Permit2 y
  la transacción— y un botón que dijera "comprar" sin ellas sería un botón que
  miente.
- La política de gasto **evalúa y corta**; el historial de decisiones es
  consultable por endpoint, todavía no tiene pantalla.

## Licencia

Privado — ReWALLET. Ver [`LICENSE`](LICENSE).