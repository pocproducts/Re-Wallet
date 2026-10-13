---
name: swap-monad-estado-y-bloqueo
type: decision
project: ReWALLET
topic_key: swap/monad/estado-y-bloqueo
metadata:
  type: decision
  scope: project
---

# El swap en Monad: qué funciona, qué bloquea

## Por qué

Al revisar el módulo de swap antes de reactivarlo se encontró que **Monad no
tiene QuoterV2 desplegado**, y que esa ausencia es la razón técnica por la que
el motor estaba apagado. Documentado para no volver a perder el mismo tiempo.

## Qué se verificó contra `rpc.monad.xyz` (chain 143)

Direcciones **reales** de Uniswap V3 en Monad (las que había en el código eran
las de Ethereum):

- Factory: `0x204faca1764b154221e35c0d20abb3c525710498`
- Universal Router: `0x0d97dc33264bfc1c226207428a79b26757fb9dc3`
- Multicall: `0xd1b797d92d87b688193a2b976efc8d577d204343`
- TickLens: `0xf025e0fe9e331a0ef05c2ad3c4e9c64b625cda6f`

Tokens:

- USDC en Monad: `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (6 dec)
- USDT0 en Monad: `0xe7cd86e13ac4309349f30b3435a9d337750fc82d` (6 dec)
  — **en Monad no existe un token `USDT`**, el equivalente es USDT0

Pools USDC/USDT0 (los cuatro existen, `getPool` los devuelve):

| fee  | pool                                     | liquidity | precio     |
|------|------------------------------------------|-----------|------------|
| 100  | `0xacf82ecc826a9fc2d8c8c4d370d2d268fa5b3500` | 13.589B | 1.000591   |
| 500  | `0xa00d8ec3c0cc20e93cad749695392a0b61fe8ca3` | 196.766M | 1.000290   |
| 3000 | `0xf5ffe1d99b84db4c7c76bf112e572580e58a7cb1` | **0**   | 0.998163   |
| 10000| `0x3ea834c40c8727162bd0385cb01a86eab8c8c7e9` | **0**   | 0.996262   |

El pool de 100 tiene **~$27.2M de TVL**. Es liquidity real y profunda.
Los de 3000 y 10000 están **vacíos** — cotizar contra ellos devuelve
`amountOut = 0`, que es un número cierto y por eso es peor que no cotizar.

## El bloqueo

**No hay Quoter en Monad.** La doc oficial de Uniswap lista 4 contratos para
Monad y el Quoter no está entre ellos. El `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`
que se hereda canónico tiene bytecode (2109 bytes) y expone `0x38571708`, pero
`quoteExactInputSingle` devuelve `0x` en todos los intentos (1, 10 y 100 USDC).

Los precios de arriba se obtuvieron **leyendo `slot0()` del pool** ySacando
`sqrtPriceX96`, no llamando a un Quoter. Esa es la vía disponible hoy.

## Learned

- **Las direcciones de Uniswap NO son iguales entre cadenas.** La propia doc lo
  dice. Este proyecto ya había copiado las de Ethereum etiquetándolas como Monad,
  y el docstring decía "verificadas contra". Nunca lo habían sido.
- **`vitest.config.ts` prohíbe tests con red a propósito**, no por conveniencia:
  es lo que permite ejercitar todo offline. Por eso el test del swap verifica
  la forma de los datos (direcciones, símbolos, fee tiers) y no una llamada.
- **El build estaba roto desde que se subió el swap** (imports con rutas
  inexistentes + `readonly` en un literal de objeto). Eso, no una decisión de
  producto, es lo que dejó el motor apagado: no había nada que deployar.
- **Un símbolo que no existe en la cadena no falla: devuelve 0.** `USDT` en
  Monad caía al placeholder `0x...` y producía un `amountOut` numérico y falso.

## Decisión pendiente

Cómo cotizar sin Quoter:

- (a) Calcular desde `slot0()` + `liquidity()` — se puede hoy, es una simulación
  con las fórmulas de V3, no un `amountOut` exacto
- (b) Usar el **Trading API de Uniswap** (el mismo que usa el web app), que sí
  cotiza en Monad
- (c) Usar **Kuru Flow**, el agregador nativo de Monad, documentado por Monad

La opción (b) es la que produce un `amountOut` real y ejecutable sin escribir un
simulador de V3. Recomendada antes que (a).