# Datos reales de cadena, Monad, webhooks y Aave

## Qué pide el owner

Dejar la billetera con datos ciertos: USDC (u$) en la billetera, y los activos
de Monad y Solana en *Bitcoin & Cripto* con su detalle. Todo leído de la
cadena, no de ejemplo. Después: webhooks que lleguen a las notificaciones de la
UI, y conexión con el pool de liquidez que da rendimiento sobre los dólares.

## Decisiones tomadas

1. **Los saldos se leen de la cadena.** Nada de cifras de ejemplo en billetera ni
   en *Bitcoin & Cripto*.
2. **Monad se suma; Ethereum se queda.** Monad entra como red soportada y la
   red por defecto sigue siendo Ethereum. La persona puede cambiar de red.
3. **Webhooks después, no ahora.** Primero que la app lea datos reales — saldos,
   assets y detalle — y después el canal de notificaciones.
4. **El depósito en Aave es real.** Approve y depósito firmados por la wallet de
   la persona. Es mainnet: hace falta USDC y MON de gas.

## Un hallazgo que ordena el plan

### La wallet EVM es la misma en Monad

La documentación de Privy dice que las wallets embebidas soportan **cualquier
cadena EVM**, configuradas con `defaultChain` y `supportedChains` en el
`PrivyProvider`, y que la wallet embebida se inicializa en la red por defecto y
después cambia de red.

Consecuencia directa: **la dirección EVM de una persona sirve en todas las redes
EVM configuradas.** No hay que crear una wallet nueva ni migrar nada. Lo que hay
que cambiar es la **configuración de red**, no el número de wallet.

### El balance de la base no se toca

`rewallet.wallets` tiene `address` UNIQUE y una fila por persona y cadena. Como
la misma dirección sirve en varias redes EVM, **agregar una fila por red rompería
esa restricción**. La red en uso es una propiedad de la sesión, no de la wallet.

Lo que sí hace falta es poder **registrar en qué red EVM está operando** la
persona, para no mandar una transacción a la red equivocada. Eso es una columna
nueva con default, no una migración destructiva.

### Verificado en cadena hoy

| Hecho | Resultado |
|---|---|
| RPC de Monad responde | sí, `rpc.monad.xyz` |
| RPC de Solana responde | sí, `api.mainnet-beta.solana.com` |
| USDC de Monad se lee | sí, `balanceOf` por `eth_call` |
| `aMonUSDC` responde | sí, `symbol()` devuelve `aMonUSDC` |
| **Aave: `getPool()`** | **revierte** |
| **Aave: `getReservesList()`** | **revierte** |
| **Aave: `getReserveData(USDC)`** | **revierte** |

Las direcciones de Aave que teníamos anotadas el 27 de septiembre **ya no
responden**. Los tres contratos tienen bytecode, así que no desaparecieron: el
despliegue se movió.

**Regla que se aplica: ninguna dirección de contrato se copia de la memoria.** Se
deriva de la fuente oficial y se verifica en cadena antes de escribir nada. Ya
se pagó una vez: leer `getReserveData` sobre el contrato equivocado produce un
error que parece "no hay reserva".

## Tareas

### T1 — Backend: saldos reales

Un caso de uso de lectura, con puertos inyectados para que los tests no toquen
la red.

- `GET /api/portfolio`: saldos de la persona, por cadena y por activo.
- Monad: saldo nativo (MON) y balance de USDC por `eth_call` a
  `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`.
- Ethereum: mismo contrato, red distinta.
- Solana: `getBalance` con lamports.
- **Un número no redondeado en la respuesta.** El redondeo a dos decimales es
  decisión de pantalla, no del backend: la app necesita poder mostrar centavos y
  tener el valor entero para operar.
- Si una cadena falla, la respuesta lo dice por cadena. Una red caída no puede
  vaciar la billetera entera.

**Gate**: tests verdes y `tsc` limpio.

**Estado: hecho en el backend.** `GET /api/portfolio`, con puertos inyectados
(`EvmBalanceReader`, `SolanaBalanceReader`) y la fila de `rewallet.wallets` como
única fuente de direcciones. Formato de la respuesta, decisiones y variables
opcionales en `07.PockBackend/README.md` (`GET /api/portfolio`).

Lo que quedó demostrado por test: los importes exactos sin redondear con su unidad
y sus decimales (18, 6 y 9), una cadena caída reportada como `error` con razón
acotada mientras las otras devuelven valores, un cero reportado como cero (no como
error ni como ausencia), una cadena sin fila de wallet reportada como `no_wallet`
(no como saldo cero), `401` sin sesión, y una dirección mandada en la query o en
el cuerpo ignorada —la dirección siempre sale de la base—. 145 tests verdes
(antes 106), `tsc --noEmit` limpio y `dist-worker.js` construido.

Lo que **no** quedó demostrado: nada se probó contra una sesión real autenticada
ni contra las RPC reales. Los adaptadores se ejercitan con un `fetch` inyectado.
Falta una prueba manual autenticada que confirme que `rpc.monad.xyz` y
`api.mainnet-beta.solana.com` responden lo que el adaptador espera con una
dirección real, y que el despliegue con `DATABASE_URL` real resuelve la fila de
wallet. La UI (T3) ya lo consume: `src/hooks/usePortfolio.ts`, una lectura por
sesión, y las pantallas de billetera, inversiones, dólares digitales y
*Bitcoin & Cripto*.

### T2 — La red Monad, configurada y registrada

- `PrivyProvider` con `defaultChain` Ethereum y Monad en `supportedChains`,
  usando `defineChain` de `viem` con los datos de Monad mainnet verificados en
  cadena antes de escribirlos.
- La base registra en qué red EVM opera la persona, con default Ethereum, para
  no operar en la red equivocada.
- Un intento de operar en una red que no está en la lista debe fallar con un
  mensaje que lo diga, no con una transacción en otra red.

**Gate**: `tsc` limpio, y la red configurada verificada contra la cadena.

**Estado: parcial.** La red quedo configurada y registrada, pero la tercera
vineta ("un intento de operar en una red que no esta en la lista debe fallar con
un mensaje que lo diga") **no** esta hecha: todavia no hay una operacion que
pueda mandarse a la red equivocada, asi que no hay que rechazarla.

- `05. UI-UX/src/config/chains.ts` es **la** configuracion de red: Monad mainnet
  con `defineChain` de `viem` (id 143 leido de `eth_chainId = 0x8f`,
  `https://rpc.monad.xyz`, MON 18 decimales) y `monadscan.com` como exploradora,
  verificada sirviendo una transaccion real de la red 143. `main.tsx` pasa
  `defaultChain` = Ethereum y `supportedChains` = [Ethereum, Monad] por
  `config` (en `@privy-io/react-auth@3.47` las cadenas van dentro de `config`,
  no como props sueltas del provider).
- `rewallet.wallets.evm_network` (CAIP-2, `NOT NULL DEFAULT 'eip155:1'`) registra
  en que red EVM opera la persona, sin filas nuevas y sin cambiar ningun
  constraint. Los dos rows existentes quedaron en `eip155:1` sin paso de datos.

Pendiente de esta tarea: exponer la eleccion de red en la UI y **rechazar** una
red no soportada antes de firmar nada.

### T3 — La UI con datos reales

- Billetera: USDC en **u$**, y el resto de los saldos que hoy son de ejemplo,
  reemplazados por los reales.
- *Bitcoin & Cripto*: **MON** y **SOL** con su detalle, saldos reales.
- Si un saldo es cero, se muestra cero. Nunca un número inventado.
- El envío a Solana usa la wallet de Solana y el saldo real de esa wallet.
- **No se tocan** las tres vistas en su estructura ni en su diseño: solo los
  datos que reciben y los textos de los activos.

**Gate**: `tsc` limpio, y los valores de pantalla coinciden con lo que devuelve
`GET /api/portfolio`.

**Estado: hecho en la lectura de saldos; el envío a Solana sigue pendiente.**

La lectura existe de punta a punta y los saldos de pantalla salen de
`GET /api/portfolio`, no de una tabla:

- `src/types/portfolio.types.ts` — el contrato, con los tres estados de cadena
  explícitos y no intercambiables (`ok` con `amount: "0"` es un cero real,
  `error` es una cadena que no se pudo leer, `no_wallet` es que no hay billetera).
- `src/services/portfolio.ts` — el `GET`, la normalización y la aritmética en
  `bigint`. Los importes llegan sin redondear y con su `decimals`, así que la
  suma de dólares entre cadenas es exacta y el redondeo a dos decimales ocurre
  **después**, una sola vez, para pintar. Sin precio de mercado no hay total en
  dólares: eso no se calcula.
- `src/services/portfolioIdentity.ts` — identidad de pantalla de los tickers que
  reporta la cadena. La primera fuente es el catálogo de producto; lo único que
  se agrega es **MON**, que el backend ya devuelve y el catálogo todavía no
  conhece. Un ticker sin identidad no se muestra.
- `src/hooks/usePortfolio.ts` — **una lectura por sesión**, en un efecto y nunca
  en el cuerpo de un render, con el mismo corte por identidad que
  `useSessionGate` y `useUserWallets`. El `App` la corre una vez y le pasa el
  resultado a las tres vistas: un hook por pantalla sería una lectura de
  blockchain por navegación.
- `WalletView`, `InvestmentsView`, `DigitalDollarsView`, `CryptoAssetsListView` y
  `CryptoAssetDetailModal` — los saldos, las redes y la dirección de depósito
  salen del portfolio. El detalle del activo muestra las redes donde ese símbolo
  tiene saldo, con **la dirección de esta persona en cada una**; antes había una
  red inventada por ticker y una dirección escrita a mano que era la misma para
  todas.

Lo que sehorecordó por ser lo más caro de dejar:

- **Un cero y un fallo se ven distintos.** Una cadena `error` o `no_wallet`
  escribe su frase en castellano —"No pudimos leer tu saldo en Monad", "No tenés
  una billetera en Solana"— y el resto de la pantalla se dibuja igual. El enum
  del backend va al log, nunca a la pantalla.
- **Un cero real se muestra como cero.** `status: "ok"` con `amount: "0"` se
  pinta `0` en la lista y `u$0,00` en la billetera.
- **Las doce filas inventadas desaparecieron.** Bitcoin, Ethereum, Solana, Tron,
  Dogecoin, Cardano, Avalanche, Polygon, Chainlink, Ripple, Polkadot y BNB con
  `0,00156 ETH`, `7,1936 TRX`, `U$20,15`, `≈ $31.640,71 ARS` y `+4,28% hoy`: son
  saldos que la persona nunca tuvo. Ahora se lista lo que la cadena reportó y
  nada más.
- **La dirección de depósito es real o no se muestra.** Antes era
  `0x4613c015949e50ba`, escrita a mano, en una pantalla que sirve para mandar
  plata.

Lo que **no** quedó demostrado: nada se probó contra una sesión real autenticada.
La normalización, la aritmética decimal y los tres estados de cadena se
ejercitaron con respuestas escritas a mano —incluido el cero real, el cero con
cadena caída al lado, las escalas mezcladas y los importes con más decimales de
los declarados—, pero falta la lectura contra `rpc.monad.xyz` y
`api.mainnet-beta.solana.com` con una sesión de verdad.

Pendiente de esta tarea: **el envío a Solana con el saldo real de esa wallet**.
Hoy el backend expone lectura de saldos; la firma y el envío por la wallet de
Solana son otro circuito.

### T4 — Webhooks que llegan a la UI

- El Worker recibe los webhooks de Privy, **verifica la firma** con
  `PRIVY_WEBHOOK_SIGNING_SECRET`, y guarda el evento en `rewallet.webhook_events`.
- Una persona que no está autenticada **no puede escribir** eventos.
- La pantalla consulta y muestra lo nuevo. Empezar por consulta periódica; si
  hace falta más,in-time es un cambio aparte y consciente.

**Gate**: un webhook firmado llega y aparece; uno con firma inválida, no.

### T5 — Aave en Monad, con dirección verificada

- **Primer paso, bloqueante: derivar el pool desde la fuente oficial de Aave para
  Monad y verificarlo en cadena.** Con la dirección verificada:
- Depositar USDC: `approve` y `deposit`, firmados por la wallet de la persona.
- El token de recibo en Monad es **`aMonUSDC`**, no `aUSDC`.
- Mostrar la tasa y el crecimiento del depósito.
- Requiere USDC y MON de gas en la wallet de Monad. **Sin gas, no hay depósito**:
  eso se dice con un mensaje, no con un error crudo.

**Gate**: la dirección del pool está verificada en cadena antes de que exista una
línea de código que la use.

## Superficies de edición

- `07.PockBackend/src/**`
- `07.PockBackend/test/**`
- `07.PockBackend/sql/**`
- `05. UI-UX/src/App.tsx`
- `05. UI-UX/src/main.tsx`
- `05. UI-UX/src/components/Wallet/**`
- `05. UI-UX/src/components/Investments/**`
- `05. UI-UX/src/components/Navigation/**`
- `05. UI-UX/src/components/Activity/**`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `odd/tasks/datos-reales-monad-aave.md`

## Fuera de alcance

- Testnet: Aave en Monad solo existe en mainnet.
- Multichain más allá de Ethereum, Monad y Solana.
- Envío real de fondos más allá de la prueba que手动 se haga a mano.