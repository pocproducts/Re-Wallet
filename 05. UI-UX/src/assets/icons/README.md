# Iconos de activos y cadenas

Los SVG de esta carpeta **se versionan** y no se piden a un CDN en runtime. Una
demo sin red tiene que seguir mostrando los logos, y un archivo en el repo no
puede desaparecer como una ruta de un tercero.

Los logos de marca **no se recolorean**: van como imagen dentro del círculo, no
como glifo. Por eso viven acá y no en el CSS.

## Origen y licencia de cada archivo

| Archivo | Qué es | Origen | Licencia |
|---|---|---|---|
| `btc.svg` | Bitcoin | open-crypto-icons | ISC |
| `eth.svg` | Ethereum | open-crypto-icons | ISC |
| `sol.svg` | Solana | open-crypto-icons | ISC |
| `doge.svg` | Dogecoin | open-crypto-icons | ISC |
| `trx.svg` | Tron | open-crypto-icons | ISC |
| `usdc.svg` | USD Coin | open-crypto-icons | ISC |
| `usdt.svg` | Tether | open-crypto-icons | ISC |
| `mon.svg` | Monad | open-crypto-icons | ISC |
| `chain-monad.svg` | Monad (cadena) | copia de `mon.svg` | ISC |
| `chain-ethereum.svg` | Ethereum (variante blanca) | open-crypto-icons | ISC |
| `chain-solana.svg` | Solana | Simple Icons | CC0 1.0 |
| `chain-optimism.svg` | Optimism | Simple Icons | CC0 1.0 |
| `chain-polygon.svg` | Polygon | Simple Icons | CC0 1.0 |
| `chain-base.svg` | Base | open-crypto-icons | ISC |
| `chain-arbitrum.svg` | Arbitrum | open-crypto-icons | ISC |

**CC0 1.0** (Simple Icons) es dominio público: la licencia dice que alcanza para
*"any purpose whatsoever, including without limitation commercial, advertising
or promotional purposes"*. No requiere atribución, y aun así el origen queda
registrado acá.

**ISC** (open-crypto-icons) es una licencia BSD-like. Pide conservar el aviso de
copyright en las redistribuciones, y por eso esta tabla está en el repo y no en
un chat.

Los archivos se tomaron de los paquetes publicados, no de sitios de terceros.

## El control que se hizo antes de confiar en los nombres

El ticker `mon` era el riesgo real: **Monero usó `MON` antes de `XMR`**, así que
el icono podía ser la moneda equivocada y no haber forma de saberlo por el
nombre. Se verificó por color: Monero es naranja `#FF6600`, y el archivo es
blanco con degradado, que es la marca de Monad.

El mismo contraste se hizo con los 14 contra su color real:

```
BTC #F7931A   ETH gradiente   SOL degradado  DOGE #C3A634
TRX #C4342B   USDC #2775CA    USDT #009393   MON blanco/degradado
Ethereum #3C3C3D   Base gradiente   Arbitrum gradiente
Optimism #FF0420   Polygon #7B3FE4   Solana #9945FF
```

Un color que no coincide es un archivo equivocado, y eso se ve antes de que
llegue a la pantalla.

## Cómo se usan

Vía `src/assets/icons/index.ts`, que es el único lugar que importa estos
archivos. El resto de la app pide el logo por ticker y no sabe de dónde vino.

Un ticker sin logo **no rompe nada**: el componente cae al glifo de texto.

## Los dos assets que hubo que corregir

Descargados como venían, dos logos no funcionaban. No es un problema de
licencia ni de calidad del dibujo: son el archivo equivocado para el fondo donde
se usan.

**`chain-ethereum.svg` era ilegible.** La versión de Simple Icons es un solo
path `#3C3C3D` — gris oscuro — y el chip de red junto al QR es `bg-black`.
Gris oscuro sobre negro, con el `p-[22%]` del contenedor: prácticamente invisible.
Se cambió por la **variante blanca** de open-crypto-icons (`#FFF`), que es la
misma marca y se lee sobre fondo oscuro.

**`mon.svg` traía el fondo horneado.** El archivo era un ícono de app, no un
logo: traía `<rect fill="#F0F3FA" rx="28">`, un cuadrado redondeado claro con un
disco oscuro adentro. Puesto en el círculo de la app se veía un cuadrado claro
dentro del círculo, que es lo que la marca **no** es. Se quitó el `<rect>` y quedó
la marca sola: el disco `#151123` con el patrón.

Esto último tiene un costo que queda anotado: el disco de Monad es oscuro, así
que **sobre el chip `bg-black` se va a ver poco**. En las filas de red, cuyo
fondo viene del color del activo y es claro, se lee bien. Resolverlo exige que el
chip deje de ser negro, y eso es una decisión de diseño.
