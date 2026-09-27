# Capa de gas

Una sola interfaz: `GasService.sendTransaction(userOp)`. El resto del backend
(`sendMoney`, `addMoney`) no sabe qué proveedor está activo.

## Los dos proveedores

| | Privy | Pimlico |
|---|---|---|
| Fase | `GAS_PHASE=mvp` | `GAS_PHASE=production` |
| Modo | `app_pays` — la app cubre el gas | `user_pays` — el usuario paga en USDC |
| Bundler | lo maneja Privy internamente | explícito, `PIMLICO_BUNDLER_URL` |
| Smart account | EIP-7702 delegation | Safe + `permissionless.js` |
| Disponible en Monad | sí (mainnet y testnet) | user-pays **todavía no** |

## Cómo se migra

```bash
GAS_PHASE=production     # en el env. Nada más cambia.
```

`buildGasConfig()` valida en el arranque: si `GAS_PHASE=production` y falta
`PIMLICO_BUNDLER_URL`, el proceso **se niega a arrancar**. Un despliegue mal
configurado nunca puede parecer sano.

`GET /gas/status` reporta la fase, el proveedor y la red activos, para que el
cambio sea observable y no silencioso.

## Testnet ↔ mainnet

Se cambia `MONAD_CHAIN_ID` (10143 ↔ 143). El código es idéntico; lo único que
distingue una red de otra es la dirección de los contratos y el saldo real.

## EIP-7702 en Monad — leer antes de tocar esto

Una EOA delegada vía EIP-7702 **no puede** enviar una transacción que baje su
saldo de MON por debajo de 10: revierte incondicionalmente.

Todos los caminos de esta capa son paymaster, así que el saldo de MON de la
wallet que firma **nunca se toca** y la restricción no aplica. Si alguna vez se
agrega un camino donde el usuario paga gas con su propio MON, esa garantía deja
de ser cierta y el camino fallará para cualquiera con menos de 10 MON.

## Custodia

`UserOp.walletId` es la wallet **del backend** (decisión D1: custodia Opción A),
no una embedded wallet de Privy por usuario. La embedded wallet de Privy, si se
habilita, es identidad — no es lo que firma.

## Idempotencia

`sendTransaction` busca una fila previa por `idempotency_key` **antes** de firmar
nada. Si existe y no está `pending`, devuelve el mismo resultado. El índice único
en `gas_sponsorships.idempotency_key` es la red final contra dos requests que
corran a la vez.

## Lo que el usuario nunca ve

- Ni "gas", ni "fee", ni "network cost", ni MON
- Si el paymaster falla: `GAS_COPY.failure` — "Algo no salió como esperábamos.
  Podés reintentar."
- El proveedor no se expone al frontend. El frontend solo llama a
  `POST /wallet/send`.
