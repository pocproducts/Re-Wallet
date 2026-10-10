# Iconos reales de activos y cadenas

## Qué cambia

Hoy la app dibuja cada activo con un **glifo de texto** dentro de un círculo de
color: `₿`, `Ξ`, `◎`, `$`. Eso no es un icono, es un caracter. La diferencia se
ve en todas partes: un glifo no tiene la marca, no escala con fidelity y no se
reconoce de un vistazo como lo que es.

El cambio es sustituir el glifo por el **logo real** del activo y de la cadena.

## Dónde entran

- **Activos**: BTC, ETH, SOL, DOGE, TRX, USDC, USDT, MON.
- **Cadenas**: Ethereum, Monad, Base, Arbitrum, Optimism, Polygon, Solana.

## De dónde salen los archivos, y por qué están en el repo

Los SVG **se versionan en `src/assets/icons/`**. No se piden a un CDN en
runtime. Tres razones, en orden de peso:

1. Una demo sin red es una demo rota. Si el CDN no responde, el activo aparece
   sin logo — y sin logo, en una pantalla financiera, parece un error.
2. Un CDN externo puede cambiar su ruta o desaparecer. Un archivo en el repo no.
3. Un logo de marca **no se recolorea**. Va como imagen, no como glifo.

## Licencia: esto importa y está verificado

| Origen | Licencia | Uso |
|---|---|---|
| Simple Icons | **CC0 1.0** | Dominio público. Sin atribución. |
| open-crypto-icons | **ISC** | BSD-like.(copyright notice |

La CC0 de Simple Icons dice textualmente que alcanza para *"any purpose
whatsoever, including without limitation commercial, advertising or promotional
purposes"*. La ISC pide conservar el aviso de copyright, y por eso
`src/assets/icons/README.md` registra origen y licencia de cada archivo.

Lo que **no** se hizo: no se copiaron logos de sitios de terceros ni de
buscadores. Cada archivo tiene un origen con licencia comprobada.

## La decisión que casi sale mal

El ticker `mon` era el riesgo: **Monero usó `MON` antes de `XMR`**, así que un
icono con ese nombre podía ser la moneda equivocada. No se asumió: se verificó
por color. Monero es naranja `#FF6600`; el archivo descargado es blanco con
degradado, que es la marca de Monad.

El mismo control se aplicó a los 14: el color de cada SVG se contrastó contra
la marca real (BTC `#F7931A`, USDC `#2775CA`, USDT `#009393`, TRX `#C4342B`,
Polygon `#7B3FE4`, Solana `#9945FF`, Optimism `#FF0420`, Dogecoin `#C3A634`).

## Cómo se dibuja

Un solo componente, `<AssetIcon ticker="USDC" />`, que:

1. busca el logo en el registro;
2. si está, lo pinta;
3. si no está, **cae al glifo de hoy**.

Ese último punto es la regla del repo: una ausencia honesta antes que un
espacio en blanco que parece un logo roto. Agregar un activo sin logo no rompe
la pantalla: se ve como se veía antes.

## Criterios de aceptacion

- [ ] Los 8 activos del catalogo muestran su logo real
- [ ] Las 7 cadenas muestran su logo real
- [ ] Un ticker sin logo sigue mostrando su glifo, no un hueco
- [ ] Los logos no se recolorean ni se estiran
- [ ] Los archivos SVG estan en el repo, no se piden por red
- [ ] `README.md` de los iconos registra origen y licencia de cada archivo
- [ ] typecheck en 0, suite en verde, build sin cambios de bundle razonables