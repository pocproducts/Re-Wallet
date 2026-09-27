# ADR-002 — Alineación: el plan original de BestPath vs. lo que ya tenemos

**Estado**: propuesto
**Fecha**: 2026-09-27
**Contexto**: llega el documento de arquitectura original (el de donde nació la idea) y
hay que alinearlo con lo que ya está construido y verificado.
**Relacionado**: ADR-001 (custodia), `odd/tasks/app-functional-ladder.md`

---

## Veredicto corto

El documento original es **buenísimo como pitch** y **parcialmente incorrecto como
plan de implementación**. Describe otro producto en dos puntos que importan, y omite
un costo que es real. Tres afirmaciones load-bearing se verificaron: dos son
ciertas, una tenía el número aproximado pero fuente frágil.

## Lo que se CONFIRMA (verificado contra fuentes)

| Afirmación | Veredicto | Evidencia |
|---|---|---|
| Aave V3 en Monad USDC existe y es grande | **CIERTO, y mejor de lo que decía** | ~$164M supply, ~$151M borrow. Supply APR **5,7–6,1%** (3,6% base + ~2% Merkl). La reserva existe y tiene liquidez. |
| El piso de 10 MON en EOA delegada | **CIERTO, textual** | Docs de Monad: *"transactions that would reduce its balance to below 10 MON will unconditionally revert"*. |
| Privy sponsors gas en Monad (App pays) | **CIERTO, con condiciones** | Available en las redes que configures; para más redes hay que hablar con ventas. |

## Lo que se CORRIGE

### 1. El costo oculto del gas sponsored

El documento dice *"el usuario nunca paga gas con MON"* y lo da por gratis. Es
verdad para el **usuario**, pero no para nosotros:

Si el camino sponsored usa **EIP-7702** (que es lo que hace Privy), la wallet
delegada del usuario tiene que **mantener 10 MON siempre**. O sea, **10 MON por
usuario, de nuestro bolsillo**, o la transacción revierte.

A ~US$0,02 el MON son **~US$0,20 por usuario**. Es barato y es viable, pero es un
costo por usuario que tiene que estar en el modelo, no ser una sorpresa el día
del demo.

### 2. EIP-7702 está deshabilitado por defecto en Monad

Alchemy, que es el motor detrás del sponsorship de Privy: *"EIP-7702 support is
disabled by default for every team on Monad"*, y sin activarlo,
`eth_sendUserOperation` devuelve `-32602 EIP-7702 is disabled`.

**Es un switch en el dashboard, y es el primer bloqueante del depósito.** Si
esperamos a implementarlo y está apagado, el primer depósito falla con un error
que no parece ours.

### 3. El número de APY

El documento decía "~5,65%". El número real está entre 5,31% y 6,10% según la
fuente, y **es mayor que el base rate**: incluye recompensas de Merkl (~2%). Si
mostramos el número, tiene que ser el total, y con fecha: cambia.

## Lo que se DESCARTA (y por qué es una decisión, no un olvido)

### Las "50+ wallets"

El plan originalWonpremia conectar MetaMask, Rainbow, Rabby por EIP-6963 y
WalletConnect, y el pitch era *"conectás 50+ wallets"*.

**No lo vamos a construir para el hackathon, y creo que no deberíamos contarlo.**

Razones:

1. **Va en contra del criterio del track.** El track dice, textual, *"a payments app
   that never mentions a blockchain to the person using it"* y pondera *"a user's
   first five minutes"*. Abrir un modal que dice "conectá tu MetaMask" es exactamente
   la experiencia de cripto que el track premia evitar.
2. **Es otro producto.** Un usuario que conecta MetaMask ya es un usuario cripto. Lo
   que estamos construyendo es para el que no tiene wallet, no sabe qué es una
   seed y nunca va a ver la palabra MON.
3. **La wallet embedded que el plan da por automática es exactamente lo que
   apagamos.** `createOnLogin: 'off'` fue decisión deliberada (ADR-001): una wallet
   en el browser para una app que nunca firma del lado del cliente es superficie de
   ataque sin uso.

Lo dejamos anotado como feature futura. **No entra en el pitch.**

## Lo que se MANTIENE

| Pieza | Estado |
|---|---|
| Autenticación con passkey | construida y renderizando en browser |
| Custodia TEE (wallet del server) | **verificada contra la API real** |
| `GasService` con una puerta y dos sponsors | ya existe en el código |
| Aave V3 en Monad | direcciones verificadas on-chain, posición legible |
| "El usuario nunca ve una seed ni un private key" | sigue siendo cierto, y más fuerte ahora |

## Lo que falta verificar antes de construir el depósito

1. **¿El gas sponsorship aplica a wallets custodiales creadas por el server?** Las
   wallets TEE son wallets de Privy, así que debería, pero no está verificado. Es
   el único desconocido que decide si el depósito funciona.
2. **EIP-7702 habilitado para nuestro equipo** en el panel de Alchemy/Privy.
3. **ABI del Pool de Aave**, si queremos mostrar la tasa proyectada. Hoy no la
   mostramos a propósito: `getReserveData` con el layout adivinado devolvió 3183%
   anual, y un número de yield no verificado no entra.

## La conclusión

El plan original era el producto correcto con dos piezas que hoy decidimos no
construir (50+ wallets, embedded wallet) y un costo que nunca se anotó (10 MON por
usuario). Lo que ya tenemos es **más pequeño, más coherente y verificado**, y el
pitch que queda es más fuerte para el track queNest点上点了.
