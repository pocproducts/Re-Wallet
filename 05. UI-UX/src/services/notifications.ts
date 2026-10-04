/**
 * Lectura de `GET /api/notifications`: el transporte, la normalización, el
 * tratamiento visual por categoría y la hora relativa.
 *
 * ── Por qué la normalización vive acá y no en el hook ────────────────────────
 *
 * Igual que en `services/portfolio.ts`: el hook corre el efecto y guarda el
 * estado; este módulo decide **qué es** una notificación. Si cada pantalla
 * normalizara por su cuenta, el mismo 502 se volvería "no tenés nada" en una y
 * en otra no, y el fallo deja de verse justo donde importa.
 *
 * ── Lo que esta pantalla NO puede llegar a tener ──────────────────────────────
 *
 * Un `payload`. El backend no lo manda y no hay forma de pedirlo (ni query
 * parameter, ni header, ni negotiate). Por eso el tipo de respuesta no tiene el
 * campo: no es una decisión de estilo, es que no hay nada que mostrar.
 *
 * ── La hora sale del backend ─────────────────────────────────────────────────
 *
 * `createdAt` es ISO 8601 y lo pone el servidor. La hora relativa se **deriva**
 * de ahí contra el reloj del navegador, y si el string no es una fecha válida
 * la fila se muestra sin hora en vez de con una hora inventada.
 */

import { getJson } from './api';
import type {
  NotificationCategory,
  NotificationsResponse,
  RewalletNotification,
} from '../types/notification.types';

/** Las categorías que el backend emite hoy. */
const KNOWN_CATEGORIES: readonly NotificationCategory[] = [
  'account',
  'security',
  'wallet',
  'link',
  'other',
];

/**
 * El código del 401 de esta ruta.
 *
 * Es el mismo de todas las rutas con cookie (`UNAUTHENTICATED`, en
 * `routes/auth.ts`): no es una sesión vencida sólo para notificaciones, es que
 * esta persona ya no tiene sesión en ReWALLET, y lo que corresponde es el
 * comportamiento de cierre de sesión que ya usa el resto de la app.
 */
export const NOTIFICATIONS_UNAUTHENTICATED_CODE = 'UNAUTHENTICATED';

/** El 502 de esta ruta: la cookie era válida pero las filas no se pudieron leer. */
export const NOTIFICATIONS_UNAVAILABLE_CODE = 'NOTIFICATIONS_UNAVAILABLE';

/** ¿Es una categoría que la pantalla sabe pintar? */
const isKnownCategory = (value: unknown): value is NotificationCategory =>
  typeof value === 'string' && (KNOWN_CATEGORIES as readonly string[]).includes(value);

/**
 * Traduce el cuerpo a la forma que la pantalla usa.
 *
 * Defensivo a propósito, y con una regla que no es negociable: una fila que no
 * tiene `id`, `message` o `createdAt` legibles **no se muestra**. No se muestra
 * como una frase inventada, ni como una fila sin texto, ni como "algo pasó".
 * Preferimos un feed más corto a un feed con una frase que el backend nunca
 * dijo.
 *
 * Una categoría desconocida, en cambio, **no** descarta la fila: se lee como
 * `other`. Perder un evento real por no tenerle un icono sería peor que mostrarlo
 * con el tratamiento genérico.
 */
export const normalizeNotifications = (body: unknown): NotificationsResponse => {
  const response = body as Partial<NotificationsResponse> | null;
  if (!Array.isArray(response?.notifications)) {
    return { generatedAt: null, notifications: [] };
  }

  const notifications: RewalletNotification[] = [];
  const seen = new Set<string>();

  for (const entry of response.notifications) {
    const item = entry as Partial<RewalletNotification> | null;
    if (item === null) continue;

    const id = typeof item.id === 'string' ? item.id : null;
    const message = typeof item.message === 'string' ? item.message.trim() : '';
    if (id === null || id.length === 0 || message.length === 0) continue;

    // El mismo evento dos veces no es dos eventos: el `id` es la identidad.
    if (seen.has(id)) continue;
    seen.add(id);

    notifications.push({
      id,
      eventType: typeof item.eventType === 'string' ? item.eventType : '',
      category: isKnownCategory(item.category) ? item.category : 'other',
      message,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    });
  }

  return {
    generatedAt: typeof response?.generatedAt === 'string' ? response.generatedAt : null,
    notifications,
  };
};

/**
 * `GET /api/notifications`.
 *
 * Mismo origen y misma cookie que el resto: `credentials: 'include'` ya está en
 * `getJson` y esta ruta no acepta ningún parámetro.
 *
 * @throws `ApiError` con el código del backend: `UNAUTHENTICATED` (401),
 *          `NOTIFICATIONS_UNAVAILABLE` (502) o `NETWORK_UNAVAILABLE`. El texto
 *          de pantalla lo pone quien lo muestra, nunca este servicio.
 */
export const readRewalletNotifications = async (): Promise<NotificationsResponse> =>
  normalizeNotifications(await getJson<NotificationsResponse>('/notifications'));

/* ── Tratamiento visual por categoría ───────────────────────────────────────── */

/**
 * Cómo se ve cada categoría. Es **pintura**, no información: el `eventType` y el
 * código crudo no llegan acá.
 *
 * `other` es el tratamiento por defecto a propósito: un `eventType` que el
 * backend no conoce llega con `other` y una frase genérica, y se ve exactamente
 * como lo que es —un evento del que no sabemos más— sin que falte un ícono.
 */
export interface CategoryTreatment {
  /** Clave del ícono de `lucide-react` que usa la fila. */
  readonly icon: 'user' | 'shield' | 'wallet' | 'link' | 'bell';
  /** Fondo del disco del ícono. */
  readonly badgeBg: string;
  /** Color del ícono. */
  readonly badgeText: string;
  /** Texto chico de la categoría, cuando la fila lo muestra. */
  readonly label: string;
}

const TREATMENTS: Readonly<Record<NotificationCategory, CategoryTreatment>> = {
  account: { icon: 'user', badgeBg: 'bg-slate-200', badgeText: 'text-slate-700', label: 'Cuenta' },
  security: { icon: 'shield', badgeBg: 'bg-amber-100', badgeText: 'text-amber-700', label: 'Seguridad' },
  wallet: { icon: 'wallet', badgeBg: 'bg-[#ccff00]', badgeText: 'text-black', label: 'Billetera' },
  link: { icon: 'link', badgeBg: 'bg-sky-100', badgeText: 'text-sky-700', label: 'Acceso' },
  other: { icon: 'bell', badgeBg: 'bg-slate-200', badgeText: 'text-slate-600', label: 'Aviso' },
};

/** El tratamiento de una categoría. Una desconocida nunca llega: se lee `other`. */
export const treatmentFor = (category: NotificationCategory): CategoryTreatment =>
  TREATMENTS[category] ?? TREATMENTS.other;

/* ── Hora relativa ──────────────────────────────────────────────────────────── */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * La hora de un evento, **derivada de `createdAt`**. Nunca del reloj como
 * única fuente: si el backend no mandó una fecha legible, la fila se muestra sin
 * hora en lugar de con una hora inventada.
 *
 * El texto sale del `Date` del navegador con `es-AR` e `hour12: false`, así que
 * la forma es la del resto de la app y no un formato inglés importado.
 */
export const relativeTimeLabel = (iso: string): string | null => {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;

  const minutes = Math.round((Date.now() - when.getTime()) / MINUTO);

  if (minutes < 1) return 'Recién';
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.round(minutes / 60);
    return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }

  const days = Math.round(minutes / (24 * 60));
  if (days < 7) return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;

  return when.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: when.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
};

export { DIA, HORA, MINUTO };