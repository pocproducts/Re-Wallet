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
| **Envío** | A un tag (`@nombre`) o a una dirección. Es una **transacción on-chain**: la firma el navegador, paga comisión de red y tarda lo que tarde la cadena. Con idempotencia, para que un doble toque no mande dos veces |
| **Política de gasto** | Tres reglas antes de firmar: magnitud, ritmo por hora, destino nuevo |
| **Conversión** | Cotización real vía Uniswap Trading API en Monad |
| **Cobrar** | Elegís en qué se cobra → el importe → QR y link. El link lleva la identidad de ReWALLET y vence en 24 horas |

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

qr-probe/         Página de prueba de QR (worker de diagnóstico)

docs/
├── contratos/   Las reglas de diseño que no se rompen
├── decisiones/   Hallazgos verificados, con cómo se comprobaron
└── 03. Auditorias/   Revisiones técnicas

odd/tasks/        Documentos de trabajo en curso: qué se decidió y por qué
tasks/            Roadmap operativo y tareas
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
cd 07.PockBackend && npm test    # backend — 921 tests
cd 05. UI-UX && npm test          # frontend — 224 tests
```

Toda la suite corre **sin red y sin base de datos**. No es una comodidad: es lo
que permite ejercitar el flujo completo de sesión, los lectores de cadena y los
stores inyectando dobles. Un test que necesita que la RPC esté arriba es un test
que solo corre el día que la RPC está arriba.

Hay dos proyectos de test en el front, con reglas distintas y declaradas en
`vitest.config.ts`:

| Proyecto | Qué entra | Entorno |
|---|---|---|
| `servicios` | `test/**/*.test.ts` — lógica pura, normalizadores, aritmética | `node` |
| `hooks` | `src/**/__tests__/**/*.test.ts` — lo que monta React | `jsdom` |

Dos de ellos vigilan cosas que antes no existían y que ya se rompieron una vez
cada una:

- `qrSvgPath.test.ts` — que el atributo `d` del QR sea un path válido. Estuvo
  roto dos veces: una con una transformación metida dentro del `d`, que el
  navegador descarta entero, y otra dibujando los módulos apagados.
- `transferPromises.test.ts` — que ningún texto visible prometa envío gratis o
  instantáneo. Hoy el envío paga comisión de red y tarda lo que tarde la cadena,
  y un copy que diga otra cosa es una promesa rota.

## Despliegue

Un solo Worker sirve la API y el front, en dos dominios:

| Dominio | Worker |
|---|---|
| `app.rewallet.win` | `rewallet-poc-api` |
| `beta.rewallet.win` | `rewallet-poc-api` |

```bash
cd "05. UI-UX" && npm run build     # el front viaja DENTRO del worker del backend
cd 07.PockBackend && npm run build && npx wrangler deploy
```

**El deploy se hace desde `07.PockBackend`, nunca desde `05. UI-UX`.** El
`wrangler.jsonc` del front declara un Worker propio que compite por el mismo
dominio, y ya pasó una vez: le ganó la ruta al backend y `/api/auth/session`
devolvió 404 en vez de 401, que es el login muerto.

El síntoma es inconfundible: **`404` en `/api/auth/session` significa que otro
Worker ganó la ruta.** `401` es lo correcto —API viva, sin sesión.

`test.rewallet.win` es un Worker de diagnóstico con `qr-probe/`: una página con
el QR real de la app, usada para separar "el QR está roto" de "el código no llega
a tu pantalla". La página se genera —no se edita a mano— porque importa el encoder
del proyecto:

```bash
cd "05. UI-UX" && npx tsx scripts/generar-qr-probe.mjs
cd ../../qr-probe && npx wrangler deploy
```

## Estado

Beta privada, en `app.rewallet.win`. El producto está detrás de sesión.

### Lo que no existe todavía

Cosas que el repo **no** debe aparentar lo contrario:

- **La conversión cotiza contra Uniswap, pero no ejecuta.** Hacen falta dos
  firmas —Permit2 y la transacción—. Y sólo ofrece los pares que están
  configurados en `dexRegistry`: un par que no está configurado se dice que no
  se soporta. Antes recitaba una lista escrita a mano, con `USDT` donde el
  registro declara `USDT0` y un `routerAddress` que era `'0x...'`, o sea un
  botón que miente con forma de lista.
- **La política de gasto evalúa y corta**, pero el historial de decisiones es
  consultable por endpoint y todavía no tiene pantalla.
- **El envío interno entre cuentas ReWALLET no existe.** La opción "A otra cuenta
  ReWALLET" está deshabilitada y lo dice: *"Enviar a un $ReTag todavía no está
  disponible"*. Es un stub honesto, y conviene que siga siéndolo.
- **No hay liquidación interna.** El envío por `@tag` mueve una transacción
  on-chain como cualquier otro: paga comisión de red y tarda lo que tarde la
  cadena.

### Lo que está decidido y documentado, pero sin implementar

**Envío con liquidación interna.** El producto decidió que el envío por ReWALLET
mueve plata por dentro y liquida contra la cadena agrupado, para que "sin
comisión e instantáneo" sean hechos y no promesas. El diseño está completo y la
decisión de riesgo está tomada —ante un fallo del batch, **se difiere**— en
[`odd/tasks/modelo-de-saldo-liquidez-interna.md`](odd/tasks/modelo-de-saldo-liquidez-interna.md).

El modelo tiene dos saldos, no uno: **total** (lo que la persona siente que tiene)
y **disponible** (lo que puede mover a la cadena ahora), con un solo invariante
—`disponible ≤ saldo real en la cadena`— que es el número que impide inventar
plata.

Hasta que eso exista, el copy de comisión e inmediatez se sacó de las pantallas, y
un test lo verifica. Ver [`odd/tasks/copy-honesto.md`](odd/tasks/copy-honesto.md).

## Licencia

Privado — ReWALLET. Ver [`LICENSE`](LICENSE).