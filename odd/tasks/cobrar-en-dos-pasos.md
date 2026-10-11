# Cobrar en dos pasos

## El problema

La pantalla de cobrar hace dos cosas en una sola pantalla:

1. **Elegir en qué se cobra** — la fila de chips Monad / USDC / Solana, más las
   redes de USDC cuando corresponde.
2. **Teclear el importe** y generar el link.

Hoy las dos están apiladas en el mismo scroll, con el teclado numérico abajo. El
resultado es que el usuario entra a "Cobrar", ve una fila de tres logos, un
importe gigante, un campo de nota y un teclado, todo a la vez. La pregunta
*"¿qué estoy elegindo acá?"* no tiene respuesta mirando la pantalla: la elección y
el importe parecen la misma cosa.

La elección **no es un detalle del importe**. Es la primera decisión del flujo: un
cobro en USDC-Solana y uno en MON-Monad no son el mismo cobro, no pagan los
mismos topes, y quien paga ve cosas distintas. Por eso va en su propia pantalla.

## El flujo pedido

```
Cobrar
  └─> [1] Elegí en qué querés cobrar      ← pantalla sola, fondo lima
        Monad  ·  USDC  ·  Solana
        (si es USDC: en qué red)
        [ Confirmar ]
          └─> [2] Importe a cobrar        ← fondo lima, la elección ya fija
                Teclear importe + nota
                [ Generar link de cobro ]
                  └─> [3] Cobro generado  ← QR + link (sin cambios)
```

La pantalla [2] **no vuelve a preguntar la moneda**. Ya se confirmó en [1], y
preguntarla dos veces es exactamente la mezcla que hay que deshacer.

## Lo que se elimina

- El bloque "En qué cobrás" (los tres chips) sale de la pantalla de importe.
- El texto "Elegí arriba en qué querés cobrar" y el símbolo `?` que lo reemplazaba.
  En la pantalla [2] siempre hay un símbolo: se("*no hay importe sin moneda, y sin
  moneda no se llegó acá*).

## Lo que no cambia

- `createPaymentRequest` y su contrato: `chain` + `asset.symbol`, igual que antes.
- La pantalla [3], el QR, el link, el confeti, la nota y su límite de 280.
- `ChargeQrModal` (cobrar por QR): es otra pantalla y otro camino.

## La regla que sostiene el flujo

**No se llega a la pantalla del importe sin una elección confirmada.** Es la
única garantía de que en [2] el símbolo mostrado sea el que se cobra, y por eso
se implementa como función pura testeable (`canConfirmCharge`), no como un
`disabled` que alguien puede leer mal.

## Decisiones tomadas

- **Las redes de USDC van en la pantalla [1].** "En qué querés cobrar" incluye la
  red: el cobro viaja con UNA cadena y quien lo paga la ve. Preguntarlo en [2]
  reintroduce la mezcla.
- **El botón Confirmar es explícito.** Tocar un chip elige; confirmar avanza. Sin
  confirmación, elegir y avanzar son el mismo gesto y el usuario puede llegar al
  importe sin querer decidir.
- **USDC sin tocar red cobra en la primera del catálogo**, que es el
  comportamiento actual (`activeUsdcChain` deriva). No es un default invisible:
  la red elegida se muestra en la pantalla [2] antes de confirmar el importe.

## Tareas

- [x] T1 — Lógica pura de familias y elección, con tests
- [x] T2 — Pantalla [1] de elección, sola, fondo lima, con Confirmar
- [x] T3 — Pantalla [2] de importe sin selector, con la elección visible
- [x] T4 — Verificación: tipos, tests, build

### Evidencia

- `npm run lint` — limpio.
- `npm test` — 198 tests verdes (186 previos + 12 nuevos en
  `test/services/chargeAssetChoice.test.ts`).
- `npm run build` — ok.
- Archivos: `src/services/chargeAssetChoice.ts` (nuevo),
  `test/services/chargeAssetChoice.test.ts` (nuevo),
  `src/components/Wallet/CreateChargeView.tsx` (reestructurado).
- **Commit**: pendiente. El usuario no pidió commit ni push; el deploy se hizo
  desde el working tree, como el anterior.
- **Verificación visual**: pendiente. El proyecto no tiene navegador headless ni
  tests de componentes, así que las dos pantallas nuevas no se pudieron ver
  renderizadas antes de subir.

## Pendiente fuera de este documento

- El destino del deploy (`beta.rewallet.win` vs `app.rewallet.win`) sigue sin
  decidir y **no** se toca en esta tarea.