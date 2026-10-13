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
 * ── Por qué el envío ya no es sólo EVM ───────────────────────────────────────
 *
 * El backend arma **dos** formas de transacción: una EVM sin firmar para las
 * redes de `viem`, y una **transacción Solana compilada y serializada** para
 * Solana, que no tiene `to` ni `data` y viaja como `kind: 'solana'` con su
 * mensaje en base64.
 *
 * Y la forma de la red también cambió: `chainId` es `number` en una red EVM y
 * **`null`** en Solana, porque no hay id EIP-155. Un `0` sería un número que
 * el clúster nunca respondió, y la forma de una red que no tiene id no puede
 * decir que tiene `0`.
 *
 * El discriminador es `kind`, en la transacción y en la red. Nunca el nombre de
 * la cadena: "solana" es un dato que puede cambiar, y una rama escrita sobre él
 * se rompe el día que el catálogo sume una red con el mismo nombre en otro
 * espacio de nombres.
 */

import { checksumAddress } from 'viem';

import { SOLANA_MAINNET, SUPPORTED_EVM_CHAINS, arbitrumMainnet, baseMainnet, ethereumMainnet, evmChainById, monad, optimismMainnet, polygonMainnet } from './chains';
import type { DepositChainId } from '../types/deposit.types';

/**
 * La clave de red del catálogo del backend, la misma que usa el depósito.
 *
 * Se reusa el tipo del depósito a propósito: envío y depósito leen la **misma**
 * fila de `rewallet.deposit_catalog` en el servidor, y dos vocabularios para la
 * misma fila son dos maneras de divergir.
 */
export type SendChainId = DepositChainId;

/** Una red EVM en la que el envío se puede firmar, con su identidad. */
export interface EvmSendChainView {
  readonly kind: 'evm';
  /** La clave del catálogo, que es lo que viaja en el cuerpo del pedido. */
  readonly chain: SendChainId;
  /** El nombre que ve la persona. */
  readonly label: string;
  /** El id EIP-155, el mismo que devuelve el backend en `chainId`. */
  readonly chainId: number;
  /** La red en CAIP-2, como la nombra la wallet. */
  readonly network: `eip155:${number}`;
}

/**
 * Solana, con la forma que Solana tiene.
 *
 * `chainId` es `null` y no `0`: **no hay id EIP-155**, y `0` es un número que
 * parece una respuesta del clúster. `network` es CAIP-2 en el espacio de nombres
 * de Solana, y ese es el identificador real.
 */
export interface SolanaSendChainView {
  readonly kind: 'solana';
  readonly chain: SendChainId;
  readonly label: string;
  /** `null`: esta red no tiene id EIP-155. Ver la nota arriba. */
  readonly chainId: null;
  readonly network: `solana:${string}`;
  /** El clúster como lo nombra la wallet de Privy: `solana:mainnet`. */
  readonly cluster: `solana:${string}`;
}

/** Una red en la que el envío se puede firmar. `kind` dice de qué clase es. */
export type SendChainView = EvmSendChainView | SolanaSendChainView;

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
  [baseMainnet.id]: 'base',
  [arbitrumMainnet.id]: 'arbitrum',
  [optimismMainnet.id]: 'optimism',
  [polygonMainnet.id]: 'polygon',
} as const satisfies Readonly<Record<ConfiguredChainId, SendChainId>>;

/** Las redes EVM en las que se puede firmar un envío, en el orden de la configuración. */
const EVM_SEND_CHAINS: readonly EvmSendChainView[] = SUPPORTED_EVM_CHAINS.map((chain) => ({
  kind: 'evm',
  chain: CHAIN_KEY_BY_ID[chain.id],
  label: chain.name,
  chainId: chain.id,
  network: `eip155:${chain.id}`,
}));

/**
 * Solana entra por la misma puerta que las demás y por la misma regla.
 *
 * La fila del backend lo declara firmable, y el backend sí la compila y la
 * serializa; lo que cambia es **la forma**, no si se puede. `chainId: null` es
 * parte del contrato: una red sin id EIP-155 lo dice así.
 */
export const SEND_CHAINS: readonly SendChainView[] = [
  ...EVM_SEND_CHAINS,
  {
    kind: 'solana',
    chain: SOLANA_MAINNET.key,
    label: SOLANA_MAINNET.label,
    chainId: null,
    network: SOLANA_MAINNET.network,
    cluster: SOLANA_MAINNET.cluster,
  },
];

/** La red de envío con ese id EIP-155, o `null` si no está soportada. */
export const sendChainByChainId = (chainId: number): EvmSendChainView | null =>
  EVM_SEND_CHAINS.find((entry) => entry.chainId === chainId) ?? null;

/**
 * La red de envío con esa red CAIP-2, o `null` si no está soportada.
 *
 * Es el lookup que usa el hook, porque `network` es el único campo que viaja en
 * **las dos** formas de la respuesta: una preparación de Solana no trae `chainId`.
 * Comparar por CAIP-2 —y no por el nombre de la cadena— es lo que hace que la
 * comprobación siga valiendo para ambas.
 */
export const sendChainByNetwork = (network: string): SendChainView | null =>
  SEND_CHAINS.find((entry) => entry.network === network) ?? null;

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
 * Bytes a base58, con **el mismo alfabeto** con el que se valida una dirección.
 *
 * Vive acá y no en el hook porque el alfabeto es un hecho de la red y ya está
 * escrito en este archivo: dos alfabitos son dos respuestas a "cómo se escribe
 * una dirección de Solana", y una firma que se muestra con el alfabeto
 * equivocado es un identificador que no existe en ninguna exploradora.
 *
 * Se usa para el hash de la transacción de Solana, que Privy devuelve como bytes
 * y la pantalla muestra como texto. Es aritmética entera en base 58 y el
 * resultado tiene que ser el mismo que escribiría cualquier wallet.
 */
export const toBase58 = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '';

  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);

  let base58 = '';
  while (number > 0n) {
    base58 = `${BASE58_ALPHABET[Number(number % 58n)]}${base58}`;
    number /= 58n;
  }

  // Los bytes cero iniciales no aparecen en el entero: son `1` en base58.
  for (const byte of bytes) {
    if (byte !== 0) break;
    base58 = `1${base58}`;
  }

  return base58;
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

/**
 * El identificador de una persona en ReWALLET: `@tag` o `tag`.
 *
 * ── Por qué vive acá y no en un componente ───────────────────────────────────
 *
 * Porque la pregunta "¿esto es una dirección o es una persona?" tiene que tener
 * **una sola** respuesta en la app, y la que vale es la del backend: `recipient`
 * se valida como dirección y `recipientTag` se resuelve como tag, y un cuerpo
 * que trae los dos se rechaza. Si cada pantalla decidiera por su cuenta, dos
 * pantallas distintas mandarían el mismo texto por dos puertas.
 *
 * ── Por qué el mismo alfabeto que el de las columnas ────────────────────────
 *
 * Es el `CHECK` vivo de `rewallet.users.tag`: `[a-z0-9_.-]{3,60}`. Escribir el
 * patrón acá otra vez sería una segunda opinión sobre qué es un tag, y lo que
 * el servidor no puede resolver no debería parecer un candidato válido en el
 * cliente.
 */
const TAG_BODY = /^[a-z0-9_.-]{3,60}$/;

/**
 * ¿El texto es un `@tag`? Acepta el identificador con o sin arroba y en cualquier
 * capitalización, porque así se escribe y así se dicta.
 *
 * Ojo con el falso positivo obvio: una dirección EVM en minúsculas **también**
 * cumple este patrón. Por eso esta función **no decide** — sólo dice "esto tiene
 * forma de tag". Quien decide es `classifyRecipient`, que primero pregunta por
 * la dirección.
 */
export const looksLikeRewalletTag = (value: string): boolean => {
  const bare = value.trim().replace(/^@/, '').toLowerCase();
  return TAG_BODY.test(bare);
};

/** Lo que la persona escribió, y por qué puerta tiene que salir. */
export type RecipientKind =
  /** Una dirección válida **para esta red**: sale por `recipient`. */
  | 'address'
  /** Un identificador de ReWALLET: sale por `recipientTag`, y el backend lo resuelve. */
  | 'rewallet'
  /** Ninguna de las dos. */
  | 'unusable';

/**
 * Decide la puerta, y en un solo lugar.
 *
 * ── Por qué la dirección va primero ──────────────────────────────────────────
 *
 * Porque una dirección EVM en minúsculas cumple el patrón del tag, y mandarla
 * por la puerta del tag sería convertir un envío perfectamente válido en un
 * "no encontramos a nadie". La dirección es la que se reconoce por su forma
 * propia; el tag es lo que queda después.
 *
 * Y una dirección de **otra** red tampoco es un tag: una dirección EVM pegada
 * en un envío a Solana sigue siendo una dirección, y el mensaje tiene que decir
 * que no sirve **en esta red** en vez de "no encontramos a esa persona".
 *
 * ── Qué no hace ─────────────────────────────────────────────────────────────
 *
 * No sabe si el tag existe, ni de qué billetera es la persona, ni por qué red le
 * llega. Eso lo contesta el backend, con un código acotado, y esta función jamás
 * adivina un `@tag` para probar si anda.
 */
export const classifyRecipient = (chain: SendChainId, value: string): RecipientKind => {
  if (isValidRecipientForChain(chain, value)) return 'address';
  if (hasEvmShape(value.trim()) || isSolanaAddress(value.trim())) return 'unusable';
  return looksLikeRewalletTag(value) ? 'rewallet' : 'unusable';
};

/**
 * El enlace a la transacción en la exploradora de la red, o `null`.
 *
 * ── Por qué vive acá y no en la pantalla ────────────────────────────────────
 *
 * Porque no hacerlo era un bug real: la pantalla buscaba el explorer sólo
 * entre las cadenas EVM, y en Solana esa cadena no está — el resultado era un
 * envío firmado que no se podía abrir en una exploradora, justo la pieza que
 * demuestra que el envío ocurrió. La regla es chica pero es un contrato:
 * Solana no tiene id EIP-155, no entra en ese catálogo, y su exploradora
 * pública es fija.
 *
 * ── Qué no hace ─────────────────────────────────────────────────────────────
 *
 * No infiere nada de la cadena por el nombre ni por el símbolo: lee la vista
 * ya resuelta del envío, que nace del catálogo del backend. Un link a una
 * exploradora equivocada en una billetera es una página que parece phishing.
 */
export const sendExplorerUrlFor = (chain: SendChainView | null, hash: string | null): string | null => {
  if (hash === null || chain === null) return null;
  if (chain.kind === 'solana') return `https://explorer.solana.com/tx/${hash}`;
  const base = evmChainById(chain.chainId)?.blockExplorers?.default.url;
  return base === undefined ? null : `${base}/tx/${hash}`;
};