# Comprar o Vender — lista real y motor de swap

## Por qué esta tarea

En `Usar → Comprar o Vender` la lista de activos está **entera mockeada**:

- El universo de la lista es `config/assets.ts` (`ASSETS`, 8 filas escritas a mano).
- Los precios son `config/markets.ts:78` (`ASSET_PRICE_USD`), los saldos son
  `config/markets.ts:113` (`BALANCES`), el tipo de cambio es `ARS_PER_USD = 1570`
  y la conversión es un cociente de dos constantes.
- El propio `markets.ts` se declara simulacro en su primera línea: *"Mercado
  simulado. Este archivo desaparece cuando exista el backend"*.
- El botón final hace `confetti()` y un `alert('¡Compra completada!')`.

Y hay un agujero peor que el mock: **4 de los 8 activos listados no existen en el
catálogo del backend** (`BTC`, `TRX`, `DOGE`, `USDT`); el backend los rechaza con
`ASSET_NOT_ON_CHAIN`. Al mismo tiempo, **`MON` no está en ninguna de las dos
tablas mock**, así que el único activo que sí se puede mover aparece con precio y
saldo `0`.

Decisión ya cerrada en `odd/tasks/catalogo-agnostico-de-cadenas-y-activos.md`: **el
catálogo vive en el backend, no en el front**. `config/assets.ts` y
`config/markets.ts` están condenados.

## Lo que ya existe y no se está usando

Todo esto ya llega a la pantalla por props y se usa en los pasos de depositar y
enviar; el bloque de trade no lo consulta:

- `GET /api/deposit-info` — catálogo real: cadena, símbolo, decimals, mint/contrato.
- `GET /api/portfolio` — saldos por cadena, con estado de lectura honesto.
- `GET /api/wallet-balance` — saldos **y precio USD** por pieza, con
  `price.source` distinguiendo `peg` de oráculo real.

## Fase 1 — la lista real (sin llaves, sin backend nuevo)

`AssetSheet` deja de tomar `ASSETS` por defecto y recibe el catálogo real. El
saldo de cada fila sale de `holdings` / `assetBalanceLabel`, que ya devuelve
`null` ("no lo sé") en vez de `0`. El precio sale de `wallet-balance`.

**Reglas que no se negocian:**
- Un saldo que no se pudo leer **no se muestra**; un cero real se muestra como
  cero. Es la misma regla que ya rige en el resto de la app.
- Desaparecen `BTC`, `TRX`, `DOGE` y `USDT` de la lista: no están en el catálogo
  y la billetera no puede moverlos.
- El botón **deja de mentir**. Mientras no exista el motor, no dice "compra
  completada" ni tira confeti. Si la acción no existe, la acción no se ofrece.
- `markets.ts` y `assets.ts` salen del camino de trade.

## Fase 2 — el motor de swap (requiere llaves)

Decisión del owner 2026-10-07: **1inch para EVM y Jupiter para Solana**. Las
llaves las consigue él después; hasta entonces se construye contra el contrato,
con el cliente inyectado y los tests sobre un doble.

- **1inch** cubre Monad (143) y Ethereum. En Solana **no hay swap clásico**: solo
  intent-based/Fusion+, que es otro flujo.
- **Jupiter** cubre Solana con el Meta-aggregator (`/swap/v2/order` → firmar →
  `/swap/v2/execute`), que devuelve la transacción base64 para firmar: el mismo
  molde que ya usa `solanaTransferPreparer.http.ts`.

El molde de ejecución ya existe dos veces y hay que seguirlo, no inventar otro:
`POST /api/send/prepare` y `POST /api/pool/deposit` devuelven
`{ chainId, approvalRequired, transactions: [{ purpose, to, data, value, chainId }] }`
para que el front firme.

## Lo que cada fase NO resuelve

- **Fase 1 no compra nada.** Deja la lista honesta y el botón sin mentira; el
  swap empieza en la fase 2.
- La fila "USDC" es una verdad ambigua: el catálogo lo tiene en tres redes. La
  fase 1 tiene que resolver qué fila muestra una persona que tiene USDC en dos
  cadenas.
- Falta la migración que versione `swap_quotes` / `swap_executions`
  (`catalogo-agnostico-de-cadenas-y-activos.md`, T5): hoy solo existen en un SQL
  de contexto que nunca se aplicó.

## Gates

- Ningún número en pantalla que no venga de una lectura real.
- Ninguna acción ofrecida que no pueda ejecutarse.
- 748 tests del backend verdes y `tsc` limpio (mínimo: no romper nada).
---

## F1 y F2 cerradas el 2026-10-07

- **F1 (lista real)**: la lista sale del catálogo del backend, con red nombrada
  por fila y saldos y precios de lecturas reales. El botón que decía "compra
  completada" ya no existe.
- **Swap apagado del menú**: el botón "Usar" y los botones Comprar / Vender /
  Cambiar se fueron. Quedan Depositar y Enviar. El código de trade queda
  estacionado y comentado, porque es la base de F2.

## Lo que F2 necesita, y no es código

1. **Llaves.** 1inch Business es de pago para EVM; Jupiter tiene plan gratuito
   para Solana. El owner las consigue.
2. **Un RPC de Solana con llave.** Medido desde el runtime del Worker: ningún
   endpoint gratuito y sin llave sirve consultas indexadas desde Cloudflare.
   `SOLANA_RPC_URL` es la válvula: una línea y la parte de Solana queda entera.
3. **La migración de `swap_quotes` / `swap_executions`** (T5 del task de
   catálogo): hoy solo existen en un SQL de contexto que nunca se aplicó.
4. **La verificación de la transacción antes de firmarla.** Es lo primero que
  hay que escribir y lo que menos obvio es: es la primera vez que la app firma
   calldata construida por un tercero.
