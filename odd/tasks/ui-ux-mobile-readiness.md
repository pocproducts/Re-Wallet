# UI-UX — Preparación mobile como guía definitiva

**Why:** `05. UI-UX` deja de ser un prototipo de AI Studio y pasa a ser **la guía
definitiva** con la que se construye la app mobile real. Un prototipo que se mira
en un monitor de escritorio miente en cinco cosas que en un teléfono no mienten:
la tipografía que cree estar usando, el notch, el zoom del teclado, el tamaño de
los dedos y el pinz-zoom.

**How to apply:** En este documento "app" = `05. UI-UX/src`.

**Restricción del owner:** NO reordenar contenido, NO agregar divs sueltos. Los
arreglos son de token, de clase y de CSS. Nada de rediseño.

---

## Diagnóstico (con evidencia, 2026-10-02)

| # | Defecto | Evidencia | Impacto en teléfono real |
|---|---|---|---|
| 1 | `.font-display` **no existe** | Las variables están en `:root` de `@layer base`; Tailwind v4 solo crea utilities desde `@theme`. `grep -o '\.font-display{...}' dist/assets/*.css` → vacío | 153 clases muertas. El código dice una cosa y el dispositivo hace otra |
| 2 | Syne y JetBrains Mono nunca se aplican | `grep -c Syne dist/assets/*.css` → **0**. Ídem JetBrains Mono | Se descargan dos fuentes que no se ven nunca |
| 3 | Cero safe areas | `grep -rn 'safe-area\|env(' src/` → nada, pese a `viewport-fit=cover` | Notch y barra de inicio encima del contenido |
| 4 | 12/12 inputs bajo 16px | 7 × `text-xs`, 4 × `text-sm` | iOS hace zoom al enfocar y el usuario debe hacer pinz para volver |
| 5 | 59/153 botones bajo 44px | 28 × `w-9 h-9` (36px), 12 × 32px, 11 × 40px, 6 × 28/14px | Errores de toque |
| 6 | Pinz-zoom bloqueado | `maximum-scale=1.0, user-scalable=no` | Fallo WCAG 1.4.4 |
| 7 | iOS infla texto en horizontal | sin `text-size-adjust: 100%` | Layout roto en landscape |
| 8 | Scrolleo fantasma | wrapper externo `min-h-screen` (100vh) vs marco `h-dvh` | En Android la página scrollea detrás de la app |
| 9 | Sin `prefers-reduced-motion`, `focus-visible`, `overscroll-behavior`, `html/body height` | — | Accesibilidad y comportamiento de scroll |

## Decisiones del owner

- **Tipografía:** Plus Jakarta Sans para todo; JetBrains Mono para cifras y tickers
  (`font-mono`). Syne se elimina. `font-display` queda como alias real de Plus
  Jakarta. Riesgo visual: cero.
- **Áreas táctiles:** todo a **44px mínimo**. El ícono no cambia, crece la caja.
- **Inputs:** **16px en los 12**, sin excepción.

---

## Tareas

### T1 — Base del sistema: tokens, tipografía y plataforma
`src/index.css` (bloque `@theme`, tokens, base, focus-visible, reduced-motion,
overscroll, text-size-adjust, `html/body height`) + `index.html` (quitar
`user-scalable`/`maximum-scale`, quitar Syne de la carga de fuentes).

### T2 — Safe areas
Utilities `safe-top-*` / `safe-bottom-*` en `index.css` que suman
`env(safe-area-inset-*)` al padding existente, aplicadas al navbar y a las raíces
de pantalla con `pt-*` / `pb-*` de borde. Cero divs nuevos.

### T3 — Áreas táctiles a 44px
Los 59 botones bajo el mínimo. Solo clases; los íconos no se tocan.

### T4 — Inputs a 16px
Los 12 inputs. Además `font-size: 16px` como piso defensivo en `@layer base`
para cualquier input futuro.

### T5 — Verificación
`tsc --noEmit`, `vite build`, grep de regresión sobre los 9 defectos y capturas
en 390×844 y 430×932 con las barras seguras simuladas vía `env()` no disponible
en headless (se verifica por cálculo, no por captura).

---

## ## Estado: CERRADO 2026-10-02

`tsc --noEmit` limpio, `vite build` OK, y los 10 puntos verificados sobre el CSS
compilado y el código fuente. Detalle de lo que se hizo y de dos regresiones
encontradas al verificar:

### T1 — Base del sistema
`@theme` con `--font-sans`, `--font-mono` (JetBrains), `--font-display`
(alias de Plus Jakarta) y los colores de marca. `html`/`body` con `height: 100%`,
`text-size-adjust: 100%`, `overscroll-behavior: none`, piso de `16px` en
`input/select/textarea` y `:focus-visible`. `prefers-reduced-motion` apaga
animaciones, confeti y pulsos. `index.html` sin `maximum-scale`/`user-scalable`,
sin Syne, `lang="es-AR"`. `App.tsx`: wrapper `min-h-dvh` en lugar de
`min-h-screen`.

### T2 — Safe areas
Utilities `@utility safe-top-*` / `safe-bottom-*` que suman
`max(0px, env(safe-area-inset-*))` al padding existente. Aplicadas en 17
lugares: navbar, 7 raíces a pantalla completa, 3 hojas inferiores, 2 hojas
superiores, 3 contenedores de pestaña, overlay de perfil, onboarding y la hoja
de compraventa. Cero divs nuevos.

### T3 — Áreas táctiles
**55** botones (no 59: 4 del primer conteo eran falsos positivos) llevados a
44px: 28 × 36px, 13 × 40px, 12 × 32px, 2 × 28px. Los íconos no se tocaron.

### T4 — Inputs
11 inputs de `text-xs`/`text-sm` a `text-base` (16px). El 12º ya estaba en
`text-xl`.

### Dos regresiones encontradas verificando (importante para el futuro)

1. **El input de teléfono se salía de la tarjeta** al subir a 16px. Causa: un
   item flex tiene `min-width: auto` y no baja de su ancho min-content; el
   `flex-1` solo no alcanza. Se resolvió con `min-w-0` en los dos inputs
   `flex-1` de la app (onboarding y scanner).
2. **Dos conteos automatizados Initially mentían.** El primero contaba íconos
   como si fueran botones (no matcheaba `className={\`...\`}`, con la llave y
   atrás). El segundo no contaba los botones con `=>` en los props, porque el
   parser cortaba el tag en ese `>`. El conteo bueno exige: `className=` con
   `(?:\{\s*)?` opcional, y cierre de tag que ignore `=>` y `>=`.

## Cerrado 2026-10-02

`tsc --noEmit` limpio, `vite build` OK, y los 10 puntos verificados sobre el CSS
compilado y el código fuente. Detalle de lo que se hizo y de **tres regresiones
encontradas al verificar**, que importan para el futuro.

### Corrección posterior: las safe areas no aplicaban

`@utility safe-bottom-*` usaba `max(0px, env(...)) + 4 * .25rem` sin `calc()`.
Mezclar una función matemática con aritmética fuera de `calc()` es una expresión
inválida: el navegador descarta la declaración en silencio. La clase se emitía
en el CSS, se veía en el devtools, y **no aplicaba nada**. Durante ese rato las
safe areas estuvieron en cero en toda la app.

La lección: **verificar que la regla se aplique (estilo computado), no que se
emita (el archivo CSS).** Comparar screenshots no alcanza, porque "la utility no
aplica" y "el inset es 0" producen la misma imagen. Con `calc()` corregido y el
dev server reiniciado, `<nav>` mide `padding-bottom: 24px` y el botón QR queda a
24px del borde.

### T5b — Margen inferior de la navbar
`safe-bottom-4` (16px) → `safe-bottom-6` (24px), igual que las pantallas a
pantalla completa, para que navbar y modales compartan el mismo aire.

### T6 — Valores de mercado centralizados
`src/config/markets.ts`: `ARS_PER_USD`, `ASSET_PRICE_USD` (con `AssetTicker`
derivado de la propia tabla), `BALANCES`, `BALANCE_DECIMALS`, y los helpers
`priceUsd`, `balanceOf`, `toArs`, `fromArs`, `formatAmount`, `balanceLabel`,
`balanceWithTicker`.

Los 15 literales que estaban dentro de los componentes (8 × `1570`, precios de
BTC/ETH/SOL, saldos `0,00852543` y `250,00`) ahora salen de ahí.

**Resolvió una contradicción real:** "Usar → Comprar" cotizaba Bitcoin a 64.250
y el detalle del mismo activo a 95.400. Dos pantallas, misma moneda, distinto
precio. Ahora manda `ASSET_PRICE_USD.BTC = 95400`, el que ya usaba la lista de
activos para calcular el balance que ve el usuario. Es el único cambio de
número visible: en ese flujo, comprar 100 USDC pasa de `0,001556` a `0,001048`
BTC.

## Cerrado 2026-10-02 — tanda 2

Cuatro pendientes del cierre de auditoría, resueltos:

| # | Qué | Dónde |
|---|---|---|
| 1 | Las cuatro pantallas de conversión comparten lógica | `useAssetTrade.ts` + `AssetTradeCard.tsx` |
| 2 | 0 textos por debajo de 11px | 29 ocurrencias (3 × 9px, 26 × 10px) |
| 3 | Estado muerto `selectedSubAction` borrado | `ActionFlowModal.tsx` |
| 5 | 198 países en el proyecto Front End | `Front End/src/config/countries.ts` + generador |

### 1 — Por qué un hook y no la lógica por cuarta vez

Comprar y Vender aparecen en **cuatro** pantallas: los dos flujos del modal
"Usar" y los dos del detalle de un cripto. Copiar la lógica iba a producir la
misma divergencia otra vez, así que se extrajo:

- `hooks/useAssetTrade.ts` — el par de activos, la hoja abierta, la inversión, el
  MAX y **todas** las cadenas derivadas (monto, equivalente en USD, saldos,
  decimales con tope de 6).
- `components/common/AssetTradeCard.tsx` — el cableado entre `TradePairCard`, las
  dos `AssetSheet` y los disparadores de foco.

Las cuatro pantallas pasan a ser seis líneas: título de arriba, título de abajo,
qué número hay en el teclado. `grep TradePairCard` en los dos modales da 0.

Dos bugs que salieron al hacerlo:

- **`openBuy`/`openSell` seteaban el par**, así que al volver de Vender a Comprar
  el par quedaba con lo último elegido. Ahora cada flujo nace con su default y
  abrir un flujo solo cambia de paso y vacía el monto.
- **`assetOrDefault(asset.ticker)` antes del `if (!asset) return null`** rompe el
  orden de hooks. Va con `asset?.ticker ?? 'USDC'` y commentado.

### 2 — Texto chico

`text-[9px]` y `text-[10px]` → `text-[11px]`, 29 lugares. El piso de la app pasó
a ser `text-xs` (12px) para cuerpo y `text-[11px]` (12 usos) para micro-etiquetas.
Reverificado a 320px en los 3 tabs, pools, dólares digitales y perfil: 0 hallazgos.

### 5 — 198 países en el Front End

Los 5 exports son idénticos, así que el archivo se copió sin tocar ninguno de sus
dos consumidores. Se llevó también el **generador** (`scripts/generate-countries.mjs`
+ `npm run generate:countries` + los dos devDeps), para que los dos proyectos no
se vuelvan a separar. Verificado: 198 opciones en el DOM, 198 códigos únicos.

**Y se eliminó el campo `short` de los dos proyectos.** Con 20 países, tres letras
identificaban; con 198 no: Congo, Costa de Marfil, Costa Rica, Chad y Christmas
Island arrancan igual. El control cerrado pasó a mostrar bandera + prefijo. El
campo se fue porque era una trampa: parecía un identificador y no lo era. De paso
apareció que `El Salvador` valía `'EL '`, con un espacio.

Fuera de alcance (decidir después)

- `metadata.json` sigue diciendo "GeoDrop - Street Map & Crypto Rewards" y pide
  `geolocation`. Residuo de la plantilla de AI Studio.
- El proyecto Front End conserva su lista de 20 países de Latinoamérica con el
  comentario que la justificaba; acá ya son 198.
- El header de `CryptoAssetDetailModal` no es sticky: al scrollear una lista
  larga el botón de volver se va. Es un cambio de orden/estructura: **no** se
  toca sin aprobación explícita.
