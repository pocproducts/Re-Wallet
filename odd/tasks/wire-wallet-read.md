# Feature — Pasada 2: el frontend lee la API real

**Feature**: `wire-wallet-read`
**Parent**: `wire-passkey-gas` (pasada 2, la que quedó abierta)
**Status**: cerrada — 4/4 (2026-09-27)
**Created**: 2026-09-27
**Deadline**: 2026-10-13

---

## Corrección de alcance (verificada, no asumida)

`GET /wallet` y `GET /wallet/movements` **ya están implementados contra Postgres
real** y con test de integración contra la base viva
(`apps/api/tests/integration/wallet.test.ts`, 11 tests). API entera: **42/42
verdes** con `bestpath-postgres` arriba.

La pasada 2 NO es "implementar endpoints". Es **el salto `Store ← API`** en el
frontend, más las dos cosas que ese salto destapa y que hoy están rotas.

## Los tres huecos que aparecieron al investigar

### H1 — No hay proxy ni CORS: el frontend no puede llamar a la API

`apps/web` corre en `127.0.0.1:5173`, la API en `:3000`. La API **no tiene
middleware de CORS** y la web **no tiene `server.proxy`**. Con la sesión siendo
una cookie, llamarla cross-origin exige `SameSite=None; Secure` + CORS con
credenciales. La respuesta correcta es **same-origin**: proxy de Vite, y la
cookie httpOnly sigue funcionando con `SameSite=Lax` en localhost.

El proxy reescribe `/api/*` → `/*` en `:3000`. Un prefijo y no una lista de
paths: el prompt maestro mete ~24 endpoints y una lista se desactualiza en
silencio. La web llama siempre bajo `/api`, en dev y en prod (en prod, mismo
origen detrás de un reverse proxy).

### H2 — El boot decide dónde arrancar con un flag local

`boot.ts` rutea con `state.session`, que vive en localStorage. Después de un
login real, `toStorePatch` **borra** `session` a propósito (es del backend), y
`DEFAULT_STATE.session` es `true` porque el prototipo arrancaba logueado. O sea:
hoy el store afirma una cosa y la cookie otra, y un refresh manda al lugar
equivocado.

Con cookie httpOnly, la **única** fuente de verdad es `GET /auth/session`. Y
devuelve exactamente el mismo envelope `{ user, wallet }` que `register/finish`
— el backend ya se/mole de que no divergan.

### H3 — El ticker de yield fabrica plata sobre un balance real

`Flow.startYieldTicker()` suma `yieldPerTick` al balance local cada 9s. Mientras
el balance es mock, es decoración. Con el backend como dueño del balance, es
**escribir sobre el saldo real**: la app mostraría plata que no existe, growing
frente a un servidor que no la tiene. No se arregla después.

## Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| D1 | Same-origin con proxy `/api` | La cookie httpOnly no negocia con CORS; `SameSite=Lax` funciona en localhost |
| D2 | `GET /auth/session` decide la pantalla inicial, no `state.session` | Es la única fuente de verdad cuando la cookie es invisible al JS |
| D3 | El backend manda en `balance`; el ticker local solo sin sesión real | Un saldo que crece solo y no existe en el servidor es el peor bug posible en una wallet |
| D4 | La hidratación es **atómica**: un `Store.set` por respuesta | Un store a medio hidratar es una pantalla con aspecto de logueada y saldo viejo |
| D5 | Si el probe falla (API caída, offline, tests), el comportamiento actual se conserva | Un backend caído no puede dejar la app sin arranco |

## Tareas

- **T1** — proxy `/api` + `API_BASE` por defecto `/api` en `wire/privy.ts`. → HECHO
- **T2** — cliente de lectura real (`fetchWallet`, `fetchMovements`) + hidratación
  atómica vía el mapper. Reusa `toStorePatch`; nada de aritmética inline. → HECHO
- **T3** — probe de sesión en el boot + ruteo desde la respuesta; ticker de yield
  condicionado (D3). → HECHO
- **T4** — tests + cierre de docs. → HECHO

Verificación de cierre: **199/199 tests** en web (182 + 17 nuevos en
`scripts/wallet-api.test.ts`), typecheck 5/5, build ok. API sin tocar: sigue
42/42.

## Lo que se aprendió implementándolo

1. **El boot quedó asíncrono y eso casi rompe el contrato de dev.** La rama de
   `shouldResetOnBoot()` tiene que seguir SALTÁNDOSE el probe: un dev con cookie
   real sería rutado a la app que vino a resetear. Está aislado y comentado.
2. **El probe devuelve TRES estados, no un booleano**: `session` / `anonymous`
   (solo 401) / `unknown` (todo lo demás). Con dos, una API con un mal minuto
   deslogueaba al usuario de su propia wallet — el peor bug posible acá. El test
   `an unreachable API does NOT log the user out` lo fija.
3. **`hydrateFromSession` hidrata y devuelve la sesión**: una sola pasada de red
   para las dos cosas. `Router.init` va DESPUÉS del probe a propósito: renderizar
   primero y corregir después le muestra welcome a un usuario logueado, que se
   lee como "te desloguearon".
4. **`refreshWallet` escribe una vez**: `Promise.all` de wallet + movements y un
   solo `Store.set`. Escribir cada respuesta al llegar produce dos verdades en
   una pantalla.
5. **El cursor de paginación NO es campo del store**: es estado de vista y
   persistirlo resucita una lista a medio leer. Vive en el módulo.
6. **Los guards de contrato importan tanto como los de tipos**: un `balance` que
   llega como número pasa por `Number()` sin quejarse y muestra un saldo
   equivocado sin error en ningún lado. `isApiWallet` / `isApiMovement` lo cortan.
7. **Un test que overridea `Store.set` tiene que llamar `realSet.call(Store, …)`**:
   el método real lee `this._state`.
8. **Los stubs de `routeFetch` tienen que cobrir TODAS las rutas del `Promise.all`**,
   o el test falla por un 404 simulado y se lee como un bug del código.
9. **Un test que llama `boot()` tiene que drenar el `setTimeout(…, 600)`**: sin
   eso el timer dispara post-teardown con `document is not defined`.
10. **ESM no permite reasignar un export en un test** (`Cannot set property …
    of [object Module] which has only a getter`): para stubear hay que redesignar
    la función con dependencia inyectable, no mutar el namespace.

## Siguiente paso acordado con el usuario

El E2E del contrato de auth (backend ⇄ `wire/privy.ts`), **después** de esta
pasada. Es el hueco que quedó abierto y el que ningún test cubre hoy.

## Fuera de alcance

- E2E del contrato auth (el usuario lo pidió **después** de esta pasada).
- Contactos reales (`GET /contacts` existe, `toContact` existe): sigue mock.
- Precipitar/enviar/yield contra Aave: siguen mock.

## Deuda que esto destapa y NO se arregla acá

1. **No hay repo git** (toplevel = `/home/lordbitcoin`, cero commits). Sin
   work-unit commits hasta que el usuario decida.
2. `.env` tiene `MONAD_CHAIN_ID=10143` (testnet) contra la decisión D2 de mainnet
   143. No se toca acá: es una decisión de red, con plata de por medio.
3. `apps/web` sin `.env.local` → la isla de Privy no monta en el browser. Sin eso
   el login real no se puede probar a mano.
4. El `TODO(feature: passkey)` de `routes/auth.ts` está desactualizado: `verifyIdToken`
   ya verifica local con `PRIVY_VERIFICATION_JWKS` vía jose.
