# PoC Frontend — BestPath Wallet

**Feature**: `poc-frontend`
**Status**: in progress
**Created**: 2026-09-27
**Deadline de contexto**: hackathon Monad Metropolis, 2026-10-13

---

## Objetivo

Llevar el prototipo funcional v0.5 embebido en `deepseek_text_20260927_c41823.md` a un
frontend ordenado: proyecto Vite + TypeScript, módulos separados, design tokens en
`styles/tokens.css`, tipos de dominio definidos.

**El entregable de esta fase es que el flujo de UI/UX completo funcione en local, sin
cambios visuales ni de comportamiento, con la frontera `api` lista para ser cableada.**

## Fuera de alcance (fase siguiente)

- Backend, base de datos, endpoints
- Privy, Monad, Aave, Chainlink — cualquier integración on-chain
- Deploy, git, commit, repo público
- Tests E2E completos, Sentry, PostHog

## Restricción dura

`src/core/api.ts` es la **única** frontera con datos externos. Debe seguir siendo un
mock con la misma firma. La fase de cableado reemplaza ese archivo y nada más.

## Criterios de aceptación

1. `npm run build` termina sin errores
2. `npx tsc --noEmit` no reporta errores
3. Smoke test: la app bootea y los 9 renderers de pantalla devuelven markup no vacío
   para un estado representativo
4. El DOM renderizado es idéntico al del HTML original de una sola pieza
5. Corriendo `npm run dev` se puede completar el flujo completo a mano

## Estructura objetivo

```
bestpath/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.ts              composition root + boot
    ├── types.ts             User, Wallet, Movement, Contact, Recipient, AppState
    ├── config.ts
    ├── core/
    │   ├── utils.ts
    │   ├── store.ts
    │   ├── api.ts           ← frontera de cableado
    │   └── router.ts
    ├── ui/                  toast, banner, sheet, biometric, confirm, qrCode
    ├── components/          tabbar, contactAvatar, contactRow, movementRow
    ├── screens/             9 archivos, uno por pantalla
    ├── flow/                addMoney, sendMoney, yield ticker, logout
    ├── actions/             delegación de eventos
    └── styles/
        ├── tokens.css
        └── global.css
```

## Mapa de módulos en el origen

Líneas dentro de `deepseek_text_20260927_c41823.md` (el HTML va de 84 a 1970):

| Rango | Contenido |
|---|---|
| 355–371 | `config` |
| 372–433 | `utils` |
| 434–467 | `store` |
| 468–494 | `api` |
| 495–632 | `ui` |
| 633–770 | `router` + helpers de render compartido |
| 771–1307 | 9 pantallas |
| 1311–1774 | `flow` |
| 1778–1918 | `actions` |
| 1922–1968 | `boot` |

## Tareas

- [x] T1 — Extraer el HTML original a `bestpath-wallet.html` y verificar integridad
- [x] T2 — Andamiaje Vite + TypeScript
- [x] T3 — Design tokens a `src/styles/tokens.css`
- [x] T4 — Tipos de dominio + config + store tipado
- [x] T5 — Partir runtime: utils, api, ui, router
- [x] T6 — Partir componentes compartidos
- [x] T7 — Partir las 9 pantallas, una por archivo
- [x] T8 — Partir flow, actions y boot; composition root
- [x] T9 — Verificación: build, typecheck, smoke test

## Deuda conocida que NO se arregla en esta fase

Se registra para la fase siguiente, no bloquea el PoC:

- `config.version` dice `'0.4'` y no hay migración `0.4 → 0.5`
- `annualYieldRate: 0.042` hardcodeado; el pitch promete 5.65% de Aave
- `locale: 'en-US'` con strings en español produce `$1,234.56` junto a "Saldo insuficiente"
- Los bounties de Chainlink no aparecen en ningún lado del plan

## Evidencia

Sin git en esta fase, por decisión explícita del usuario. La evidencia es la salida
de los comandos de aceptación.

| Criterio | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores |
| `npx vite build` | 29 módulos, `built in 479ms` |
| `npx vitest run` | 25/25 en 2 archivos |
| `npm run dev` | HTTP 200, shell con `#device`/`#screens`/`#layer` |

### Paridad de DOM — sí, y medida

`scripts/parity.test.ts` carga el HTML original de una pieza en un JSDOM aparte
(window, document y localStorage aislados), siembra el mismo estado fijo en ambos
stores y compara el markup renderizado de las 9 pantallas. **12/12 idénticas.**

Se normaliza solo lo volátil antes de comparar: los tiempos relativos (`hace 5 s`,
que dependen del instante del render) y los ids aleatorios. Todo lo demás — estructura,
nombres de clase, copy, formateo de moneda — tiene que coincidir exactamente.

La aserción exige `> 200` caracteres de markup por pantalla, para que un diff verde
entre dos strings vacíos no pueda pasar por buena.

### Bugs reales que encontró el corte

1. **`_lastShownBalance` roto por el split.** Se declaraba en `home.ts` y lo usaba
   `flow/index.ts`. En el archivo único funcionaba por scope compartido; al partirlo
   quedaba undefined. Ahora vive en `screens/shared.ts` como `shownBalance = { value: 0 }`
   — un objeto, porque ESM prohíbe asignar a un binding importado.
2. **Identificador fantasma `config`.** El generador de imports veía un `config`
   local (`register(name, config)` y un `const config` en la pantalla de
   procesamiento) y lo tomaba por un binding de módulo. Se eliminó de la tabla de
   fuentes; si no, se creaban imports que no corresponden.

### Decisiones técnicas tomadas en esta fase

- **`strict: false` a propósito.** La capa de render son 1.600 líneas de markup en
  template strings; tiparla no aporta nada para la fase de cableado. Lo que sí está
  tipado exacto es el modelo de datos (`src/types.ts`), que es justamente lo que
  `core/api.ts` tiene que satisfacer cuando se reemplace. No es descuido, es alcance.
- **El namespace `BP` se conserva.** Partir los archivos era el objetivo; reescribir
  los ~1.600 call sites `BP.screens.x()` a imports ESM no aporta nada para esta fase
  y sí introduce regresiones. La frontera de cableado no depende de eso.

### Notas de entorno

- `gentle-ai-worker` falló dos veces con error de modelo (1 turno, 0 tool calls). La
  migración se hizo inline en el orquestador.
- npm 11 bloquea install scripts por defecto: hubo que `npm approve-scripts esbuild`
  o vite no encuentra su binario.
