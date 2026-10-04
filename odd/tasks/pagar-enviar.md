# Pagar: enviar a una dirección

## Por qué esta tarea

Hoy la app **no mueve plata**. Lee saldos, muestra direcciones y deposita en
Aave — eso último ya firma transacciones de verdad. Pero **enviar no existe**, y
sin enviar no hay producto de pagos: hay un lector de cadena con muy buenos
datos.

Esta es la primera vez que la app mueve dinero. Por eso el orden es
**backend primero**: la validación de dirección, de monto y de saldo tiene que
estar probada **antes** de que exista un botón que pueda fallar.

## Decisiones

1. **Enviar a una dirección pegada.** No hay agenda de contactos todavía: sale
   de los propios envíos (tarea siguiente, "últimos envíos").
2. **El backend prepara y el navegador firma.** Mismo camino que el depósito en
   Aave: el servidor arma la transacción sin firmar, el front la firma con la
   wallet de la persona. Las direcciones de contrato viven en el servidor.
3. **Idempotencia.** Un doble toque no puede mandar plata dos veces. Existe la
   tabla `rewallet.idempotency_keys` (`key`, `user_id`, `endpoint`, `response`,
   `status_code`, `created_at`, `expires_at`) y es lo que se usa.
4. **Un movimiento se registra al preparar y se actualiza al confirmar.**
   `rewallet.movements` tiene `wallet_id`, `type`, `amount`, `title`, `status`,
   `meta`. Sirve para "últimos envíos" y para que la actividad deje de estar
   vacía.

## Validaciones obligatorias

| Regla | Por qué |
|---|---|
| Red conocida y activo soportado en **esa** red | Mandar USDC a una red donde no existe pierde todo |
| Dirección válida **para esa red**: EVM `0x` + 40 hex, Solana base58 de 32 bytes | Una dirección de Solana pegada en un envío EVM se pierde |
| EIP-55 si viene en mayúsculas mezcladas | Una dirección con un carácter mal copiado **se pierde** |
| Monto entero positivo, en unidades mínimas | Un `0.1` con 6 decimales es 100000, no 1 |
| Saldo suficiente **leído de la cadena** | Un saldo de la base puede estar viejo |
| Saldo de gas (nativo) mayor que cero | Mainnet cobra gas aunque el monto sea USDC |
| Si el saldo **no se pudo leer**, no se envía | Enviar sobre un saldo desconocido es apostar |

## El contrato

```
POST /api/send/prepare        (misma sesión; el cuerpo trae la dirección del
                               cliente, la red y el monto)

{ "requestId": "<uuid del cliente>",
  "chain": "monad",
  "asset": { "symbol": "USDC", "decimals": 6 },
  "recipient": "0x…",
  "amountRaw": "1500000" }

→ 200 { "chainId": 143,
        "network": "eip155:143",
        "transactions": [ { "purpose": "transfer", "to": "0x…",
                            "data": "0x…", "value": "0" } ],
        "movement": { "id": "…", "status": "pending" } }

→ 409 IDEMPOTENT_REPLAY cuando el mismo requestId ya preparó una transferencia
→ 400 con un código acotado: CHAIN_UNKNOWN, ASSET_NOT_ON_CHAIN,
  INVALID_RECIPIENT, INVALID_AMOUNT, AMOUNT_EXCEEDS_BALANCE, NO_GAS,
  BALANCE_UNREADABLE
```

Un token ERC-20 se manda con `transfer(recipient, amount)` desde el contrato del
token: **no necesita aprobación** porque la envía el dueño, y ese es el camino
más corto para un pago entre personas.

## Tareas

### T1 — Backend: preparar y validar la transferencia

- Reusar el **catálogo de depósito** como fuente de verdad de qué activo existe
  en qué red. No hay una segunda lista.
- Lectura de saldo por cadena con las reglas de la tabla de arriba.
- Armado de la transacción sin firmar: nativa (`value` = monto) o ERC-20
  (`transfer`).
- Idempotencia con `rewallet.idempotency_keys`: mismo `requestId`, misma
  respuesta, **sin volver a preparar**.
- Movimiento en estado pendiente.

**Gate**: `npm test` en verde, `tsc` limpio, build ok.

> **T1 — hecho (2026-10-04).** `POST /api/send/prepare` existe en
> `07.PockBackend`: `src/application/send/prepareSend.ts`,
> `src/interface/http/routes/send.ts`, `src/domain/send/` (keccak-256 sin
> dependencias, EIP-55, base58, calldata derivada) y los adaptadores de
> `rewallet.movements` y `rewallet.idempotency_keys`. **No firma nada y no manda
> nada.** Gates: `npm test` 376 en verde (31 archivos; antes 308 en 27), `tsc
> --noEmit` limpio, `npm run build` produce `dist-worker.js`. Contrato completo y
> orden de validaciones en el README del backend. Dos códigos acotados fuera de la
> tabla de arriba: `REQUEST_ID_INVALID` (una petición sin `requestId` no se puede
> proteger de un doble toque) e `IDEMPOTENT_IN_FLIGHT` (la respuesta existe pero
> todavía no está guardada). Sigue sin probarse sin una transferencia firmada de
> verdad: T2.

### T2 — Front: la pantalla de enviar

- Eligir activo y red, pegar dirección, monto.
- **Validar la dirección en el cliente antes de tocar la red**, con la misma
  regla por cadena, y volver a validar en el servidor: el cliente es una
  comodidad, no una garantía.
- Firmar con la wallet de la persona, en el mismo camino que el depósito.
- Mostrar el **hash** y releer la posición. Un envío sin hash visible no es un
  envío: es una promesa.

**Gate**: `tsc` limpio y build ok.

## Allowed edit surfaces

- `07.PockBackend/src/**`
- `07.PockBackend/test/**`
- `07.PockBackend/README.md`
- `05. UI-UX/src/App.tsx`
- `05. UI-UX/src/components/Wallet/**`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/config/**`
- `odd/tasks/pagar-enviar.md`

## Fuera de alcance

- Contactos: sale de "últimos envíos", que es la tarea siguiente.
- Cobrar con QR y detección de llegada.
- Rescate de los 0,82 USDC de la wallet sin dueño (`0xcCbe…`): está anotado y no
  bloquea esto.
- Transferencias entre nuestras propias billeteras: no hay red de pagos interna
  todavía, y una app que se paga a sí misma es una app que no puede perder plata.