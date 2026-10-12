# Feature: que `beta.rewallet.win` sirva la app, no la landing

## Objetivo

Dejar `rewallet.win` sirviendo la landing y `beta.rewallet.win` sirviendo la app
completa con su API funcionando, para poder probar la app. Además, el mock de
swap que quedó sin commitear debe sobrevivir pero **nunca** activarse en un build
de deploy.

## Causas raíz verificadas (read-only, contra Cloudflare y contra los bytes servidos)

1. **El worker que tiene los dominios no es el del repo.** `beta.rewallet.win` y
   `app.rewallet.win` apuntan a `rewallet-poc-api-production`, que tiene **un solo
   binding** (`MONAD_POOL_RPC_URL`). El worker declarado en
   `07.PockBackend/wrangler.jsonc`, `rewallet-poc-api`, tiene los **18 bindings**
   completos pero **ningún hostname**. Por eso `/api/health` y
   `/api/auth/session` devuelven `500 INTERNAL` en los dos dominios.
   El string `rewallet-poc-api-production` no existe en el repo y no hay ningún
   `[env.production]` declarado: el estado desplegado no es reproducible.

2. **`05. UI-UX/dist/` está contaminado con la landing.** Contiene el build real
   de Vite (`assets/`, 298 chunks, entry `index-Dve9_rzW.js`) **más** archivos de
   landing en su raíz (`index.html` 18066 B, `styles.css` 13974 B, `main.js`,
   `scrub-engine.js`). El `index.html` de la landing pisó el shell de Vite.
   Como `wrangler.jsonc` sirve `"directory": "../05. UI-UX/dist"`, el worker
   publica la landing como si fuera la app. Evidencia directa:
   `beta.rewallet.win/styles.css` responde 200 con el encabezado
   `"ReWALLET Landing — misma estructura que la maqueta original"`.

3. **La landing local quedó destrozada.** `04. Landing Page/site/index.html`:
   HEAD 10657 B (idéntico a lo que sirve `rewallet.win`), working tree 1136 B
   (236 líneas borradas, quedó un botón violeta ajeno a la marca). El comando
   documentado `wrangler pages deploy "04. Landing Page/site"` tumbaría
   `rewallet.win`.

4. **El mock de swap no está conectado.** `quoteSwapMock` se define en
   `src/services/swap.ts` y **nadie lo importa**. El hook `useAssetTrade` ya
   acepta inyectarlo, pero `CryptoAssetDetailModal` no lo pasa.

5. **Trampa latente:** el botón "Ejecutar Swap Mock" del modal renderiza sólo
   cuando hay cotización real disponible. Con la API en 500 no aparece; **al
   arreglar el worker se activa**, muestra el precio real al lado y fabrica un
   `txHash` hexadecimal de 64 caracteres simulando una ejecución exitosa. Aislar
   el mock es prerrequisito del arreglo del worker, no una mejora posterior.

## Decisiones

- Un solo Worker para API y front en el mismo origen: ya decidido en
  `wrangler.jsonc` por la cookie `__Host-` con `SameSite=Lax`. No se toca.
- Los dominios `app` y `beta` siguen apuntando al **mismo** worker: prueba en
  cualquiera de los dos es prueba de lo mismo. Es lo que declara el repo.
- El mock queda detrás de una bandera **apagada por defecto**: encendida en el
  servidor de desarrollo local, apagada en cualquier build de deploy, forzable
  sólo con `VITE_SWAP_MOCK=1`.
- El mock debe ser **visiblemente falso en pantalla**. Una billetera que no miente
  no puede mostrar un precio simulado ni un hash inventado sin decirlo.
- `rewallet.win` no se toca: hoy funciona y sirve la landing correcta.

## Estado

- [x] T1 — Preservar los archivos de landing que viven sólo dentro de `dist/`
      → `/tmp/rewallet-dist-landing-backup/` (index.html, styles.css, main.js, scrub-engine.js)
      y el stub del working tree como `site-index-stub-worktree.html`.
- [x] T2 — Restaurar `04. Landing Page/site/index.html` desde HEAD
      → worktree 10657 B, sha `10a2c0f7…`, igual a HEAD y a lo que sirve `rewallet.win`.
- [x] T3 — Aislar el mock de swap detrás de bandera y etiquetarlo como simulado
      → `isSwapMockEnabled()` en `src/services/swap.ts`; el modal lo inyecta sólo si está
      encendida y muestra cartel ámbar. Además se corrigieron dos bugs del mock que lo
      hacían inservible: las unidades (multiplicaba por 10⁶ un monto que ya venía en
      unidades mínimas) y el número de bloque inventado con el reloj.
- [x] T4 — Reconstruir el front y verificar que `dist/index.html` es el shell real
      → 6223 B, `<title>ReWALLET - Dólares Digitales y Rendimientos</title>`, `id="root"`,
      assets hasheados; los archivos de landing ya no están en `dist/`.
- [x] T5 — Compilar el worker del backend → `dist-worker.js`, 2090374 B.
- [x] T6 — Correr tipos y tests de los dos proyectos
      → front: `tsc --noEmit` limpio y 232/232 tests. Backend: 925/925 tests en 66 archivos.
      El `typecheck` del backend **falla por un defecto previo, no de este cambio** (ver
      Hallazgos).
- [x] T7 — Mover los dominios `app`/`beta` a `rewallet-poc-api` y desplegar
      → `wrangler deploy` se adjudicó los dos custom domains. Los 17 `secret_text`
      sobrevivieron (verificado con `wrangler secret list`).
- [x] T8 — Verificar en vivo
      → `beta` y `app` sirven el shell de la app (6223 B) y ya no la landing;
      `/styles.css` pasó de 200 a 404; `POST /api/wallet/swap/quote` → 401 (ruta montada);
      `POST /api/diagnostics` → 204; `GET /api/metrics/privy` → 200 con datos reales de
      Privy. `rewallet.win` intacto.

## Hallazgos abiertos

- [ ] **H1 — Bloqueante manual:** confirmar que `beta.rewallet.win` esté en los dominios
      permitidos del panel de Privy. Sin eso el login falla en beta aunque el resto
      funcione. No se puede resolver desde el repo.
- [ ] **H2 — Defecto nuevo, previo al corte:** los deep links de la SPA devuelven 404.
      `GET https://beta.rewallet.win/cobrar/<id>` responde el 404 de texto plano de Hono
      (13 B) en vez de `index.html`, incluso con `Accept: text/html`. La app lee el id del
      `pathname` (`useIncomingPaymentRequest` → `paymentRequestIdFromPath`), así que
      **abrir un link de cobro compartido está roto**. `wrangler.jsonc` declara
      `not_found_handling: single-page-application`, pero el Worker tiene un `main` y
      Hono responde a todo lo que no sea un archivo existente, así que el fallback nunca
      se aplica. Arreglarlo es una tarea propia: binding `ASSETS` explícito y delegación
      desde el Worker, con test.
- [ ] **H3 — Defecto previo:** `npm run typecheck` del backend falla con
      `../05. UI-UX/src/services/api.ts(19,42): Property 'env' does not exist on type
      'ImportMeta'`. Se reproduce compilando el `api.ts` pristino con las opciones del
      backend, así que no lo introdujo este cambio. Causa: `test/monad-send.smoke.test.ts`
      importa archivos del front y el `tsconfig` del backend no tiene los tipos de Vite.
      El job de CI del repo corre justamente ese `typecheck`.
- [ ] **H4 — Decisión de producto pendiente:** el backend ya tiene montado y respondiendo
      `POST /api/wallet/swap/quote`, y `TRADE_UNAVAILABLE_TEXT` sigue diciendo que el
      cambio entre activos no está disponible. Con el mock apagado, el modal muestra ese
      texto aunque el motor exista. Ver `docs/decisiones/swap-monad-estado-y-bloqueo.md`:
      la forma de cotizar figura como decisión pendiente.
- [ ] **H5 — Higiene:** `README-ejecucion.md` está sin trackear; los números del
      `README.md` sin commitear (921 backend / 224 front) son levemente viejos pero no
      falsos: la corrida real da 925 y 232.

## Riesgos conocidos

- **Dominios permitidos de Privy.** El comentario de `05. UI-UX/.env` menciona
  sólo `app.rewallet.win` en la lista blanca. Si `beta.rewallet.win` no está
  cargado en el panel de Privy, el login va a fallar en beta aunque todo lo demás
  funcione. Es una acción manual en el panel: no se puede resolver desde el repo.
- **Secretos del worker.** `wrangler deploy` **no** borra secretos (lo declara el
  propio `wrangler deploy --help`: *"secrets are never deleted by deployments"*).
  Aun así, no se debe usar `--keep-vars=false` con expectativa de reversión, y el
  despliegue de `rewallet-poc-api` no debe recrear el worker.
- **La landing alternativa del `dist/`.** Tiene paleta y tipografía distintas a la
  vigente (`--lemon: #ffd93d` y Poppins contra `#ccff00` y Montserrat). Se
  preservó en `/tmp/rewallet-dist-landing-backup/`; su destino es una decisión
  aparte, no parte de este arreglo.

## Fuera de alcance

- Borrar los workers basura (`raspy-wildflower-e92b`, `test-debug-worker`,
  `hello-worker-test`) y resolver `www.rewallet.win`.
- Corregir las métricas del `README.md` sin commitear y decidir qué hacer con
  `README-EJECUCION.md`.
- Empujar commits, abrir PR o mergear.

## Aprendizaje

(pendiente)
