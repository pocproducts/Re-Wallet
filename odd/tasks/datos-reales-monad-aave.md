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

**Estado: las cifras inventadas de rendimiento ya no están.** El detalle del pool
(`components/Yield/AavePoolsView.tsx`) no muestra ninguna tasa ni total del pool:
dice, en las mismas palabras que la tarjeta de `DigitalDollarsView`, que todavía
no hay conexión con Aave. La píldora de la billetera dejó de decir `Rindiendo
3,90% anual` por lo mismo, y `POOL_SUPPLY_APR` y `formatApr()` se borraron de
`config/markets.ts`: la tasa entra con T5, desde el pool.

Lo que sigue mock, y por qué: `ASSET_PRICE_USD`, `BALANCES` y `ARS_PER_USD`
consumen en `components/common/AssetTradeCard.tsx`, `components/common/AssetSheet.tsx`
y `config/displayCurrency.ts`, que no son de este cambio. Borrarlos sin tocar esas
pantallas no haría la app más verdadera: haría que el equivalente en dólares
muestre `$0,00` y que el selector de activo muestre saldo cero. Se borran cuando
esas tres pantallas lean el mismo portfolio del backend.

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

### T3b — Cifras inventadas que quedaban en pantalla

La lectura de saldos quedó real en T3, pero quedaban cuatro pantallas que
seguían mostrando números escritos a mano, ninguno de los cuales venía de la
cadena. En una app de dinero eso no es un bug de estilo: una cifra escrita a
mano se lee como plata que la persona tiene, o —en el caso del rendimiento—
como plata que ya está ganando.

Las cuatro, y lo que dice cada una ahora:

| Pantalla | Antes | Ahora |
|---|---|---|
| `DigitalDollarsView`, tarjeta de rendimiento | `3,90%`, `$150 . 198 . 641`, `89%` | Sin cifras. Dice que todavía no hay conexión con Aave, que no hay nada depositado y que el rendimiento es cero por eso, no porque el pool rinda poco |
| `ChargeQrModal` | `btcBalance = 0.000186` por defecto, persistido en `localStorage`, y un pago de `0,00005 BTC` que se daba por hecho a los 1,8 s | Cobra a la dirección real de `GET /api/portfolio`, y sin dirección real no genera el QR. El pago con QR ya no se simula: dice que todavía no puede leer el código |
| `ActivityView` | Siete movimientos de ejemplo con fechas de septiembre y `- 4.000,00 ARS`, `+ 7,193689 TRX`, `+ 18,93880759 DOGE`, `+ 0,0155256 SOL` | Estado vacío: “Todavía no hay movimientos”. `GET /api/portfolio` devuelve saldos, no movimientos, y no hay fuente real de historial |
| `CryptoAssetDetailModal` | Una curva púrpura fija en el SVG, idéntica para todos los activos y sin ninguna serie detrás | Sin gráfico, con estado vacío. Los selectores de período quedan: son una elección de la persona, no un dato |

La regla que queda escrita: **una cifra de dinero sale de `GET /api/portfolio` o
no sale.** Un cero sólo se muestra cuando el cero es lo que dijo la cadena, y
una cadena que no se pudo leer se dice, no se convierte en cero.

**Lo que quedó fuera y hay que saber**: `src/components/Yield/AavePoolsView.tsx`
sigue mostrando `$150.198.641`, `89%`, `89,21%` y la tasa de
`formatApr()`, y esa pantalla se abre desde el botón “Ver más” de la tarjeta que
recién se limpió. No se tocó porque no estaba en las superficies autorizadas
para esta pasada. Es la deuda más cara que queda de este trabajo.

**Gate**: `tsc --noEmit` limpio, `vite build` correcto, y
`grep -rn "0.000186\|150.198.641\|89 %\|89%\|31.640" src` sin coincidencias que
no sean comentarios al servicio de este registro.

### T4 — Webhooks que llegan a la UI

- El Worker recibe los webhooks de Privy, **verifica la firma** con
  `PRIVY_WEBHOOK_SIGNING_SECRET`, y guarda el evento en `rewallet.webhook_events`.
- Una persona que no está autenticada **no puede escribir** eventos.
- La pantalla consulta y muestra lo nuevo. Empezar por consulta periódica; si
  hace falta más,in-time es un cambio aparte y consciente.

**Gate**: un webhook firmado llega y aparece; uno con firma inválida, no.

**Estado: hecho en el backend.** `POST /api/webhooks/privy` y
`GET /api/notifications`, con `PRIVY_WEBHOOK_SIGNING_SECRET` como quinta variable
obligatoria (falla cerrada con las otras cuatro).

- **Firma Svix** verificada en `src/domain/webhooks/svixSignature.ts`: contenido
  firmado `${svix-id}.${svix-timestamp}.${cuerpo crudo}`, clave = secreto sin
  `whsec_` en base64, HMAC-SHA256 en base64, tolerancia de 5 minutos en **las dos**
  direcciones. **No se agregó la dependencia `svix`**: el esquema es un HMAC sobre
  una cadena y Web Crypto ya está en el runtime; la dependencia<Node-oriented`
  entraría al bundle de workerd, y los tests re-derivan la firma con `node:crypto`
  para que la implementación se comprueba contra el esquema y no contra sí misma.
- **Nada sin verificar se guarda.** Sin cabeceras, firma inválida o cuerpo editado
  tras firmar: `401` y **cero filas**. No existe fila con
  `signature_valid = false`: la ruta es pública y una fila sin verificar sería una
  superficie de escritura abierta de la que además lee el feed.
- **Reintentos**: el duplicado se rechaza por `external_id`
  (`UNIQUE (source, external_id)` + `ON CONFLICT DO NOTHING`) y responde **200 con
  cuerpo vacío**. Un timestamp viejo se rechaza como `STALE`. Son dos defensas
  distintas: la relojera no depende de la base y la deduplicación no depende de la
  ventana de 5 minutos.
- **Feed por persona**: misma cookie de sesión que el resto, orden reciente primero,
  tope de 50, `eventType`/`category`/`message`/`createdAt`, **sin payload**. Un
  `event_type` desconocido produce una frase usable (`Se recibió un evento de tu
  cuenta.`, categoría `other`) en `src/domain/webhooks/eventDescription.ts`: nunca
  en blanco, nunca inventando qué pasó, nunca descartado en silencio.
- **Sin columna de atribución.** La tabla no se tocó: el feed filtra con
  `payload @> …` y el índice GIN de `payload` puede servirlo (`jsonb_ops` tiene la
  estrategia 7 = `@>`, verificado en el catálogo). Una columna `privy_did` sería
  una copia de un dato que ya está en `payload`, escrita por la misma extracción
  que hace falta igual, y las dos podrían contradecirse.
- **Sin efectos secundarios**: ni trabajo de wallet, ni push, ni `processed_at`.

Lo que quedó demostrado por test: 236 tests verdes (antes 157), `tsc --noEmit`
limpio y `dist-worker.js` construido. Contratos, mapeo y decisión de atribución en
`07.PockBackend/README.md`.

Lo que **no** quedó demostrado: nada se probó contra la base real (la tabla tiene 0
filas y no se escribió ninguna), ni contra una entrega real de Privy, ni contra
una sesión real autenticada. `wrangler.jsonc` sigue listando cuatro secretos en su
comentario y hay que agregarle el quinto; queda pendiente porque esa superficie no
era editable en esta tarea. La UI (consumo de `GET /api/notifications`) no se tocó:
su superficie no estaba autorizada acá.

#### T4b — La UI del feed (`05. UI-UX`), consumo posterior

- `services/notifications.ts` lee `GET /api/notifications` y normaliza **a
  propósito**: una fila sin `id`/`message` legibles no se muestra, pero una
  categoría desconocida se lee como `other` — se pierde peor un evento real que
  no tenga ícono. El tipo de respuesta **no tiene `payload`**: no es una decisión
  de estilo, es que no hay nada que pedir ni mostrar.
- `hooks/useNotifications.ts` replica el patrón de `usePortfolio`: una lectura por
  sesión, corte en `useEffect`, liberada al cerrar sesión, `reload()` explícito.
  Los estados son `idle | loading | empty | ready | unavailable`: `empty` (no hay
  eventos) y `unavailable` (no se pudieron leer) son hechos distintos, igual que
  `usdcNote` distingue la cadena caída de la billetera vacía. Un `502` nunca se
  pinta como lista vacía.
- Un `401` (`UNAUTHENTICATED`) no abre modal: es la misma cookie del resto, así
  que la persona ya no tiene sesión y la salida es el cierre de sesión que ya
  usaba la app.
- El punto de "nuevo" de la campana se deriva del `id` del evento más reciente
  contra el `id` más reciente guardado en `localStorage`
  (`rewallet_notifications_seen`, `{ newestId, seenAt }`). Sólo ids y una hora:
  **ni un payload, ni un token, ni un mensaje**. Se marca visto al abrir el modal.
- No hay push: el feed se lee al cargar la app y con el botón de recargar del
  modal. La pantalla no promete nada en vivo.

Lo que **no** quedó demostrado: sin runner de tests en el front (y está prohibido
agregarlo), así que lo verificado fue `npm run lint` (`tsc --noEmit`) limpio y
`npm run build` exitoso. **Ninguna** fila se vio contra el backend desplegado:
la tabla sigue con 0 filas, así que `ready`, `empty` y `unavailable` no se
ejercitaron contra datos reales; hace falta una entrega real de webhook con una
sesión real para probar el feed de punta a punta.

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

**Estado: hecho.** El backend lee la reserva y arma las transacciones; el front
las firma y vuelve a leer la posición.

#### Las direcciones (verificadas por tres fuentes el 2026-10-04)

| Qué | Dirección | Verificada por |
|---|---|---|
| Pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | `aave-address-book` `AaveV3Monad.POOL`, **y** `aMonUSDC.POOL()` en cadena |
| Data provider | `0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad` | `AAVE_PROTOCOL_DATA_PROVIDER`, y `getReserveTokensAddresses(USDC)` |
| USDC (reserva 1) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `ASSETS.USDC.UNDERLYING`, 6 decimales |
| aUSDC | `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042` | `ASSETS.USDC.A_TOKEN`, `symbol()` = `aMonUSDC` |
| Cadena | 143 | `eth_chainId` en `rpc.monad.xyz` = `0x8f` |

Viven en `07.PockBackend/src/domain/pool/aaveMonad.ts`. **El front no lleva
ninguna**: pide `POST /api/pool/deposit` y recibe transacciones ya construidas.

#### La trampa del selector y del ABI, cerrada con tests

`getReserveData(address)` es **`0x35ea6a75`** en V3. `0x026b1d5f` es el selector de
**V2** y revierte sobre un pool V3, y ese revert se leyó una sesión entera como "el
pool se movió". El selector ahora es una constante con un test.

El ABI oficial tiene **doce** salidas, en ese orden. Declarar menos, o en otro
orden, no tira: todo lo que viene después de la palabra que falta se corre un
slot, y de ahí salieron un `lastUpdateTimestamp` de `4e25` y un APR de
`130.281.299%`. Por eso `decodeReserveData` **rechaza** cualquier respuesta que no
sea exactamente doce palabras, y `RESERVE_DECODE_FAILED` es un motivo propio: una
estructura que no se puede leer es problema nuestro, no del endpoint.

La tasa es **anual en RAY** (`RAY = 1e27`), no por segundo. La conversión es
`rate x 1e6 / RAY`, entera, y la escala de todo porcentaje de la respuesta es
**una unidad = 0.0001%**.

#### El número que se comprobó, y cómo

Leído de `getReserveData(USDC)` con `https://rpc.monad.xyz` el 2026-10-04
(`lastUpdate` 1791088293 → `2026-10-04T04:31:33Z`):

```
total depositado     173.874.477,777314 USDC
deuda variable       159.699.152,138313 USDC
disponible            14.175.325,639001 USDC
utilización           91,8473%
supply APR            4,1196%      borrow APR   4,9876%
reserve factor        10% (1000 bps, de getReserveConfigurationData)
```

La comprobación: **`liquidityRate = variableBorrowRate x utilización x (1 - rf)`**

```
4,9876 x 0,918473 x 0,9 = 4,1228%     contra 4,1196%     diferencia 0,0032 pp
```

Una diferencia así es el spread de la estrategia de tasas, que el provider no
entrega. Y la coherencia con el resto de la reserva: la utilización está apenas
arriba del kink de 90%, muy lejos de una reserva al 99% (donde la tasa de
préstamo sería otra magnitud), el supply está por debajo del borrow, y el spread
es de 0,87 puntos.

Eso no es decorativo: `reconciliation` viaja en la respuesta con un `agrees`, y
cuando `agrees` es `false` el front **no muestra la tasa** (`displayableSupplyApr`
pasa a `null`). Una tasa que no se puede reproducir desde el resto de la reserva es
justo lo que produce un decode desalineado.

#### Backend

- `GET /api/pool`: los números de la reserva (supply APR, borrow APR, total
  depositado, prestado, disponible, utilización, última actualización) y **la
  posición de la persona**: su `aMonUSDC`, su USDC libre y su MON de gas.
  Cada campo con su estado: `ok` o `unreadable` con un motivo acotado. **Un campo
  ilegible nunca es un cero.** Importes como texto decimal exacto, con `decimals` y
  `unit`. Sin floats, sin redondeo en el backend.
- `POST /api/pool/deposit` con el monto en **unidad mínima como texto**, devuelve
  las transacciones sin firmar, en orden: `approve(spender = pool, amount exacto)`
  y `deposit(asset, amount, onBehalfOf = dirección de la base, referralCode = 0)`,
  cada una con `to`, `data`, `value: '0'` y `chainId: 143`. La dirección sale de
  `rewallet.wallets` y **ningún parámetro del pedido puede cambiarla**. Cero y
  negativos se rechazan; por encima del saldo, con un motivo propio
  (`AMOUNT_EXCEEDS_BALANCE`, distinto de `BALANCE_UNREADABLE`). Si el allowance ya
  alcanza, `approvalRequired: false` y la primera firma se salta.
- Contrato completo en `07.PockBackend/README.md`.

Lo que quedó demostrado por test: **308 tests verdes (antes 263)**, `tsc --noEmit`
limpio y `dist-worker.js` construido. El transcript de la reserva real es un
fixture, no un número inventado, así que un decoder roto falla acá. Cubierto: el
decode de doce salidas con su APR plausible, la reconciliación de la tasa contra
utilización y reserve factor, el rechazo de una respuesta de seis palabras, una
posición de cero reportada como cero, una lectura fallida reportada como ilegible,
`approve` y luego `deposit` con el pool como spender y la dirección de la base
como `onBehalfOf`, cero/negativo/por encima del saldo, que ningún parámetro cambia
la dirección, el allowance que ya alcanza, que un allowance ilegible mantiene la
aprobación, y `401` sin sesión.

#### Front

- `services/pool.ts` + `types/pool.types.ts`: el contrato, la normalización y la
  aritmética en `bigint` (conversión coma/punto a entero, redondeo **una sola vez**
  y recién para pintar, proyección anual en enteros). `projectYearlyGain`
  multiplica el depósito por el APR de este momento y la pantalla la llama
  **estimación**: no es una promesa.
- `hooks/usePool.ts`: **una lectura por sesión**, mismo patrón que `usePortfolio`, con
  `reload()` para después de un depósito firmado.
- `hooks/usePoolDeposit.ts`: pide las transacciones al backend, cambia la wallet a
  Monad (`eip155:143`) **antes** de la primera firma, y firma `approve` y `deposit`
  **una por una y en orden**, reportando cada paso. Verifica que la wallet
  conectada sea la misma que la fila de la base. Un paso fallado frena el flujo: la
  pantalla no dice "listo".
- `components/Yield/AavePoolsView.tsx`: la tasa real (o la frase de que no se pudo
  leer), la posición, la estimación anual y el detalle de la reserva.
- `components/Yield/DepositToPoolModal.tsx`: el monto con `NumericKeypad`,
  "depositar todo lo disponible" con la cifra exacta de la cadena, y los estados
  honestos **antes** de firmar.
- `components/Investments/DigitalDollarsView.tsx` y `components/Wallet/WalletView.tsx`:
  la tarjeta de rendimiento muestra el APR real y la posición; si la lectura no
  llega, lo dicen.

Lo que una persona ve, en cada estado: **no hay USDC libre** → "No tenés USDC
libre en esta billetera", con el botón de depósito igual visible pero el monto en
cero rechazado; **no hay MON** → "No tenés MON para el gas", con la explicación de
que el depósito es en la red principal y paga gas aunque el monto sea de USDC, y el
botón deshabilitado; **la reserva no se pudo leer** → guion con "sin cifra legible"
y la explicación de que no es que el pool no rinda; **la posición no se pudo leer**
→ "No pudimos leer tu posición" y el depósito bloqueado sobre un saldo que no se
conoce; **un paso falla** → el paso queda en rojo con "falló" y un cartel que dice
que el depósito no se completó; **todo salió bien** → la posición se vuelve a leer
de la cadena y la pantalla muestra lo que dijo el pool.

Lo que **no** quedó demostrado: **ninguna transacción firmada**. El camino de
prueba es un lector inyectado, el calldata se comprueba contra palabras ABI
compuestas en el test, y la firma ocurre en la wallet de Privy en un navegador con
MON de verdad. En el front no hay runner de tests —y está prohibido agregarlo—, así
que lo verificado ahí fue `npm run lint` y `npm run build`.

#### Lo que quedó pendiente de esta tarea

- **El retiro.** Se lee la disponibilidad del pool, pero no existe `withdraw`.
- **`getAllReservesTokens` devuelve un listado de relleno** (`…01a0`, `…0220`): los
  aTokens que responde el provider en esta cadena no coinciden con `A_TOKEN` del
  address book, aunque `getReserveTokensAddresses(USDC)` sí devuelve
  `0x35a7…6042`. Vale investigarlo antes de confiar en ese listado para otra cosa.
- **`wrangler.jsonc` sigue listando secretos en su comentario**: falta agregar
  `MONAD_POOL_RPC_URL` (opcional) y dejar constancia de que las cinco variables
  obligatorias siguen siendo las mismas.

## Superficies de edición

- `07.PockBackend/src/**`
- `07.PockBackend/test/**`
- `07.PockBackend/sql/**`
- `05. UI-UX/src/components/Yield/**` (detalle del pool y depósito, T5)
- `05. UI-UX/src/config/**`
- `05. UI-UX/src/App.tsx`
- `05. UI-UX/src/main.tsx`
- `05. UI-UX/src/components/Wallet/**`
- `05. UI-UX/src/components/Investments/**`
- `05. UI-UX/src/components/Navigation/**`
- `05. UI-UX/src/components/Activity/**`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/components/Activity/**` (punto de "nuevo" en la campana, T4b)
- `odd/tasks/datos-reales-monad-aave.md`

## Fuera de alcance

- Testnet: Aave en Monad solo existe en mainnet.
- Multichain más allá de Ethereum, Monad y Solana.
- Envío real de fondos más allá de la prueba que手动 se haga a mano.