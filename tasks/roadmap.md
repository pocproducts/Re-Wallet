# ReWALLET — Panorama

**Reconciliado contra el código el 2026-09-29.** Este documento reemplaza la
necesidad de leer los nueve documentos de `odd/tasks/` para saber qué está
hecho. Es el mapa; los documentos siguen siendo la letra, y cuando no coincidan
con lo de acá **manda lo de acá**, porque este se escribió mirando el árbol.

La razón de que exista: nueve documentos escritos en sesiones distintas, con IDs
de tarea que **arrancan en T1 en cada uno**. `T4` significa cinco cosas
distintas. Eso no es un problema de redacción: es la razón por la que el
checklist de fase 1 creía que faltaban cuatro tareas que ya estaban hechas, y por la
que otro documento afirma haber borrado cuatro archivos que siguen en el disco.

---

## 1. Lo que está hecho, por capacidad

Cada línea tiene su evidencia en el árbol. Nada acá está affirmado por un
documento: está afirmado por un archivo.

| Capacidad | Estado | Evidencia |
| --- | --- | --- |
| API y arranque | LISTO | `Backend/src/interface/http/app.ts`, `src/index.ts`, `src/container.ts` |
| Config fail-closed | LISTO | `src/interface/config/env.ts` — sin `NODE_ENV` corre en producción y exige secretos |
| Schema y migraciones | LISTO | 28 tablas en `rewallet`, `src/infrastructure/db/{schema,client,migrate}.ts` |
| Sesiones | LISTO | `rw1_` + SHA-256, cookie httpOnly, sliding 30d / techo 90d, revoke idempotente |
| Lectura de balance multi-cadena | LISTO | `/wallet` publica USDC + MON valuado, por cadena |
| Assets y cobertura declarada | LISTO | `/wallet/assets` con `assets[]` + `chains[]` y tres estados de cobertura |
| Historial de movimientos | LISTO | búsqueda binaria sobre el nodo de archivo, presupuesto de trabajo, caché 30s single-flight |
| Oráculo de precios | LISTO | Chainlink off-chain, `domain/pricing/valuation.ts` como función pura |
| Yield | LECTURA LISTA | Aave V3 on-chain en mainnet por el `UiPoolDataProvider`; la tasa es real |
| Webhooks Privy | LISTO | Svix, ledger `webhook_events`, dedupe por `svix-id`, `POST /webhooks/privy`, `GET /webhooks/events` |
| Cliente realtime | LISTO | `Front End/src/application/webhooks/`, `components/Wallet/BalanceUpdatedNotice.tsx` |
| Perfil, onboarding, país | LISTO | `components/Profile/ProfileView.tsx`, `components/Onboarding/` |
| **Suite** | **506 tests, 506 verdes** | `Backend/`, vitest |

## 2. Lo que falta, y son cinco cosas

**Diez directorios vacíos en `Backend/src`.** No hay código a medias: hay
carpetas que alguien creó y nunca llenó, y que son el mapa exacto de lo que falta.

```
src/application/auth        src/infrastructure/auth
src/application/contacts    src/infrastructure/custody
src/application/payments    src/infrastructure/gas
```

| | Falta | Por qué importa |
| --- | --- | --- |
| **1** | **Auth (login de Privy)** — verificación JWKS, upsert de usuario, `@tag`, minteo de sesión | **El cuello de botella. Bloquea el 90% de lo demás** |
| **2** | **Custody** — provisionar la wallet TEE, persistir `provider_wallet_id` | Va con el 1. Hoy la única wallet de la base lo tiene en `NULL` |
| **3** | **Payments** — send, deposit-intent, idempotencia, `policy_decisions` | Sin esto no hay producto, hay un lector de cadena |
| **4** | **Contacts** — CRUD, límite 20 por usuario | Menos urgente, es una pantalla |
| **5** | **Wiring del frontend** — reemplazar `MockAuthProvider` | Sin esto el 1 no se ve, y el realtime queda invisible |

Además, a medias:

- **Gas sponsorship (T11)**: existe la tabla `gas_sponsorships` y las variables de
  entorno. No existe el código.
- **Ledger de yield (T10)**: las tablas `yield_positions` y `yield_accruals`
  existen, con sus constraints; **nadie escribe filas**. La tasa se lee de Aave y
  se publica, no se persiste. Los propios comentarios del código lo dicen:
  *"a later `yield_accruals` row will persist it"*.
- **Re-medición de rendimiento**: dos documentos esperan la misma medición de los
  tres endpoints, y nadie la tomó.

### La cadena crítica

**1 y 2 son una sola pieza de trabajo.** Las sesiones ya se mintean (T5), pero
**nadie puede pedir una**. Sin login:

- no existe un `users.id` que no sea la fila sembrada,
- `provider_wallet_id` queda en `NULL` para siempre,
- toda lectura con scope de sesión responde por alguien que no está,
- y **el cliente realtime hace standing down**, porque no hay cookie. Es la misma
  causa que hizo que el feature de webhooks cerrara correcto e invisible.

**El 5 no es un extra: es la prueba de que el 1 sirve.**

Orden: **1+2 → 5 → 3 → 4 → gas → ledger de yield → re-medición.**

## 3. Los documentos, y quién es dueño de qué

| Documento | Dueño de | Estado real |
| --- | --- | --- |
| `backend-fase1.md` | El backend completo, T1–T15 | **La espina.** T3, T8, T12, T14 hechas (decía que no); T6, T7, T9, T11, T13, T15 sin empezar; T10 a medias |
| `privy-webhooks-and-realtime.md` | Webhooks, T1–T5 | Cerrado, 14/14 verificadas contra el árbol |
| `multi-chain-wallets.md` | Multi-cadena, T1–T6 | Cerrado, 12/12 rutas reales |
| `native-currency-support.md` | Moneda nativa MON, T1–T5 | Cerrado, 15/15 rutas reales |
| `price-feeds-and-valuation.md` | Oráculo, T1–T5 | **Enteramente obsoleto**: las 5 tareas están sin marcar y **están hechas** |
| `country-selector-and-profile-header.md` | País y perfil, T1–T4 | Cerrado, 5/5 reales. El documento más limpio del set |
| `yield-real-apr.md` | La tasa real de Aave, T1–T7 | Cerrado; su alcance excluye a propósito el ledger de accruals |
| `history-read-performance.md` | Performance, T1–T6 | ** contiene 4 afirmaciones falsas** (abajo) |
| `mvp-clean-shell.md` | El shell del frontend | **Superado.** Su T8 le pasó el backend a `backend-fase1`, que ya lo llevó a T14 |

### Las tareas que eran la misma

Cuatro pares de tareas que son **el mismo trabajo con dos nombres**:

1. **Presupuesto de lectura de historial** — `native-currency-support` T3 y
   `history-read-performance` T3. Ambos caen en
   `stateDiffMovementReader.ts`, y ambos tienen el mismo test de guarda.
2. **Lectura de assets en el frontend** — `native-currency-support` T4,
   `multi-chain-wallets` T6 y `history-read-performance` T4. Los mismos cuatro
   archivos. **Dos dicen construirla, uno dice borrarla.** Ver abajo.
3. **Scaffold del backend** — `mvp-clean-shell` T8 y `backend-fase1` T1.
4. **Borrado de mapa y misiones** — `mvp-clean-shell` T3 y T5, dentro del mismo
   documento. T3 es una casilla muerta.

Y 44 colisiones de ID entre documentos: `T1` a `T5` existen en los nueve.

## 4. Las contradicciones, y cómo quedaron

### 4.1 Un documento afirma un borrado que nunca pasó

`history-read-performance` T4, marcado hecho:

> *"Remove `httpAssetRepository`, `useHoldings`, the `AssetRepository` port and
> its provider wiring"*
> *"**The 404 is gone.** The app now asks for exactly three endpoints and all
> three exist"*

**Los cuatro archivos siguen en el disco y cableados** (`App.tsx:101`,
`PoolProvider.tsx:32`), y la ruta está registrada en `app.ts:264` — con un
comentario en el propio código que dice lo contrario del documento: *"It used to
be absent entirely, which is what the client's 404s were."*

**Resolución: la ruta vive.** Tres documentos dependen de que exista
(`backend-fase1` T8, `native-currency-support` T4, `multi-chain-wallets` T6), y el
cliente la llama hoy. La afirmación del documento era una decisión que se tomó
antes de que la ruta existiera, y nunca se revisó. El T4 queda **anulado por
obsoleto**, no por error.

### 4.2 Un documento entero dice que la nada está hecha

`price-feeds-and-valuation` tiene sus cinco tareas sin marcar y cierra con
*"Evidence: To be collected"*, mientras la tabla de feeds, el port, el adapter,
la función de valuación, un archivo de tests dedicado y los call sites existen
todos. **El trabajo salió; el documento nunca se actualizó.**

**Resolución: documentado como cerrado acá.** El documento queda con una nota
apuntando a esta tabla.

### 4.3 Dos ADRs borrados del árbol, y son la decisión de T7

`mvp-clean-shell` cita `odd/decisions/adr-001-custodia.md` tres veces y le anota
una deuda congelada. **`odd/decisions/` no está en el árbol de trabajo** — pero
los dos ADRs están en el historial de git (commit `f4148ca`) y son recuperables.
No están perdidos: están fuera del expediente.

Y esto no es una nota de archivo, porque **el ADR-001 gobierna exactamente T7**,
la segunda mitad del cuello de botella:

> *"Una wallet creada desde nuestro backend, en TEE, con el dueño en un quórum
> 2-de-2: el passkey del usuario más una authorization key de nuestro server."*

El ADR promete un quórum 2-de-2 donde el passkey del usuario es la mitad. Lo que
se medió después es que el servidor puede satisfacer el quórum **solo**, así que
firmar desde el backend funciona y el passkey no es dueño de nada. **T7 se va a
implementar contra un documento que ya se sabe que no dice la verdad.**

**Resolución: recuperar los dos ADRs a `odd/decisions/` antes de arrancar T7, y
corregir el ADR-001 con la medición, no borrarlo.** No está hecho acá: es una
decisión de producto y está fuera de lo que se autorizó en esta pasada.

### 4.4 Un "next step" que se contradice dentro de su propio documento

`mvp-clean-shell` termina con *"Próximo paso: T4 — reescribir el onboarding"*, y
seis párrafos más arriba su sección *Progreso* ya reporta T4, T4b, T4c y T5 como
implementados, con conteos de líneas y tamaños de build.

## 5. Cómo se verificó

Caminos declarados por los nueve documentos, chequeados contra el árbol:
**141 declarados, 118 reales, 23 ausentes o falsos.** Por documento:

| Documento | Declarados | Reales | Ausentes/falsos |
| --- | --- | --- | --- |
| `country-selector-and-profile-header.md` | 5 | 5 | 0 |
| `multi-chain-wallets.md` | 12 | 12 | 0 |
| `native-currency-support.md` | 15 | 15 | 0 |
| `privy-webhooks-and-realtime.md` | 19 | 19 | 0 |
| `price-feeds-and-valuation.md` | 7 | 6 | 1 (ruta distinta) |
| `yield-real-apr.md` | 10 | 7 | 3 (renombrados) |
| `backend-fase1.md` | 33 | 28 | 5 (los adaptadores de 1, 2, 5) |
| `mvp-clean-shell.md` | 20 | 12 | 8 (renombrados o nunca existieron) |
| `history-read-performance.md` | ~20 | ~14 | **6, cuatro de ellos afirmaciones** |

**No verificado**, y por lo tanto no afirmado acá: conteos de tests de cada
documento (son cortes acumulados, no comparables entre sí), tiempos HTTP, estado
de la app de Privy, y todo el estado de git.

## 6. Lo que este documento no arregla

- **No se borró ningún documento.** Los nueve siguen, porque son el registro de
  por qué el código es como es. Se les agregó una nota que apunta acá.
- **No se resolvió 4.3.** Los ADRs siguen fuera del árbol. Están en el historial
  de git, recuperables, y hay que hacerlo **antes** de T7 — no después.
- **No se corrigieron las rutas desactualizadas** dentro de los documentos. Un
  documento que dice `src/data/transactions.ts` y el archivo se llama
  `components/activity/ActivityView.tsx` sigue diciendo la ruta vieja; corregir
  todas es trabajo sin valor, y este mapa es el que se lee.
- **No se tocó `01.Poc-bestpath`.** Es el laboratorio, y queda afuera.
