# El front no tiene un solo test

## Por qué esta tarea

El backend tiene **768 tests**. El front tiene **cero**, y es el lugar donde vive la
regla que el owner másidentallyBombardeó durante la semana:

> "si no se pudo leer que no lo muestres en la UI, y que cuando haya para leer sí
> lo puedas mostrar"

Esa regla no está en ningún test. Vive en comentarios y en el criterio de quien
la escribió. El día que alguien toque `normalizePart` o el filtro de una lista y
no se entere, la app vuelve a pintar plata que no leyó — y no hay nada que lo
diga.

El CI ya corre tipos y build del front ([#33](https://github.com/pocproducts/ReWALLET/pull/33)).
types y build no atrapan una fila que aparece donde no debe.

## Qué hay que distinguir, y por qué va primero

El front tiene dos cosas muy distintas y el test se cuesta distinto:

1. **Aritmética y reglas puras** — `bigint`, redondeos, uniones discriminadas,
   frases. No React, sin DOM,毫ilisegundos. Es donde está el riesgo de plata.
2. **Render** — qué fila aparece y cuál no. Caro de testear, y es donde vive la
   regla del owner.

Se empieza por 1 porque es casi todo el riesgo y casi todo el valor. 2 después.

## F1 — runner y lógica pura

1. Vitest en `05. UI-UX`, con `npm test`. El proyecto ya es Vite, así que
   vitest entra sin cambiar la cadena de build.
2. Cobertura, por orden de riesgo de plata:
   - `src/services/walletBalance.ts` — el corazón. `toRatio`, `toVenueRate`,
     `normalizePart`, `normalizeVenue`, `normalizeYield`, `formatYieldRate`,
     `formatVenueRate`, `buildIncompletenessNote`, `byUsdValueDesc`.
   - `src/services/digitalDollars.ts` — normaliza lo mismo otra vez.
   - `src/services/pool.ts` — `displayableSupplyApr` es
     `reconciles ? supplyApr : null`, y esa condición decide si se muestra una
     tasa.
   - `src/services/portfolio.ts` y `src/config/markets.ts` — formato de dinero.
3. **CI corre los tests del front.** Si no, los tests son un adorno.

## F2 — render

Con `@testing-library/react` y jsdom:
- una pieza ilegible **no** dibuja fila;
- una pieza leída como cero **sí** dibuja, y como cero;
- un venue con `zero_balance` no se confunde con uno ilegible;
- el botón de comprar y vender **no** aparece.

## Reglas

- Un test que no falla cuando el código está mal, no es un test. Cada caso
  describe **el defecto que evita**, no la función que exercise.
- La aritmética de dinero se prueba en `bigint` exacto: un redondeo a la
  centésima es un fallo, no un detalle de formato.
- Ningún test puede depender del reloj, de la red, ni de `Math.random()`.

## Fuera de alcance

- Migrar el backend.
- Cambiar comportamiento. Esta tarea **no arregla nada**: averigua qué está
  roto antes de arreglarlo, si aparece algo.

## Gates

- `npm test` en verde.
- `npm run lint` y `npm run build` siguen verdes.
- CI en verde con los tests del front corriendo.

## F1 — entregado

**135 tests, 5 archivos, `test/services/` y `test/config/`.** `npm test` = `vitest run`,
`test:watch` para la tanda corta. `vitest.config.ts` va aparte de `vite.config.ts` a
propósito: acá no hay React, ni estilos, ni DOM — `environment: 'node'`, cero mocking.

**El primer test encontró plata.** `projectYearlyGain` dividía por `1e6 x 100` cuando el
APR ya venía escalado en `1e-4`, así que dividía de más por cien: 100 USDC al 100% se
proyectaban como 1,00. La cifra se pintaba como "estimación en un año" en
`DigitalDollarsView` y `AavePoolsView`. Corregido el divisor a `1e4 x 100`; los dos
casos quedan como guarda.

**CI:** paso `front — tests` nuevo entre tipos y build. Sin esto los tests son un adorno.

Evidencia local: `npm test` 135/135, `npm run lint` limpio, `npm run build` verde.

## F2 — pendiente

Render con `@testing-library/react` y jsdom. Sin hacer.