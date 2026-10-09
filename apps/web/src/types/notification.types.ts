/**
 * La respuesta de `GET /api/notifications`, tal como la manda el backend.
 *
 * ── El contrato ya no se suaviza ─────────────────────────────────────────────
 *
 * Es la misma forma que escribe `07.PockBackend/src/interface/http/routes/notifications.ts`.
 * Lo importante acá es lo que **no** está: no hay `payload`. El backend no manda
 * identificadores del proveedor y no hay forma de pedirlos, así que el tipo no
 * ofrece el campo y una pantalla no puede compilar aunque quiera mostrarlo.
 *
 * ── `category` es un enum, no un texto libre ─────────────────────────────────
 *
 * Los cinco valores (`account`, `security`, `wallet`, `link`, `other`) son los
 * que el backend conoce hoy. Un `eventType` que no recognizes **no** rompe el
 * contrato: vuelve con categoría `other` y una frase genérica, y la pantalla lo
 * dibuja con el tratamiento genérico. Un tipo desconocido no se descarta ni se
 * adivina.
 */
/** Los cinco tratamientos que la pantalla conoce hoy. */
export type NotificationCategory = 'account' | 'security' | 'wallet' | 'link' | 'other';

/** Un evento tal como lo cuenta el backend, en una frase. */
export interface RewalletNotification {
  /** Estable entre lecturas: es lo que permite "algo nuevo desde la última vez". */
  readonly id: string;
  /** `wallet.created`, `user.signed_in`, … El código crudo, no se muestra. */
  readonly eventType: string;
  /** Sólo la pintura. Una categoría desconocida se lee como `other`. */
  readonly category: NotificationCategory;
  /** La frase del backend, **verbatim**. La pantalla no la reescribe. */
  readonly message: string;
  /** ISO 8601. Es la única fuente de la hora: no hay reloj de la app. */
  readonly createdAt: string;
}

/** `GET /api/notifications`: hasta 50 eventos, del más nuevo al más viejo. */
export interface NotificationsResponse {
  readonly generatedAt: string | null;
  readonly notifications: readonly RewalletNotification[];
}