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

Hoy el modal lee `availableUsdc`, que es el saldo libre de la cadena del pool, y
sólo existe para Aave. Con el botón en la fila, **cada venue tiene que decir cuánto
se puede depositar ahí**.

- `availableUsdc` (o su equivalente) para Kamino = USDC libre de **Solana**.
- Un venue sin saldo de origen **no dibuja botón**.
- Un saldo ilegible tampoco: depositar sobre un número que no se conoce no es una
  acción que vaya a funcionar.

### F3 — Backend: depositar en Kamino Earn

- `prepareDepositKamino`, hermano de `prepareDeposit`, **sin** `approve`: el SPL no
  necesita allowance, es una sola instrucción.
- Mismo contrato de seguridad: la dirección sale de la fila de la base, nunca del
  cuerpo de la petición. Mismo refusal de importes que no sean enteros.
- El server sigue construyendo; el navegador solo firma.

### F4 — Front: el botón en la fila

- Sacar "Depositar USDC" de `CARD 1`.
- Un botón por fila con venue, que abre su propio modal y su propio flujo.
- La fila de Ethereum dice que no hay destino, y **no** dibuja botón.
- El botón de Aave dice que van a ser dos firmas, antes de la primera.

### F5 — Gates

- `npm test` (front) y los 768 tests del backend verdes.
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