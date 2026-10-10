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
 * ── Por qué el importe se manda como texto decimal ───────────────────────────
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
 * dibujara un cobro sin importe es una pantalla que pide plata sin decir cuánto.
 */

import { postJson, getJson, ApiError } from './api';
import type {
  PaymentRequest,
  PaymentRequestStatus,
  PayChargeResponse,
} from '../types/paymentRequest.types';
import type { SendChainId } from '../config/send';

export type { PaymentRequest, PaymentRequestStatus, PayChargeResponse };

/** Los estados que la pantalla sabe pintar. Los cuatro de la tabla. */
const KNOWN_STATUSES: readonly PaymentRequestStatus[] = ['pending', 'paid', 'expired', 'cancelled'];

/** Un importe: hasta 14 enteros y hasta 6 decimales, como `numeric(20,6)`. */
const DECIMAL = /^\d{1,14}(?:\.\d{1,6})?$/;

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
  const fraction = dot === -1 ? '' : normalized.slice(dot + 1).slice(0, 6);

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

  if (whole.length > 14 || !DECIMAL.test(canonical)) {
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
 * Traduce el cuerpo a la forma que la pantalla usa.
 *
 * Una respuesta sin `id`, sin importe o sin estado legible **no es un cobro** y
 * devuelve `null`: no se muestra como un cobro vacío —que sería una pantalla
 * pidiendo plata por nada— sino como una lectura que no se pudo hacer, que es un
 * hecho distinto y tiene su propio ámbar en la pantalla.
 */
export const normalizePaymentRequest = (body: unknown): PaymentRequest | null => {
  const response = body as Partial<PaymentRequest> | null;
  if (response === null || typeof response !== 'object') return null;
  if (typeof response.id !== 'string' || response.id.length === 0) return null;
  if (typeof response.amount !== 'string' || !DECIMAL.test(response.amount)) return null;
  if (typeof response.expiresAt !== 'string' || Number.isNaN(Date.parse(response.expiresAt))) return null;

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
  };
};

/**
 * `POST /api/payment-requests` — un cobro nuevo.
 *
 * El id que vuelve **es** el link: la app arma la ruta con
 * `config/paymentLinks.ts` y lo comparte. No hay una URL sin registro, porque una
 * URL sin registro no es un cobro: es un favor.
 *
 * @throws `ApiError` con el código del backend; el texto lo pone la pantalla.
 */
export const createPaymentRequest = async (body: {
  readonly amount: string;
  readonly note?: string | null;
}): Promise<PaymentRequest> => {
  const created = await postJson<PaymentRequest>('/payment-requests', {
    amount: body.amount,
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

/** Lo que la pantalla elige para pagar: en qué red y con qué activo. */
export interface PayChargeChoice {
  readonly chain: SendChainId;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * `POST /api/payment-requests/:id/pay` — la transacción sin firmar del pago.
 *
 * Lo que vuelve es una preparación de envío (más el estado del cobro), y lo que
 * **no** vuelve es la dirección de quien cobra: no se pide y no se devuelve. La
 * firma la pone la wallet de quien paga, contra `address`, que es la suya.
 */
export const payPaymentRequest = async (
  id: string,
  choice: PayChargeChoice,
): Promise<PayChargeResponse> => {
  const response = await postJson<PayChargeResponse>(
    `/payment-requests/${encodeURIComponent(id)}/pay`,
    { chain: choice.chain, asset: { symbol: choice.symbol, decimals: choice.decimals } },
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
  AMOUNT_NOT_REPRESENTABLE: 'Ese importe no se puede pagar exacto en el activo elegido.',
  IDEMPOTENT_REPLAY: 'Este pago ya se había preparado. No lo volvemos a mandar.',
  IDEMPOTENT_IN_FLIGHT: 'Este pago ya se está preparando. Esperá un momento.',
  PAYMENT_REQUESTS_UNAVAILABLE: 'No pudimos leer el cobro. Probá de nuevo en un momento.',
  PAYMENT_REQUEST_CREATE_FAILED: 'No pudimos crear el cobro. Probá de nuevo en un momento.',
  UNAUTHENTICATED: 'Tu sesión terminó. Volvé a entrar para cobrar.',
  NETWORK_UNAVAILABLE: 'No pudimos conectarnos al backend. Revisá tu conexión.',
};
