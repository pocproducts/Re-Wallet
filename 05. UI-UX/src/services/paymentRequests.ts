/**
 * El link de cobro: crear, leer y pagar.
 *
 * ── Por qué el pago no manda un destinatario ────────────────────────────────
 *
 * Porque no hay campo para mandarlo. `POST /api/payment-requests/:id/pay` lleva
 * la red, el activo y nada más, y el backend resuelve la dirección de quien cobra
 * por dentro, contra `rewallet.wallets`. Un envío a mano manda `recipient` porque
 * quien paga copió una dirección de algún lado; acá no hay ningún lado del que
 * copiarla, y esa es exactamente la diferencia entre las dos pantallas.
 *
 * ── Por qué el cuerpo manda cadena y símbolo, y no decimales ────────────────
 *
 * Porque un cobro **nombra en qué se cobra**: `{ amount, chain, asset: { symbol } }`.
 * Los decimales los resuelve el servidor desde el catálogo, que es la autoridad
 * sobre el número por el que se cobra plata —la misma razón por la que
 * `prepareSend` no confía el `decimals` de un destinatario—. El front manda lo
 * que la persona eligió en el selector y nada más.
 *
 * Y como el cobro ya lo dice, el **cuerpo del pago no declara nada**: el backend
 * usa los del cobro. Un selector de activo al momento de pagar sería la manera de
 * volver a darle esa decisión a quien paga.
 *
 * ── Por qué el importe se manda como texto decimal ──────────────────────────
 *
 * Porque el cobro guarda dólares (`numeric(20,6)`) y no tiene con qué guardar la
 * escala del activo: el activo se elige **al pagar**, no al crear. El entero de
 * la unidad mínima lo calcula el servidor con aritmética entera en el momento del
 * pago. Si esta pantalla calculara ese entero, tendría que pasar el decimal por
 * un `number` de JavaScript y mandaría otra plata —ver `chargeAmountToDecimal`—.
 *
 * ── Por qué la normalización es defensiva y por qué descarta lo que no entiende
 *
 * Igual que `normalizePool` y `normalizeNotifications`: una respuesta con una
 * forma que no se reconoce **no** se muestra ni se paga. Una pantalla de cobro que
 * dibujara un cobro sin importe es una pantalla que pide plata sin decir cuánto, y
 * una que dibujara un cobro **sin cadena ni activo** es la misma cosa con más
 * palabras: nadie podría pagarlo, así que no se muestra.
 */

import { postJson, getJson, ApiError } from './api';
import type {
  PaymentRequest,
  PaymentRequestAsset,
  PaymentRequestStatus,
  PayChargeResponse,
} from '../types/paymentRequest.types';
import { SEND_CHAINS, sendChainByKey, type SendChainId } from '../config/send';
import type { DepositNetworkView } from './depositInfo';

export type { PaymentRequest, PaymentRequestStatus, PayChargeResponse };
export type { PaymentRequestAsset };

/** Los estados que la pantalla sabe pintar. Los cuatro de la tabla. */
const KNOWN_STATUSES: readonly PaymentRequestStatus[] = ['pending', 'paid', 'expired', 'cancelled'];

/**
 * Las cadenas que el backend puede mandar en un cobro: las de `config/send.ts`.
 *
 * La lista no se escribe acá: sale de la misma configuración de redes que decide
 * dónde se puede firmar un envío. Un cobro que llega con una cadena que no está
 * en esa lista no se muestra —no hay a qué red mandarlo—.
 */
const KNOWN_CHARGE_CHAINS: readonly string[] = SEND_CHAINS.map((entry) => entry.chain);

const isChargeChain = (value: unknown): value is SendChainId =>
  typeof value === 'string' && KNOWN_CHARGE_CHAINS.includes(value);

/**
 * El nombre de la cadena, en castellano y sin jerga: "Monad", "Solana".
 *
 * Sale de `config/send.ts`, que es donde ya vive el nombre que ve la persona. Si
 * la cadena no está, se devuelve la clave: una pantalla de dinero no puede
 * dejar un hueco, y la clave al menos no miente.
 */
export const chargeChainLabel = (chain: SendChainId): string => sendChainByKey(chain)?.label ?? chain;

/**
 * Un importe: hasta 20 enteros y hasta 18 decimales.
 *
 * El techo de 18 no es arbitrario: es el del catálogo. ETH y MON tienen 18
 * decimales y SOL tiene 9, y el cobro ahora nombra su activo en vez de medir en
 * dólares. Con un techo de 6, teclear `1.1234567` de ETH recortaba en silencio a
 * `1.123456` y se mandaba **menos plata de la que la persona escribió**, sin
 * aviso. Recortar es correcto cuando no queda nada que perder; acá quedaba, y en
 * la dirección que hace que la persona page de más.
 */
const DECIMAL = /^\d{1,20}(?:\.\d{1,18})?$/;

/**
 * El importe del teclado —argentino, `"1.234,56"`— al decimal que espera el
 * backend: `"1234.56"`.
 *
 * **Aritmética entera y recorte, nunca `parseFloat`.** El punto es separador de
 * miles y la coma es el decimal; un `Number('1.234,56')` da `NaN` y un
 * `Number('1,25')` da `1`, que es plata que nadie eligió. Los decimales de más se
 * **recortan** en vez de redondearse por la misma razón que en `sendAmountToRaw`:
 * un redondeo manda plata que no se escribió, y hacia arriba.
 *
 * @throws `RangeError` si no es un importe, o si no da un monto positivo.
 */
export const chargeAmountToDecimal = (text: string): string => {
  // El punto es separador de miles y la coma es el decimal: `"1.234,56"` es mil
  // doscientos treinta y cuatro con cincuenta y seis. Al revés no se acepta.
  const normalized = text.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) {
    throw new RangeError(`un importe no puede ser "${text}"`);
  }

  const dot = normalized.indexOf('.');
  const whole = dot === -1 ? normalized : normalized.slice(0, dot);
  // Recorte, no redondeo: ver el comentario de arriba.
  const fraction = dot === -1 ? '' : normalized.slice(dot + 1).slice(0, 18);

  /*
   * El importe se arma PRIMERO y se valida la cadena armada.
   *
   * Antes se validaba `${whole}.${fraction}`, que siempre lleva un punto. Cuando
   * el importe no tiene decimales `fraction` viene vacío y la cadena evaluada
   * terminaba en punto —`"1."`—, que `DECIMAL` rechaza porque exige de uno a
   * seis dígitos después del punto. El efecto era que **todo importe entero
   * quedaba sin poder cobrarse**: `1`, `10` y `100` se rechazaban con "el
   * importe no es un número válido", mientras que `1,5` pasaba. El bug no era
   * del monto chico sino de la ausencia de decimales: la mitad de los importes
   * posibles, y justo los más naturales de teclear.
   *
   * Validar lo que se devuelve, y no una reconstrucción aparte, es además lo
   * que hace que las dos cosas no puedan separarse nunca más.
   */
  const canonical = `${whole.replace(/^0+(?=\d)/, '')}${fraction === '' ? '' : `.${fraction}`}`;

  if (whole.length > 20 || !DECIMAL.test(canonical)) {
    throw new RangeError(`un importe no puede ser "${text}"`);
  }

  if (!/[1-9]/.test(canonical)) throw new RangeError('el importe tiene que ser mayor que cero');
  return canonical;
};

/** Un estado que la pantalla reconoce, o `pending` — que nunca miente hacia peor. */
const normalizeStatus = (value: unknown): PaymentRequestStatus =>
  typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as PaymentRequestStatus)
    : 'pending';

/**
 * El activo del cobro, si se puede interpretar.
 *
 * Sin símbolo no hay activo, y sin activo no hay cobro: se devuelve `null` y la
 * respuesta entera se descarta. La escala se acepta sólo si es un entero no
 * negativo; si no se pudo leer queda `null` en vez de `6`, porque un `6` puesto
 * acá sería un número que nadie declaró.
 */
const normalizeAsset = (value: unknown): PaymentRequestAsset | null => {
  const asset = value as { symbol?: unknown; decimals?: unknown } | null;
  if (asset === null || typeof asset !== 'object') return null;
  if (typeof asset.symbol !== 'string' || asset.symbol.length === 0) return null;

  const decimals =
    typeof asset.decimals === 'number' && Number.isInteger(asset.decimals) && asset.decimals >= 0
      ? asset.decimals
      : null;

  return { symbol: asset.symbol, decimals };
};

/**
 * Traduce el cuerpo a la forma que la pantalla usa.
 *
 * Una respuesta sin `id`, sin importe, sin estado legible, **sin cadena o sin
 * activo** no es un cobro y devuelve `null`: no se muestra como un cobro vacío —
 *que sería una pantalla pidiendo plata sin decir cuánto ni en qué— sino como una
 * lectura que no se pudo hacer, que es un hecho distinto y tiene su propio ámbar
 * en la pantalla.
 */
export const normalizePaymentRequest = (body: unknown): PaymentRequest | null => {
  const response = body as Partial<PaymentRequest> | null;
  if (response === null || typeof response !== 'object') return null;
  if (typeof response.id !== 'string' || response.id.length === 0) return null;
  if (typeof response.amount !== 'string' || !DECIMAL.test(response.amount)) return null;
  if (typeof response.expiresAt !== 'string' || Number.isNaN(Date.parse(response.expiresAt))) return null;
  if (!isChargeChain(response.chain)) return null;
  const asset = normalizeAsset(response.asset);
  if (asset === null) return null;

  return {
    id: response.id,
    amount: response.amount,
    note: typeof response.note === 'string' && response.note.length > 0 ? response.note : null,
    status: normalizeStatus(response.status),
    createdAt: typeof response.createdAt === 'string' ? response.createdAt : response.expiresAt,
    expiresAt: response.expiresAt,
    requesterTag:
      typeof response.requesterTag === 'string' && response.requesterTag.length > 0
        ? response.requesterTag
        : null,
    chain: response.chain,
    asset,
  };
};

/**
 * Un par cadena+activo por el que se puede cobrar.
 *
 * Sale del catálogo de depósito —el mismo que usan depósito y envío—, así que
 * un activo nuevo aparece en el selector sin tocar ninguna pantalla. La clave
 * `${chain}:${symbol}` es la que la pantalla guarda elegida.
 */
export interface ChargeAssetOption {
  readonly key: string;
  readonly chain: SendChainId;
  readonly chainLabel: string;
  readonly symbol: string;
  readonly assetName: string;
  readonly decimals: number;
}

/**
 * Los pares que el catálogo declara, en su orden, y nada más.
 *
 * Tres filtros, y los tres importan:
 *
 * - **La red tiene que ser firmable** (`config/send.ts`): un cobro que nadie
 *   puede pagar no es un cobro.
 * - **El activo tiene que traer escala del catálogo**: sin `decimals` no hay
 *   número que enviar, así que no se ofrece.
 * - **La red tiene que declarar el activo**: dos USDC de redes distintas son
 *   dos opciones, porque son dos cobros distintos.
 *
 * Sin catálogo no hay lista: `[]` es la ausencia, y la pantalla la dice en vez
 * de mostrar un selector vacío que parece "no hay nada para cobrar".
 */
export const chargeAssetOptions = (
  networks: readonly DepositNetworkView[],
): readonly ChargeAssetOption[] =>
  networks.flatMap((network) => {
    const chain = sendChainByKey(network.chain);
    if (chain === null) return [];

    return network.assets.map((asset) => ({
      key: `${network.chain}:${asset.symbol}`,
      chain: network.chain,
      chainLabel: chain.label,
      symbol: asset.symbol,
      assetName: asset.name,
      decimals: asset.decimals,
    }));
  });

/**
 * `POST /api/payment-requests` — un cobro nuevo, que **nombra** en qué se cobra.
 *
 * El cuerpo lleva `chain` y `asset.symbol`, y **no** decimales: la escala la
 * resuelve el servidor desde el catálogo, que es la autoridad sobre el número.
 *
 * @throws `ApiError` con el código del backend; el texto lo pone la pantalla.
 */
export const createPaymentRequest = async (body: {
  readonly amount: string;
  readonly chain: SendChainId;
  readonly asset: { readonly symbol: string };
  readonly note?: string | null;
}): Promise<PaymentRequest> => {
  const created = await postJson<PaymentRequest>('/payment-requests', {
    amount: body.amount,
    chain: body.chain,
    asset: { symbol: body.asset.symbol },
    ...(body.note === undefined || body.note === null || body.note.length === 0 ? {} : { note: body.note }),
  });

  const charge = normalizePaymentRequest(created);
  if (charge === null) throw new ApiError('PREPARATION_FAILED');
  return charge;
};

/**
 * `GET /api/payment-requests/:id` — el cobro del link.
 *
 * @throws `ApiError` con `REQUEST_NOT_FOUND` cuando el link no existe o ya no
 *         está vivo, y con `PAYMENT_REQUESTS_UNAVAILABLE` cuando no se pudo leer.
 *         Son dos hechos distintos y la pantalla los muestra distinto.
 */
export const readPaymentRequest = async (id: string): Promise<PaymentRequest> => {
  const response = await getJson<PaymentRequest>(`/payment-requests/${encodeURIComponent(id)}`);
  const charge = normalizePaymentRequest(response);
  if (charge === null) throw new ApiError('PREPARATION_FAILED');
  return charge;
};

/**
 * Lo que el navegador necesita del par elegido, y que **no** se manda.
 *
 * La red y la escala las necesita el hook de firma —cambiar de red en la wallet y
 * construir la transacción—, así que siguen viajando por dentro de la app. Lo que
 * cambia es el contrato HTTP. Este parámetro existe sólo porque el punto de
 * llamada (`usePayCharge`) todavía lo pasa, y se **ignora** a propósito: mandarlo
 * sería devolverle a quien paga la elección que el producto le cerró.
 */
export interface PayChargeChoice {
  readonly chain: SendChainId;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * `POST /api/payment-requests/:id/pay` — la transacción sin firmar del pago.
 *
 * **El cuerpo no declara activo ni cadena.** Desde que el cobro los nombra, se
 * usan los del cobro, y `choice` es el par que el hook ya tenía resuelto para
 * firmar: no se manda. Quien paga paga lo que el cobro pide.
 *
 * Lo que vuelve es una preparación de envío (más el estado del cobro), y lo que
 * **no** vuelve es la dirección de quien cobra: no se pide y no se devuelve. La
 * firma la pone la wallet de quien paga, contra `address`, que es la suya.
 *
 * @param choice Ignorado a propósito: ver `PayChargeChoice`.
 */
export const payPaymentRequest = async (
  id: string,
  _choice?: PayChargeChoice,
): Promise<PayChargeResponse> => {
  const response = await postJson<PayChargeResponse>(
    `/payment-requests/${encodeURIComponent(id)}/pay`,
    {},
  );
  return response;
};

/**
 * Los motivos por los que se corta, en las palabras que la pantalla puede
 * mostrar.
 *
 * Los que también son del envío (`INVALID_AMOUNT`, `NO_GAS`,
 * `AMOUNT_EXCEEDS_BALANCE`, …) tienen el mismo texto que en `useSendTransfer`, y
 * a propósito: es **el mismo hecho** y una persona no debería ver dos frases para
 * lo que le pasó una sola vez.
 */
export const CHARGE_FAILURE_TEXT: Readonly<Record<string, string>> = {
  REQUEST_NOT_FOUND: 'Este link de cobro no existe.',
  ALREADY_PAID: 'Este cobro ya se pagó. El link es de un solo uso.',
  REQUEST_EXPIRED: 'Este cobro se venció. Pedile uno nuevo a quien te lo pasó.',
  AMOUNT_INVALID: 'El importe no es un número válido.',
  NOTE_INVALID: 'La nota es demasiado larga.',
  EXPIRY_OUT_OF_RANGE: 'Ese plazo no sirve para un cobro.',
  ID_UNUSABLE: 'No pudimos generar el link. Probá de nuevo.',
  SELF_PAYMENT_REFUSED: 'Este cobro lo creaste vos, así que no te lo podés pagar.',
  PAYEE_WALLET_UNAVAILABLE: 'Quien te pide el dinero no puede recibirlo todavía. Avisale.',
  AMOUNT_NOT_REPRESENTABLE: 'Ese importe no se puede pagar exacto en el activo que pide el cobro.',
  /*
   * Los dos rechazos de la creación, cuando el par cadena+activo no existe.
   * Los devuelve el backend y no tienen equivalente en el envío: acá se elige en
   * qué cobrar, y una elección que no existe es un cobro que no se puede crear.
   */
  CHAIN_UNKNOWN: 'Esa cadena no existe. Elegí otra para cobrar.',
  ASSET_NOT_ON_CHAIN: 'Ese activo no está en esa cadena. Elegí otro para cobrar.',
  IDEMPOTENT_REPLAY: 'Este pago ya se había preparado. No lo volvemos a mandar.',
  IDEMPOTENT_IN_FLIGHT: 'Este pago ya se está preparando. Esperá un momento.',
  PAYMENT_REQUESTS_UNAVAILABLE: 'No pudimos leer el cobro. Probá de nuevo en un momento.',
  PAYMENT_REQUEST_CREATE_FAILED: 'No pudimos crear el cobro. Probá de nuevo en un momento.',
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a entrar para cobrar.',
  NETWORK_UNAVAILABLE: 'No pudimos conectarnos al backend. Revisá tu conexión.',
};
