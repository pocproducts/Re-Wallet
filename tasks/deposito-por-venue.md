# El botón de depositar vive en la fila del venue

## Qué cambia

Hoy `CARD 1` de "Tu dinero" tiene un botón único, **"Depositar USDC"**, y su destino
está fijo en el código: `prepareDeposit` importa `AAVE_V3_MONAD` y no recibe el
destino como parámetro. Nadie elige a dónde va su plata; el servidor lo decidió.

La pantalla `CARD 2 — TU POSICIÓN` ya lista **una fila por venue**. La acción se
mueve ahí: **un botón por venue**, y cada botón ejecuta su propia autorización.
La fila *es* el destino.

```
CARD 1  TU RENDIMIENTO            ← sin botón
CARD 2  TU POSICIÓN
          Aave V3 · Monad      U$ 1.234,56      [ Depositar ]
          Kamino · Solana     U$     0,00      [ Depositar ]
          Ethereum                  sin destino       ← sin botón, y lo dice
CARD 3  EL POOL
CARD 4  LO QUE ESTÁ PASANDO
```

## Las decisiones del owner

1. **Ethereum:** fila que dice que en esa red todavía no hay un lugar donde rendir
   esos dólares. No se construye un venue de Ethereum: eso es otro feature.
2. **Aave/Monad:** se queda `approve` + `deposit`, **dos firmas**. No se invierte en
   EIP-2612 `permit` ahora. La UI dice las dos firmas antes de pedir la primera.
3. **Nada se mueve sin que la persona lo toque y lo firme.** Nada de auto-depositar.

## Por qué el botón por fila y no un selector

Un selector de destino tiene que ser elegido *antes* de la acción, y el destino
que ofrece hoy es uno solo y está compilado. Con el botón en la fila, la fila dice
qué es, cuánto hay y qué pasa si lo tocás. No hay un paso de elegir, y no hay un
lugar donde el destino esté equivocado.

## El riesgo grande, y por qué va primero

**La instrucción de depósito de KVault no está verificada.**

El lector (`kaminoEarnVault.http.ts`) tiene cada offset confirmado contra la cadena
viva. El **depositor no existe**. La instrucción de depósito al programa KVault es
un Anchor: hay que acertar el discriminador, el orden de los accounts y el layout del
importe. Inventar esos bytes es la forma más barata de perder plata: una transacción
que se ejecuta y deposita donde no debía, o que quema el SOL de fees sin hacer nada.

Nadie acá escribe un offset de memoria. Por eso la primera tarea **no es código**: es
traer el layout desde una fuente autoritativa y confirmarlo con `simulateTransaction`
contra mainnet antes de que exista un botón que lo ejecute.

## Las tareas

### F1 — Verificar la instrucción de depósito de KVault (sin escribir UI)

**Hecho, con una corrección que cambia el feature: el depósito no es una
instrucción, son cuatro.**

La respuesta oficial de Kamino (`POST api.kamino.finance/ktx/kvault/deposit-instructions`)
para este vault devuelve:

| # | programa | qué hace |
|---|----------|----------|
| 0 | `ATokenGPvbd…` | crear la ATA de las **shares** |
| 1 | `KvauGMsp…` | el depósito: 13 accounts + **8 restantes** |
| 2 | `FarmsPZpW…` | crear la cuenta de farm (rent) |
| 3 | `FarmsPZpW…` | **stakear las shares** en el farm |

Las 2 y 3 confirman lo que el lector siempre supo: para este vault, las shares
**no se ven en la billetera**. El ejemplo del propio repo del programa dice lo
contrario; un doc no le gana a una cadena.

**Verificado, con su fuente:**

- **Discriminador** `f2 23 c6 89 52 e1 f2 b6`, por partida triple: `sha256("global:deposit")` calculado acá, el IDL autogenerado (`[242, 35, …]`), y el `data` de la respuesta de producción. Coinciden byte a byte.
- **Los 13 accounts** con su orden y sus permisos: el IDL (`new` = writable, `new_readonly` = sólo lectura) y los `role` de producción. El 0 es el único signer; el 9 (`token_program`) es el único `[optional]`.
- **El argumento** se llama **`max_amount`**, `u64` little-endian. Es un "max", no un importe: es una promesa, y por eso el nombre importa.
- **Los 4 reserves**: están en la cuenta del vault en offset **312**, stride **2160**, y el slice de 32 bytes coincide byte a byte con la pubkey de cada reserve. El quinto slot (offset 8952) es todo cero.
- **Las 4 lending markets**: **no** están en el vault. Están en la cuenta de la reserve, offset **32**. Comprobado en las cuatro, una por una. Y **no** se derivan por PDA: se probaron cuatro juegos de seeds y ninguno reproduce los mercados que Kamino manda.

Todo eso quedó anotado en `src/domain/yield/kaminoKVaultDeposit.ts`, con la fuente de
cada afirmación y una lista explícita de lo que **no** se verificó.

- **Gate de la simulación: PENDIENTE.** Falta `simulateTransaction` contra
  mainnet con una cuenta que tenga USDC de Solana y SOL.

**Lo que la verificación dejó en claro, y que F3 tiene que respetar:**

1. La **ATA de USDC** de la persona no la crea Kamino. La instrucción 0 crea la
   de las shares. Hay que derivar `user_token_ata` y crearla si no existe, y
   eso **cuesta SOL de renta**: sin él, el primer depósito falla.
2. El primer depósito de una persona es **más caro** que el segundo, porque la
   instrucción 2 crea su cuenta de farm. `9FVjHqdu…` y `3bMUivmh…` **no existen**
   en cadena (`getMultipleAccounts` → `null`); se crean en el momento.
3. Los 8 `remaining_accounts` no se pueden escribir a mano: **se leen**. Son los
   que hacen que la plata llegue a algún lado, y sin ellos la instrucción es
   inválida, no parcial.

### F2 — Backend: el saldo de origen de cada venue

**Hecho.** `investedValue.yield.venues[]` publica `depositable` al lado de `balance`
y `rate`: el USDC libre de **su** cadena, exacto (`raw`, `amount`, `decimals`,
`unit`), resuelto sobre las piezas libres que el portfolio ya leyó — sin RPC nueva
y sin una segunda lectura de la misma cadena.

La forma es una unión discriminada, nunca un `null` ambiguo ni un cero inventado:

```
depositable: { "status": "ok",         "amount": { "raw": "1500000", …, "unit": "USDC" } }
depositable: { "status": "unreadable", "reason": "RPC_UNAVAILABLE" }
```

Tres reglas, cada una con su test:

| Regla | Defecto que evita |
|---|---|
| `ok` con el importe exacto, y un **cero legítimo es `ok` con `raw: '0'`** | Un origen en cero deja dibujar el botón con tope cero; un ilegible no dibuja nada |
| `unreadable` con motivo, nunca `0` | Un botón que deposita sobre un número que nadie conoce |
| El indexado es **por cadena**: Aave ve Monad, Kamino ve Solana | Un modal que ofrece la plata de otra red |

Y la que protege la plata: `depositable` **no entra** en ningún `bucketOf`, ni en
`sumExact`, ni en `total`, ni altera `complete`. Es una **referencia** al mismo USDC
libre que `digitalDollarsValue` ya contó del lado libre, exactamente como
`availableUsdc` y `gasBalance` en `aaveVenue`. Con $1.50 libres en Monad, $0.50 en
Ethereum y $2.50 en Solana más $100 depositados, los dólares digitales siguen siendo
`104.5` y el total `104.585926`.

El original de acá:

Hoy el modal lee `availableUsdc`, que es el saldo libre de la cadena del pool, y
sólo existe para Aave. Con el botón en la fila, **cada venue tiene que decir cuánto
se puede depositar ahí**.

- `availableUsdc` (o su equivalente) para Kamino = USDC libre de **Solana**.
- Un venue sin saldo de origen **no dibuja botón**.
- Un saldo ilegible tampoco: depositar sobre un número que no se conoce no es una
  acción que vaya a funcionar.

### F3 — Backend: depositar en Kamino Earn

**Hecho, a medias y a propósito: el mensaje está armado y la respuesta dice que
todavía no mueve plata.**

`prepareDepositKamino` prepara un mensaje **sin firmar** con las dos instrucciones
que sí están verificadas —crear la ATA de USDC, crear la ATA de shares, y el
`Deposit` del KVault con sus 13 accounts y los 8 `remaining_accounts` leídos de la
cadena— y publica `completion.executes: false` con las dos instrucciones del
programa Farms que **no** se construyeron, cada una con su motivo.

**Por qué no se construyeron.** Las instrucciones 2 y 3 son del programa Farms y
este trabajo no encontró una fuente autoritativa para su discriminador ni para el
orden de sus accounts. No se inventan: sin ellas las shares quedan sin stakear en
el farm, que es donde rinde. Un botón que falla en mainnet es peor que un botón
que todavía no existe, así que la respuesta lleva un campo `completion` que la
pantalla puede mostrar tal cual.

**El contrato.** `POST /api/pool/deposit` con `{ "venue": "kamino", "amount":
"1000000" }`. El venue sale de `DEPOSIT_VENUES` —una lista cerrada en el servidor—,
y un venue desconocido se rechaza con `VENUE_UNKNOWN` **antes** de llamar a ningún
caso de uso. La dirección del firmante sale de `rewallet.wallets` (fila `solana`) y
el vault de una constante fijada: ningún cuerpo puede cambiar ninguna de las dos.

**El saldo de SOL.** Se publica `solBalance` junto con `requiredRent` y
`rentShortfall`, porque el primer depósito paga la renta de dos cuentas nuevas
—2 039 280 lamports cada una— y "no pudiste depositar" esconde la única razón por
la que un depósito es caro la primera vez. Dos reglas: un saldo ilegible es
`unreadable` y **nunca** `0`, y tener SOL suficiente **no** bloquea el depósito. El
saldo no entra en ningún bucket ni en ningún total: es la misma plata que el
portfolio ya contó, como `availableUsdc` de Aave.

**Lo que falta para que esto sea un botón:** las dos instrucciones del farm, su
simulación contra mainnet con una cuenta que tenga USDC, y el `event_authority` del
programa —que hoy se **deriva** por la convención de Anchor y que ninguna fuente de
este repositorio verificó como los otros offsets—.

### F4 — Front: el botón en la fila

- Sacar "Depositar USDC" de `CARD 1`.
- Un botón por fila con venue, que abre su propio modal y su propio flujo.
- La fila de Ethereum dice que no hay destino, y **no** dibuja botón.
- El botón de Aave dice que van a ser dos firmas, antes de la primera.

**Hecho, con una pieza de servidor que hacía falta.**

**F4a — `depositReady`, en la respuesta del balance.** Al lado de `depositable`,
cada venue publica si **puede** recibir un depósito, y cuando no puede, por qué.
No es un `boolean` pelado: es una unión discriminada, con un motivo acotado y una
frase para pintar tal cual.

```
depositReady: { "status": "ready" }
depositReady: { "status": "not_ready", "reason": "DEPOSIT_INSTRUCTIONS_UNVERIFIED",
                "missingSteps": 2, "message": "Todavía no podés depositar en Kamino…" }
```

Aave: listo. Kamino: no listo, con el motivo y la frase. El valor sale de
`KAMINO_DEPOSIT_NOT_EXECUTABLE`, al lado de la tabla de venues, y una prueba corre
`readWalletBalance` y `prepareDepositKamino` **sobre los mismos ports** y compara
las dos respuestas: `depositReady.status === 'ready'` tiene que ser exactamente lo
mismo que `completion.executes`. Dos verdades que no se cruzan son el botón que
aparece el día que construyan el farm y el depósito que falla en mainnet.

**Cada venue ahora publica también su `chain`** (`"monad"`, `"solana"`,
`"ethereum"`). Una fila que no dice en qué red está obliga a la pantalla a
deducirlo de la etiqueta, y una pantalla que deduce una red ofrece depósitos en
la red equivocada.

**F4b — El botón vive en la fila.** `CARD 1` quedó sin botón —no duplicado ni
escondido— y `CARD 2` dibuja una fila por red de la app, cruzada con las venues
que informó el balance. La decisión de si una fila dibuja botón se extrajo a
`venueRowActionOf`, que es **lógica pura** y por eso se prueba sin DOM: el repo
sigue sin tests de render (F2 de `odd/tasks/tests-del-front.md` pendiente), y esta
tarea no levantó `@testing-library/react`.

Quién dibuja botón y quién no:

| fila | botón | por qué |
|------|-------|---------|
| Aave · Monad, con USDC libre legible | **sí** | `depositReady: ready` y hay saldo de origen |
| Kamino · Solana | no | `depositReady: not_ready`; la frase del servidor va al lado, sin botón gris ni "próximamente" |
| Ethereum, sin venue | no | `no_venue`: la fila aparece y dice que en esa red todavía no hay dónde rendir |
| fila ilegible | no | `venue_unreadable`; ni la fila ni su botón se dibujan |
| `depositable` ilegible | no | `origin_unreadable`: no se deposita sobre un número que nadie leyó |
| `depositable` en cero real | no | `origin_zero`: se leyó y no hay nada — dos frases distintas para dos hechos distintos |
| venue listo sin flujo en la app | no | `no_flow_yet`: abrir el flujo de otro venue es mandar plata en otra cadena |

El número de firmas sale de los pasos del propio flujo (`approve` + `deposit`), no
de un número escrito en la vista, así que el rótulo no puede desincronizarse de lo
que el flujo hace.

### F5 — Gates

- `npm test` (front) y los tests del backend verdes.
- `tsc` limpio en los dos proyectos.
- Build verde.
- Un caso de test por cada regla de la sección de abajo.

## Las reglas, y el defecto que cada test evita

| Regla | Defecto que evita |
|---|---|
| Sin botón cuando no hay saldo de origen legible | Un botón que deposita una cifra que no sabemos |
| Sin botón en la fila sin venue | Ofrecer un destino que no existe |
| Sin auto-depositar | Mover plata sin que nadie la toque |
| Un toque en Aave = dos firmas, y la UI lo dice antes | Sorprender a alguien con dos pedidos de firma |
| La dirección del destino sale de la base | Depositar en la cuenta de otro |
| El share price de Kamino se pregunta, no se calcula | Un precio ~200× mal sobre plata real |

## Fuera de alcance

- **Venue de Ethereum.** Decidido: fila que declara la ausencia, no un Aave nuevo.
- **EIP-2612 `permit`.** Decidido: dos firmas en Monad.
- **Retiros.** No hay ruta de retiro, y esta feature no agrega una.
- **Auto-depositar.** Decidido: no.
- **Kamino SDK.** Las instrucciones se construyen acá, como las de Aave.