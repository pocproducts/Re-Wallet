# Feature: swap con el estándar de Uniswap, detrás de "Usar"

## Objetivo

El botón "Usar" vuelve a la billetera, entre "Depositar" y "Enviar". Adentro viven
"Comprar" y "Vender", que abren **una sola** pantalla de swap con la disposición
documentada por Uniswap. La cotización es la real del backend
(`POST /api/wallet/swap/quote`, que ya está montado y responde). La ejecución es
simulada y se lee como simulación en pantalla hasta que exista la firma real.

Lo pide el usuario para probarlo en beta: el diseño de la pantalla actual no está
claro, y en vez de rediseñarlo a mano se adopta el estándar.

## El estándar de Uniswap, extraído del código fuente

Fuente: repositorio clonado de `@uniswap/widgets` (`Uniswap/widgets`, rama main,
snapshot del 2026) — los componentes de `src/components/Swap/` son el estándar
de facto del swap—and-docs.uniswap.org. El orden de bloques de la pantalla es:

1. **Header** con título + `Settings` (slippage "Auto"/custom y TTL).
2. **Panel "You pay"** (`Swap/Input.tsx`): monto grande, selector de token con
   logo, saldo y botón MAX.
3. **ReverseButton** circular centrado entre los paneles (invierte dirección).
4. **Panel "You receive"** (`Swap/Output.tsx`): monto calculado por la
   cotización, selector de token.
5. **Línea de precio** (`Swap/Price.tsx`): `1 origen ≈ X destino`, cliqueable
   para invertir la razón.
6. **Detalle** (`Swap/Summary/Details.tsx`): mínimo recibido, slippage, price
   impact, fee de red, ruta. Filas omitibles cuando no hay dato.
7. **Botón de acción** (`Swap/SwapActionButton/`): estados Approve → Swap →
   Confirming, uno solo y con el texto honesto del estado.
8. **Status** (`Swap/Status/StatusDialog.tsx`): pendiente / confirmada / fallida.
9. **Advertencias** (`Swap/Speedbump/`): alto impacto de precio exige confirmar
   a propósito.

### Lo que el backend de ReWALLET puede poblar honestamente

El puerto `SwapQuote` ya tiene: `amountIn`, `amountOut`, `amountOutMin`
(mínimo recibido), `price`, `feeTier`, `validUntil`, `blockNumber`, `quoteId`.
El adaptador del Trading API de Uniswap ve `priceImpact` y `routeString` en la
respuesta pero **no los lleva al puerto**: quedaron fuera. El contrato HTTP
tampoco los expone. Por eso:

- **Se muestran**: pagás, recibí, precio, mínimo recibido, slippage.
- **Se omiten**: price impact, fee de red, ruta. Una fila sin número verificable
  no se inventa — es la tesis del proyecto.
- Extender el contrato (priceImpact/routeString/feeTier al frente) queda como
  tarea aparte (Slice C), con test de forma en el backend.

### Slippage

La request del backend ya acepta `slippageBips` (default 50, rango 0-10000). La
UI del estándar tiene presets Auto/0.1/0.5/1.0% + custom. Se cablea a la request
(fin del hardcode de 50).

## Decisiones

- **Una pantalla, no dos**: Comprar y Vender abren la misma pantalla con dirección
  por defecto distinta (Comprar: USDC → activo; Vender: activo → USDC). Dos
  pantallas espejadas es justamente el diseño que no estaba claro.
- **La puerta es "Usar"** en la billetera. El detalle de cripto (`CryptoAssetDetailModal`)
  sigue sin ofrecer motor por ahora: su copy "no disponible" se fuerza a
  decisión aparte (H4 del task doc anterior).
- **El mock completo** (cotización inventada) queda sólo en `VITE_SWAP_MOCK=1` o
  en `npm run dev`. En beta la cotización es real; el botón de acción ejecuta una
  **simulación etiquetada** porque todavía no hay firma real en el front.
- **Los deep links `/cobrar/<id>` (H2) y el typecheck del backend (H3) quedan
  pendientes** del task doc anterior, no de éste.

## Estado

- [x] S1 — Investigar el estándar (widget de Uniswap clonado + docs oficiales)
- [x] S2 — Mapear el estado actual (puerta "Usar" sacada a propósito, pantallas
      `use_buy`/`use_sell` estacionadas, hook `useAssetTrade`, contrato swap)
- [x] S3 — Reabrir la puerta: "Usar" en la fila de acciones de `WalletView`,
      entre Depositar y Enviar, con el comentario de diseño actualizado
- [x] S4 — Pantalla de swap nueva (`src/components/Wallet/SwapScreen.tsx`) con la
      anatomía del estándar: header con ajustes → cartel de simulación → paneles
      Pagás/Recibí con inversor → detalle (precio, mínimo recibido, slippage) →
      botón honesto → teclado. Reemplaza las dos pantallas estacionadas.
- [x] S5 — Cotización cableada con slippage en la request (fin del hardcode 50),
      mínimo recibido exigido por el contrato, y bug de backend corregido: la
      ruta serializaba la cotización con `bigint` y reventaba con
      `TypeError: Do not know how to serialize a BigInt` → ahora los montos
      viajan como texto (`test/interface/swapRoutes.test.ts` fija la forma).
- [x] S6 — La bandera incluye el hostname: mock en `beta.rewallet.win` y en dev,
      real en `app.rewallet.win`. Verificado en el bundle:
      `gi=()=>typeof window<'u'&&window.location.hostname==='beta.rewallet.win'`.
      Front `tsc` limpio y 234/234; backend 929/929 (67 archivos).
- [x] S7 — Deploy `rewallet-poc-api` versión `3b00efe5` y verificación en vivo:
      beta sirve el shell nuevo, el chunk traía todas las cadenas de la pantalla,
      API sana (`/api/auth/session` → 401, `/api/metrics/privy` → 200) y
      `rewallet.win` intacto (sha `10a2c0f7`).
- [ ] S8 — Slice C (pendiente, decisión): extender el contrato con priceImpact,
      routeString y feeTier al frente y renderizar las filas del detalle que el
      estándar de Uniswap muestra y hoy no tienen datos honestos.
      priceImpact / routeString / feeTier

## Aprendizaje

(pendiente)
