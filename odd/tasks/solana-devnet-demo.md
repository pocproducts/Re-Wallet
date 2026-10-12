# Feature: pivot a Solana devnet para la demo del hackathon

## Objetivo

Gritar nada. Hoy 2026-10-11 23:59 ART cierra la entrega del Colosseum · Superteam
Argentina: el producto tiene que mostrar una transacción real de Solana con
firma en el explorer. El jurado acepta devnet. La app estaba cableada a mainnet.

## Qué se cambió

- **Clúster por configuración, no por string suelto.** Nuevo módulo
  `07.PockBackend/src/domain/solana/cluster.ts`: specs verificadas de mainnet y
  devnet (genesis hash leído de `getGenesisHash` contra `api.devnet.solana.com`,
  mint de USDC de devnet verificado con `getAccountInfo` contra el mismo RPC),
  y `configureSolanaCluster()` que el contenedor setea una vez por boot
  (`SOLANA_CLUSTER` del env; default mainnet).
- Lo leen: `domain/send/transfer.ts` (`chainIdentityFor` de Solana),
  `domain/deposit/catalog.ts` (el mint del USDC) y
  `infrastructure/rpc/solanaTransferPreparer.http.ts` (red fallback).
- **Front**: `05. UI-UX/src/config/chains.ts` lee `VITE_SOLANA_CLUSTER` al build
  (default mainnet). El bundle de hoy está horneado en devnet.
- **Despliegue**: `SOLANA_CLUSTER=devnet` como var del worker y
  `SOLANA_RPC_URL` apuntado a `https://api.devnet.solana.com`.

## Restricciones que se respetaron

- Privy 3.47 soporta `solana:devnet` de fábrica (confirmado por sus propios
  tipos), así que el flujo de firma es idéntico.
- El depósito a Kamino **sigue irreducible hoy**: `completion.executes: false`
  por diseño del equipo (faltan las instrucciones del programa Farms, sin
  fuente autoritativa). No se forzó horas antes de la demo. En la demo se
  etiqueta como próximo y se muestra el envío a @tag.

## Estado

- [x] Módulo de clúster + wiring completo, backend y front.
- [x] Tests: backend 935/935 (69 archivos, incluye el test del contrato del
  clúster), front 234/234 + `tsc` limpio.
- [x] Build del front con `VITE_SOLANA_CLUSTER=devnet` y deploy en vivo:
  versión `d7639dca` accesible, API sana (metrics 200, session 401).
- [ ] **[Usuario]** faucet.circle.com a una wallet de prueba con USDC devnet,
  enviar 1 USDC a un @tag de una segunda cuenta, mostrar la firma en
  `explorer.solana.com/?cluster=devnet`, sacar screenshots.
- [ ] Post-hackathon: revertir worker a `SOLANA_CLUSTER=mainnet` (bajar la var)
  y reconstruir el front sin la env.

## Aprendizaje

- Devnet de Solana **fue reiniciada** (2023): el genesis hash flotando en la
  documentación vieja no es el actual ("RuLo..." vs "Ru166..."). Verificar el
  RPC es la respuesta canónica.
- Las bindings del Worker **no** son `process.env`; el contenedor fusiona los
  dos. Por eso el clúster se configura en `buildApp` y no se lee suelto.
