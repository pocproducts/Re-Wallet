# Fase 1 — Cableado y deuda

**Feature**: `phase1-wiring`
**Status**: planificado — no iniciado
**Created**: 2026-09-27
**Predecesor**: `poc-frontend` (cerrado 2026-09-27, 9/9, paridad de DOM 12/12)
**Deadline de contexto**: Monad Metropolis, 2026-10-13
**Especificación del backend**: `deepseek_text_20260927_b29186.txt` ("Prompt Maestro —
Backend BestPath Wallet" v1.0). Es la autoridad para el esqueleto del backend: stack
obligatorio, 11 tablas de Drizzle, endpoints como stubs, env validadas con Zod, 7 pasos.

## Mapa de los 7 pasos del prompt maestro

| Paso | Qué | Bloqueado por |
|---|---|---|
| 1 | Monorepo base: root, pnpm-workspace, turbo, docker-compose, README | nada |
| 2 | `packages/shared`: tipos + constantes | nada |
| 3 | `packages/config`: env con Zod | nada |
| 4 | `apps/api`: Drizzle schema (11 tablas), client, seed, migración | nada |
| 5 | `apps/api`: app, lib (env/logger/errors/money), middleware | nada |
| 6 | `apps/api`: rutas stub `{ ok: true, data: null }` | paso 5 |
| 7 | `apps/api`: servicios stub que tiran `TODO` | paso 6 |

Los 7 pasos son esqueleto puro: **cero lógica de negocio**, y el propio prompt lo dice.
Está bien y conviene respetarlo, porque es la forma más barata de tener el repo
levantando y empezar a implementar features una por una después.

**Cuidado con una cosa que el prompt no dice**: *"Empezá por el PASO 1. No avances al
PASO 2 sin que el PASO 1 funcione end-to-end"* es una instrucción para un ejecutor, no un
plan de trabajo nuestro. Nosotros planificamos por *gates de producto*, no por pasos de
archivo.

---

## Objetivo

Que BestPath deje de ser un simulacro. La UI que ya existe y está verificada pasa a
hablar con un backend real, y la deuda que quedó documentada en la Fase 0 se cierra.

El entregable final de esta fase es el mismo número que el pitch promete: **el rendimiento
que muestra la pantalla viene de Aave, no de una constante**.

## Fuera de alcance

Nada de esto arranca sin autorización explícita:

- No hay git hasta que el usuario lo habilite (riesgo abierto: `/home/lordbitcoin`
  es raíz de un repo git con cero commits que stagearía el home entero con API keys)
- No hay deploy hasta la fase de publicación
- No se toca el diseño visual: la paridad de DOM es un activo, no algo a mejorar

---

## Conflictos entre documentos — resolver antes de escribir código

Aparecieron al integrar el prompt maestro del backend. No son tilted: son
contradicciones reales que, si se ignoran, se descubren a mitad de la implementación.

### C1. La custodia sigue rota, y ahora está *peor*

El prompt maestro reaffirma las dos mitades incompatibles y además **las horneó en el
schema**:

- Regla de producto: *"El usuario NUNCA ve frases semilla. Privy custodia la key."*
- Regla de producto: *"El rendimiento es pasivo. El backend deposita en Aave V3."*
- Schema: tabla `yield_positions` con `aave_atoken_bal` y `UNIQUE (wallet_id)`

Esa tabla asume que **el backend controla la posición** de Aave del usuario. Es la
opción B (custodio) escrita en SQL. Con embedded wallets de Privy el backend no tiene
las keys: no puede depositar en Aave en nombre del usuario sin que el usuario firme.

Decisión pendiente, y es la primera de la fase: **¿se cambia la regla de producto o se
cambia el schema?** Son las dos salidas honestas.

### C2. Testnet no puede mostrar yield

`MONAD_CHAIN_ID 10143` (testnet) es el valor por defecto del prompt. Pero **Aave V3.7
está live en Monad mainnet (143)**. En testnet no hay posición que produzca yield.

Consecuencia directa: si el demo corre en testnet, `annualYieldRate` **no puede** ser
real, y el yield — que es el producto — queda simulado. Si corremos en mainnet, hay que
manejar plata real.

O sea: **D2 no es una preferencia de demo, es la condición que decide si el objetivo
terminal de la fase es alcanzable.**

### C3. Dos caminos de gas sponsorship

El prompt maestro dice *"Pimlico lo patrocina"*. La documentación de Privy dice que su
propio motor de sponsorship cubre Monad y Monad Testnet. Son dos caminos distintos
(bundler+paymaster de AA vs sponsorship nativo de Privy).

Verifiqué que ambos existen. Hay que elegir uno y no improvisar en el video: si el gas lo
patrocina Privy, se dice Privy. Además Pimlico es un sponsor opcional, y la checklist de
bounties tiene a Privy explícitamente.

### C4. El link de cobro cambió de formato

- Documento maestro §3.6 y el frontend actual: `bestpath.app/pay/{tag}/{monto}`
- Prompt maestro: `bestpath.app/pay/{id}` con `payment_requests.id` = nanoid(10)

El formato con `{id}` es mejor: oculta el monto, permite expirar y auditar, y ya tiene
tabla. Pero **`src/screens/receive.ts` genera el formato viejo**. Hay que migrar el
frontend o los links del video no van a resolver.

### C5. `strict: true` vs lo que hicimos

El prompt exige *"TypeScript strict: true. Sin excepciones. No usar `any`"* para el
backend, y lo repite en notas finales. El frontend quedó en `strict: false`, con
justificación explícita y registrada (1.600 líneas de template strings).

No es necesariamente una contradicción: `apps/api` y `packages/shared` pueden ser
strict sin problema mientras el frontend sigue como está. Pero hay que decidirlo y
dejarlo escrito, porque en un monorepo con tipos compartidos la mezcla se va a notar.

### C6. `yield_accruals` no es idempotente por diseño

`UNIQUE (wallet_id, accrued_for_date)` más un job diario significa que una segunda
ejecución del accrual del mismo día choca. El prompt pide idempotencia en los POST de
dinero pero no habla del job diario. Hay que definirlo como upsert o el job falla al
segundo día.

### C7. Cambio de package manager

El prompt es pnpm + Turborepo. El frontend que construimos está en npm, con su
`node_modules` y su lock. Al moverlo a `apps/web` hay que reinstalar con pnpm.
Mecánico, pero que no sorprenda.

### C8. Chainlink sigue sin aparecer

Ni en el documento maestro ni en el prompt del backend. La checklist de submission lo
pide. Si el bounty importa, hay que construirlo y justificarlo explícitamente.

---

## Dónde encaja lo que ya construimos

Nada de la Fase 0 se pierde, pero hay un movimiento mecánico pendiente:

```
hoy:      ReWALLET/bestpath/            <- el proyecto Vite
destino:  ReWALLET/bestpath/apps/web/   <- apps/web del monorepo
```

Es un `mv` más un ajuste de rutas en `vite.config.ts` y en el import del smoke test.
`src/types.ts` pasa a ser la fuente de `packages/shared`: los tipos de dominio
(`Movement`, `Contact`, `AppState`, `Recipient`) ya están exactos y coinciden con lo que
el prompt pide en `packages/shared`. Esa parte no se tira, se promueve.

El namespace `BP` sobrevive al cambio de directorio, que es justo el motivo por el que
conservarlo fue la decisión correcta.

---

## El panorama: por qué el orden importa

La deuda que queda no son tres correcciones sueltas. Son tres señales de una misma
ausencia: **no hay backend**. Y cada una se resuelve en un punto distinto de la cadena.

```
   Privy/passkey
        │
        ▼
   Postgres + API        ──►  habilita A: locale, version 0.5
        │
        ▼
   ¿Dónde vive la key?   ◄──  DECISIÓN DEL USUARIO. Bloquea D y E.
        │
        ├──►  pagos en Monad  ──►  habilita la pantalla /pay/{id}
        │
        └──►  lectura de Aave  ──►  habilita E: annualYieldRate real
                                        (y requiere Chainlink para USD)
```

**`annualYieldRate` es el último eslabón, no el primero.** Cambiar `0.042` por `0.0565`
a mano sería mentira: la app mostraría un número que no puede sostener. Para que sea real
tiene que haber una posición real en Aave que le dé origen. Por eso el objetivo terminal
de esta fase es ese, y todo lo demás es el camino para alcanzarlo.

---

## Decisiones abiertas — necesitan al usuario, no las puedo tomar yo

### D1. Custodia: ¿dónde vive la key del usuario? — **DECIDIDA: Opción A**

**Decisión del usuario, 2026-09-27: custodia en el backend.** El backend es el custodio
de los fondos. Esta decisión cierra el conflicto C1 **a favor del schema**: la tabla
`yield_positions` con `aave_atoken_bal` por wallet ya asumía esta opción, así que no hay
que reescribir el modelo de datos.

**Qué significa concretamente (modelo de ledger agrupado, el que implican `wallets.balance`
y `movements`):**

- El usuario se autentica con Privy (passkey) → eso es **identidad**, no custodia.
- Los fondos viven en **wallets del backend** (EOA o smart account), no en la embedded
  wallet de Privy.
- `wallets.balance` es un saldo interno (ledger), no un on-chain balance.
- `movements` es el libro de movimientos de ese ledger.
- El backend firma el depósito a Aave, el accrual y los envíos.

**Consecuencias que hay que asumir explícitamente:**

1. **Privy deja de ser la custodia.** Pasa a ser solo el proveedor de passkey/identidad.
   Su embedded wallet ya no protege los fondos del usuario. La frase "Privy custodia la
   key" del documento maestro queda desactualizada respecto de la arquitectura real.

2. **El backend pasa a ser el objetivo más atractivo del sistema.** En un diseño no
   custodial, un backend comprometido solo puede leer datos. Acá, un backend comprometido
   = pérdida total de los fondos de todos los usuarios. Eso eleva el listón de seguridad
   a "operación financiera" y hace críticos puntos que antes eran secundarios:
   - gestión de claves del backend (HSM, o cifrado en reposo con acceso estricto)
   - `SESSION_SECRET` y el manejo de sesión/cookie: una fuga = toma de control de cuentas
   - toda ruta de retiro: autenticada, rate-limited y auditada
   - el `idempotency.ts` y la exactitud del ledger son **críticos**, no "nice to have"
     (los montos ya están como `numeric(20,6)`, nunca float — eso está bien y se mantiene)

3. **La promesa de producto hay que ponerla al día.** El marketing actual dice
   implícitamente que el dinero es del usuario. Con custodia A, un judge que lea "sin
   frases semilla" más una arquitectura custodial puede questioning. Vale la pena que el
   copy y la submission sean honestos sobre el modelo (ej: "custody institutional-style,
  Api key never exposed to the user").

4. **Regulatorio (recordatorio, no sermón).** Poolear USDC de terceros es transmisión de
   dinero en la mayoría de las jurisdicciones y trae obligaciones de KYC/AML. Con montos de
   prueba y fines de demo es un contexto diferente a recibir fondos reales de usuarios.
   Es una decisión consciente del usuario y queda registrada como tal.

### D2. ¿Testnet o mainnet para la demo?

**Esta decisión cambió de categoría.** El prompt maestro pone testnet por defecto, pero
Aave V3.7 solo está live en mainnet (143). En testnet no existe yield real.

| | testnet (10143) | mainnet (143) |
|---|---|---|
| Passkey / Privy | sí | sí |
| Enviar / recibir USDC | sí | sí |
| **Yield real de Aave** | **no** | sí |
| `annualYieldRate` real | **imposible** | sí |
| Riesgo de plata | ninguno | real |

Si elegimos testnet, aceptamos explícitamente que el yield del video es simulado y
`annualYieldRate` queda para otra fase. Si elegimos mainnet, el objetivo terminal de la
fase sigue vivo. No hay tercera opción.

### D3. ¿Los 7 días del chart son historia o proyección?

`yield-detail` muestra un chart de 7 días. El día 1 no hay 7 días de historia real.
¿Se graba desde el lanzamiento y el chart arranca vacío, o se muestra proyección y se
declara como tal en el video?

---

## Trabajo A — Deuda visible (independiente, riesgo bajo)

No necesita backend. Se puede hacer apenas se autorice. Ojo: **rompe la paridad de DOM**,
así que hay que hacerlo con cuidado y actualizar el test de paridad o retirarlo.

| # | Deuda | Dónde | Cambio |
|---|---|---|---|
| A1 | `config.version` dice `'0.4'`, doc dice v0.5 | `src/config.ts` | subir a `'0.5'` + migración `0.4 → 0.5` en `core/store.ts` |
| A2 | `locale: 'en-US'` con strings en español | `src/config.ts` | `es-AR`, y revisar que los montos salgan `$1.250,50` |
| A3 | `/pay/{tag}/{monto}` es un link que no existe | `src/screens/receive.ts` | decide: link real o marcarlo como próximo |

A2 es el que más se nota en un video: hoy muestra `$1,234.56` al lado de
"Saldo insuficiente".

---

## Trabajo B — El shell de API

`src/core/api.ts` es la única frontera con datos. Hoy es un mock con 4 métodos
(`addMoney`, `sendMoney`, `accrueYield`, `createPaymentRequest`).

Se reemplaza ese archivo y **nada más**. El contrato ya está especificado en §3.6 del
documento maestro: 18 endpoints, `Idempotency-Key` obligatorio en todo POST de dinero,
formato de error uniforme.

Es el momento de montar el monorepo del prompt maestro: `apps/web`, `apps/api`,
`packages/shared`, `packages/config`, más `packages/sdk` y `apps/contracts` (vacío).
Los pasos 1 a 7 del prompt maestro salen aquí, en este bloque.

**Criterio de éxito**: la app corre con `BP.api` apuntando a un backend vacío y las
pantallas siguen renderizando igual. El store deja de leer de `localStorage` y hidrata
desde la API.

---

## Trabajo C — Privy y passkey

Verificado contra docs oficiales antes de arrancar:

- ✅ Privy soporta Monad (docs de Privy, "Configuring EVM networks")
- ✅ Gas sponsorship de Privy cubre Monad y Monad Testnet
- ✅ `chainId: 143` mainnet, RPC `https://rpc.monad.xyz`; testnet `10143`

El overlay biométrico simulado (1.2s) pasa a invocar `navigator.credentials` real.
Sesión por cookie httpOnly. Gestión de dispositivos con revocación.

**Criterio de éxito**: passkey real en un teléfono. Si se prueba en desktop con
Touch ID/Windows Hello, hay que decirlo en el video porque el público va a asumir
móvil.

---

## Trabajo D — Pagos en Monad

- **Añadir dinero**: dirección de depósito + indexer que acredita al detectar
- **Enviar interno**: atómico en DB, instantáneo
- **Enviar externo**: firma + broadcast + webhook de confirmación
- **Idempotencia**: obligatoria, clave guardada 24h

El indexer es la parte que más se subestima. No es un endpoint: es un proceso que
escucha la chain, reconfirma por profundidad, y es idempotente ante reorg.

---

## Trabajo E — Yield en Aave  ← acá muere `annualYieldRate`

Este es el objetivo terminal de la fase.

Dos correcciones de partida, respecto de lo que dice el documento maestro:

1. **Aave V3.7, no V3.** El pool de Monad se activó como V3.7 (propuesta 501) con la
   lista de activos ampliada. Apuntar a V3 es apuntar a algo que ya no está.
2. **El modelo de accrual cambia.** Hoy el prototipo tickea cada 9s y suma
   `yieldPerTick: [0.008, 0.024]` a mano. Aave acumula de forma continua. La UI tiene
   que pasar de "sumar números" a "proyectar desde una tasa real". Es un cambio de
   modelo, no un cambio de constante.

De paso, el APY que apareció hardcodeado en el documento (5.65%) ya está viejo: al
momento de la verificación estaba entre **5.31% (DefiLlama) y 6.10% (Aavescan)**. Por
eso el número tiene que leerse de la chain en runtime, nunca del código.

**Criterio de éxito**: `src/config.ts` ya no tiene `annualYieldRate`, y el número que
la pantalla muestra se puede reconciliar con Aave a mano.

---

## Trabajo F — La pantalla pública `/pay/{id}`

Hoy `POST /wallet/request` genera una URL `bestpath.app/pay/{tag}/{monto}` que no
existe. El video demo tiene que mostrar "recibir", y esto es lo que lo hace real: un
link que abre un navegador sin sesión y paga.

No está en el plan de migración original. Falta.

---

## Trabajo G — Chainlink (bounty)

Está en la checklist de submission pero **no aparece en ninguna fase del plan**. Si se
quiere el bounty hay que construirlo explícitamente.

Justificación inevitable a preparar: Aave ya tiene su propio oracle, así que hay que
explicar qué aporta Chainlink. El ángulo honesto es **valorización en USD de un activo
whose precio no está en el oráculo de lending** — o usarlo como fallback/fuente de
reserva. Hay que definirlo antes de construir, no después.

---

## Mapa: deuda de la Fase 0 → dónde se cierra

| Deuda | Se cierra en | Bloqueada por |
|---|---|---|
| `config.version` `0.4` | A1 | nada |
| `locale: 'en-US'` | A2 | nada |
| `annualYieldRate: 0.042` | **E** | **D2 (mainnet)** + D1 (ya decidida) → B → D → E |
| `/pay/{id}` inexistente | F | B, D |
| Chainlink ausente | G | B |
| `.git` del home | fuera del repo | decisión del usuario |

---

## Criterios de aceptación de la fase

1. La app funciona con el backend real y no con el mock
2. `annualYieldRate` eliminado de la configuración; la tasa viene de la chain
3. Un usuario real se registra con passkey y mueve USDC
4. Un link `/pay/{id}` funciona sin sesión
5. Cero regresiones de paridad en lo que no cambió a propósito
6. Las decisiones D1, D2 y D3 están tomadas y escritas, no implícitas en el código

---

## Pendiente para más adelante: script de despliegue

El usuario decidió (2026-09-27) dejar el arranque local armado y ordenado
(`bestpath/dev.sh`, con `up`/`setup`/`down`/`reset`/`check`) y **desarrollar el
script de despliegue solo cuando sea necesario**, no antes.

 groundwork ya existente:
- `apps/api/Dockerfile` multi-stage con pnpm
- `.env.example` con las variables de producción, y `env.ts` que rechaza
  `COOKIE_SECURE=false` cuando `NODE_ENV=production`
- migraciones de Drizzle versionadas en `src/db/migrations/`

Objetivo del futuro `deploy.sh`: reconstruir contenedores para API en Fly.io,
web en Vercel, Postgres en Neon, y correr migraciones contra la base remota.

**Orden deliberado:** cerrar D2 (testnet vs mainnet) y arrancar el cableado antes
que tocar infraestructura. Con 15 días, la infra es lo último que se toca.

## Riesgos abiertos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| D1 (custodia A) — compromiso de backend = pérdida total | vulneración de sesión/clave | HSM/cifrado, sesiones auditadas, ledger idempotente |
| D2 (testnet) por descuido | el yield queda simulado sin avisar | decidir explícitamente antes del paso 1 |
| `.git` del home | stageo del home con API keys | no commitear nada hasta resolver |
| Mainnet con fondos reales | pérdida de plata en un bug | montos chicos, montos de prueba, límites por usuario |
| El indexer se subestima | deposits que no acreditan | idempotencia + reconfirmación por profundidad desde el día 1 |
| 15 días contra un plan de 5-6 semanas | entrega incompleta | priorizar por la checklist de submission, no por el plan |
