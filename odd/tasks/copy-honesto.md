# El copy que promete lo que no existe

## El problema

La app muestra nueve veces que el envío por ReWALLET es **gratuito** y
**instantáneo**. No hay un solo campo del backend que lo sostenga.

`SendPreparation` (`07.PockBackend/src/application/send/prepareSend.ts:199-243`)
no tiene campo de comisión ni de liquidación. No existe red de liquidación
interna: no hay ledger, no hay batch, y la tabla `rewallet.gas_sponsorships`
existe en el schema (`sql/ReWallet_Schema123.sql:413-433`) con **cero
referencias** en `src/` ni en `test/`.

El envío de hoy **arma una transacción on-chain y la firma el navegador**
(`prepareSend.ts:826-839` EVM y Solana, `useSendTransfer.ts:553-604`). Por lo
tanto:

- **Paga comisión de red**, que cobra la cadena y no la app.
- **Toma lo que tarde la cadena**: segundos en Solana, minutos en un EVM con
  tráfico.

## Por qué no es cosmético

Es una billetera. La afirmación "sin comisión · transferencia instantánea" sobre
un movimiento de dinero es una promesa, y en una pantalla de pagos una promesa
falsa es un problema legal y reputacional — no un texto mal elegido.

Ademáscredentials el caso donde más duele: alguien manda plata, ve "instantáneo",
y tarda cuatro minutos. El copy no hizo que tardara menos; hizo que la demora
pareciera un fallo de la app.

## El matiz que hay que respetar

**"Sin comisiones" no es falso en el DEPÓSITO.** Depositar no le cuesta nada a
quien recibe: no hay transacción que la app ejecute, y la comisión —si la hay—
la paga quien envía desde su exchange. La afirmación honesta ahí es *"ReWALLET no
te cobra nada por recibir"*, que es exactamente verdad.

Lo que sí es falso en todos lados es **"instantáneo"**, porque el depósito por
tag todavía no liquida por dentro.

## Dónde está cada uno

| Archivo:línea | Texto actual | Qué hay que decir |
|---|---|---|
| `ActionFlowModal.tsx:858` | "Gratis e instantáneo." (envío interno) | Sin promesa |
| `ActionFlowModal.tsx:1626` | "Gratis e instantáneo." (envío interno) | Sin promesa |
| `ActionFlowModal.tsx:1864` | "Sin comisión · Transferencia instantánea por ReWALLET" | Sin promesa |
| `CryptoAssetDetailModal.tsx:1156` | "Gratis e instantánea." (envío) | Sin promesa |
| `CryptoAssetDetailModal.tsx:1371` | "Sin comisión · Transferencia instantánea por ReWALLET" | Sin promesa |
| `CryptoAssetDetailModal.tsx:627` | "¡Es instantáneo y gratuito!" (recibir) | Solo lo gratuito |
| `CryptoAssetDetailModal.tsx:765` | "Sin comisiones" (card $ReTag) | ReWALLET no cobra |
| `CryptoAssetDetailModal.tsx:897` | "Sin comisiones" (card dirección) | ReWALLET no cobra |
| `ActionFlowModal.tsx:1000` | "Sin comisiones" (card depósito) | ReWALLET no cobra |

## La regla

**Ningún texto afirma una propiedad que ningún campo del backend pueda
respaldar.** El envío de hoy es on-chain: paga red y tarda lo que tarde la red.
Eso es lo que hay que decir.

Cuando exista la liquidación interna, el copy se restaura —y entonces tendrá que
estar **respaldado por el mismo balance** que este trabajo agrega, para que no
vuelva a ser una promesa sin dato.

## Tareas

- [x] T1 — Mapear los nueve textos y clasificarlos (mentira vs matiz)
- [ ] T2 — Reescribir el copy de envío
- [ ] T3 — Reescribir el copy de recepción y depósito
- [ ] T4 — Test que impide el regreso
- [ ] T5 — Verificar y desplegar

## Pendiente, no es parte de esto

El **modelo de saldo** para la liquidación interna vive en
`odd/tasks/modelo-de-saldo-liquidez-interna.md`. Este documento no lo implementa;
solo saca la promesa que hoy no se sostiene.