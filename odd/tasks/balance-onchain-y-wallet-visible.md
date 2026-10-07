# Balance on-chain y wallet visible

**Feature**: `balance-onchain-y-wallet-visible`
**Estado**: 8 de 8 tareas cerradas. Pendiente de despliegue y de la transferencia de fondos.
**Fecha**: 2026-09-27
**Rama**: `fix/passkey-register`

---

## Por qué existe

El usuario 1 se registró con passkey y la alta funcionó de punta a punta, pero
en la app no ve ni su wallet ni su saldo. Son dos ausencias distintas, con dos
causas distintas, y por eso van en la misma feature y en tareas separadas.

| # | Lo que falta | Causa | Tarea |
|---|---|---|---|
| 1 | El perfil no muestra la dirección | `walletAddress` nunca se hidrata desde auth | 1 |
| 2 | El perfil muestra `$0` siempre | Nada escribe `wallets.balance` | 2, 3, 4 |

El orden importa: la tarea 1 es independiente y desbloquea ver la dirección sin
esperar a la cadena on-chain. Las tareas 2 a 4 construyen la lectura on-chain.

## Tareas

### T1 — `walletAddress` llega al store — HECHA

`toStorePatch` (`apps/web/src/wire/session-envelope.ts`) mapeaba `userName`,
`firstName`, `lastName`, `bpTag`, `balance`, `hasReceivedFunds`,
`yieldStartedAt` — y **no** `walletAddress`. Lo mismo `toWalletPatch`
(`apps/web/src/wire/wallet.ts`). El único que lo escribía era
`toPositionPatch`, o sea que la wallet solo aparecía si el usuario tenía una
posición de Aave.

Sin esto, `settings.ts:50` cae siempre en `'Se genera al crear tu cuenta'`.

**Lo que encontró el trabajo**: eran **tres** proyecciones, no dos.
`toSessionPatch` (`wallet.ts`, la del reload) era una tercera copia literal de
la misma lista de campos, y tampoco tenía la dirección. Agregarle la línea a
las dos primeras habría dejado la tercera rota y el bug vivo. Ahora
`toSessionPatch` **delega** en `toStorePatch`: una sola proyección de sesión a
store, que es lo que el comentario viejo decía pero no tenía.

`SESSION_OWNED_FIELDS` es `['session']` solamente, así que la dirección no está
prohibida: es pública por construcción (se imprime en un explorador) y no es una
credencial.

Verificado: 209/209 en `bestpath-wallet`, `tsc --noEmit` limpio. Un test de
`@bestpath/api` (`wallet.test.ts`, paginación de movements) falla por **timeout
de 5s**; verificado con `git stash` que ya fallaba en el árbol limpio, o sea
que es preexistente y no de este cambio.

### T2 — `monad.ts` real

Hoy es `export const TODO_MONAD = true`. Se implementa el acceso a Monad con
**`viem`**, que ya es dependencia, para no escribir encoding ERC-20 a mano.
`viem` ya está en `apps/api/package.json` (`^2.56.9`).

Criterio: `usdcBalanceOf(address)` devuelve el saldo en USDC como string de
6 decimales — **string**, no `number`, por la regla de `numeric(20,6)` del
proyecto.

### T3 — Espejo del saldo, con `firstFundsAt` que no se resetea

`wallets.balance` es un **espejo de la realidad**: se reconcilia leyendo la
cadena. Es idempotente por naturaleza — correr dos veces da lo mismo.

`first_funds_at` se escribe **una sola vez** (`coalesce` / "set once, never
reset" del schema): es un estado, no un balance, y de él depende el énfasis de
"Recibir" para un usuario nuevo. Si se resetea al bajar a cero, se re-onboardea
al usuario.

Criterio: el saldo de la fila sigue a la cadena, y un usuario que gastó todo
conserva `first_funds_at`.

### T7 — El login trabado — HECHA

La cadena real que dejó al usuario sin poder entrar:

1. `flow/index.ts` ruteaba el logout según `s.onboardingComplete`, una bandera
   que vive en el navegador y es `false` para cualquiera cuyo guardado de perfil
   falló. `false` mandaba a `welcome`.
2. `welcome.ts` es la pantalla de “sos nuevo” y su botón principal lleva
   `data-mode="onboarding"` → ceremonia de REGISTRO.
3. `signupWithPasskey` no puede registrar una passkey que ya existe.

La cuenta estaba bien y la passkey funcionaba; la app ofrecía crear una cuenta
nueva. Ahora:

- El logout va **siempre** a `passkey` con `mode:'login'`. Cerrar sesión implica
  que hay cuenta: la passkey es lo que lo hizo entrar. “¿Soy nuevo?” no es una
  pregunta que el logout pueda responder.
- `passkey.ts` defultea `login` en vez de `onboarding`. El default anterior
  convertía en “registrar” toda navegación que olvidara nombrar su ceremonia, y
  el default inocuo es el único que puede fallar.
- El copy del error sigue la ceremonia: quien apretó “Empezar” y falla recibe
  “si ya tenías una, entrá con tu passkey”.

### T8 — El perfil contra la API — HECHA

`save-profile` escribía cuatro campos en el store local y nada más. El nombre y
el tag vivían solo en el `localStorage` del teléfono.

- `apps/web/src/wire/profile.ts`: `saveProfileName` y `saveRecovery`, con el tag
  que vuelve del **servidor**, no el que se adivinó en el cliente. El servidor
  puede agregar un sufijo si el handle derivado está tomado; un cliente que
  conserva su guess muestra un tag ajeno.
- `requestJson` de `wire/wallet.ts` pasó a ser el transporte único con método y
  body, en vez de crear una tercera copia del fetch y del sobre de respuesta.
- `PATCH /me/recovery` **dejó de ser un stub**: ahora escribe, rechaza el body
  vacío con `validation_failed`, y no toca las columnas que el body no menciona
  (un `Object.assign` del body borraba el teléfono cuando se cambiaba el email).
- `onboardingComplete` solo se lacha cuando el backend confirmó. Es la bandera
  que el logout confiaba, así que confirmarla en un guardado fallido es
  justamente lo que rompe el login.

Agregar `[triggers] crons` a `wrangler.toml` y el handler `scheduled` en
`src/worker.ts`. El cron mantiene el ledger al día; el pedido de lectura **no**
escribe en la base.

## Fuera de alcance (y por qué)

- **Movimientos (`movements`).** `movements` es una **historia de eventos**: cada
  fila necesita un `txHash` real. Un sync por diferencia de balance *fabrica*
  movimientos y, ante un fallo a mitad de camino, **credita dos veces**. Es tarea
  aparte, con fuente de eventos e idempotencia por `txHash`.
  `indexer.ts` sigue siendo un stub a propósito.
- **`yield.ts`.** Depende de `monad.ts` y de un indexer. No se toca.
- **Política de recuperación.** `recovery_email` y `recovery_phone` en NULL: una
  cuenta passkey-only sin forma de volver a entrar. Decisión de producto, no
  técnica.

## Hallazgos que cambiaron el plan

**0. Los tests de integración escriben en Neon de producción.** Corriendo
`pnpm --filter @bestpath/api test` a las 16:52 UTC entraron **4 usuarios falsos**
(`did:e2e:96ea280a:1`, `did:e2e:46fb032c:3`, `did:e2e:efe155c1:1`,
`did:e2e:c847a7c3:3`) con wallets `0x000…006ea280a1` que **no existen en
Privy**: `auth.e2e.test.ts:60` fabrica el DID y `auth.e2e.test.ts:340` abre la
base con `getDb(env.DATABASE_URL)`, y `.env` apunta a la rama `production`. Son
cuentas inservibles (nadie puede firmar por esas wallets) y ensucian el tag
público. Fue este trabajo el que las creó, al correr la suite para verificar
T1. Dos tareas nuevas: limpiarlas, y poner una guarda para que la suite no pueda
volver a hacerlo.

**1. "Lectura on-chain" no existía.** El commit `f4148ca` decía "auth passkey,
custodia TEE y lectura on-chain", pero `monad.ts`, `yield.ts` e `indexer.ts` son
stubs de una línea. La lectura on-chain hay que construirla, no completarla.

**2. `wallets.balance` no lo escribía nadie.** Cero `.set()`/`.update()` sobre
`wallets` en todo `apps/api/src`. El campo se llenaba solo al insertar, con
default `'0'`. Por eso el perfil muestraba `$0` con o sin depósito: el balance es
un ledger interno, no una lectura de cadena.

**3. El depósito del QR estaba en una wallet inaccionable.** El QR de
`/tmp/rewallet-usdc-deposito.png` decodifica a
`0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6` (0.826004 USDC en mainnet), pero
es un artefacto e2e: `owner_id: null`, `exported_at: null`, `policy_ids: []`.
Sin quórum dueño, la authorization key de Privy no puede firmar para ella, así
que **no se puede enlazar al usuario**: la app mostraría un saldo que jamás
podría gastar. Los fondos van por transferencia a la wallet del usuario
(`0x6c9F…7ae1`, que sí tiene `owner_id`), y esa wallet tiene **0 MON**, así que
la transferencia necesita gas primero.
