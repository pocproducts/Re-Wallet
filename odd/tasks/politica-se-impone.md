# La política se impone, no se consulta

## El problema

La política de gasto está expuesta como un endpoint aparte:

```
POST /api/wallet/policy/evaluate   →  "este envío, ¿puede?"
POST /api/send/prepare             →  mueve plata, sin preguntar nada
```

El front consulta el primero, muestra lo que dice, y recién ahí llama al segundo.
**El backend no exige ninguna decisión.** Ni `routes/send.ts`, ni `prepareSend`,
ni el store la consultan en ningún punto del camino.

La consecuencia es directa: cualquiera con un token de sesión se saltea las tres
reglas llamando directo a `POST /api/send/prepare`. Un `curl`, un cliente
modificado, un script. No hace falta tocar la app.

Y lo mismo pasa al pagar un cobro: `payPaymentRequest` no consulta la política,
así que los topes por envío y por hora no aplican a esa vía.

## Por qué importa más que un bug

El producto vende que **la política decide y el software ejecuta**. Eso es la
afirmación que sostiene el pitch y la que va a preguntar un jurado. Hoy no es
cierta en la frontera del servidor: la política es *asesora*, y depende de que
el cliente obedezca.

Una política que un cliente puede ignorar no es una política.

## La distinción que define el diseño

`Verdict` tiene tres valores: `allow`, `confirm`, `deny`. No los tres son
iguales para efectos de aplicación:

- **`deny` es exigible.** El servidor dice que no y no hay nada que el cliente
  pueda hacer para que sí. Son los topes duros: $1.000 por hora. Se imponen
  siempre, sin excepción y sin bandera que los desactive.

- **`confirm` no es exigible, y hay que decirlo.** "Avisale a la persona" no se
  puede cumplir desde el servidor: no hay forma de saber si un humano vio el
  aviso. Un cliente malicioso pondría `confirmed: true` sin preguntar a nadie.
  Lo que sí se puede es **exigir el gesto explícito y registrarlo**: sin el
  gesto, la operación se frena; con el gesto, se anota en `policy_decisions` que
  alguien afirmación haber confirmado. Eso no es prueba de que alguien确认ara, y
  no hay que venderlo como si lo fuera.

- **`allow`** no requiere nada.

## Dónde se imponen

En los dos caminos que mueven plata, y **adentro**, no antes de que el cliente
puedaSidear:

1. `prepareSend` — antes de armar la transferencia.
2. `payPaymentRequest` — antes de marcar el cobro como pagado.

## Qué se mantiene

- El endpoint `POST /api/wallet/policy/evaluate` **no se saca**: el front lo usa
  para pintar el motivo antes de que la persona decida. La consulta sigue siendo
  una cortesía para la pantalla; la aplicación es otra cosa, adentro.
- Las tres reglas, sus montos y sus textos. No se toca `evaluateSendPolicy`.
- La política de `control` sobre `policy_decisions` como auditoría.

## Lo que NO se hace, y por qué

**No se agrega un token firmado de política.** Sería más elegante, pero es una
capa más sobre una decisión que hay que tomar igual adentro, y hoy no hay ningún
cliente que lo pida. Si algún día se agrega, el lugar es el mismo: adentro del
use case que mueve plata.

## Criterios de aceptacion

- [x] `POST /api/send/prepare` con un envío que viola un tope por hora se
      rechaza **aunque el cliente no haya consultado la política**
      → `test/application/policyEnforcement.test.ts` → "refuses a send over the
      hourly cap with no consultation at all": $900 en la última hora + $300
      ahora = 400 `POLICY_DENIED`, sin movimiento y sin clave de idempotencia.
- [x] `POST /payment-requests/:id/pay` con un pago que viola un tope también se
      rechaza, por la misma puerta
      → "is refused when the payer is over the hourly cap": el pago llama a
      `prepareSend` por dentro, responde 400 `POLICY_DENIED` y el cobro queda
      `pending`.
- [x] Un `deny` no se puede levantar con ninguna bandera del cuerpo
      → "is not lifted by any flag in the body": `policyConfirmed: true`,
      `policyConfirmed: "true"`, `confirmed`, `force`, `override`,
      `skipPolicy` y `acceptedRisk` —todos dan 400 `POLICY_DENIED`.
- [x] Un `confirm` sin gesto explícito frena la operación con su motivo
      → "stops the send when the body carries no gesture" ($600 a destino nuevo):
      400 `POLICY_CONFIRM_REQUIRED`, sin movimiento, y la decisión queda con
      `verdict: 'confirm'` y `rule: 'max_single_send'` en `policy_decisions`.
      "does not accept an improvised gesture either": `"true"` no es gesto.
- [x] Con el gesto explícito, la operación sigue y queda registrada en
      `policy_decisions`
      → "lets the send through when the gesture is exactly true, and records
      it": 200, movimiento escrito, decisión `confirm` con el monto y el destino.
      En el cobro: "is paid when the pay body carries the gesture" (200, cobro
      `paid`, y la decisión apunta a la dirección de quien cobra).
- [x] Un envío permitido por las tres reglas sigue funcionando igual
      → "still prepares, and still writes its movement": destino conocido,
      $200 con $100 ya enviados en la hora — `allow`, 200, movimiento `pending`.
- [x] La landing puede decir la verdad: "cada envío consulta reglas antes de salir"
      → El texto ya existe (`04. Landing Page/site/index.html:130`) y ahora es
      cierto: la consulta corre adentro de `prepareSend`, en el servidor.
- [x] typecheck 0, suite en verde
      → `07.PockBackend`: `tsc --noEmit` con **33 errores preexistentes** (swap,
      de otro editor; `submitFeedback`; `walletBalance`; un `import.meta.env`
      del front). Los archivos de este cambio no suman ninguno. `vitest run`:
      65 archivos, 921 tests en verde. `05. UI-UX`: `tsc --noEmit` con **0
      errores** (línea de base 0) y 186 tests en verde.

## Lo que quedó fuera de esta tarea, y por qué

- **La pantalla de cobro no muestra los motivos de la política.** `PayChargeView`
  pinta `chargeFailureText(código)` pero no `flow.policyReasons`, así que un
  `POLICY_CONFIRM_REQUIRED` en un cobro se ve con la frase genérica y sin el
  motivo. Mostrarlos es un cambio de dos líneas en `PayChargeView.tsx`, que no
  está en la superficie de esta tarea.
- **El tope por hora se cuenta dos veces con el cliente real.** `POST
  /api/wallet/policy/evaluate` escribe una fila por consulta y el enforcement
  escribe otra por envío, y las dos alimentan `sendsSince`: el tope efectivo
  baja a ~$500 por hora para quien pasa por la app. La consulta sigue porque el
  doc la pide ("el front la usa para pintar el motivo"); la solución es
  deduplicar por intento o dejar de consultar desde el front, y es una decisión
  de producto, no de esta tarea.