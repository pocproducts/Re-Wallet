# Depósito de cripto: catálogo por red y direcciones correctas

## Por qué esta tarea

El paso **Depositar → Cripto** es el punto donde un error de dirección no da un
error visible: da una pérdida. Hoy esa pantalla tiene:

| Qué | Estado |
|---|---|
| Red por defecto | `Bnb Chain (BEP20)`, escrita a mano |
| Redes | lista hardcodeada |
| Activos | catálogo mock (BTC, DOGE, USDT…) |
| **Dirección de la persona** | **no aparece** |

El modal ya avisa *"Asegurate de depositar X desde la red Y. De lo contrario,
perderás tus fondos"*. El texto está bien; lo que falta es que la red y la
dirección que hay detrás sean reales.

## Decisiones del owner

1. **El catálogo arranca con los cuatro activos cuyo saldo sí leemos**: MON,
   USDC, ETH y SOL. La estructura queda lista para crecer y **cada activo
   futuro entra con su contrato verificado en cadena antes de mostrarse**.
2. **Elegir red y después dirección.** Un activo que vive en varias redes no
   muestra una única dirección: muestra una por red.
3. **Dirección recortada, con copiar completa y QR.** Una dirección entera
   escrita a mano se transcribe mal.
4. **La dirección siempre viene del backend**, pegada a su red. Nunca de una
   constante, de un link ni del navegador.
5. **Si un activo no se puede leer, se avisa; no se muestra 0.** Lógicamente
   "no leído" es 0, pero mostrar 0 afirma algo que no sabemos. Es producto de
   pagos de consumo: ahí la honestidad no es decorativa.
6. **La wallet EVM recibe cualquier ERC-20 de sus redes**, y la pantalla lo
   dice. El catálogo de la app es una decisión del producto, no un límite de
   Privy.

## Lo que dice la documentación de Privy

- *"Privy embedded wallets can support **any EVM-compatible chain**"*, y las
  redes se configuran con `defaultChain` y `supportedChains`.
- La lista de assets con nombre de Privy (`eth`, `usdc`, `polygon`…) **no
  incluye Monad**, que es una de las razones por las que los saldos se leen
  con RPC propio.
- Consecuencia de producto: **la dirección EVM es la misma en Ethereum y en
  Monad**, y puede recibir cualquier token de esas redes. Solana tiene la
  suya.

## El contrato, en un solo lugar

El backend es la fuente de verdad del catálogo y de las direcciones. El front no
tiene lista de redes ni de activos para depositar.

```
GET /api/deposit-info        (misma sesión, mismas reglas que el resto)

{
  "generatedAt": "…",
  "networks": [
    {
      "chain": "monad",
      "label": "Monad",
      "evmNetwork": "eip155:143",
      "hasWallet": true,
      "address": "0xaA8A…",
      "assets": [
        { "symbol": "MON",  "name": "Monad",  "decimals": 18, "native": true,
          "token": null, "balanceReadable": true },
        { "symbol": "USDC", "name": "Dólares digitales", "decimals": 6, "native": false,
          "token": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", "balanceReadable": true }
      ]
    }
  ]
}
```

Reglas del contrato:

- `address` viene de `rewallet.wallets` de la persona autenticada. **Nunca del
  pedido.**
- Una red sin wallet aparece con `hasWallet: false` y **sin** `address`: no hay
  adónde recibir.
- `balanceReadable` viaja **por activo**, porque depende de qué sepamos leer
  en cadena para ese token. Es lo que decide entre mostrar el saldo y mostrar el
  aviso.
- Un token que entre al catálogo con `balanceReadable: false` es un activo
  recibible, con red y dirección, pero sin cifra.

## Tareas

### T1 — Backend: catálogo y direcciones

- Un módulo único con el catálogo por red. **Fuente de verdad, en el servidor.**
- Las direcciones por red salen de las filas de la persona, con la red a la que
  pertenece.
- Tests: la dirección nunca viene del pedido; una red sin wallet no trae
  dirección; un activo con `balanceReadable: false` aparece igual con su red;
  el orden de activos por red es estable.

**Gate**: `npm test` en verde y `tsc` limpio.

### T2 — Front: elegir activo, red y dirección

- El paso de depositar deja de usar la red hardcodeada y el catálogo mock.
- El flujo es **activo → red → dirección**, y la red va **pegada** a la fila de
  cada activo, para que nunca haya una dirección sin su red.
- Dirección recortada, con copiar la completa y QR.
- Se conserva el aviso existente de que depositar en otra red hace perder los
  fondos, ahora respaldado por redes reales.
- Cuando un activo no tiene saldo legible, se dice que no se pudo leer. Nunca 0.

**Gate**: `tsc` limpio y build ok.

## Allowed edit surfaces

- `07.PockBackend/src/**`
- `07.PockBackend/test/**`
- `07.PockBackend/README.md`
- `05. UI-UX/src/App.tsx`
- `05. UI-UX/src/components/Wallet/**`
- `05. UI-UX/src/components/Charge/**`
- `05. UI-UX/src/components/Investments/**`
- `05. UI-UX/src/components/common/AssetSheet.tsx`
- `05. UI-UX/src/services/**`
- `05. UI-UX/src/hooks/**`
- `05. UI-UX/src/types/**`
- `05. UI-UX/src/config/assets.ts`
- `odd/tasks/deposito-assets-y-direcciones.md`

## Fuera de alcance

- Depositar desde un exchange: la app muestra adónde Receiving, no mueve fondos.
- Aave: es T5 del otro documento y sigue con su propio camino.
- Wrapped tokens (WMON, WETH): entran cuando su contrato esté verificado.
