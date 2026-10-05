# Enviar en Solana: SOL nativo y USDC (SPL)

## Por qué esta tarea

El envío a EVM funciona y está desplegado (`odd/tasks/pagar-enviar.md`, T2). Pero
`config/send.ts` deriva las redes signables de `SUPPORTED_EVM_CHAINS`, y el front
no tiene billetera de Solana. La app **no puede enviar a Solana**.

Peor: el backend **no puede armarla**. `prepareSend.ts:414` construye, para un
activo nativo, `nativeTransfer(recipient, amount, chainId)` — una transacción con
**forma EVM**. Para SOL eso devuelve `{to, value, data:'0x', chainId: 0}`, que no
se puede firmar en Solana: no tiene blockhash, ni mensaje compilado, ni cuentas.

Es decir: hoy un `POST /api/send/prepare` con `chain: "solana"` devuelve **200 con
una transacción basura**. Eso solo ya es un bug que hay que cerrar.

Y hay una mentira en el catálogo: `ASSETS_BY_CHAIN.solana` tiene solo SOL, con un
comentario que dice *"Solana todavía no tiene un dólar en el catálogo: no es un
error de la pantalla de dólares, es un hecho del catálogo"*. **Esa decisión de
producto cambió**: se pide USDC en Solana.

## Decisiones

1. ~~**Se agrega `@solana/web3.js`.**~~ **AMENDADA: se agregan
   `@solana/web3.js` **y** `@solana/spl-token`.**
   
   El motivo de la decisión original se mantiene: compilar un mensaje versionado y
   serializarlo son bytes que mueven plata, y una librería probada tiene el riesgo
   de supply chain —auditable— mientras que hacerlo a mano tiene el riesgo de
   corrección, que no. El keccak propio de `domain/send/` se queda: es una función
   hash, no una transacción.
   
   **Por qué hacen falta las dos.** `@solana/web3.js` compila y serializa el
   mensaje (`Transaction`, `Connection`, `PublicKey`), pero **no** construye
   instrucciones SPL: no sabe qué es un *associated token account* ni cómo se deriva
   esa dirección. `@solana/spl-token` construye esas instrucciones y deriva esa
   cuenta, pero no compila ni serializa el mensaje. Ninguna de las dos alcanza por
   sí sola para un envío de USDC, y escribir a mano lo que falta es exactamente lo
   que esta decisión prohíbe.
   
   **Consecuencia aceptada y registrada:** las dos son dependencias de **runtime** y
   entran en el bundle del Worker. Hay que vigilar el tamaño de `dist-worker.js`.
   `npm audit` reporta además dos avisos moderados que entran con `@solana/web3.js`
   (`stream-json` vía `jayson`, y `uuid`); quedan documentados en el README y
   **sin arreglar**, porque el arreglo es el major de `@solana/web3.js@3.0.0`, que
   rompe la API que esta tarea usa.

2. **El backend serializa; el navegador firma.** El front **no** arma
   transacciones ni conoce la cuenta de tokens. Mismo principio que ya sostiene
   `usePoolDeposit`: *"no construye calldata, no conoce direcciones de contrato,
   no estima gas, no manda nada por su cuenta"*.

3. **La cuenta de tokens del destinatario se crea si falta.** En Solana, mandar
   USDC a alguien que nunca recibió USDC falla si la *associated token account*
   no existe. La alternativa —rechazar— significa "no podés pagarle a nadie que no
   haya usado USDC en Solana", que rompe el producto. Se crea y lo paga quien
   envía. El costo de la renta va documentado, no escondido.

4. **Solana necesita su propio puerto, no un `if`.** El puerto de saldo ya
   argumenta exactamente esto: *"Solana no es EVM. Fingir que lo es —un lector con
   un argumento `chain` y un switch adentro— es lo que hace divergir los dos modos
   de fallo"*. El bloque y la transferencia van en un puerto nuevo, con su
   adaptador.

5. **`chainId: 0` no vuelve a aparecer en una respuesta.** Si una cadena no tiene
   id EIP-155, la respuesta lo dice de otra forma o no lo dice. Devolver `0` como
   si fuera un id es el mismo tipo de mentira que las once redes de la pantalla.

## El contrato que cambia

Hoy la respuesta es EVM:

```json
{ "transactions": [ { "purpose": "transfer", "to": "0x…", "data": "0x…",
                      "value": "0", "chainId": 143 } ] }
```

Para Solana hace falta otra forma. **No se estira la de EVM** — se agrega una
rama explícita, porque una transacción serializada de Solana no se puede
expresar como `to` + `data`:

```json
{ "transactions": [ { "purpose": "transfer",
                      "kind": "solana",
                      "serializedTransaction": "<base64>",
                      "chain": "solana" } ] }
```

El front tiene que distinguir `kind`. Un `switch` sobre la forma, no sobre el
nombre de la red.

## Qué hay que cambiar

### Backend

1. Puerto nuevo de Solana: blockhash reciente + transferencia (nativa y SPL).
   **Hecho**: `src/domain/ports/solana-transfer-preparer.ts`, con
   `SolanaPreparationError` y sus cuatro códigos acotados.
2. Adaptador HTTP sobre el RPC de Solana.
   **Hecho**: `src/infrastructure/rpc/solanaTransferPreparer.http.ts`.
3. `prepareSend`: rama de Solana que use el puerto nuevo y devuelva la forma nueva.
   **Hecho**. La rama también lee el saldo **del token** (no lamports) cuando el
   activo no es nativo, y se niega a devolver un mensaje cuya red no sea la que
   nombra el catálogo. Apareció un código de rechazo nuevo: `PREPARATION_FAILED`.
4. `chainIdentityFor`: que `solana` no produzca un `chainId` EVM.
   **Hecho**: la clave `chainId` **no existe** en la identidad de Solana. No es `0`:
   `0` parece un número que el clúster respondió.
5. Catálogo: entrada de **USDC en Solana** (mint
   `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimales), y el comentario
   que decía que no había dólar en Solana, actualizado.
   **Hecho**. `balanceReadable: false` en la fila, y el motivo escrito en el código.
6. README actualizado. **Hecho**: la segunda forma de transacción, el código nuevo,
   los avisos de dependencias y el hecho de que las dos librerías son de runtime.

### Pendiente, y por qué

Nada del backend queda pendiente. El bundle del Worker **sí** tocó este punto y ya
está resuelto: `build.mjs` ahora resuelve `@solana/web3.js` a su entrada de
navegador y `bigint-buffer` a su variante de navegador (su entrada por defecto
hace `require('bindings')`, que llega a `fs` y `path`). No se cambió `platform`:
eso alteraría cómo se resuelve todo el bundle, incluidas las rutas EVM que hoy
funcionan. Resultado: `dist-worker.js` en **1,918,013 bytes**crudos /
**366,420** con gzip, contra 1,202,134 / 229,461 del build anterior — un delta de
unos +716 KB crudos y +137 KB comprimidos, que sigue entrando de sobra en el
límite de un Worker.

### Front

7. `config/send.ts`: Solana entra a `SEND_CHAINS`; `network` admite `solana:…`.
   **Hecho.** `SendChainView` es una unión con `kind`: `'evm'` con
   `chainId: number` y `'solana'` con **`chainId: null`**. No es `0`: una red sin
   id EIP-155 no tiene id. El `satisfies` de las redes EVM queda intacto, y
   `evmChainById` acepta `null`/`undefined` para que la fila de exploradora
   pueda preguntar por el id de una red que no lo tiene.
8. `useSendTransfer`: rama de firma de Solana. **Privy firma Solana con
   `signAndSendTransaction`**, no con `eth_sendTransaction`, y **no hay
   `switchChain`**.
   **Hecho.** El método se verificó contra los tipos instalados
   (`@privy-io/react-auth` 3.47.0) y no de memoria:
   `ConnectedStandardSolanaWallet.signAndSendTransaction({ transaction: Uint8Array,
   address: string, chain: 'solana:mainnet' })` devuelve `{ signature: Uint8Array }`.
   El paso `network` **no desaparece**: queda `skipped` con el rótulo "Sin cambio
   de red", porque una lista que cambia de largo entre redes confunde más que una
   fila que dice la verdad.
9. La billetera se busca por `type === 'solana'`.
   **CORREGIDO**: las billeteras de Solana de `useWallets()` **no tienen `type`**.
   Son `ConnectedStandardSolanaWallet` —tienen `address` y
   `signAndSendTransaction`—, y la búsqueda se hace por el **método**, que es lo
   que los tipos sí garantizan. Buscar por `type` sería buscar un campo que no
   está.
10. Decimales: SOL y USDC usan la cantidad del catálogo, no 6 por defecto.
    **Sin cambios necesarios**: `ActionFlowModal.tsx` ya pasa `sendAsset.decimals`
    —el del catálogo del servidor— a `sendAmountToRaw` y al hook. No hay un `6`
    escrito en ningún punto de este flujo.

### Una línea de este documento que quedó vieja

El contrato de Solana dice que la respuesta "no tiene `chainId`". Sigue siendo
cierto, pero **también devuelve `address`**, igual que en EVM y con la misma
regla: se firma para la billetera que el servidor validó. Una preparación de
Solana sin `address` es una preparación que no se entiende, y el hook no firma.

## Allowed edit surfaces

- `07.PockBackend/src/domain/send/**`
- `07.PockBackend/src/domain/ports/**`
- `07.PockBackend/src/domain/deposit/catalog.ts`
- `07.PockBackend/src/application/send/prepareSend.ts`
- `07.PockBackend/src/infrastructure/rpc/**`
- `07.PockBackend/src/infrastructure/db/**`
- `07.PockBackend/src/interface/http/routes/send.ts`
- `07.PockBackend/src/container.ts`
- `07.PockBackend/test/**`
- `07.PockBackend/README.md`
- `07.PockBackend/package.json`
- `07.PockBackend/package-lock.json`
- `05. UI-UX/src/config/send.ts`
- `05. UI-UX/src/config/chains.ts`
- `05. UI-UX/src/services/send.ts`
- `05. UI-UX/src/types/send.types.ts`
- `05. UI-UX/src/hooks/useSendTransfer.ts`
- `05. UI-UX/package.json`
- `05. UI-UX/package-lock.json`
- `odd/tasks/enviar-solana.md`

## Fuera de alcance

- **Firmar con la wallet huérfana** `0xcCbe…`. Sigue fuera de alcance.
- Solana en el **depósito** (`deposit-info`): solo se agrega la fila del catálogo,
  la pantalla de cobrar no cambia.
- Detección de llegada de fondos (`odd/tasks/money-ears-from-arrival.md`).
- Cualquier cosa de ERC-4337, gas sponsorship o cuenta de servidor.
- Pruebas en mainnet: el código se prueba offline, la prueba con plata la hace
  una persona.