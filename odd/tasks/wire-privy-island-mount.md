# Feature — Montar la isla de Privy en la app vanilla

**Feature**: `wire-privy-island-mount`
**Parent**: `wire-passkey-gas` (pasada 1, orden de ejecución 10-12)
**Status**: cerrada — 3/3 (2026-09-27)
**Created**: 2026-09-27
**Deadline**: 2026-10-13

---

## Punto de partida (verificado en esta sesión)

Ya está escrito y verificado, y **no** se toca:

| Artefacto | Estado |
|---|---|
| `apps/web/src/wire/mapper.ts` | listo, 18 tests de contrato |
| `apps/web/src/wire/privy.ts` | listo, 33 tests (`scripts/privy.test.ts`) |
| `apps/web/src/wire/privy-island.tsx` | escrito, **sin montar** |
| alias `react`→`preact/compat` | en `vite.config.ts` + `tsconfig.json` |
| `preact` + `@privy-io/react-auth` | instalados |

Verificación de arranque: **172/172 tests verdes, typecheck limpio**. El `grep` de
`wire/` fuera del propio directorio no devuelve **nada**: la isla está huérfana.

## Qué falta (y por qué importa)

El propio `privy-island.tsx` lo dice: *"the one-line call that mounts it belongs in
`boot.ts`, which was not editable"*. La sesión anterior murió ahí.

Tres tareas:

### T1 — Montar la isla en `boot.ts`

- `import()` **dinámico** de `./wire/privy-island`, no import estático. Razón: una
  app sin `VITE_PRIVY_APP_ID` no debe arrastrar Preact + el SDK de Privy en el
  grafo de arranque, y `mountPrivyIsland` ya devuelve `null` cuando no hay App ID.
- Host: `.app` (shell), nunca `#screens`. El router destruye los hijos de
  `#screens` en cada navegación y se llevaría el contexto de Privy y la ceremonia
  WebAuthn en vuelo. La invariante ya está defensively chequeada en la isla.
- El cleanup se guarda a nivel de módulo para que sea desmontable.

### T2 — Cablear los dos puntos de entrada

- `Actions['biometric']` → `requestPrivyLogin()` **cuando la isla está montada**;
  si no, sigue el camino mock actual.
- `Flow.logout()` → `requestPrivyLogout()` antes de limpiar el store, best-effort.
- `requestPrivyLogin` / `requestPrivyLogout` se importan de `wire/privy.ts`, que
  **no** importa Preact: Preact queda fuera del grafo de imports de cada screen.

**Decisión de diseño (híbrido, explícita):** la isla montada gana; sin isla, el
mock. Es lo único que deja verdes los 172 tests y permite develops sin
credenciales. No es una mezcla silenciosa: `hasPrivyIsland()` decide en un solo
lugar por acción.

### T3 — Env, tests de integración y cierre

- `apps/web/.env.example` con `VITE_PRIVY_APP_ID` y `VITE_API_BASE_URL`
  (hoy no existe; sin él nadie descubre los nombres).
- `apps/web/scripts/privy-island.test.ts`: contrato de integración
  (el mount no cuelga de `#screens`, el botón delega cuando hay isla, el logout
  llama al backend, y la paridad de DOM sigue intacta).
- Actualizar `wire-passkey-gas.md` con el cierre de los pasos 10-12.

## Fuera de alcance

- `GET /wallet` y `GET /wallet/movements` reales (siguen mockeados: es la pasada 2).
- Contratos on-chain / Aave.
- Precipitar, contactos, yield.

## Resultado

| Tarea | Estado | Evidencia |
|---|---|---|
| T1 — montar en `boot.ts` | done | `mountPrivyIslandOnce()`, import dinámico, host `.app`, los DOS return paths |
| T2 — cablear login y logout | done | `Actions['biometric']` y `Flow.logout()` delegan vía `wire/privy.ts` |
| T3 — env, tests, cierre | done | `apps/web/ENVIRONMENT.md` + `scripts/privy-island.test.ts` (10 tests) |

Verificación de cierre: **182/182 tests** (antes 172, +10 nuevos), typecheck 5/5,
build ok con la isla en su propio chunk (`privy-island-*.js`).

### Lo que se aprendió implementándolo

1. **`DEFAULT_STATE.session` es `true`.** El prototipo arranca “logueado”, así que
   `session` no sirve para distinguir login real de mock: el test tiene que observar
   qué rama corrió (`UI.biometric`, `Router.go`), no el estado del store.
2. **`UI.biometric()` es una animación de ~4s real.** Un test que la deje correr no
   falla, expira. Hay que stubearla: lo que se prueba es QUÉ rama corre.
3. **`boot()` deja timers vivos**: el sync de conexión a 600ms y el refresher de
   tiempo cada 30s. Un test que llama `boot()` tiene que drenarlos o revientan
   después del teardown con `document is not defined`.
4. **El grafo del SDK se transforma lento** (segundos en una corrida paralela), así
   que ese test lleva timeout explícito de 30s. El deadline interno es 20s.
5. **`.env.example` no se puede escribir**: el harness bloquea paths `.env*` como
   sensibles. Las variables quedaron documentadas en `apps/web/ENVIRONMENT.md`.
6. **La isla pesa 2,205 kB (633 kB gzip)** y se pide en el boot. Ver “deuda abierta”.

## Deuda abierta (decisión del usuario)

1. **La isla se descarga en cada arranque**, aunque casi ningún usuario toque login.
   Opciones: montarla en el primer `data-action="biometric"` (un click de latencia
   de red), o en `requestIdleCallback`. No se cambió sola porque es una decisión de
   carga, no de corrección.
2. **No hay repo git.** `git rev-parse --show-toplevel` desde `bestpath/` devuelve
   `/home/lordbitcoin`: un repo sobre el home, con cero commits y todo el home como
   untracked (`.ssh`, `.claude.json` con API keys). Ningún work-unit commit se puede
   hacer sin que el usuario decida primero (¿`git init` en `bestpath/`?).

## Riesgo conocido

**No hay repo git.** `git rev-parse --show-toplevel` desde `bestpath/` devuelve
`/home/lordbitcoin`: un repo sobre el home con **cero commits** y todo el home
como untracked (`.ssh`, `.claude.json` con API keys). Ningún work-unit commit se
puede hacer sin que el usuario decida primero. Pendiente de decisión, no bloquea
el código.
