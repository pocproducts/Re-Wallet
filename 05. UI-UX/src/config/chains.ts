import { defineChain } from 'viem';
import { mainnet } from 'viem/chains';

/**
 * LAS REDES EVM QUE SOPORTA LA APP.
 *
 * Este archivo es **la** configuración de red del frontend. `main.tsx` no declara
 * cadenas: las toma de acá, para que la respuesta a "¿en qué redes puede
 * funcionar esto?" esté escrita una sola vez.
 *
 * ── Por qué una wallet EVM y no una por red ───────────────────────────────────
 *
 * Las wallets embebidas de Privy soportan **cualquier** cadena EVM: se
 * configuran acá (`defaultChain` + `supportedChains`) y la wallet embebida se
 * inicializa en la red por defecto y después cambia de red. Consecuencia directa:
 *
 *   **la misma dirección EVM sirve en todas las redes EVM configuradas.**
 *
 * No hay una wallet de Ethereum y otra de Monad. Hay una, y vale en las dos. Por
 * eso la red no se elige acá creando nada: se elige saying cuál es la que la
 * persona está usando, y esa elección se registra en la base (columna
 * `rewallet.wallets.evm_network`, CAIP-2). Agregar una fila por red en la base
 * rompería `wallets_address_key`, porque no hay una segunda dirección que
 * escribir.
 *
 * ── Por qué Ethereum sigue siendo la red por defecto ─────────────────────────
 *
 * Decisión del owner: **Monad se suma, Ethereum no se reemplaza.** La red por
 * defecto es la que el producto quiso siempre, así que una transacción en la que
 * nadie eligió red va a Ethereum. Mandar a alguien a la red equivocada no tiene
 * vuelta: por eso el default es explícito y no "la primera de la lista".
 *
 * ── De dónde sale cada dato ───────────────────────────────────────────────────
 *
 * Ninguna URL ni ningún id sale de memoria. El 143 se verificó en cadena: la
 * RPC de Monad devuelve `eth_chainId = 0x8f`, y `0x8f` es 143. La exploradora se
 * verificó sirviendo una transacción real de esa misma red (y su `ChainID` en la
 * página es `0x8f`); ver el bloque de comentarios de más abajo.
 */

/**
 * Monad mainnet.
 *
 * `defineChain` de `viem`, no una constante de `viem/chains`: el paquete no la
 * trae todavía (la versión instalada es 2.56.5), y copiar la definición a mano
 * es la forma de que el id y el RPC se desincronicen de la red un día.
 *
 * - `id`: 143, leído de `eth_chainId` (`0x8f`) en `https://rpc.monad.xyz`.
 * - `nativeCurrency`: MON, 18 decimales.
 * - `rpcUrls`: la RPC pública que responde JSON-RPC.
 * - `blockExplorers`: `monadscan.com`, verificada sirviendo una transacción real
 *   de la red 143. **Un link de exploradora equivocado en una app de billetera
 *   manda a la gente a una página que parece phishing**, así que no se escribe
 *   ninguna sin comprobar antes que responde para esta cadena.
 */
export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: {
      name: 'MonadScan',
      url: 'https://monadscan.com',
    },
  },
  testnet: false,
});

/** Ethereum mainnet: la red por defecto, y la que no se reemplaza. */
export const ethereumMainnet = mainnet;

/** Todas las redes EVM soportadas, en el orden en que se ofrecen. Ethereum primero. */
export const SUPPORTED_EVM_CHAINS = [ethereumMainnet, monad] as const;

/** La red en la que se inicializa la wallet embebida. Ethereum, a propósito. */
export const DEFAULT_EVM_CHAIN = ethereumMainnet;

/**
 * Ether y MON, por id de cadena.
 *
 * El id es lo que identifica la red; el nombre es lo que se muestra. Tener el
 * id como clave evita comparar por texto un nombre que puede cambiar de
 * traducción.
 */
export const EVM_CHAIN_BY_ID: Readonly<Record<number, (typeof SUPPORTED_EVM_CHAINS)[number]>> = {
  [ethereumMainnet.id]: ethereumMainnet,
  [monad.id]: monad,
};

/**
 * La red EVM con ese id, o `null` si no está soportada.
 *
 * `null` y no la primera: una red desconocida tiene que poder rechazarse. Volver
 * a Ethereum por defecto sería mandar una transacción a una red que nadie
 * eligió.
 */
export const evmChainById = (chainId: number): (typeof SUPPORTED_EVM_CHAINS)[number] | null =>
  EVM_CHAIN_BY_ID[chainId] ?? null;