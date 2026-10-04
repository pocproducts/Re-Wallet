/**
 * LAS REDES EN LAS QUE EL ENVÍO SE PUEDE FIRMAR, derivadas de la configuración
 * de red del proyecto.
 *
 * ── Por qué no hay una lista de redes de envío escrita a mano ────────────────
 *
 * Porque ya hubo una: la pantalla de destino anunciaba *"red Arbitrum, Base, Bnb
 * Chain (BEP20), CELO, Ethereum (ERC20), Monad, Optimism, Polygon, Solana,
 * Stellar o ZKsync Era"* — once redes, de las que el backend soporta dos. La
 * frase prometía destinos donde la plata se pierde sin dar ningún error, que es
 * la peor forma de perder plata.
 *
 * La lista de redes **firmables** sale de `config/chains.ts`, que es la
 * configuración de red de la app y la única que se cambia al agregar una cadena.
 * Acá no se escribe ningún id: se le pide a ese archivo.
 *
 * ── Por qué `satisfies` y no una lista ───────────────────────────────────────
 *
 * `Record<id, clave>` con `satisfies` hace que el compilador falle si se agrega
 * una red a `SUPPORTED_EVM_CHAINS` sin decidir acá qué clave de catálogo tiene.
 * Una red nueva no entra "de rebote": o se mapea, o no compila.
 *
 * ── Por qué el envío es sólo EVM ────────────────────────────────────────────
 *
 * El backend construye **una transacción EVM sin firmar** para las tres redes de
 * su catálogo —incluida Solana, donde `chainId` vale `0` porque no existe un id
 * EIP-155—. Lo que no hay es una billetera Solana en esta app: el flujo firma con
 * `eth_sendTransaction` sobre la wallet embebida de Privy, que es EVM. Ofrecer
 * Solana sin poder firmarla sería otra versión de la misma mentira de las once
 * redes, así que el filtro es explícito y va en el único lugar que decide.
 */

import { checksumAddress } from 'viem';

import { SUPPORTED_EVM_CHAINS, ethereumMainnet, monad } from './chains';
import type { DepositChainId } from '../types/deposit.types';

/**
 * La clave de red del catálogo del backend, la misma que usa el depósito.
 *
 * Se reusa el tipo del depósito a propósito: envío y depósito leen la **misma**
 * fila de `rewallet.deposit_catalog` en el servidor, y dos vocabularios para la
 * misma fila son dos maneras de divergir.
 */
export type SendChainId = DepositChainId;

/** Una red en la que el envío se puede firmar, con su identidad. */
export interface SendChainView {
  /** La clave del catálogo, que es lo que viaja en el cuerpo del pedido. */
  readonly chain: SendChainId;
  /** El nombre que ve la persona. */
  readonly label: string;
  /** El id EIP-155, el mismo que devuelve el backend en `chainId`. */
  readonly chainId: number;
  /** La red en CAIP-2, como la nombra la wallet. */
  readonly network: `eip155:${number}`;
}

/** Un id de cadena de las configuradas. */
type ConfiguredChainId = (typeof SUPPORTED_EVM_CHAINS)[number]['id'];

/**
 * De id de cadena a clave de catálogo.
 *
 * La clave **no** se deduce de `chain.name`: el backend manda su propia etiqueta
 * por red y un nombre de `viem` puede cambiar sin que cambie el catálogo. Se
 * escribe una vez, acá, y el compilador avisa si falta una red.
 */
const CHAIN_KEY_BY_ID = {
  [ethereumMainnet.id]: 'ethereum',
  [monad.id]: 'monad',
} as const satisfies Readonly<Record<ConfiguredChainId, SendChainId>>;

/** Las redes en las que se puede firmar un envío, en el orden de la configuración. */
export const SEND_CHAINS: readonly SendChainView[] = SUPPORTED_EVM_CHAINS.map((chain) => ({
  chain: CHAIN_KEY_BY_ID[chain.id],
  label: chain.name,
  chainId: chain.id,
  network: `eip155:${chain.id}`,
}));

/** La red de envío con ese id, o `null` si no está soportada. */
export const sendChainByChainId = (chainId: number): SendChainView | null =>
  SEND_CHAINS.find((entry) => entry.chainId === chainId) ?? null;

/** La red de envío con esa clave, o `null` si no está soportada. */
export const sendChainByKey = (chain: SendChainId): SendChainView | null =>
  SEND_CHAINS.find((entry) => entry.chain === chain) ?? null;

/**
 * La primera red en la que un envío es posible, para cuando hace falta una y no
 * hay elección previa.
 */
export const DEFAULT_SEND_CHAIN: SendChainView | null = SEND_CHAINS[0] ?? null;

/** ¿Tiene la forma de una dirección EVM? `0x` y cuarenta hex, sin más. */
const hasEvmShape = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

/**
 * ¿Es una dirección EVM válida, con la misma regla de checksum que el backend?
 *
 * La regla es la de EIP-55 y es la que importa: una dirección **mixta** lleva el
 * checksum dentro de su propia capitalización, así que un carácter mal copiado
 * cambia el `keccak256` y produce una dirección que *parece* válida y no lo es.
 * En una cadena EVM nadie vuelve a mirar ese carácter —la transferencia es
 * final y se pierde— y por eso una mixta tiene que pasar por `checksumAddress`.
 *
 * Toda en minúscula o toda en mayúscula se acepta sin checksum: esas
 * capitalizaciones no llevan información de checksum, así que no hay nada que
 * verificar. Es literalmente la regla del backend, para que el cliente no
 * rechace una dirección que el servidor aceptaría.
 */
export const isEvmAddress = (value: string): boolean => {
  if (!hasEvmShape(value)) return false;

  const body = value.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;

  try {
    // El tipo de `checksumAddress` exige el prefijo, que `hasEvmShape` ya aseguró.
    return checksumAddress(value as `0x${string}`) === value;
  } catch {
    return false;
  }
};

/**
 * Base58: el alfabeto de Bitcoin y por lo tanto el de Solana. `0`, `O`, `I` y `l`
 * **no** están, y esa es exactamente la razón por la que una dirección de una
 * red no se puede pegar en un envío de la otra: los alfabetos no se cruzan.
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Cuántos bytes decodifica una cadena base58, o `null` si tiene un carácter
 * fuera del alfabeto.
 *
 * Son aritmética entera sobre el valor de cada carácter, en base 58: es la
 * definición de base58, no una tabla de longitudes escritas a mano.
 */
const base58ByteLength = (value: string): number | null => {
  let bytes = 0;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit === -1) return null;
    bytes = bytes * 58 + digit;
  }
  // El número de bytes es el logaritmo en 256 del valor, más los ceros iniciales.
  let length = 0;
  for (let rest = bytes; rest > 0; rest = Math.floor(rest / 256)) length += 1;
  return length;
};

/** Una dirección de Solana: base58 que decodifica a **exactamente** 32 bytes. */
export const isSolanaAddress = (value: string): boolean => {
  if (value.length === 0) return false;
  return base58ByteLength(value) === 32;
};

/**
 * La dirección es válida **para esta** red, y sólo eso.
 *
 * ── El backend vuelve a validarla, y esa es la validación que cuenta ─────────
 *
 * `POST /api/send/prepare` corre `recipientForChain` sobre lo mismo que se le
 * mandó, y rechaza con `INVALID_RECIPIENT` antes de leer un saldo o escribir una
 * fila. Lo de acá es una comodidad: frena el envío obviousmente mal formado sin
 * gastar una ida al servidor, y **no** es una garantía. Una dirección que pasa
 * esta función puede ser inválida igual —el tabulador pegado, el `0x` de otro
 * exchange, el carácter que se perdió al copiar— y la que decide es la del
 * servidor, siempre.
 */
export const isValidRecipientForChain = (chain: SendChainId, value: string): boolean => {
  if (chain === 'solana') return isSolanaAddress(value);
  return isEvmAddress(value);
};