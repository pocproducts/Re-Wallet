/**
 * El envío: `POST /api/send/prepare`, el identificador del intento y la
 * validación del destinatario.
 *
 * ── Por qué acá no hay ni una dirección de contrato ──────────────────────────
 *
 * Mismo criterio que `services/pool.ts`: el backend arma la transacción sin
 * firmar y este archivo sólo la pide. El front no sabe qué contrato es el USDC de
 * Monad ni el de Ethereum —son dos direcciones distintas y ambas viven en el
 * catálogo del servidor—, y un front que las conoce puede ser movido a firmar
 * contra otro contrato por quien escriba la próxima pantalla.
 *
 * ── El `requestId`: un UUID por intención de envío ───────────────────────────
 *
 * Es lo único que impide que un doble toque mande plata dos veces, y por eso su
 * vida útil está decidida acá y no en la pantalla:
 *
 * - **Vive en el hook**, en una referencia, no en el estado de la pantalla: un
 *   `requestId` que se guarda en un `useState` re-renderizado puede cambiar
 *   entre el clic y el envío, y dos ids distintos es exactamente el doble toque
 *   que se quiere evitar.
 * - **Un id por preparación**, generado al empezar el intento y reusado durante
 *   todo el intento: dos toques que llegan al servidor antes de que termine el
 *   primero llevan el mismo id, y el segundo recibe la preparación guardada en
 *   lugar de una segunda transferencia.
 * - **Un intento nuevo es una intención nueva** y por lo tanto un id nuevo. Un
 *   reintento de una preparación que *falló* es una intención nueva de verdad:
 *   el backend devuelve la clave al refuse y no la quema, así que no se está
 *   pierden la protección de nada.
 * - **Nunca se reusa después de una firma**, y esto es lo importante: si el hash
 *   ya existe, ese envío ya está en la cadena y preparar otro con el mismo id
 *   lo convertiría en un envío distinto. El hook no vuelve a preparar cuando hay
 *   un hash.
 *
 * El backend acepta `[A-Za-z0-9_-]{8,128}`, así que un UUID con guiones entra
 * sin cambios.
 */

import { postJson, ApiError } from './api';
import {
  isSolanaSendTransaction,
  type SendPreparationBody,
  type SendPreparationResponse,
  type SendTransaction,
  type SendUnsignedTransaction,
} from '../types/send.types';

export type { SendPreparationBody, SendPreparationResponse, SendUnsignedTransaction };

/**
 * Base64 → bytes, y un `RangeError` si lo que vino no es base64.
 *
 * El mensaje de Solana viaja en base64 y la wallet lo toma en bytes, así que
 * esta conversión es parte del contrato con Privy y no una comodidad.
 *
 * Se decodifica a mano y no con `atob`: el mismo código tiene que correr en un
 * navegador, en una pestaña de pruebas y en un entorno de pruebas sin DOM, y
 * `atob` es una global que cada runtime expone un poco distinto.
 */
const fromBase64 = (base64: string): Uint8Array => {
  const text = base64.trim();
  if (text.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new RangeError(`un mensaje en base64 no puede ser "${base64}"`);
  }

  const bytes = new Uint8Array((text.length / 4) * 3);
  let offset = 0;
  for (let index = 0; index < text.length; index += 4) {
    const chunk =
      (BASE64_VALUES[text.charCodeAt(index)] ?? 0) * 262144 +
      (BASE64_VALUES[text.charCodeAt(index + 1)] ?? 0) * 4096 +
      (BASE64_VALUES[text.charCodeAt(index + 2)] ?? 0) * 64 +
      (BASE64_VALUES[text.charCodeAt(index + 3)] ?? 0);
    bytes[offset++] = (chunk >> 16) & 0xff;
    if (text[index + 2] !== '=') bytes[offset++] = (chunk >> 8) & 0xff;
    if (text[index + 3] !== '=') bytes[offset++] = chunk & 0xff;
  }

  return bytes.subarray(0, offset);
};

/** El valor de cada carácter del alfabeto base64; `-1` donde no hay carácter. */
const BASE64_VALUES = (() => {
  const table = new Int8Array(256).fill(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let index = 0; index < alphabet.length; index += 1) table[alphabet.charCodeAt(index)] = index;
  return table;
})();

/**
 * El mensaje de una preparación de Solana, en bytes.
 *
 * Lanza si la transacción no es de Solana: la única forma de mensaje es la que
 * trae `serializedTransaction`, y una preparación sin mensaje no es algo que se
 * pueda firmar.
 */
export const solanaMessageBytes = (transaction: SendTransaction): Uint8Array => {
  if (!isSolanaSendTransaction(transaction)) {
    throw new RangeError('esta transacción no es un mensaje de Solana');
  }
  return fromBase64(transaction.serializedTransaction);
};

/**
 * Un identificador de intento, para `POST /api/send/prepare`.
 *
 * `crypto.randomUUID` en un contexto seguro; si no lo hay —la app abierta por
 * http en una IP de la red local, que es como se prueba— se arman los 16 bytes
 * con `getRandomValues`, que sí existe siempre que haya Web Crypto. Nunca cae a
 * `Math.random`: un `requestId` adivinable no es una protección de doble toque.
 */
export const newSendRequestId = (): string => {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  // RFC 4122 v4: los bits de versión y de variante van puestos a mano.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** El envío tal como lo pide la pantalla: un cuerpo completo. */
export type PrepareSendInput = Omit<SendPreparationBody, 'requestId'>;

/**
 * ¿Lo que volvió es una preparación?
 *
 * Se lee defensivo, como `normalizePool`: una respuesta con una forma que no se
 * reconoce **no** se firma. Enviar algo que no se entendió sería mandar una
 * transacción que nadie revisó.
 *
 * Y `address` es parte de esa forma, no un extra: sin la dirección **que el
 * backend validó** no hay con qué comparar la wallet conectada, y adivinar sería
 * volver a firmar con la idea que tiene el cliente en vez de con la que el
 * servidor comprobó. Una respuesta sin `address` no es una preparación.
 *
 * ── Por qué cada transacción se valida según **su** forma ─────────────────────
 *
 * Porque son dos formas y cada una tiene su contrato: la EVM se firma con
 * `eth_sendTransaction` y necesita `to`, `data`, `value` y `chainId`; la de
 * Solana se firma con `signAndSendTransaction` y necesita el mensaje serializado.
 * Validar la forma de la una contra los campos de la otra dejaría pasar una
 * preparación a medio hacer como si estuviera entera.
 */
const isPreparation = (body: unknown): body is SendPreparationResponse => {
  const response = body as SendPreparationResponse | null;
  if (response === null || typeof response !== 'object') return false;
  if (typeof response.network !== 'string' || response.network.length === 0) return false;
  if (typeof response.address !== 'string' || response.address.length === 0) return false;
  if (!Array.isArray(response.transactions) || response.transactions.length === 0) return false;

  return response.transactions.every((transaction: SendTransaction) =>
    isSolanaSendTransaction(transaction)
      ? typeof transaction.serializedTransaction === 'string' && transaction.serializedTransaction.length > 0
      : typeof transaction.to === 'string' &&
        typeof transaction.data === 'string' &&
        typeof transaction.value === 'string' &&
        Number.isInteger(transaction.chainId),
  );
};

/**
 * `POST /api/send/prepare`: pide la transacción sin firmar de un envío.
 *
 * No firma, no manda nada y no reintenta. Un reintento automático de un `POST`
 * que prepara dinero sería exactamente el doble toque que la idempotencia
 * existe para evitar, así que si la red falla, la red falla: lo reintenta la
 * persona, con un intento nuevo.
 *
 * @returns La preparación, o `null` si la respuesta no tiene la forma de una —
 *          en particular, si no trae `address`. `null` **no** es una preparación
 *          sin firmar: es una respuesta que no se entendió, y no se firma.
 * @throws `ApiError` con el código del backend. El texto lo pone quien lo
 *         muestra; acá no se traduce ni un error.
 */
export const prepareSend = async (body: SendPreparationBody): Promise<SendPreparationResponse | null> => {
  try {
    const response = await postJson<SendPreparationResponse>('/send/prepare', body);
    return isPreparation(response) ? response : null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('PREPARATION_FAILED');
  }
};

/**
 * El monto de la pantalla al entero de la unidad mínima.
 *
 * El formato de entrada es el **argentino**: `"1.234,56"`, con punto de miles y
 * coma decimal —es lo que produce el teclado de la pantalla y lo mismo que
 * acepta `toScaled` de `services/pool.ts`—. El punto es separador de miles, no
 * separador decimal: un `"0.5"` con punto se leería como `5` y mandaría diez
 * veces lo escrito, así que el separador decimal tiene que ser la coma.
 *
 * Aritmética entera y **recorte**, no redondeo: los decimales sobrantes se cortan
 * en vez de redondearse, y acá importa más. Un redondeo en el medio significaría
 * mandar una plata que nadie eligió, y hacia arriba; un recorte manda lo que se
 * escribió y descarta lo que no se pudo escribir. Los decimales declarados son
 * los del catálogo, así que un sexto decimal escrito de más no llega nunca a la
 * cadena.
 *
 * @throws `RangeError` si el texto no es un importe, o si no da un monto positivo.
 */
export const sendAmountToRaw = (text: string, decimals: number): string => {
  const normalized = text.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new RangeError(`un importe no puede ser "${text}"`);
  }

  const dot = normalized.indexOf('.');
  const whole = dot === -1 ? normalized : normalized.slice(0, dot);
  const fraction = dot === -1 ? '' : normalized.slice(dot + 1);

  // Se recorta, no se redondea: ver el comentario de la función.
  const trimmed = fraction.slice(0, decimals).padEnd(decimals, '0');
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(trimmed || '0');
  if (value <= 0n) throw new RangeError('el monto tiene que ser mayor que cero');

  return value.toString();
};