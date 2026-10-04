/**
 * Los avisos de la cuenta, leídos **una vez por sesión**.
 *
 * ── El mismo contrato que `usePortfolio` ─────────────────────────────────────
 *
 * Una lectura por sesión, con corte en un `useEffect` —nunca en el cuerpo del
 * render—, liberada al cerrar sesión para que la próxima lea de nuevo, y un
 * `reload()` explícito para recargar a mano. Mismo patrón, misma razón: el
 * feed es una lectura, no un render.
 *
 * ── Por qué no hay push ni canal en vivo ─────────────────────────────────────
 *
 * `GET /api/notifications` es un `GET` con cookie: no hay push, no hay SSE, no
 * hay websocket. El feed se lee cuando la app carga y cuando la persona aprieta
 * recargar. Por eso el estado nuevo/no-nuevo se deriva de un `id` guardado
 * localmente y **no** de un watcher: si algo cambia, aparece en la próxima
 * lectura, y la pantalla nunca promete que se entera antes.
 *
 * ── Lo que este hook NO hace ─────────────────────────────────────────────────
 *
 * No inventa un aviso, no inventa una categoría, no inventa una hora y no
 * convierte un fallo en una lista vacía. Un `502` es `unavailable`: es un hecho
 * distinto de "no tenés nada", igual que en los saldos, donde `usdcNote`
 * distingue la cadena caída de la billetera vacía. Y nunca guarda un payload ni
 * un token: en `localStorage` sólo entran ids y una marca de tiempo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../services/api';
import {
  NOTIFICATIONS_UNAUTHENTICATED_CODE,
  readRewalletNotifications,
} from '../services/notifications';
import type { NotificationsResponse } from '../types/notification.types';

/**
 * La clave local del "ya visto".
 *
 * Sólo ids y una hora de cuando se vio. Ni mensajes, ni categorías, ni
 * `eventType`, ni nada que venga del proveedor: si mañana el feed deja de
 * devolver un evento, esa fila tampoco está en el navegador.
 */
const SEEN_STORAGE_KEY = 'rewallet_notifications_seen';

/**
 * Qué se guarda, con la forma exacta.
 *
 * `newestId`: el `id` del evento más reciente del feed, que es lo único que
 * hace falta para saber si apareció algo. `seenAt`: cuándo se miró, en
 * milisegundos, para diagnóstico. Nada más entra acá.
 */
interface SeenMarker {
  readonly newestId: string | null;
  readonly seenAt: number;
}

const EMPTY_MARKER: SeenMarker = { newestId: null, seenAt: 0 };

/** Lee el marcador local. Un `localStorage` roto no es motivo para romper la app. */
const readMarker = (): SeenMarker => {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (raw === null) return EMPTY_MARKER;

    const parsed = JSON.parse(raw) as Partial<SeenMarker> | null;
    if (parsed === null || typeof parsed !== 'object') return EMPTY_MARKER;

    return {
      newestId: typeof parsed.newestId === 'string' ? parsed.newestId : null,
      seenAt: typeof parsed.seenAt === 'number' && Number.isFinite(parsed.seenAt) ? parsed.seenAt : 0,
    };
  } catch {
    return EMPTY_MARKER;
  }
};

/** Escribe el marcador local. Si el navegador no lo permite, seguimos igual. */
const writeMarker = (marker: SeenMarker): void => {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Sin persistencia local el feed sigue leyéndose: lo único que se pierde es
    // el punto de "nuevo" entre recargas de la página.
  }
};

export type NotificationsStatus =
  /** Todavía no se pidió nada. */
  | 'idle'
  /** La lectura está en vuelo. */
  | 'loading'
  /** Llegó una lista con eventos. */
  | 'ready'
  /**
   * Llegó una lista **vacía**: no hay eventos. Es un hecho, y se dice como tal.
   * No es lo mismo que `unavailable`, y por eso son dos estados y no una lista
   * vacía con un error pegado.
   */
  | 'empty'
  /** No se pudo leer el feed. No hay respuesta para mostrar. */
  | 'unavailable';

export interface NotificationsView {
  readonly status: NotificationsStatus;
  /**
   * El código del fallo, o `null`.
   *
   * `UNAUTHENTICATED` es el caso especial: la persona ya no tiene sesión, y lo
   * que corresponde es el cierre de sesión que ya usa la app —nunca un modal de
   * avisos para alguien que no está adentro—.
   */
  readonly failureCode: string | null;
  /** Los eventos, del más nuevo al más viejo, tal como los devolvió la API. */
  readonly notifications: NotificationsResponse['notifications'];
  /** `true` sólo para el 401: la sesión ya no está. */
  readonly signedOut: boolean;
  /** Hay algo que esta persona todavía no vio en su última visita. */
  readonly hasUnread: boolean;
  /** Marca lo que hay como visto. Lo dispara el abrir del modal, no un render. */
  readonly markSeen: () => void;
  /** Vuelve a leer. Lo decide la persona, nunca un render. */
  readonly reload: () => void;
}

/**
 * @param enabled `true` sólo cuando la sesión de ReWALLET ya está abierta: la
 * cookie es lo que prueba que hay sesión, y antes de eso la lectura no sirve.
 */
export const useNotifications = (enabled: boolean): NotificationsView => {
  const [status, setStatus] = useState<NotificationsStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [feed, setFeed] = useState<NotificationsResponse | null>(null);
  const [marker, setMarker] = useState<SeenMarker>(EMPTY_MARKER);

  /* El marcador se lee una vez, antes de que haya nada que comparar. */
  const markerLoaded = useRef<boolean>(false);
  useEffect(() => {
    if (markerLoaded.current) return;
    markerLoaded.current = true;
    setMarker(readMarker());
  }, []);

  /*
   * El corte de la repetición: una lectura por sesión, igual que el portfolio.
   * Sin esto, un `502` reintentaría solo y para siempre.
   */
  const loadedFor = useRef<boolean>(false);

  /*
   * El token de esta pasada. `vigente` no pregunta si el hook sigue montado:
   * pregunta si **esta** pasada es la que corresponde, así un `reload()` no pisa
   * una lectura que todavía está en vuelo.
   */
  const activeRun = useRef<symbol | null>(null);

  const load = useCallback((): void => {
    const run = Symbol('useNotifications:pasada');
    activeRun.current = run;

    setStatus('loading');

    void (async () => {
      try {
        const next = await readRewalletNotifications();
        if (activeRun.current !== run) return;

        setFeed(next);
        setFailureCode(null);
        setStatus(next.notifications.length === 0 ? 'empty' : 'ready');
      } catch (error) {
        if (activeRun.current !== run) return;

        /*
         * Un fallo **no** deja el feed viejo en pantalla ni lo convierte en
         * lista vacía: se descarta lo que había, porque mezclar "esto es lo que
         * hay" con "esto no lo pude leer" sería mentir en las dos direcciones.
         */
        setFeed(null);
        setFailureCode(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
        setStatus('unavailable');
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Cierre de sesión: se libera el corte y se olvida el feed anterior.
      loadedFor.current = false;
      activeRun.current = null;
      setFeed(null);
      setFailureCode(null);
      setStatus('idle');
      return;
    }

    if (loadedFor.current) return;
    loadedFor.current = true;

    load();
  }, [enabled, load]);

  const markSeen = useCallback((): void => {
    const newest = feed?.notifications[0]?.id ?? null;
    const next: SeenMarker = { newestId: newest, seenAt: Date.now() };

    setMarker(next);
    writeMarker(next);
  }, [feed]);

  return useMemo<NotificationsView>(() => {
    const notifications = feed?.notifications ?? [];
    const newestId = notifications[0]?.id ?? null;

    /*
     * Hay algo nuevo cuando el evento más reciente **no** es el que esta persona
     * dejó visto. Sin marcador previo no se dio ninguna visita: se cuenta como
     * nuevo, que es literalmente cierto —nunca lo vio— y no requiere que el
     * backend sepa nada nuevo.
     *
     * Y si no hay eventos, no hay nada nuevo aunque el marcador sea viejo: el
     * punto no puede aparecer sobre un feed vacío.
     */
    const hasUnread =
      status === 'ready' && newestId !== null && newestId !== marker.newestId;

    return {
      status,
      failureCode,
      notifications,
      signedOut: failureCode === NOTIFICATIONS_UNAUTHENTICATED_CODE,
      hasUnread,
      markSeen,
      reload: load,
    };
  }, [feed, status, failureCode, marker, markSeen, load]);
};