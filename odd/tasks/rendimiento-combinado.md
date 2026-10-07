# Rendimiento combinado — el front muestra los dos venues

## Why this task

El backend ya compone el rendimiento ponderado de los venues de yield y lo manda
en `GET /api/wallet-balance` → `investedValue.yield` (tasa exacta como
`numerator`/`denominator` bigint, más una fila por venue con su propia tasa y su
estado). El front ya tiene el servicio que lo normaliza (`normalizeYield`), lo
formatea (`formatYieldRate`, `formatVenueRate`) y compone la frase de
incompletitud (`buildYieldIncompletenessNote`).

Lo que falta es **pintarlo**: hoy la card RENDIMIENTO de Dólares digitales sigue
mostrando únicamente el APR de Aave, como si el dinero de la persona rindiera en
un solo lugar.

## Decisión del owner (2026-10-07)

El titular de la card RENDIMIENTO pasa a ser **la tasa combinada**, y debajo van
las filas de cada venue con su propia tasa. Si algún venue no se pudo leer, el
número no se publica y aparece la nota que nombra el venue que falta.

## Tasks

### T1 — El hook expone el rendimiento

`useWalletBalance` publica el `yield` normalizado en el `ScreenView`, sin
redondear ni componer frases nuevas: solo pasa lo que el servicio ya decidió.

### T2 — La card RENDIMIENTO muestra el combinado

- Titular: `formatYieldRate(yield)` + "anual".
- Filas: una por venue, con `formatVenueRate`.
- Incompleto: la nota del servicio; **nunca** un número parcial.

### T3 — Verificación

`tsc` limpio en el front, `build` verde, suite del backend verde.

## Out of scope

- Cambiar el cálculo del backend (ya está, con media ponderada exacta).
- Añadir un tercer venue.
- Redondear o estimar una tasa que no llegó.

## Gates

- Ninguna cifra en pantalla que no venga de una lectura real.
- Sin número combinado cuando falta un venue: la nota nombra cuál.