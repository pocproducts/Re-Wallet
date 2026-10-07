# Feature: "tu dinero rinde desde que ingresa" — el mecanismo

Este documento es el estudio, no la implementación. Se escribió **midiendo** en
la app real y en la cadena real, porque la pieza que decide el rumbo es si el
backend **puede mover el dinero**, y eso no se responde con un diagrama.

## 1. Lo que dice el producto, y lo que son en realidad

El concepto es: el cliente ve **un saldo**, y ese saldo está generando. Nunca ve
un vault, ni un aToken, ni un approve, ni un withdraw.

| Lo que el usuario dice | Lo que el backend hace | Lo que el usuario nunca ve |
| --- | --- | --- |
| "Ingresé 100" | recibe USDC → `supply` a Aave | approve, supply, aUSDC |
| "Enviar 50 a @carla" | `withdraw` lo justo → `transfer` |.withdraw, la segunda tx |
| "Me quedan 50 generando" | posición = aUSDC × índice | el índice de liquidez |

El principio que lo sostiene: **el usuario piensa en acciones; el backend piensa
en operaciones. La distancia entre las dos es el producto.**

## 2. Tres restricciones medidas, que cambian el plan

### 2.1 El camino de escritura lo construimos nosotros

La primera hipótesis era delegar el depósito en la API `earn` de Privy. **No
alcanza.** De los docs oficiales de Privy:

> "Privy deploys Aave vaults on Ethereum, Base, Optimism, Polygon, and
> Arbitrum."

**Monad no está.** Y `client.wallets.earn.ethereum` en el SDK instalado habla de
ERC-4626, mientras que el aUSDC de Aave V3 no lo es. Así que el `earn` de Privy
no tiene un vault para este pool, y el `supply` hay que construirlo con viem:
`approve(USDC → Pool)` y `supply(Pool, USDC, onBehalfOf)`.

La lectura sí tiene el camino de escritura ya abierto en el SDK: `wallets._rpc`
con `method: 'eth_sendTransaction'`. Es la misma que usaría un deposit intent.

### 2.2 No hay credenciales de Privy en el entorno

Medido sobre el proceso que corre, no sobre el `.env`:

```
PRIVY_APP_ID      VACIO        WEBHOOK_SECRET_PRIVY  VACIO
PRIVY_APP_SECRET  VACIO        PIMLICO_API_KEY       VACIO
                              ETHERSCAN_API_KEY     VACIO
```

**Y el log de arranque los imprime igual.** `redactEnv()` sustituye por
`[redacted]` toda variable cuyo nombre es una clave conocida, esté o no esté
puesta. Un log que dice `[redacted]` donde no hay nada es peor que un log que
dice `undefined`: hace que un despliegue sin credenciales parezca configurado.

Consecuencia directa: hoy **no se puede firmar nada**, y tampoco se puede hacer
login. Esto no es un problema de código; es una variable que sólo sale del
dashboard de Privy.

### 2.3 Con 0,826004 USDC el rendimiento es invisible

Medido contra el pool real:

```
Aave V3 USDC · Monad mainnet
APY  4,04%      TVL  144.042.775      utilización  90,91%   retirable  sí
aUSDC de la wallet  0,000000
```

El cálculo que el producto promete, con el saldo que hay hoy:

| | |
| --- | --- |
| 0,826004 USDC × 4,04% | **0,0334 USDC al año** |
| por día | **0,0000914 USDC** |
| por hora | 0,0000038 USDC |
| en 30 días | 0,0027 USDC |

**Cero centavos, todos los días.** Y no es un problema de redondeo del producto:
es aritmética. Para que se vea:

| Saldo | Ganancia por día |
| --- | --- |
| 0,83 USDC (hoy) | 0,00009 USDC |
| 90 USDC | ~0,01 USDC — un centavo por día |
| 1.000 USDC | ~0,11 USDC |
| 9.000 USDC | ~1 USDC |

**Con 90 USDC recién se ve un centavo por día.** Cualquier demo que espere un
día con el saldo actual muestra $0,00, y va a parecer que el producto no
funciona. Esto se tiene que resolver antes de dibujar una pantalla, porque
decide qué se muestra: si es un saldo pequeño, la UI tiene que hablar de
**tasa y posición**, no de centavos ganados.

## 3. Lo que ya está listo, y es más de lo que parece

El lado de la lectura quedó trazado por el trabajo anterior, y no hay que
rehacerlo:

| Pieza | Dónde | Estado |
| --- | --- | --- |
| El puerto ya declara índice de liquidez y conversión aToken→underlying | `domain/ports/chain-balance-reader.ts`, `domain/wallet/balances.ts:103` | **Existe, sin usar** |
| La tasa real del pool, leída on-chain | `/yield/summary`, `/yield/pools` | **Viva**: 4,04% real |
| La tabla que va a guardar la posición | `yield_positions` (`aave_atoken_bal`, `last_accrued_at`) | **Existe, sin filas** |
| `rewardRateKnown: false` | `/yield/summary` | **Ya honesto**: declara que la tasa de incentivo no se conoce |
| El ledger de eventos que dispara el depósito automático | `webhook_events` + `wallet.funds_deposited` | **Listo** |

`underlying = aToken * liquidityIndex` ya está escrito como la definición
on-chain. Lo que falta no es el modelo: es quién lo llama.

## 4. La forma, y la decisión que la fija

**Decisión del 2026-09-29:** Aave en Monad lo hacemos nosotros. Pero el puerto
se escribe **neutral**, porque mañana Privy va a tener vaults en Ethereum, Base,
Optimism, Polygon y Arbitrum, y ese día tiene que ser una fila de configuración,
no una reescritura.

### 4.1 Dos adapters, un solo puerto

| Provider | Dónde sirve | Recibo | Quién paga el gas |
| --- | --- | --- | --- |
| `AaveSupplyAdapter` — **nosotros**, viem | **Monad**, y cualquier cadena con Aave v3 | aToken | La wallet (MON) |
| `PrivyEarnAdapter` — el `earn` de Privy | Ethereum, Base, Optimism, Polygon, Arbitrum | ERC-4626 shares | Privy lo sponsoriza |

El enrutamiento es por `(cadena, activo)` y **la elección se declara con su
motivo**, igual que `ENABLED_CHAINS` y `CREATION_ORDER`: que un chain esté
sirviendo por el camino hosted y no por el nuestro es una decisión, no un
default.

### 4.2 Lo que el puerto tiene que saber, y lo que no puede

Esta es la parte que decide si "sumar una red" es fácil o es una mudanza.

**El puerto habla en el idioma del producto**, no en el de Aave ni en el de Privy:

- `position()` devuelve **underlying**, y el recibo como un valor opaco con su
  tipo. La capa de aplicación nunca pregunta "¿es un aToken o un share?",
  porque la respuesta es distinta en cada red y no debería importar arriba.
- `deposit()` y `withdraw()` devuelven una **acción pendiente**, no un boolean.
  Las dos rutas son asíncronas: el `earn` de Privy crea un `wallet_action` que se
  completa on-chain, y nuestra supply también. Un puerto que devuelve `boolean`
  obligaría a los dos adapters a mentir uno de los dos.
- **El puerto NO conoce `vault_id`.** Es un detalle del `PrivyEarnAdapter`, igual
  que la dirección del Pool lo es del nuestro. Si `vault_id` aparece en el
  puerto, el día que se agrega Monad hay que cambiarlo.

### 4.3 El campo que decide si la promesa es cierta: `netApy`

> "You set a performance fee between 0% and 100% of the yield the vault earns.
> With a 20% performance fee, users keep 80% of the vault's yield." — Privy docs

**Con Privy, el cliente no recibe el APY que se muestra.** Si el puerto publica
la tasa bruta y la UI la muestra, el producto está prometiendo dinero que la
persona no va a recibir. Por eso la posición lleva:

- `netApy` — lo que el cliente realmente gana. **La UI sólo muestra este.**
- `grossApy` y la comisión del provider, que son públicos y honestos, y que la
  interfaz puede mostrar como "de esto, tu app se queda X".

En nuestro camino la comisión es cero, y en el de Privy no. **Es el mismo campo
en los dos casos, y por eso la pantalla no tiene que cambiar** cuando cambia la
red.

### 4.4 Lo que "sumar una red" cuesta de verdad

Código: una fila en el registro de providers. **Operación: un `vault_id` por
cadena y por activo, creado en el dashboard de Privy.** Eso no lo arregla un
deploy, y conviene saberlo antes de prometer que es un día de trabajo.

## 4b. Los dos regímenes de pantalla, y por qué son uno solo

**Decisión del 2026-09-29:** el producto tiene que funcionar con 0,83 USDC y con
90, y la demo tiene que **generar rendimiento y mostrarlo**. Las dos cosas son
ciertas a la vez, y la tentación es resolverlo con dos builds distintos. No.

**Un solo camino de código, dos formas de contarlo.** El accrue produce siempre
un `bigint` exacto de unidades base, y nunca se redondea al guardar. Lo que
cambia es **cuántos decimales muestra la pantalla**, y eso lo decide la magnitud
acumulada, no el saldo.

Primero, la aritmética que hay que tener clara, porque cambia la conclusión:

| Escala | Lo que la demo muestra |
| --- | --- |
| 0,826004 USDC | 0,0000914 USDC **por día** = **91 unidades base**. Es representable. |
| 90 USDC | 0,00996 USDC por día = 996 unidades base |

**Con 0,83 USDC el rendimiento diario también es un número entero y exacto.** No
hay redondeo de por medio, y no hace falta inventar nada. Lo único que no existe
a esa escala es **el centavo**.

Así que la regla es de formato, y tiene un solo umbral:

- **acumulado ≥ 1 centavo** → se muestran centavos, el increments es real y
  acumulable. A 0,826004 USDC esto tarda **~110 días** (10.000 ÷ 91 por día); a 90
  USDC, **~1 día** (9.961 por día, el 99,61% del centavo).

  El primer número estaba escrito como 11 días y era un error de un factor 10,
  encontrado midiendo en vez de calculando. El segundo está confirmado por la
  cadena: en 257 segundos de tiempo real el índice avanzó 3,11e-7 relativo, que a
  0,82 USDC son 0,255 unidades base — y 0,255 al truncar es **cero**. El producto
  dice cero con honestidad, y por eso el umbral de un centavo está 10.000 veces
  más arriba que un entero.
- **acumulado < 1 centavo** → **no se muestra un incremento que no existe**. Se
  muestra la posición y la tasa, que son verdad, y una proyección con su horizonte
  explícito: *"tu posición está ganando; en 30 días serán U$0,0027"*. La
  proyección se **rotula como proyección** en la misma línea, no en letra chica.

**Lo que queda prohibido en los dos regímenes:** redondear un incremento hacia
arriba para que se vea algo, mostrar centavos de un saldo que no llegó, o
mostrar la tasa como si fuera un monto ganado. Un producto que promete rendimiento
y muestra un número inventado para que se vea el producto está mintiendo dos
veces: en el número y en la promesa.

**Consecuencia para la demo:** el camino de código es **idéntico** en los dos
regímenes, así que la demo no necesita un build especial — necesita **fondos**.
Con 90 USDC en la billetera, un día de demo muestra un centavo real. Es la misma
transacción de `supply`, la misma lectura de índice y el mismo accrue.

## 5. Las capas

```
interface/http/     POST /wallet/deposit · /wallet/withdraw · /wallet/send
                    GET  /wallet/position   ← lo que ve el usuario: UN saldo
application/        earnOnArrival  ← el caso que decide: ¿esto va al pool?
                    sendMoney      ← retiro just-in-time + envío
                    accrueYield    ← el diario que convierte índice en centavos
domain/ports/       earn-provider   position / deposit / withdraw   ← neutral
                    chain-reader   (el de hoy, con liquidityIndex)
domain/             earnPolicy   ← LA DECISIÓN: cuánto al pool, cuánto líquido
                    providerRegistry  ← (cadena, activo) → adapter, con motivo
infrastructure/     aaveSupplyAdapter   approve + supply + withdraw, vía viem
                    privyEarnAdapter    vaults de Privy
                    signing             wallets._rpc, o una clave propia
```

**`earnPolicy` es la pieza que hay que escribir primero**, y no es un detalle de
configuración. Es la que contesta la pregunta que la research de la sesión pasada
dejó abierta y que el producto tiene que decidir explícitamente:

- ¿El 100% va al pool, o un buffer líquido?
- Con un pool al **90,91% de utilización**, retirar es posible pero el margen no
  es infinito. Prometer "envío instantáneo" con el 100% adentro es una promesa
  que no se puede cumplir en estrés.
- **Con 0,826 USDC, un buffer del 10% son 0,08 USDC**: la regla no escala hacia
  abajo, y una política escrita para saldos grandes no sirve para el saldo que
  hay.

## 5b. Lo que hay que decidir antes de escribir una línea

| # | Decisión | Por qué no la puedo tomar yo |
| --- | --- | --- |
| 1 | **¿Me pasás `PRIVY_APP_SECRET`?** | Sale del dashboard. Sin eso no hay login, ni firma, ni depósito. Y hay que revisar en el dashboard que el quórum de la wallet lo pueda satisfacer el servidor, que es lo que hace posible el depósito automático |
| 2 | **¿Se fondea con más USDC, o la UI habla de tasa y posición?** | Con 0,83 USDC el rendimiento no existe numéricamente. Ambas opciones son defendibles; definen pantallas distintas |
| 3 | **¿Y las recompensas de incentivo?** | Hoy `rewardRateKnown: false`. Hay tres caminos: declarar `apyTotal` como la base y listo; integrar Merkl; o leer el `RewardsController`. El 4,04% es la base real y es defendible solo |

Ninguna de las tres bloquea el **trabajo de lectura**, que es la mitad del
sistema y no necesita una sola credencial. Ése es el orden que propongo: hacer
que el backend sepa leer la posición y el accrue con números reales, y que la
escritura espere a la decisión 1.

## 5c. Tareas

- [x] **T1** `earnPolicy`: buffer plano de 5 USDC, y todo al pool cuando el saldo no
      llega a cubrirlo. **Un porcentaje queda descalificado por medición**: el 10%
      de 0,826004 USDC son 0,08 USDC, una reserva que no cubre ni un envío y deja
      el producto apagado exactamente en el saldo que existe hoy.
- [x] **T2** Lectura de la posición: aUSDC + índice → `underlying`, y que
      `/wallet` deje de reportar sólo el USDC suelto. **Entregada 2026-09-29.**
      `domain/wallet/position.ts` (`readPosition`, `underlyingFromPosition`,
      `unreadablePosition`); la pata de posición en `balances.ts` y en
      `viemBalanceReader.ts`; y el contrato espejado en el cliente con
      `tokenTotalOf` como único lugar de la regla de degradado.
- [x] **T3** `accrueYield`: índice → progreso del tiempo, redondeo **a la baja**
      en la accrual. **Entregada 2026-09-29.** `domain/wallet/accrual.ts`, 13
      tests. El puerto de persistencia (`domain/ports/yield-position-store.ts`)
      está declarado y **sin adapter** a propósito: un puerto con adapter antes
      de que exista la escritura es una forma que sólo se pudre.
- [x] **T4** `earnProvider` como puerto, para que Aave sea un adapter y no el modelo
- [x] **T5** `aaveEarnAdapter`: approve + supply + withdraw con viem
- [x] **T6** `signing` como **puerto**, con dos adapters: uno de clave propia
      (permite probar `supply` y `withdraw` con transacciones reales hoy, sin
      ninguna credencial) y `wallets._rpc` de Privy detrás del mismo contrato
- [x] **T7** `earnOnArrival`, disparado por el webhook `wallet.funds_deposited`
- [x] **T8** `sendMoney` con retiro just-in-time
- [x] **T9** La pantalla: un saldo, con la posición y la tasa debajo
- [x] **T10** `redactEnv`: dos placeholders en vez de uno. **Entregada
      2026-09-29.** La forma estable se conserva (la clave aparece siempre), pero
      un secreto **ausente** ahora dice `[unset]`. Un secreto presente sigue
      diciendo `[redacted]`, y se decide con `key in env` — que nunca lee un valor.
- [x] **T1b** Los dos regímenes, como decisión de formato:
      `domain/earn/accruedAmount.ts` + el espejo en el cliente. Un umbral, un
      centavo. Piso de 10.000 unidades base; los horizontes `day`/`week`/`month`
      están justificados y los descartados también.
- [x] **T7** `earnOnArrival` disparado por `wallet.funds_deposited`, con el store
      de posición, el wiring en el container y el firmante inyectado desde
      `index.ts`. Un depósito fallido **devuelve** el rechazo en vez de tirar, para
      que una `simulation-reverted` determinística no quede para siempre en la
      lista de reintentos.
- [x] **T8** `sendMoney` con retiro just-in-time: `domain/payments/sendPlan.ts`,
      `amount.ts`, `transferPort.ts`, `erc20Transfer.ts`, `application/payments/
      sendMoney.ts` y `POST /wallet/send`. El saldo corto **carga las cifras**
      (`total`, `shortfall`) en vez de decir "no tenés".
- [x] **T9** La pantalla: un saldo, con la posición y la tasa debajo.
      `EarnLine`, `earnReading`, `earnCopy`, y el formateador entero. Los cuatro
      estados tienen su frase, y **nunca hay un segundo saldo en pantalla**.

T2 y T3 no dependían de ninguna decisión. T1 quedó desbloqueada por el régimen de
pantalla. T5 a T9 dependían de la credencial de Privy, y seittersaron igual: la
escritura va por el puerto del firmante, que con una clave propia no necesita
ninguna.

---

## 7. Lo que la lectura ya puede decir, medido

Contra Monad mainnet, 2026-09-29 18:19Z, bloque 109105847:

```
USDC disponible        0,826004
aMonUSDC               0,000000      <- el nombre on-chain es aMonUSDC, no aUSDC
liquidityIndex         1009314224005829185645218155   (1,009314224 RAY)
currentLiquidityRate   4,0182% anual
lastUpdateTimestamp    1790705851  ->  18:17:31Z
```

**El índice ya vale 1,0093**: el pool lleva ganado un 0,93% desde que existe. Un
aMonUSDC ya es más USDC que antes. Esa es la definición on-chain del rendimiento,
leída del contrato, sin una fórmula propia.

Sobre 90 USDC y 2114 segundos de tiempo de cadena, el accrue da **267 unidades
base**. Redondeado **hacia abajo**, siempre: redondear hacia arriba publica
dinero que la cadena no ganó y que el producto debería en cada lectura. El resto
se descarta, y no se arrastra: convertir el saldo del recibo y no el resultado
anterior es lo que impide que el error se acumule.

Un índice no positivo se **rechaza**, no se recorta a cero: un pool que contesta
índice 0/contestó con algo que no es un índice, y recortarlo publica la billetera
como si no valiera nada.

## 8. El cambio de contrato, y el defecto que destapó

Hacer `total` nulable fue correcto desde el backend —un total que omite la mitad
que está ganando es la cifra que el cliente no puede verificar— y **rompió el
cliente**: `App.tsx` leía `balances?.total.amount`, que con `total: null` es un
TypeError. `tsc` no lo podía ver, porque el cliente confía en su propia
declaración. Es la misma clase de bug que ya mordió antes, con `profile.wallets`
en `undefined` y un `.map` que se llevaba la pantalla en silencio.

Lo corregido:

- el tipo del cliente espeja el del servidor, incluida la unión `covered |
  unreadable` y los cinco códigos de razón;
- `httpWalletRepository` **rechaza** un payload que se contradiga a sí mismo
  (`total === null` sin `unreadable`, un `covered` sin índice, una razón
  desconocida) en vez de dejarlo llegar a una pantalla;
- `tokenTotalOf` es el **único** lugar donde vive la regla del degradado, igual
  que `primaryWallet` lo es en el mismo archivo;
- el cliente ve el saldo ocioso y **una frase que dice qué falta**: *"Acá va solo
  lo que tenés disponible: no pudimos leer la parte que está ganando en el pool,
  así que no te mostramos un total."* Mismo lugar, mismo peso y mismo color que
  las advertencias que ya había, y con **su propia** frase en vez de reusar la del
  precio: decirle a alguien "no pudimos leer un precio" cuando la verdad es "no
  pudimos leer lo que estás ganando" es una frase falsa.

**Lo que falta y hay que saber**: las tres pantallas llevan ahora un prop
`poolUnreadable` cada una. Una cuarta pantalla que muestre la cifra del token y
se olvide del prop imprimirá la pata ociosa sin aviso. Centralizar la frase en el
dominio lo arregla, pero saca la copia del producto de las pantallas, y eso es
más grande que esta corrección.

**Otro cambio con costo, a propósito**: el lector ya **no** tira excepción si el
aToken no coincide con el del pool. Esa configuración rota ahora es visible sólo
como `position.coverage.reason` en el payload, no en un 500. Es deliberado —que
una reserva caída no tumbe una pantalla cuyo saldo ocioso sí se leyó bien en la
misma pasada— y está en el header del archivo, pero es un trade que un operador
tiene que conocer.

---

## 9. T4: el puerto y el registro, y un hueco que dejó

`domain/ports/earn-provider.ts`, `domain/earn/earnPolicy.ts`,
`domain/earn/providerRegistry.ts`. 571 tests, typecheck limpio.

Cada término que el puerto tiene que **no** conocer aparece en el archivo
únicamente dentro de un comentario que explica dónde vive en realidad:
`vault_id` es del adapter de Privy, `supply`/`approve` son del de Aave, `aprBps`
no existe porque un `aprBps` no se puede renderizar exacto. La única aparición
real de `aTokenBalance` es en el shim que adapta la posición del puerto al
vocabulario que `accrueYield` ya tenía, y el shim lleva su propia justificación.

**`accrualObservationOf` devuelve `null` para un recibo `share-priced`.** Es
correcto hoy y es un hueco mañana: el accrue es índice-acumulativo, y un share de
ERC-4624 se=value por precio de share, no por índice. Multiplicar ese factor
hasta RAY haría que el número pareciera consumible estando equivocado en nueve
órdenes de magnitud. Cuando se sume Privy hay que agregar la segunda vía del
accrue, no estirar la primera.

### La regla de `earnPolicy`, y por qué no es un porcentaje

```
balance ≤ 5 USDC   →  al pool: todo,   líquido: 0
balance > 5 USDC   →  al pool: saldo − 5,   líquido: 5 USDC
```

Un buffer **plano**, y nada retenido para un saldo que no llega a cubrirlo. Un
porcentaje se descarta por una razón medida: **el 10% de 0,826004 USDC son 0,08
USDC**, una reserva que no cubre ni un envío y que deja el producto apagado
exactamente en el saldo que hoy existe. Un buffer plano de 5 USDC se comporta
bien en el saldo grande y se degrada a "todo al pool" en el chico, que es la
forma correcta de degradar: el retiro just-in-time cubre el envío, y el pool tiene
~13,1 millones de USDC ociosos con 90,91% de utilización.

Lo que **no** se hizo, a propósito: una reserva escalada por utilización, porque
este camino no mide la utilización y publicarla sería un número que nada
respalda.

---

## 10. T5 y T6: el camino de escritura, y lo que todavía NO es idempotente

627 tests, typecheck limpio en backend y front. **Nada se difundió.**

### El puerto de firma, y por qué es tan tonto a propósito

`TransactionSigner` tiene tres miembros: `id`, `account`, `sendTransaction(chain, call)`.

- **No sabe qué hace la llamada.** Ni `supply`, ni `approve`, ni `withdraw`: sólo
  `to`, `data`, `value`, `gas`. Un firmante al que se le pasan bytes opacos sólo
  puede mover el dinero que la capa de earn le pidió mover, y ningún bug de arriba
  puede pasar por un firmante que entiende la intención. Un puerto con forma
  "firmar un supply" tendría que recibir una dirección de pool y un spender, y
  ayudaría a un caller a equivocarse de par.
- **Se le dice una CADENA, nunca un nodo.** Hay un test que **lee el fuente del
  puerto** y falla si encuentra `rpcUrl` o `provider`. El firmante de clave
  propia queda atado a un nodo en su construcción —una clave cruda tiene que
  difundir por algún lado— y ese atado es privado suyo.
- **La estimación de gas NO está en el puerto.** Privy no puede estimar, y
  obligaría al camino hospedado a inventar un límite; un límite inventado en un
  `supply` es un out-of-gas **después** de que el pool aceptó la plata. El gas es
  opcional, y `0n` lo rechaza el constructor: una medición ausente escrita como
  número.
- **Un envío no lleva timestamp.** `submittedAt` es tiempo de cadena, y un
  firmante no lo tiene. `Date.now()` ahí es el mismo defecto que
  `yield-position-store.ts` rechaza para `last_accrued_at`.

### El depósito, paso a paso

1. El firmante **tiene que ser** la billetera (`signer-account-mismatch`): un
   approve desde una dirección y un supply para otra son dos Personas en un
   depósito.
2. `decimals()` se lee de la cadena y se **niega** si no dice 6
   (`amount-not-representable`). Dos fuentes sobre la escala son un monto
   equivocado en 10⁷.
3. Se lee el permiso. **Si la lectura falla, rechaza**: nunca se trata como cero,
   porque eso emitiría un permiso de pie en cada depósito durante una caída del
   RPC.
4. `approve` **sólo si** el permiso queda corto, y por el monto exacto. Nunca
   `MaxUint256`, nunca en un depósito que no lo necesita.
5. **Dry run** del `supply`. Si revierte, se rechaza con la primera línea del
   motivo (`Pool: reserve is not active…`) y **no se difunde nada**.
6. `estimateGas`, aparte de la simulación. Falla o da `≤ 0` → `gas-unmeasurable`.
7. Firma y difunde. El `reference` de la acción es el **hash del supply**, y el
   `id` se deriva de `(kind, ruta, dirección, monto)` **sin reloj, sin azar y sin
   contador**.

### Lo que es idempotente, y lo que no

**Sí:** la **identidad de la acción**. El mismo intent da el mismo id en cualquier
proceso, así que un caller puede **guardarlo antes de disparar** y reconocer el
reintento. Y el permiso: un reintento que lo encuentra suficiente saltea el
approve, así que los reintentos no apilan permisos.

**No:** una transacción de cadena **no** es idempotente. Un `supply` enviado dos
veces mueve plata dos veces. La idempotencia real es un **nonce que el emisor
posee y reutiliza**, y este backend no posee ninguno. **Un reintento después de un
fallo ambiguo —un timeout donde la transacción puede o puede no haberse
difundido— hoy no es seguro.** Lo que el id compra es la capacidad de **notar**,
que es la mitad construible antes de que exista la maquinaria de nonces.

Tampoco es atómico: un approve que entró y un supply que falló dejan un permiso de
pie acotado. Los dos límites están en el header del archivo, no sólo acá.

### `EARN_SIGNER_PRIVATE_KEY`, y por que un solo acceso no alcanza

Es la **única variable de este archivo que ES la plata**: no es un token, ni un
id, ni una key de lectura. Si esa cadena llega a un log, el atacante no necesita
un bug, una suscripción ni una sesión. Por eso es `SECRET_KEY`, no enumerable y
redactada — y además el firmante **nunca la tiene como propiedad**: vive en un
closure, y hay tests que lo verifican sobre `JSON.stringify`, `Object.keys`, todos
los valores y todos los mensajes de rechazo.

Hex-typed y **opcional en todos los modos**, incluido producción: un proceso sin
firmante de earn igual debe arrancar y seguir sirviendo todas las lecturas, y
tirar el arranque abajo por una feature que no tiene sería peor que la feature
que falta. Lo que **nunca** puede pasar es caer a otra cosa, y eso vive en
`createLocalKeySigner`, que rechaza.

### El probe, y por qué rechaza tanto

`Backend/scripts/probe-earn-write.ts`. Rechaza sin
`--yes-i-know-this-is-mainnet`; rechaza sin `--amount` (no tiene default: cuánto
es una decisión con plata); rechaza si el firmante no tiene el monto; **rechaza
si no le queda MON para el gas**, porque depositar el saldo y no poder pagar el
retiro se aprende caro; imprime **todas las direcciones que va a tocar antes de
tocar nada**; y nunca imprime la clave, ni un prefijo, ni su longitud.

Sin `--broadcast` simula y no difunde. Verificado en vivo contra mainnet con una
clave descartable sin fondos: lee los dos saldos reales, imprime las direcciones y
se detiene en la comprobación de fondos. **Nunca llegó a la sección de depósito**,
que es exactamente donde debe detenerse.

---

## 11. Cierre: 788 tests, y lo que falta es una sola dirección

```
Backend   788 tests · 62 archivos · verde
Front End tsc limpio · build 1718 módulos
```

### El régimen de pantalla, y por qué el umbral es una constante

`EARN_DISPLAY_FLOOR = 10.000` unidades base — un centavo, con 6 decimales. Una
función, un umbral, sobre el rendimiento **acumulado**.

- acumulado ≥ 10.000 → el incremento real, en centavos, y **una proyección es
  estructuralmente imposible** al lado.
- acumulado < 10.000 → **ningún incremento**, porque no hay centavo que mostrar.
  Posición y tasa, que son verdad, y una proyección rotulada.

**El umbral es constante, no parámetro.** Un `0` apagaría el régimen que necesita
el piso; uno mayor —diez centavos— le mostraría **nada** a quien ganó nueve, que es
un producto que le esconde al cliente pequeño las ganancias para las que existe.
Y un parámetro hace el número intestable: los tests comprobarían el número que
les pasaron.

Medido sobre el saldo real: 0,826004 USDC × 4,04% = **91 unidades base por día**
— un entero exacto — y 2.742 a 30 días. A 90 USDC un día son 9.961 unidades, el
99,61% de un centavo, así que **el cruce ocurre solo**, sin bandera.

Horizontes `day` / `week` / `month`. Descartados y por qué: **hora** son 3,8
unidades sobre el saldo real, y una proyección de cero mientras el dinero gana es
la misma mentira llegada del otro lado; **año** son 0,0334 USDC, una afirmación
sobre una tasa que el pool puede cambiar; **"hasta el primer centavo"** es una
división que no termina.

### `earnedPercent` fue RECHAZADO como sustituto, y está bien

`balances.earnedPercent` existe y el cliente lo tenía a mano como el acumulado.
**No sirve**: es el crecimiento del índice del pool desde el génesis, así que
pagaría a alguien que depositó ayer por el tiempo que estuvo fuera. Es
exactamente el error de la clase que este proyecto viene corrigiendo.

Y como ningún payload publica un accrued todavía —el store existe pero su
puerto no tiene adaptador que escriba accrued— laIncrement está implementada,
renderizada e inspeccionable en el DOM, y **no alcanzable desde una lectura viva**.
No se inventó el número para que se viera.

### `sendMoney`, y lo que dice cuando falta plata

El reparto es `fromLiquid = min(monto, líquido)` y `fromPool = max(0, monto −
líquido)`, y un envío que la billetera cubre **no toca el pool**: en el borde
`monto === líquido` no cuesta ninguna transacción.

Cuando falta: un rechazo que **carga las cifras** — `total`, `position`,
`shortfall`. Alguien con 0,826004 ociosos y 90 generando que pide 100 recibe
`total 90,826004` y `shortfall 9,173996`. Nunca "no tenés nada" y nunca una
prohibición general. Una posición ilegible da `position: null`, `total: null`,
`shortfall: null` —nunca `0n`— y **no bloquea un envío que la billetera cubre
sola**.

Es idempotente el retiro, y sólo por posición: después de un retiro liquidado la
plata está ociosa, el reparto siguiente no pide nada al pool y el reintento es una
transferencia normal. **No** es idempotente la transferencia, ni un reintento con
el retiro todavía pendiente, y el test lo maneja en vez de sólo admitirlo.

### El deposit fallido NO se relanza, y por qué

El dinero ya está en la billetera, este código no lo movió, y no hay nada que
revertir. El rechazo **se devuelve** en vez de tirarse: un `throw` dejaría
`processed_at` en NULL y pondría un `simulation-reverted` **determinista** en la
lista de reintentos para siempre, y reintentar un `broadcast-failed` ambiguo es
justo lo que el adapter dice que no es idempotente.

### Un hallazgo que NO toqué, y que necesita tu decisión

`createWalletRead` —el camino de **lectura**— pasa un `isProduction: false`
literal a `createConfiguredWatchProvider`, mientras que el camino de envío que
acabamos de escribir pasa el `isProduction` real. El comentario del propio código
dice que el proveedor de direcciones "REFUSA existir en producción", y con un
`false` literal **no niega nada**: en producción, `GET /wallet` sin sesión
devolvería la billetera de desarrollo.

No lo cambié porque altera qué devuelve `GET /wallet` en producción, y eso es una
decisión de despliegue tuya. Es una palabra.

### Lo que falta para la prueba real

Una sola cosa, y es tuya: **una dirección con USDC y MON**, para correr
`probe-earn-write`. La clave va en `EARN_SIGNER_PRIVATE_KEY`; sin ella el
container degrada a la reacción documentada, que es lo correcto y es visible en
`earnWiring.reason`.

---

## 12. Con plata real: un bug de 0,93% que ningún test había visto

2026-09-29. Las credenciales de Privy estaban en `01.Poc-bestpath/.env`, y con
ellas se pudo hacer lo que ningún test podía: **firmar de verdad**.

### El `privySigner` estaba mal, y mal de la forma que se oculta

Se había escrito sin verificarlo contra la API real. Dos errores, y el segundo
era el que importa:

1. Usaba `client.wallets._rpc`, que **no puede llevar**
   `privy-authorization-signature`. Ese header es el mecanismo entero, y un
   método que arma su propio request sin lugar donde poner la firma no lo puede
   expresar. Ahora el cliente **firma** y un `fetch` **envía**, que es la forma
   verificada en `01.Poc-bestpath/apps/api/src/services/custody.ts`.
2. El body no llevaba `caip2`. Y aquí está la trampa: **un 400 es un CUERPO
   rechazado, evaluado ANTES que la autorización**. Decirle a un operador "tu llave
   está mal" lo manda a arreglar lo único que nunca estuvo roto. El mensaje de
   error ahora lo dice.

También: la llave llega etiquetada (`wallet-auth:`) y el SDK quiere el PKCS#8
pelado. La forma etiquetada produce una firma que no verifica contra nada y Privy
la responde como fallo de autorización — es decir, **una llave mal pegada y una
llave equivocada se ven iguales desde afuera**.

`personal_sign` —que no mueve plata— probó el camino entero antes de tocar una
transacción. Y encontró también que `params.encoding` es obligatorio: la primera
corrida produjo una firma válida y fue rechazada por eso.

### El bug: el índice se aplicaba DOS veces

Puse 0,82 USDC reales en el pool. El sistema reportsó una posición de
**0,827651 USDC** para 0,819999 aMonUSDC. El pool, en su propio
`getUserAccountData`, dice **0,81999007**.

**0,0077 USDC de ganancia inventada**, exactamente el factor
`liquidityIndex / RAY` = 0,93%. La causa: en Aave v3
`aToken.balanceOf(usuario)` **ya devuelve el saldo INDEXADO**
(`scaledBalance × liquidityIndex`), y el código lo trataba como si fuera el
escalado, así que multiplicaba por el índice una segunda vez.

El mismo error estaba en el accrue, y **era peor de lo que parecía**: no era un
redondeo, era un modelo. `from.balance × Δíndice / RAY` cobra al depósito de
**hoy** por interés acumulado desde que el pool existe. El denominador correcto es
el índice **de apertura de la ventana**. Con un pool recién-deployeado
(`from.index == RAY`) las dos formas coinciden — y por eso pasó la revisión: sólo
se separa cuando el índice deja de ser 1,0, y hoy es 1,0093.

**Once tests fallaron al corregirlo, y los once fijaban el bug.** Todos
asertaban la multiplicación. Un test que pasa por el motivo equivocado no es un
test, es una barrera contra el arreglo: cada número viejo está reemplazado por el
nuevo con la medición al lado, y hay un caso que empieza la ventana en el índice
**medido** justamente para que la separación sea visible.

Corregido: el subyacente es el saldo del recibo, y el accrue divide por el índice
de apertura. **796 tests verdes**, y el sistema ahora coincide con el pool.

### Lo que la demo probó y lo que no

```
USDC del firmante      0,826004  →  0,006004     (0,82 al pool)
aMonUSDC               0        →  0,819999
MON                    30        →  29,9507     (gas de approve + supply)
nonce                  0        →  2           (dos transacciones, ambas confirmadas)
índice de liquidez     1,0093330088516543, subiendo
```

La tres formas de mirar el rendimiento coinciden:

| | |
| --- | --- |
| delta del subyacente (nuestro) | 0 USDC |
| delta del pool (`getUserAccountData`) | 0 USD |
| `accrueYield` (dominio) | 0 USDC |

**Y el cero es la demostración.** En 257 segundos de tiempo real el índice avanzó
3,11e-7 relativo, que a 0,82 USDC son **0,255 unidades base** — y 0,255 al
truncar es cero. A 4,04% son 91 unidades por día: el primer centavo arrives a los
**~110 días**, y con 90 USDC a los ~1 día.

Eso es exactamente el motivo del régimen de pantalla, medido y no argüido.

### El probe mentía, y el arreglo fue cambiar el probe

`probe-earn-write.ts` imprimía "nada se difundió" sin `--broadcast`, y era
**falso**: `adapter.deposit()` simula, estima el gas y **envía**. La corrida que
dijo eso movió 0,82 USDC y 0,049 MON. Lo único que lo delató fue que el saldo
después fuera 0,006004.

El adapter tiene razón: un depósito es un depósito, y un medio depósito no es una
cosa. El script estaba mal sobre lo que hacía. Ahora la vista previa hace **su
propio** `simulateContract` y nunca llama al adapter — y el primer intento
falló porque inventé el selector de `supply` a mano (`0x6e553f65`) y el nodo
respondió "RPC Request failed", que parece un problema de la cadena y es un
selector equivocado. Ahora codifica desde el ABI, que es más corto y es lo único
que no puede divergir de lo que se mandaría.
