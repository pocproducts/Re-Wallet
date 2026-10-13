# El cobro nombra activo y cadena

## Qué cambia

Hoy un cobro **no dice en qué se cobra**. Guarda un importe en dólares y quien
paga elige el activo y la cadena al momento de pagar
(`payPaymentRequest.ts:243`, `selectPayableAsset`). Por eso la pantalla de cobro
tiene "U$" fijo y no hay selector: no hay nada que elegir.

Con este cambio, un cobro **nombra la cadena y el activo**, y el link se
descifra solo: al abrirlo, la app ya sabe si lo que se pide es EVM o Solana.

Decisión del dueño: el pagador **no** puede cambiarlo. Paga lo que el cobro pide o
no paga. Si el pagador no tiene ese activo en esa cadena, se lo dice.

## Por qué el pagador no elige

Elegir en el momento de pagar era más flexible, y por eso el cobro no declaraba
nada. Pero un link que no dice qué pide obliga a quien paga a interpretar, y en
un producto que promete no tener jerga eso es exactamente lo que no queremos. Un
cobro que dice "10 USDC" no necesita explicación.

## El contrato

### Crear — `POST /api/payment-requests`

```json
{ "amount": "10", "chain": "monad", "asset": { "symbol": "USDC" }, "note": null }
```

El cliente manda **cadena y símbolo, no decimales**. Los decimales los resuelve
el servidor desde el catálogo (`DEPOSIT_NETWORKS`): son un dato del activo, y
aceptarlos del cliente es darle autoridad sobre el número que se cobra por
plata. Es la misma razón por la que `prepareSend` no confía el `decimals` de un
destinatario.

Si la cadena no existe, o el símbolo no está en esa cadena, la creación se
rechaza. No es un cobro: es un cobro en algo que no existe.

### Leer — `GET /api/payment-requests/:id`

Ahora devuelve además `chain` y `asset: { symbol, decimals }`. Con eso el link
`/cobrar/{id}` ya dice qué pide, sin cambiar la forma de la URL: **el id sigue
siendo el link entero**, que es lo que evita que exista una URL sin registro.

### Pagar — `POST /api/payment-requests/:id/pay`

El cuerpo ya **no declara** activo ni cadena. Se usan los del cobro. La pantalla
de pago lee el cobro, muestra qué pide y paga eso.

## La consecuencia que hay que resolver antes de escribir

`payment_requests.amount` es `numeric(20,6)`. El catálogo tiene ETH y MON con
**18 decimales** y SOL con 9. Con la columna actual, un cobro de 0.0000000000001
ETH se guarda como 0 — se manda plata que no se escribió.

La columna se ensancha a **`numeric(38,18)`**, el máximo que mantiene 18
decimales en Postgres. No hay filas (`payment_requests` está vacía), así que el
cambio no reescribe nada.

## Migraciones

La numeración sigue a `0004`. Va `0005`, idempotente, y el schema
`ReWallet_Schema123.sql` se actualiza para las instalaciones nuevas —que es lo
mismo que se rompió antes: el `.sql` quedó con `{10,16}` y la base tiene
`{10,32}`, y esa deriva costó una investigación entera.

## Lo que no cambia

- La **forma de la URL**: sigue siendo `/cobrar/{id}`. Agregar la cadena al path
  haría el id un prefijo de algo, y hoy el id ES el cobro.
- El **expirado**: el cobro sigue venciendo, y sigue siendo de un solo uso.
- La **política de envío**: no toca el cobro. Se consulta al pagar, que es donde
  hay una firma.

## Criterios de aceptacion

- [ ] Crear un cobro pide cadena y activo, con selector desde el catálogo
- [ ] Crear en una cadena/símbolo que no existe se rechaza, y el mensaje lo dice
- [ ] `GET /payment-requests/:id` devuelve cadena y activo
- [ ] El link descifrado muestra qué pide, en castellano y sin jerga
- [ ] Pagar usa la cadena y el activo del cobro, no los del cuerpo
- [ ] Un cobro de 18 decimales se guarda exacto, sin truncar
- [ ] El `.sql` del schema y la base real dicen lo mismo
- [ ] typecheck 0, suite en verde, backend y front