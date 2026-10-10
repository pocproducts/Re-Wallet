# Lote beta-feedback #37, #38, #39

Issues reportados desde la app beta. Todos llegan como GitHub issues con el label
`beta-feedback` y el tag del tester embebido en el cuerpo.

## Fuente de la verdad

`gh issue list --label beta-feedback`. Los issues no viven en el repo: se abren
desde la app. Antes de trabajar en un lote, leerlos de ahí, no de memoria.

## Los tres issues

### #37 — Contactos mockeados y QR que no se genera

Al hacer Enviar -> desde otra billetera ReWALLET, aparecen contactos que no
existen. Deberían listarse los contactos reales con los que ya se envió vía tag
`@`. Además el sistema no genera QR ni para la billetera EVM ni para la Solana.

### #38 — Saldo real en el envío, con toggle a USD

En Enviar -> criptoactivos -> elegir asset -> poner billetera, hay una frase fija
"tus saldos se descontarán de tu cuenta {asset}". Debe mostrar el saldo
disponible real en una línea propia, con un botón al costado que invierte la
presentación entre unidades y USD.

### #39 — El botón "ver issue en GitHub" no debe verse

Al enviar feedback desde la app aparece un enlace a GitHub. Es interno, no puede
estar a la vista del usuario.

## Estado al abrir el lote

El working tree tenía trabajo sin commitear que ya cubría parte de esto:

- **#37a contactos**: backend completo y cableado (`readContacts`, puerto
  `ContactsStore`, `createPostgresContactsStore`, ruta `GET /api/contacts`,
  inyectado en `container.ts` y montado en `app.ts`). El frontend tiene
  `services/contacts.ts` y estados de carga/error/vacío reales. **Pero:**
  1. `contactsStore.pg.ts` hace `LEFT JOIN rewallet.users u ON u.tag =
     m.meta->>'recipientTag'`, y el tag en `movements.meta.recipientTag` se
     guarda **sin** `@` mientras que `users.tag` exige `@` (constraint
     `^@[a-z0-9_]{2,19}$`). El join nunca casa y `contact.name` es siempre null.
     La columna correcta es `users.tag_normalized`.
  2. Los mocks siguen visibles porque el paso `send_where` /
     `send_lemon_account` está renderizado **dos veces** en el mismo root. La
     primera pareja es la nueva (con fetch real); la segunda es la vieja (con un
     array literal hardcodeado de cinco contactos).
- **#37b QR**: el encoder (`services/qrEncode.ts`) existe y funciona, pero solo
  lo consumen `ChargeQrModal` y `CreateChargeView`, y solo para links de cobro.
  No hay QR de dirección para ninguna cadena. Hay tres lugares con iconos que
  hacen de QR: el paso `depo_qr_result` del modal de acción, la tarjeta ReTag del
  detalle de criptoactivo, y la vista de actividad.
- **#38**: ya implementado en el working tree.
- **#39**: el enlace ya no se renderiza. Queda un valor asignado y nunca usado.

## Decisiones

1. **No se toca la tabla `rewallet.contacts`.** Existe en el schema y está
   muerta: nadie la consulta. La agenda se deriva de `movements`. Es residuo.
2. **El nombre de un contacto sale de `users.tag_normalized`, no de `users.tag`.**
   El tag normalizado es lo que el envío escribe y lo que el store ya usa para
   resolver billeteras.
3. **QR como componente único.** El patrón estaba duplicado inline en dos
   archivos con un `viewBox` que recorta la zona quieta que el encoder declara.
   Se extrae a `components/common/QrCode.tsx` y se corrige el recorte ahí.
4. **Ningún número inventado.** Si el saldo no se puede leer, la línea lo dice.
   No se cae a `U$0,00` como si fuera un dato.

## Lo que se encontró al abrirlo, y no estaba en el planteo

Cuatro cosas, y las tres primeras hacen que "el bug" no fuera el que parecía:

1. **El `LEFT JOIN` de contactos no casaba nunca.** No era que faltara el nombre: es
   que la columna unida no podía coincidir con lo escrito.
2. **Los mocks no eran un array huérfano.** El paso estaba renderizado dos veces.
3. **Había una segunda agenda mockeada**, en el detalle del criptoactivo, con
   nombres de personas reales, y tocar un contacto lo dejaba como destino de una
   transferencia.
4. **Había un placeholder `$joadata`** que, al volverse escaneable por el QR,
   pasó de ser texto de demo a ser una dirección de cobro que no es de nadie.

## Verificado

- [x] `/api/contacts` resuelve el nombre real: el `JOIN` va por
      `users.tag_normalized`, y hay 13 tests en
      `test/infrastructure/contactsStore.pg.test.ts` que fallan si vuelve a
      `users.tag`. Verificado revirtiendo el fix a mano.
- [x] No queda ningun contacto mockeado en el frontend. Verificado con grep sobre
      `src/` completo, cero resultados. Las dos pantallas que listan contactos
      (modal de accion y detalle del criptoactivo) leen `readContacts()`.
- [x] El paso de envio se renderiza una vez, no dos. Cada `currentStep ===`
      aparece una unica vez.
- [x] QR real de direccion via `components/common/QrCode.tsx`, en el paso de
      deposito, en el detalle del criptoactivo (ReTag y red) y en la vista de
      actividad (cobro).
- [x] El `viewBox` de los QR de cobro ahora mide `size + 8`, que es lo que ocupa
      el path con su zona quieta. Antes declaraba `size + 2` y recortaba el
      margen.
- [x] El placeholder `$joadata` ya no llega al QR: sin tag, el detalle cae en su
      `fallback`.
- [x] La linea de saldo del envio muestra el disponible real y el boton invierte
      entre unidades y USD, con ramas de error que no inventan cifras.
- [x] No queda ningun enlace a GitHub visible en la app.
- [x] Build de produccion del frontend OK.

## Lo que sigue pendiente, y no es de este lote

El baseline del repo esta roto desde antes, por el trabajo que estaba sin commitear:

- Frontend: typecheck con errores en `PriceChart.tsx` (importa
  `../services/coinGecko`, que no existe), `WalletView.tsx`,
  `hooks/__tests__/useAssetTrade.test.ts` (escrito para jest, que no esta
  instalado) y `main.tsx`. Tests: 3 fallos en `test/config/markets.test.ts`.
- Backend: typecheck roto en la linea de swap y en `container.ts`. Tests: 9
  fallos en `kaminoEarnPosition`, `solanaPortfolio`, `interface/portfolio`,
  `interface/walletBalance` y `test/swap.test.ts`.

Y una decision de producto que este lote no cierra: **el envio a un `$ReTag`
esta deshabilitado** ("Enviar a un $ReTag todavia no esta disponible"). Como la
agenda se deriva de los envios con tag, hoy solo se puebla si la persona escribe
un `@tag` a mano en el campo de direccion del envio de criptoactivos. Sin eso, la
agenda llega vacia y el fix se ve como si no hiciera nada.

Ademas, `rewallet.contacts` existe en el schema y esta muerta: nadie la consulta.
La agenda se deriva de `movements`. Es residuo que confunde al proximo.