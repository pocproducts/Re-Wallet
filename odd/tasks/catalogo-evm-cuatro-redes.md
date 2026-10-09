# Agregar las 4 grandes redes EVM al catálogo de depósito

## Objective

Que la billetera pueda **recibir** assets en Base, Arbitrum, Optimism y Polygon,
al mismo nivel que hoy Monad y Ethereum: catálogo de depósito honesto (contrato
verificado en cadena), portfolio que las lea con el mismo lector, y la wallet
EVM de Privy operando en esas redes.

## Why

Privy crea una sola wallet EVM que sirve para **todas** las redes EVM
configuradas. Hoy el catálogo solo declara Monad y Ethereum, así que todo
asset que llegue por Base/Arbitrum/Optimism/Polygon no tiene destino visible
en la app.

## Scope

- Redes nuevas: **Base (8453), Arbitrum One (42161), OP Mainnet (10), Polygon (137)**.
- Por red: moneda nativa + USDC (+ USDT solo donde el contrato verifique en cadena).
- Tocar: ids CAIP-2, lista de redes del portfolio, catálogo de depósito,
  ASSETS_BY_CHAIN, endpoints RPC por red (con override por env), wiring del
  container, Privy `supportedChains` del front.
- Fuera de alcance: redes fuera de las 4 (Avalanche, Linea, Zora, Celo...),
  tokens más allá de nativo/USDC/USDT, gas sponsorship.

## Rules del repo (no negociables)

- Cada token entra **después** de verificar en cadena: bytecode presente,
  `symbol()` y `decimals()` correctos. Una dirección copiada de otra red es un bug.
- Cada endpoint RPC nuevo se prueba a mano (`eth_blockNumber`, `eth_getBalance`,
  `balanceOf` en USDC) antes de declararlo.
- `balanceReadable: false` es válido: recibir sí, cifra todavía no.

## Checklist

- [x] 1. Verificar en cadena (bytecode + symbol + decimals): USDC y USDT en Base, Arbitrum, Optimism, Polygon. Anotar direcciones verificadas.

  Verificado 2026-10-08 con `eth_getCode` + `symbol()` + `decimals()`:

  | Red | Nativo | USDC (6 dec) | USDT (6 dec) | RPC que respondió |
  |---|---|---|---|---|
  | Base (8453) | ETH (18) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | https://mainnet.base.org |
  | Arbitrum One (42161) | ETH (18) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | https://arb1.arbitrum.io/rpc |
  | OP Mainnet (10) | ETH (18) | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | https://mainnet.optimism.io |
  | Polygon (137) | POL (18) | `0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | https://polygon.drpc.org (polygon-rpc.com hoy devuelve 403) |

- [x] 2. `evmNetwork.ts`: agregar los 4 CAIP-2 ids a `SUPPORTED_EVM_NETWORK_IDS` y tests.
- [x] 3. `networks.ts`: agregar las 4 a `EVM_NETWORKS`/`PORTFOLIO_CHAINS`/`WALLET_CHAIN_FOR` y tests de orden.
- [x] 4. `catalog.ts`: declarar las 4 redes con nativo + USDC (+USDT verificado), `balanceReadable` según lector.
- [x] 5. `assets.ts`: filas nuevas en `ASSETS_BY_CHAIN` consumiendo el catálogo.
- [x] 6. `jsonRpcEvmBalanceReader.ts`: endpoints por red + overrides de env (`BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`, `POLYGON_RPC_URL`), probados a mano.
- [x] 7. Container/wiring + stores (movimientos/wallets) aceptan las redes nuevas si aplican.
- [x] 8. Front: `supportedChains` de Privy incluye las 4; deposit-info/env vars.
- [x] 9. Tests: `npm test` verde; typecheck verde.

## Acceptance criteria

- `/api/deposit-info` lista las 4 redes con dirección real y assets clasificados.
- El portfolio lee (o declara `error` honesto) en las 4 redes.
- Ningún contrato se declara sin verificación en cadena documentada en el código.
