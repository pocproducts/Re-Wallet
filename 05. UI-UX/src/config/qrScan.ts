/**
 * QUÉ ES LO QUE SE ESCANEÓ: la regla que decide si lo que hay en el QR es el
 * destino del envío, y la frase que lo dice.
 *
 * ── Por qué la validación vive acá y no en la pantalla ───────────────────────
 *
 * Porque el destino se valida **por red**, y la red es una decisión que se tomó
 * antes de abrir la cámara. Un mismo texto es un destino válido en una red y un
 * error en otra: una dirección `0x…` en un envío a Solana no es "casi una
 * dirección", es **la dirección de otra red**, y mandarle la plata ahí es perder
 * el envío. La regla que decide eso es `isValidRecipientForChain` de
 * `config/send.ts` —la misma que valida lo pegado a mano— y este archivo no la
 * reescribe: la usa, y le pone al lado la frase que la persona puede entender.
 *
 * ── Por qué el rechazo nombra la red y nunca el contenido ────────────────────
 *
 * Por dos razones, y las dos importan.
 *
 * Una es de plata: un `0x…` de otra red y un `0x…` de la red correcta se
 * distinguen por un checksum, y la diferencia son caracteres que la persona no
 * va a leer de todos modos. Decir *"esa dirección es de una red Ethereum y este
 * envío va por Solana"* dice qué hacer —elegir la red correcta, o no mandar— sin
 * pedirle que compare dos ristras indistinguibles.
 *
 * La otra es de decoro y de seguridad: un QR puede contener cualquier cosa, y
 * volver a pintar ese texto en la pantalla es darle a quien generó el código la
 * pantalla completa para escribir lo que quiera —un número de teléfono, una
 * contraseña, una dirección con un typo que la persona iba a corregir a ciegas—.
 * Acá el valor escaneado **no se vuelve a mostrar**: se describe lo que se
 * detectó y se dice qué hacer.
 *
 * ── Por qué un link o un texto no se "adivina" ───────────────────────────────
 *
 * Porque un link de cobro (`/cobrar/<id>`) es otra cosa y la resuelve otra
 * parte de la app: se abre por la ruta, no por el campo de destino de un envío.
 * Completar el destino con un link sería mandar la plata a un sitio que no es
 * una dirección. Se rechaza con la frase que manda a la persona al camino
 * correcto.
 *
 * ── Y cómo se concilia eso con "Pagar" ───────────────────────────────────────
 *
 * Ese rechazo es del **envío**, y sigue siendo correcto: pegar un link de cobro
 * en un destino de envío es mandar plata a un lugar que no es una dirección. Por
 * eso el link se acepta sólo cuando el escáner está sirviendo a **pagar un
 * cobro**, que es un flujo distinto con una pantalla distinta: `mode`.
 *
 * `mode` no cambia qué es una dirección ni cómo se valida —la misma
 * `isValidRecipientForChain`— ni agrega una excepción: en `send` el link se sigue
 * rechazando, en `pay` el link es exactamente lo que se buscaba. Un modo nuevo no
 * habilita "aceptar links en todas partes", que es el error que este archivo evita
 * a propósito.
 */
import { isEvmAddress, isSolanaAddress, type SendChainView } from './send';
import { paymentRequestIdFromScannedValue } from './paymentLinks';

/**
 * Para qué flujo está leyendo el escáner.
 *
 * La diferencia es de **destino**, no de validación: los dos leen el mismo QR con
 * la misma cámara y la misma regla de red, y lo que cambia es qué se hace con lo
 * que sale.
 *
 * - `send`: completa el destino de un envío. Un link no sirve y se explica por qué.
 * - `pay`: abre el cobro de otro. Ahí el link de ReWALLET es lo que se busca, y
 *   una dirección sigue siendo aceptable porque pagar a una dirección escaneada
 *   es una forma de pagar como la otra.
 */
export type ScanMode = 'send' | 'pay';

/**
 * Por qué no se usó un valor escaneado.
 *
 * `not_address` agrupa los cuatro casos que no son una dirección, y la frase
 * distingue entre ellos; los otros tres son los que una persona puede
 * provocar sin querer y a los que hay que decirle qué hacer.
 */
export type ScanRejection = 'not_address' | 'wrong_chain' | 'too_long' | 'empty';

/** El QR servía: es el destino, para la red que está en juego. */
export interface ScanAccepted {
  readonly ok: true;
  readonly kind: 'address';
  /**
   * La dirección, ya recortada.
   *
   * Es lo **único** que sale de acá hacia la pantalla: una dirección que pasó la
   * misma validación que la que se pega a mano.
   */
  readonly address: string;
  /** La red para la que es válida, o `null` si no se pidió ninguna. */
  readonly chain: SendChainView | null;
}

/**
 * El QR era un link de cobro de ReWALLET, y el escáner estaba pagando.
 *
 * No lleva `address` a propósito: acá no hay una dirección que devolver. Lo que
 * sale es el id del cobro, y la pantalla que lo recibe —`PayChargeView`— nunca
 * muestra ni pide un destino. Por eso es un caso aparte del discriminador y no un
 * `chain` más: son dos respuestas distintas a "qué hago con esto".
 */
export interface ScanPaymentLinkAccepted {
  readonly ok: true;
  readonly kind: 'payment_link';
  /** El id del cobro, ya validado con el mismo patrón del link. */
  readonly chargeId: string;
}

/** El QR no servía, y hay una frase para decirlo. */
export interface ScanRejected {
  readonly ok: false;
  readonly reason: ScanRejection;
  /** Lo que la persona lee. Nunca contiene el valor escaneado. */
  readonly message: string;
}

/** El veredicto del escaneo: se usa o se explica. */
export type ScanVerdict = ScanAccepted | ScanPaymentLinkAccepted | ScanRejected;

/**
 * Cuánto texto se acepta antes de decir que el código no es una dirección.
 *
 * Una dirección EVM son 42 caracteres y una de Solana 44. El límite es tres
 * veces eso: cualquierQR con un id de cobro o un texto corto entra, y uno con
 * algo grande adentro se responde sin ir a mirar la red.
 */
const MAX_SCANNED_LENGTH = 128;

/** Un esquema de URL: `http:`, `https:`, `rewallet:`, `ethereum:`. */
const URL_SHAPED = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Un tag de ReWALLET, de las dos formas que la app conoce: `@nombre` y `$nombre`. */
const TAG_SHAPED = /^[$@][\w.-]{1,64}$/;

/**
 * La familia de red de una dirección, o `null` si no es una dirección.
 *
 * Son dos y no más porque los dos alfabetos no se cruzan: una `0x…` es EVM o no
 * es nada, y una base58 de 32 bytes es Solana o no es nada. No hace falta —ni
 * alcanza— para esto adivinar *cuál* red EVM es: la dirección no lo dice.
 */
type ChainFamily = 'evm' | 'solana';

const familyOf = (value: string): ChainFamily | null => {
  if (isEvmAddress(value)) return 'evm';
  if (isSolanaAddress(value)) return 'solana';
  return null;
};

/**
 * Cómo se nombra cada familia en la frase.
 *
 * "EIP-155" solo no dice nada para quien no Programó: lo que tiene que entender
 * es que **es otra billetera y otra red**, y por eso la frase dice qué hacer
 * después.
 */
const FAMILY_LABEL: Readonly<Record<ChainFamily, string>> = {
  evm: 'una red Ethereum (tipo EIP-155)',
  solana: 'Solana',
};

/**
 * Lo que se responde cuando el QR no es una dirección de billetera.
 *
 * El orden importa: primero se distingue lo que la persona probablemente quiso
 * escanear —un link, un tag— de lo que no tiene forma de dirección, porque la
 * acción que sigue es distinta. En ningún caso se devuelve el texto escaneado.
 *
 * `mode` cambia sólo la frase del link, y sólo cuando el link **no** era un link
 * de cobro: en `pay` ya se buscó un id antes de llegar acá, así que un link que no
 * lo tiene no es "abrilo en el navegador" sino "no es un cobro de ReWALLET".
 */
const notAddressMessage = (value: string, mode: ScanMode): string => {
  if (URL_SHAPED.test(value)) {
    if (mode === 'pay') {
      return (
        'Ese código es un link, pero no es un cobro de ReWALLET. Pedile a quien ' +
        'te cobra que te mande el link del cobro y apuntá ese.'
      );
    }

    return (
      'Ese código es un link, no una dirección. Si es un cobro de ReWALLET, ' +
      'abrilo desde el chat o desde el navegador y la app lo lleva a la pantalla del cobro.'
    );
  }

  if (TAG_SHAPED.test(value)) {
    return (
      'Ese código es un tag de ReWALLET, no una dirección. Buscá a esa persona ' +
      'por su @tag en esta pantalla y ReWALLET resuelve el destino sola.'
    );
  }

  if (/\s/.test(value.trim())) {
    return 'Ese código tiene texto, no una dirección de billetera. Apuntá a un QR de cobro.';
  }

  return 'Ese código no es una dirección de billetera. Sólo se puede enviar a una dirección escaneada o pegada.';
};

/**
 * El veredicto sobre lo que se acaba de escanear, para la red en juego.
 *
 * `chain` es `null` cuando el escáner se abrió sin una red elegida —el que está
 * en la cabecera de la billetera—. En ese caso no se puede afirmar que la
 * dirección sea "de otra red": se acepta cualquier dirección y el resto del flujo
 * es el que decide. Rechazar sin red sería inventar una restricción que nadie
 * pidió.
 */
export const judgeScannedValue = (
  raw: string,
  chain: SendChainView | null,
  mode: ScanMode = 'send',
): ScanVerdict => {
  const value = raw.trim();

  if (value.length === 0) {
    return { ok: false, reason: 'empty', message: 'El código llegó vacío. Probá de nuevo, más cerca y con luz.' };
  }

  if (value.length > MAX_SCANNED_LENGTH) {
    return {
      ok: false,
      reason: 'too_long',
      message: 'Ese código tiene demasiado texto para ser una dirección. Probá con el QR de cobro.',
    };
  }

  /*
   * Pagar un cobro: primero el link, y primero **siempre**.
   *
   * Un link nunca es una dirección, así que probarlo antes de la familia de red
   * no le quita ningún caso válido a nadie: si esto devuelve `null` sigue el
   * camino de siempre. Y si devuelve un id, ese id ya vino validado con el mismo
   * patrón que la barra de direcciones —`paymentRequestIdFromPath`—, así que acá
   * no hay una segunda versión de la regla.
   *
   * En `send` este bloque no existe, y por eso pegar un link de cobro en un
   * destino de envío sigue siendo un error.
   */
  if (mode === 'pay') {
    const chargeId = paymentRequestIdFromScannedValue(value);
    if (chargeId !== null) return { ok: true, kind: 'payment_link', chargeId };
  }

  const family = familyOf(value);

  if (family === null) {
    return { ok: false, reason: 'not_address', message: notAddressMessage(value, mode) };
  }

  // Sin red elegida no se puede afirmar que sea "de otra red": se acepta la
  // dirección y es el flujo del envío el que después decide.
  if (chain === null) {
    return { ok: true, kind: 'address', address: value, chain: null };
  }

  /*
   * Misma familia, misma red: acá no hay forma de adivinar más —una dirección
   * EVM no dice en qué red EVM está—, y `config/send.ts` es la que valida de
   * verdad, con checksum, antes de dejar firmar.
   */
  const wanted: ChainFamily = chain.kind === 'solana' ? 'solana' : 'evm';
  if (family !== wanted) {
    return {
      ok: false,
      reason: 'wrong_chain',
      message: `Ese QR es una dirección de ${FAMILY_LABEL[family]} y este envío va por ${chain.label}. Cambiá la red del envío o escaneá el QR de la otra billetera.`,
    };
  }

  return { ok: true, kind: 'address', address: value, chain };
};

/**
 * La dirección, o `null` si lo escaneado no sirve.
 *
 * Es un convenience para el consumidor —el que llena el campo— que no quiere
 * mirar el discriminador. `null` es lo único que significa "no llenes nada", y un
 * link de cobro también es `null`: para el destino de un envío no hay nada que
 * llenar.
 */
export const scannedAddressOrNull = (verdict: ScanVerdict): string | null =>
  verdict.ok && verdict.kind === 'address' ? verdict.address : null;

/**
 * La frase de una cámara que no se pudo abrir.
 *
 * ── Por qué no hay una sola ───────────────────────────────────────────────────
 *
 * Porque "no pudimos acceder a la cámara" no le dice a nadie qué hacer, y hay
 * tres motivos distintos que se arreglan de tres maneras: la persona lo negó y
 * hay que habilitarla en el candado del navegador; el navegador no la concede en
 * un contexto sin `https`; y no hay cámara o el sistema la tiene ocupada.
 *
 * Negar la cámara es una **decisión de la persona**, no un fallo de la app: por
 * eso el estilo del aviso no es el de un error y el botón grande es *reintentar*,
 * no *reparar*.
 */
export const CAMERA_STATUS_TEXT = {
  idle: 'Preparando la cámara…',
  starting: 'Preparando la cámara…',
  /** Negada en el navegador o por el sistema. */
  denied:
    'No vamos a usar la cámara sin tu permiso. Si te sirve, habilitala en el candado que aparece arriba del navegador y probá otra vez. También podés pegar la dirección a mano.',
  /** El navegador no la concede: falta `https`, o la app está dentro de un iframe. */
  unavailable:
    'No pudimos abrir la cámara. Puede que este navegador la tenga ocupada, o que la app esté abierta sin conexión segura. Podés pegar la dirección a mano.',
  insecure:
    'El navegador sólo abre la cámara en una dirección con https. Abrí la app por su dirección segura y el escáner vuelve a funcionar.',
  /** Ya se está leyendo: el texto de la cámara no dice nada de esto. */
  scanning: '',
} as const;

/** La línea que acompaña siempre al visor, y que también es la promesa del contrato. */
export const SCAN_FRAME_NOTE =
  'La cámara se abre sólo mientras escaneás y el video se lee en este teléfono: no se manda a ningún lado.';