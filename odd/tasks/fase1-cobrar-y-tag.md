# Fase 1: cerrar cobrar y pagar como lo que el contrato pide

## Por qué esta tarea

`docs/contrato-dinero.md` define la Fase 1 y hoy la app **no la cumple**:

- `:26` — *"Se llega por **QR** o por **nombre o @tag**, y ReWALLET resuelve la
  dirección por detrás y **nadie escribe una dirección ni la ve**."*
- `:105` — *"se crea por un **link compartido**, o cualquier wallet cripto deposita
  directo a la dirección EVM del usuario"*
- `:29` — *"El destinatario se valida como identidad ReWALLET, no como una
  dirección escrita."*

Lo que hay hoy: una pantalla de envío con un campo para **pegar** una dirección
cualquiera. Eso es la fase siguiente. Y un QR de cobro con dirección real, que
funciona, pero no es el link compartido que pide el contrato.

**Decisión del cliente:** el QR **sí** codifica una dirección y la app **sí** lo
escanea. Es coherente con el contrato: *"se llega por QR"* está escrito, y lo
prohibido es que la persona escriba o vea la dirección — un escáner cumple las dos
cosas.

## Decisiones

1. **El link de cobro usa `payment_requests`.** La tabla existe completa (`id`,
   `user_id`, `amount`, `note`, `status`, `paid_by_user_id`, `paid_movement_id`,
   `created_at`, `paid_at`, `expires_at`) con sus índices. **No se agrega otra
   tabla ni una URL sin registro**: un link que no deja rastro de quién debe qué
   no es un cobro, es un favor.

2. **La dirección nunca llega a la pantalla.** `prepareSend` devuelve `address` —
   la del emisor, que la persona ya conoce. El **destinatario resuelto no se
   devuelve**. Si el front tiene la dirección, la prohibition está rota.

3. **El @tag se resuelve en el backend.** `users.tag_normalized` es `citext`
   unique, así que el índice existe. La búsqueda va al backend y devuelve lo
   mínimo para firmar; la dirección del otro no sale.

4. **El escáner no habla con nadie.** Todo el OCR del QR ocurre en el navegador.
   Una app de billetera que manda el frame de cámara a un servicio externo para
   decodificarlo es una app que filtra lo que la persona está mirando. Sin
   analítica, sin telemetría, sin red más allá de leer el video local.

5. **Deep link: la app tiene que aprender a leer su propia URL.** Hoy no lo hace
   (`grep` de `location`/`URLSearchParams` en `05. UI-UX/src`: nada). Sin eso, un
   link compartido abre la pantalla de inicio y el cobro se pierde.

## Tareas

### T1 — Link de cobro compartido

- Backend: crear un pedido de cobro (monto, nota, expiración) y leerlo por id.
  Estados: `pending`, `paid`, `expired`. Un pago lo marca `paid` con
  `paid_by_user_id` y `paid_movement_id`, leyendo el movimiento del envío.
- Un id que se pueda compartir y que **no adivine**: adivinar un id es robar un
  cobro.
- Front: pantalla para generar el cobro, y pantalla para pagarlo entrando por el
  link.
- Deep link: `GET /api/payment-requests/:id` desde la ruta, y la app abre esa
  pantalla al arrancar.

**Gate**: `npm test` en verde, `tsc --noEmit` limpio en front y back.

### T2 — Escáner de QR en la app

- Dependencia de decodificación **local**. Ningún servicio externo.
- La cámara se pide **solo al abrir el escáner**, no al entrar a la app.
- El destino del escáner alimenta el flujo de envío que ya existe.
- Si la persona cancela, la pantalla vuelve intacta.

**Gate**: `tsc --noEmit` limpio, build ok.

### T3 — Enviar por @tag

- Backend: `prepareSend` acepta **identidad ReWALLET** (tag) además de dirección,
  y la resuelve internamente.
- **La dirección resuelta no vuelve en la respuesta.**
- Un tag inexistente es un error acotado, no un 500 ni un resultado vacío.

**Gate**: `npm test` en verde, `tsc --noEmit` limpio.

## Allowed edit surfaces

- `07.PockBackend/src/application/payment-requests/**`
- `07.PockBackend/src/application/send/prepareSend.ts`
- `07.PockBackend/src/domain/ports/**`
- `07.PockBackend/src/infrastructure/db/**`
- `07.PockBackend/src/interface/http/routes/**`
- `07.PockBackend/src/container.ts`
- `07.PockBackend/test/**`
- `07.PockBackend/README.md`
- `07.PockBackend/package.json`
- `07.PockBackend/package-lock.json`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/config/**`
- `05. UI-UX/src/components/Wallet/**`
- `05. UI-UX/src/App.tsx`
- `05. UI-UX/package.json`
- `05. UI-UX/package-lock.json`
- `odd/tasks/fase1-cobrar-y-tag.md`

## Fuera de alcance

- Enviar a una billetera externa: es Fase 2 y ya funciona.
- Retiro bancario: el contrato lo ubica en Fase 3.
- Notificación de llegada (`odd/tasks/money-ears-from-arrival.md`).
- Límites por operación o diarios: Fase 1 es permissionless.
- Contactos / agenda. El contrato dice que los últimos envíos la alimentan.