/**
 * EL REGISTRO DE ICONOS: el único lugar que sabe de dónde sale un logo.
 *
 * ── Por qué los archivos viven en el repo y no en un CDN ─────────────────────
 *
 * Una demo sin red es una demo rota, y en una pantalla financiera un activo sin
 * logo no se lee como un faltante: se lee como un error. Un CDN externo además
 * puede cambiar su ruta y dejar de servir. Un archivo en el repo no hace ninguna
 * de las dos cosas.
 *
 * ── Por qué un logo no se recolorea ──────────────────────────────────────────
 *
 * Un logo de marca es un archivo, no un color. `currentColor` sobre un SVG de
 * marca produce algo que ya no se parece a la marca. Por eso van como `<img>`
 * dentro del círculo y nunca se tiñen: el círculo conserva su fondo y el logo
 * se dibuja tal cual, y por eso conviven los de color con los monocromos.
 *
 * ── La ausencia se dice ──────────────────────────────────────────────────────
 *
 * Un ticker sin entrada acá devuelve `null`, no una imagen rota. Quien lo
 * consume cae al glifo de texto, que es como se veía antes: preferible a un
 * hueco que parece un logo que no cargó.
 *
 * El origen y la licencia de cada archivo están en `README.md`, en esta misma
 * carpeta. No los repito acá porque el README es el lugar donde se actualizan
 * cuando cambia un archivo.
 */
import arbChain from './chain-arbitrum.svg';
import baseChain from './chain-base.svg';
import ethereumChain from './chain-ethereum.svg';
import monadChain from './chain-monad.svg';
import optimismChain from './chain-optimism.svg';
import polygonChain from './chain-polygon.svg';
import solanaChain from './chain-solana.svg';

import btc from './btc.svg';
import doge from './doge.svg';
import eth from './eth.svg';
import mon from './mon.svg';
import sol from './sol.svg';
import trx from './trx.svg';
import usdc from './usdc.svg';
import usdt from './usdt.svg';

/**
 * El logo de un ticker, o `null` si este proyecto no tiene el archivo.
 *
 * La clave es el **ticker en mayúsculas** porque es como el resto de la app
 * busca un activo: `identityOf`, el catálogo y los hooks usan `USDC`, no
 * `usdc`. Por eso se normaliza acá y no en cada consumidor.
 */
const BY_TICKER: Readonly<Record<string, string>> = {
  BTC: btc,
  DOGE: doge,
  ETH: eth,
  MON: mon,
  SOL: sol,
  TRX: trx,
  USDC: usdc,
  USDT: usdt,
};

/**
 * El logo de una cadena, o `null` si no hay archivo.
 *
 * La clave es el **key de cadena**, el mismo identificador que usan las rutas de
 * la API y `SUPPORTED_EVM_CHAINS`: `monad`, `ethereum`, `solana`, `base`,
 * `arbitrum`, `optimism`, `polygon`.
 */
const BY_CHAIN: Readonly<Record<string, string>> = {
  arbitrum: arbChain,
  base: baseChain,
  ethereum: ethereumChain,
  monad: monadChain,
  optimism: optimismChain,
  polygon: polygonChain,
  solana: solanaChain,
};

/** El logo de un activo, o `null` si este proyecto no lo tiene. */
export const iconForTicker = (ticker: string): string | null =>
  BY_TICKER[ticker.trim().toUpperCase()] ?? null;

/**
 * El logo de una cadena, o `null`.
 *
 * El key puede venir con o sin prefijo de `chain`, y con o sin mayúscula: cada
 * consumidor lo nombró a su manera y esta es la única función que los conoce a
 * todos. Aceptarlos a todos acá es más barato que obligar a corregir diez
 * call sites.
 */
export const iconForChain = (chain: string): string | null => {
  const key = chain.trim().toLowerCase();
  return BY_CHAIN[key] ?? BY_CHAIN[key.replace(/^chain[-:]/, '')] ?? null;
};

/** Si este proyecto tiene logo para el ticker. Para decidir sin dibujar. */
export const hasIconForTicker = (ticker: string): boolean => iconForTicker(ticker) !== null;