# Webhooks: que la plata que llega y se envía se vea en pantalla

## Por qué esta tarea

El pipeline de webhooks **funciona y está probado**: dos eventos reales de Privy
con firma válida en `rewallet.webhook_events`. Pero solo sabemos traducir nueve
eventos de cuenta, y hay una cosa peor:

**Los eventos de dinero llegan y no se le atribuyen a nadie.**

Privy sí tiene lo que hace falta para avisar "llegó plata" y "se envió con qué
estado" (`wallet.funds_deposited`, `wallet.funds_withdrawn`, `transaction.*`).
Verificado contra la documentación oficial. El problema es 100% nuestro: la
atribución.

## El problema exacto

La atribución actual apuesta a que el DID viaja dentro del JSON del payload:

```sql
WHERE payload @> '{"user_id": "did:privy:…"}'
```

Los eventos de dinero **no lo traen**. Traen `wallet_id`:

```json
{ "type": "wallet.funds_deposited",
  "wallet_id": "fmfdj6yq…", "caip2": "eip155:1",
  "asset": {…}, "amount": "…", "transaction_hash": "0x…",
  "sender": "0x…", "recipient": "0x…", "block": {…} }
```

y los `transaction.*` vienen **anidados bajo `data`**:

```json
{ "type": "transaction.broadcasted",
  "data": { "wallet_id": "…", "transaction_id": "…", "caip2": "…" } }
```

Con la lógica actual: cero filas, **sin error**. Y eso se lee como "no tenés
notificaciones" en vez de "las notificaciones no se pueden atribuir". Es el peor
modo de falla posible: silencioso y con la explicación equivocada.

## Decisiones

1. **La persona se resuelve por sus wallets, no adivinando dentro del JSON.**
   `rewallet.wallets.provider_wallet_id` ya existe y ya guarda el id de Privy. La
   atribución por `wallet_id` es una afirmación con significado conocido — la
   misma disciplina que ya aplica a los paths del DID: no se busca "algún
   `did:privy:` en el payload" porque eso atribuiría el evento a quien solo
   aparece mencionado.

2. **Un solo `SELECT`, sin viaje extra.** El filtro resuelve los ids del proveedor
   con un subquery a `rewallet.wallets` + `rewallet.users` por `privy_did`, en la
   misma sentencia. Agregar un método al port y un viaje de ida y vuelta sería una
   ida y vuelta de red para unir el mismo dato.

   **Costo aceptado y medido:** con los ids desconocidos hasta que corre la
   sentencia, los términos de `wallet_id` tienen que ser `payload @> ANY (SELECT…)`
   y no `payload @> $n::jsonb`. El test de contención es el mismo y los términos
   del DID **siguen** servidos por el índice GIN. Los dos términos de wallet
   repiten el join: a volumen de feed es despreciable, y si algún día aparece en un
   plan, el arreglo es un subquery que devuelva un array de formas.

3. **Los caminos del `wallet_id` son una lista, como los del DID.** El adapter
   arma un `OR` por camino. Si mañana Privy anida el id en otro lado, se agrega un
   elemento a la lista y no se toca SQL.

4. **Sin movimiento de plata, no se inventa nada en la frase.** La descripción la
   produce `describeEvent(eventType)`, que **solo recibe el tipo**: no ve el
   payload. Las ocho frases dicen qué pasó, sin nombre, importe ni cadena.

   **Por qué no se le pasa el payload:** los `transaction.*` no traen `amount` ni
   `asset`, así que se descartan por sí solos para el caso que más importa. Una
   frase que dependiera del payload solo acertaría en 2 de 8 eventos. Pasarlo es un
   cambio de firma deliberado, con todos los callers, y es otra tarea.

## Los tipos que hay que traducir

| Evento | Categoría |
|---|---|
| `wallet.funds_deposited` | `wallet` |
| `wallet.funds_withdrawn` | `wallet` |
| `transaction.broadcasted` | `wallet` |
| `transaction.confirmed` | `wallet` |
| `transaction.execution_reverted` | `wallet` |
| `transaction.failed` | `wallet` |
| `transaction.still_pending` | `wallet` |
| `transaction.replaced` | `wallet` |

`wallet_action.transfer.*` **no se agrega**: son eventos de *Wallet Actions*, donde
le pedimos a Privy que haga la transferencia. Nuestro diseño firma en el
navegador con la wallet de la persona, así que nunca se disparan.

## Lo que NO hace esta tarea

- **No activa los eventos en el dashboard de Privy.** Es configuración del
  proveedor, la hace una persona.
- **No registra assets en Privy.** Los `transaction.*` exigen un asset registrado.
- **No cambia el modelo de "una wallet por cadena"** ni lo ignora: si el `wallet_id`
  de un evento no está en `rewallet.wallets`, el evento **no se atribuye** y eso se
  deja dicho en el código, no escondido.
- No implementa detección de llegada de fondos por polling
  (`odd/tasks/money-ears-from-arrival.md`). Esta tarea hace que los eventos que
  Privy **sí** manda lleguen a una persona; la otra cubre lo que Privy no manda.

## Tareas

### T1 — Atribución por `wallet_id`

- `PERSON_WALLET_ID_PATHS` en `src/domain/webhooks/attribution.ts`, con el mismo
  formato que `PERSON_DID_PATHS`.
- `webhookEventStore.pg.ts`: resolver los ids del proveedor de la persona con un
  subquery y sumar los containment por `wallet_id` al filtro existente.
- La unión de las dos reglas se lee como una sola: "un evento es de esta persona
  si su DID está en él, o si pertenece a una de sus wallets".
- **`PERSON_DID_PATHS` también estaba incompleta.** Corregido acá porque es la
  misma atribución: ver abajo.

**Gate**: `npm test` en verde (376 hoy), `tsc --noEmit` limpio.

### T1bis — El bug que apareció al probar contra Postgres de verdad

La SQL nueva nunca se había ejecutado contra una base real: los tests la
interceptan y la leen de forma estructural. Al correrla contra Neon aparecieron
los dos payloads reales que teníamos guardados:

```
wallet.created   → type, user_id, wallet_id
user.signed_in   → type, user_id
```

**Privy manda `user_id`. `PERSON_DID_PATHS` listaba `user_did`.** El path nunca
existió. Con solo los cinco paths viejos la consulta devuelve **0 filas**.

Es decir: **el feed de notificaciones venía devolviendo una lista vacía en
producción**, para todos los eventos reales que tenemos. Sin error, sin 500:
justo el modo de falla que se lee como "no tenés notificaciones".

`wallet.created` pasó a verse de rebote, porque su `wallet_id` sí coincide con una
fila de `rewallet.wallets` — o sea, por el camino nuevo, no por el del DID.

Se agregan `user_id` y `data.user_id`. **`user_did` no se borra**: es el campo
documentado para otras formas de payload de Privy, y los dos nombres son ciertos
según el tipo de evento. Lo que no puede volver a pasar es que una entrada de la
lista no tenga un payload real detrás.

**Gate**: ambos eventos visibles en Neon, verificado a mano.

### T2 — Descripciones de los eventos de dinero

- Las ocho filas de la tabla de arriba, en español, sin inventar importes ni
  cadenas que el payload no trae.
- Si el payload trae `amount`/`asset`, la frase lo nombra. Si no, no dice cuánto.

**Gate**: `npm test` en verde, `tsc --noEmit` limpio.

### T3 — Desplegar y probar en pantalla

- `npm run build`, `wrangler deploy`.
- Fondear MON y USDC a `0xaA8A88A0005707D8A90D725fe654A6C06b255f75` (Monad mainnet)
  y ver si aparece un `wallet.funds_deposited` en `rewallet.webhook_events` **y** en
  la pantalla de notificaciones.

**Gate**: el evento aparece en la base **y** en pantalla para la persona correcta.

## Allowed edit surfaces

- `07.PockBackend/src/domain/webhooks/**`
- `07.PockBackend/src/domain/ports/webhook-event-store.ts`
- `07.PockBackend/src/infrastructure/db/webhookEventStore.pg.ts`
- `07.PockBackend/src/application/webhooks/**`
- `07.PockBackend/src/interface/http/routes/webhooks.ts`
- `07.PockBackend/test/**`
- `odd/tasks/webhooks-notificaciones-dinero.md`

## Fuera de alcance

- Cambios de schema. `webhook_events` y `wallets` ya tienen lo que hace falta.
- Cambios en `05. UI-UX`. La pantalla ya consume `GET /api/notifications` y va a
  mostrar lo que aparezca; si renderiza mal, es una tarea aparte.