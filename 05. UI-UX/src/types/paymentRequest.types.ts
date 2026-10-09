/**
 * Lo que el backend responde de un cobro, tal como lo manda.
 *
 * ── Por qué esta tabla no tiene una dirección ───────────────────────────────
 *
 * Porque `docs/contrato-dinero.md:26` dice que el destinatario *"no lo ve
 * nadie"*, y el tipo es donde esa prohibición se vuelve real: no hay campo donde
 * una dirección pudiera entrar, así que una pantalla no puede compilar aunque
 * quiera mostrar una. La regla del backend es que la dirección del que cobra se
 * resuelve adentro, contra `rewallet.wallets`, y nunca vuelve.
 *
 * Lo que sí vuelve es el `@tag` de quien cobra: una identidad que una persona
 * puede leer en voz alta y comparar con la persona que le está pidiendo la plata.
 *
 * ── Por qué el estado puede ser cuatro cosas y el servidor escribe tres ──────
 *
 * `pending`, `paid`, `expired` y `cancelled` son los cuatro valores que acepta
 * `payment_requests_status_valid`. El servidor **nunca** escribe `expired`: un
 * cobro `pending` cuya fecha ya pasó se **lee** como `expired`, sin escribir nada
 * (está explicado en `expiry.ts` del backend). `cancelled` existe en el tipo
 * porque existe en la tabla y una pantalla no debería romperse el día que
 * aparezca; no hay ninguna pantalla que lo produzca hoy.
 *
 * ── Por qué los decimales van como texto y no como número ──────────────────
 *
 * Porque `payment_requests.amount` es `numeric(20,6)` y viaja como cadena. Un
 * `number` de JavaScript no puede representar todos los decimales de seis lugares
 * sin perder el último, y un cobro de `150,25` que llega como `150.249999…` es un
 * cobro de otra plata. El entero de la unidad mínima —que es lo que viaja a la
 * cadena— lo calcula el servidor cuando alguien paga, con aritmética entera: ver
 * el `README` del backend.
 */
import type { SendPreparationResponse } from './send.types';

/** Los cuatro estados que `payment_requests_status_valid` permite. */
export type PaymentRequestStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

/**
 * Un cobro, tal como lo ve quien tiene el link.
 *
 * `amount` son dólares enteros con hasta seis decimales, en texto. `note` es lo
 * que escribió quien cobra, o `null`. `requesterTag` es el `@tag` de quien cobra,
 * o `null` si no se pudo leer — en ese caso la pantalla muestra el importe y no
 * dice quién, en vez de inventar un nombre.
 */
export interface PaymentRequest {
  /** El identificador compartible. Es también el único control de acceso. */
  readonly id: string;
  readonly amount: string;
  readonly note: string | null;
  readonly status: PaymentRequestStatus;
  /** ISO 8601, del servidor. La pantalla no tiene reloj propio para esto. */
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly requesterTag: string | null;
}

/**
 * La respuesta de `POST /api/payment-requests/:id/pay`.
 *
 * **Extiende** la preparación de envío en vez de re-declararla, y esa es la forma
 * de decir que no hay una segunda forma: la misma que devuelve
 * `POST /api/send/prepare`, con el estado del cobro encima. El navegador la firma
 * con el mismo hook y el mismo código, así que un pago de cobro y un envío a mano
 * no pueden divergir en un paso.
 *
 * El campo `address` es la wallet **de quien paga** —la que hay que firmar— y es
 * el mismo campo que devuelve `POST /api/send/prepare`. Quien cobra no aparece en
 * ningún campo.
 */
export interface PayChargeResponse extends SendPreparationResponse {
  readonly paymentRequest: {
    readonly id: string;
    readonly status: 'paid';
    readonly paidAt: string;
  };
}
