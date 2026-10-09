# Yield real — el pool de Aave V3 se lee de la chain

<!--
> **RECONCILIADO 2026-09-29**
> **Estado real: closed**, y su límite de alcance es deliberado: cerró el LADO DE LECTURA
> de T10 en `odd/tasks/backend-fase1.md`, y excluye explícitamente `yield_positions` y
> `yield_accruals`, que es exactamente la mitad que sigue faltando.
> Ojo con sus rutas, que están viejas: `Front End/src/data/poolApi.ts` no existe —la
> costura real del front es `domain/pools/poolRepository.ts` más
> `infrastructure/pools/httpPoolRepository.ts` y `application/pools/usePools.ts`— y
> `Front End/src/components/InvestmentsView.tsx` hoy es
> `Front End/src/interface/screens/InvestmentsScreen.tsx`. La tabla de Alcance de abajo
> se deja como está: es el registro de la decisión.
> **Mapa y contradicciones: `odd/roadmap.md` seccion 2 y 3.**
-->

## Objetivo

Que `GET /yield/summary` devuelva la tasa **real** del pool de USDC en Aave V3 sobre
Monad, leída de la chain en cada request, y que el front la muestre en vez del
número inventado. Sin login, sin wallet, sin sesión: lectura pública.

## Por qué esta tarea

El PoC se cortó acá. La **posición** se leía (`aUSDC.balanceOf`) pero la **tasa** no,
porque el primer intento con `getReserveData` y el layout adivinado devolvió
**3183% anual** — leyó el aToken como interest-rate strategy. Un índice de struct
equivocado en Aave v3.7 **no tira error**: devuelve un número plausible.

Mientras tanto `Front End/src/components/Wallet/WalletView.tsx:87` muestra
"Rindiendo 20.77% anual", que es inventado. La regla 4 del repo dice: un número que
no se pudo verificar no se muestra. Hoy se muestra.

## Verificación del layout (2026-09-28, mainnet, chain 143)

`Backend/scripts/test-aave-apy.ts` ejecutado contra `https://rpc.monad.xyz`:

- índice **2** = `currentLiquidityRate` = `41279110802650329225207076` → **4.1279% APR**
- índice **8** = `aTokenAddress` = `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042`,
  que **coincide** con la aUSDC verificada on-chain

El aToken que devuelve el struct es el que esperábamos: el layout está confirmado, y
esa coincidencia es lo que convierte una corazonada en una lectura verificada.

**El guard que faltaba en el PoC:** si el aToken que devuelve la chain no es el
aToken que esperamos, la lectura **falla**. Con eso, el 3183% es imposible por
construcción, no por suerte.

## Alcance

Vertical slice completo, hexagonal:

| Capa | Archivo |
| --- | --- |
| domain | `src/domain/yield/reserveRate.ts` — RAY→bps, pairing guard |
| domain | `src/domain/ports/aave-reader.ts` — puerto |
| infrastructure | `src/infrastructure/aave/viemAaveReader.ts` — adaptador viem |
| application | `src/application/yield/getPoolSummary.ts` — caso de uso |
| interface | `src/interface/http/yield/yieldRoutes.ts` — `GET /yield/summary` |
| front | `src/data/poolApi.ts` + `WalletView` / `InvestmentsView` |

## Fuera de alcance

T10 completo (posición del usuario, `yield_positions`, `yield_accruals`, APY con
rewards de Merkl). Esto es **la tasa del pool**, que es pública y no necesita auth.
El depósito sigue siendo un trabajo aparte que sí requiere la pila completa.

## Criterios de aceptación

- `GET /yield/summary` responde `{ok:true,data:{...}}` con la tasa leída de mainnet.
- Si la chain devuelve un aToken distinto al configurado, responde 500 y **no**
  devuelve número. Un APY no verificable no viaja.
- El front muestra esa tasa y borra `20.77%`.
- `npm run typecheck` y `npm run test` en verde.

## Estado

- [x] Layout de `getReserveData` verificado contra mainnet
- [x] T1 dominio: `reserveRate.ts` + `aave-reader.ts`
- [x] T2 adaptador viem
- [x] T3 caso de uso + ruta
- [x] T4 wiring + `.env`
- [x] T5 tests
- [x] T6 front lee la API
- [x] T7 verificado end-to-end en localhost
