/**
 * Quién está adentro de la app, y cómo se decide.
 *
 * ── La decisión no es "¿hay un perfil en `localStorage`?" ─────────────────────
 *
 * Antes lo era: un flag de onboarding leía una clave del navegador y eso
 * decidía si se veía la app. Un flag de un navegador no es una sesión —se
 * borra, se copia, se miente— y además hacía aparecer la puerta de ingreso a
 * gente que ya estaba adentro. Ahora la pregunta es "¿el backend dice que esta
 * cookie sirve?", y la respuesta viene del backend.
 *
 * ── "Autenticado en Privy" y "con sesión en ReWALLET" NO son lo mismo ─────────
 *
 * Este hook existe también por el otro lado de esa frase. Son dos sesiones
 * distintas, en dos lugares distintos, y **se pueden desincronizar**:
 *
 *   - Privy autentica y después nuestro Worker falla en `session.identity_lookup`.
 *     El navegador queda **autenticado en Privy** y **sin sesión de ReWALLET**.
 *   - La puerta vieja mostraba el formulario de correo "para que entre de nuevo".
 *     Pero pedir un código a alguien que ya está autenticado en Privy no es un
 *     login: Privy intenta **enlazar** un segundo correo del mismo tipo y
 *     responde `cannot_link_more_of_type`. Un reintento por esa puerta no puede
 *     funcionar nunca.
 *
 * Por eso, cuando Privy ya dice autenticado, **no se pide ningún código**: se
 * va derecho a intercambiar la sesión con nuestro backend
 * (`getAccessToken()` → `POST /api/auth/session`). El correo y el código son
 * para gente que **no** está autenticada en Privy, y solo para esa gente.
 *
 * ── Por qué los estados son explícitos y no un booleano ──────────────────────
 *
 * Porque este bug fue silencioso: no hubo error visible, hubo una pantalla que
 * no era la correcta. Los estados nombrados (`checking`, `checking_session`,
 * `exchanging`, `authenticated`, `anonymous`, `exchange_failed`) obligan a que
 * cada transición
 * esté pensada. Un booleano deja que "no sé todavía" y "no hay sesión" se
 * confundan, y esa confusión es exactamente la que flashaba la puerta a
 * alguien que ya estaba adentro.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { API_BASE_URL, ApiError } from '../services/api';
import { closeRewalletSession, isRewalletSessionActive, openRewalletSession, SESSION_ERROR_IDENTITY_UNAVAILABLE } from '../services/session';
import { reportPrivyError, readPrivyErrorCode, toDiagnosticCode } from '../services/privy';
import { deriveProfileFromPrivy } from '../services/profile';
import { UserProfileData } from '../types';

export type SessionStatus =
  /** Privy ni siquiera arrancó. No hay nada que decidir todavía. */
  | 'checking'
  /** Privy arrancó: le estamos preguntando al backend si la cookie sirve. */
  | 'checking_session'
  /**
   * Privy dice autenticado y todavía no hay sesión de ReWALLET: se está
   * intercambiando (`getAccessToken()` → `POST /api/auth/session`). **Nunca**
   * se pide un código en este estado.
   */
  | 'exchanging'
  /** Sesión de ReWALLET abierta: se muestra la app. */
  | 'authenticated'
  /** Nadie autenticado en Privy y sin cookie: se muestra la puerta de correo. */
  | 'anonymous'
  /**
   * Privy autenticado pero el intercambio con nuestro backend falló. Se muestra
   * el fallo **con una salida**: cerrar sesión en Privy y volver al correo.
   */
  | 'exchange_failed';

/** Etapas del intercambio, para que el log del Worker diga dónde se cortó. */
const ETAPA_INTERCAMBIO_TOKEN = 'login_intercambio_token';
const ETAPA_INTERCAMBIO_SESION = 'login_intercambio_sesion';

export interface SessionGate {
  /** `false` mientras Privy no terminó de arrancar. */
  readonly ready: boolean;
  readonly status: SessionStatus;
  /** El perfil derivado del usuario de Privy, o `null` si no hay usuario. */
  readonly profile: UserProfileData | null;
  /** El texto del último fallo de intercambio, o `null`. */
  readonly exchangeError: string | null;
  /**
   * Cierra la sesión del backend y la de Privy, en ese orden. Es la única
   * reparación posible desde el navegador cuando el intercambio falla.
   */
  readonly signOut: () => Promise<void>;
  /**
   * Salir del estado `exchange_failed`: cierra ambas sesiones y deja la puerta
   * de correo lista para un intento limpio.
   */
  readonly restartFromCleanState: () => Promise<void>;
}

export const useSessionGate = (): SessionGate => {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const [cookieActive, setCookieActive] = useState<boolean | null>(null);
  const [exchangeState, setExchangeState] = useState<'idle' | 'running' | 'failed'>('idle');
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  /*
   * El intercambio se hace **una vez por usuario de Privy**, no en cada render.
   * Este ref es lo que impide el bucle: sin él, un fallo del backend reintentaría
   * solo y para siempre. Después de un fallo, la única forma de volver a intentar
   * es `restartFromCleanState()`, que lo resetea explícitamente.
   */
  const exchangeStartedFor = useRef<string | null>(null);

  /*
   * La pregunta al backend se hace una sola vez, cuando Privy ya arrancó: antes
   * de eso la respuesta no significa nada, porque todavía no sabemos si hay
   * sesión que preguntar.
   */
  useEffect(() => {
    if (!ready) return;

    let vigente = true;
    void isRewalletSessionActive().then((activa) => {
      if (vigente) setCookieActive(activa);
    });

    return () => {
      vigente = false;
    };
  }, [ready]);

  /*
   * El intercambio. Se dispara solo cuando Privy **ya dice autenticado** y el
   * backend todavía no tiene cookie para esta persona: ese es el estado en el que
   * la puerta vieja pedía un código y Privy respondía `cannot_link_more_of_type`.
   */
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (cookieActive === true || cookieActive === null) return;

    const id = user?.id ?? 'sin_id_de_usuario';
    if (exchangeStartedFor.current === id) return;
    exchangeStartedFor.current = id;

    let vigente = true;
    setExchangeState('running');
    setExchangeError(null);

    const fail = (mensaje: string) => {
      if (!vigente) return;
      setExchangeState('failed');
      setExchangeError(mensaje);
    };

    void (async () => {
      // 1) El access token. Sin token no hay `POST`, y sin `POST` no hay cookie.
      let accessToken: string | null = null;
      try {
        accessToken = await getAccessToken();
      } catch (error) {
        void reportPrivyError(
          ETAPA_INTERCAMBIO_TOKEN,
          toDiagnosticCode(readPrivyErrorCode(error)),
          API_BASE_URL,
        );
      }

      /*
       * Privy autenticado pero sin token **es un estado real**, no un crash: la
       * sesión del SDK no siempre se puede materializar. Se muestra el fallo y se
       * ofrece la salida (cerrar sesión y arrancar de cero), nunca una excepción.
       */
      if (!accessToken) {
        void reportPrivyError(
          ETAPA_INTERCAMBIO_TOKEN,
          toDiagnosticCode('must_be_authenticated'),
          API_BASE_URL,
        );
        fail(
          'Tu sesión de Privy está activa pero no pudimos renovarla. Cerrá sesión y volvé a entrar.',
        );
        return;
      }

      // 2) La sesión de ReWALLET: el `POST` que emite la cookie httpOnly.
      try {
        await openRewalletSession({ accessToken });
      } catch (error) {
        const codigoApi = error instanceof ApiError ? error.code : null;
        void reportPrivyError(
          ETAPA_INTERCAMBIO_SESION,
          toDiagnosticCode(codigoApi),
          API_BASE_URL,
        );
        fail(
          codigoApi === SESSION_ERROR_IDENTITY_UNAVAILABLE
            ? 'Entramos a tu cuenta pero no pudimos leerla, así que no se creó nada. Cerrá sesión y volvé a entrar.'
            : 'Entramos a tu cuenta pero no pudimos abrir la sesión de la app. Cerrá sesión y volvé a entrar.',
        );
        return;
      }

      if (!vigente) return;
      setCookieActive(true);
      setExchangeState('idle');
      setExchangeError(null);
    })();

    return () => {
      vigente = false;
    };
  }, [ready, authenticated, cookieActive, user?.id, getAccessToken]);

  const restartFromCleanState = useCallback(async () => {
    /*
     * El backend primero y sin que su fallo corte el camino: lo que decide si
     * esta persona puede volver a entrar es la sesión de Privy, no la cookie.
     */
    await closeRewalletSession();
    try {
      await logout();
    } catch {
      // Sin sesión de Privy no hay token, así que el intercambio no puede
      // volver a intentarse solo: se vuelve al correo y listo.
    }
    // Se resetea el guard para que un ingreso nuevo pueda intercambiar de nuevo.
    exchangeStartedFor.current = null;
    setExchangeError(null);
    setExchangeState('idle');
    setCookieActive(false);
  }, [logout]);

  const signOut = useCallback(async () => {
    await closeRewalletSession();
    try {
      await logout();
    } finally {
      exchangeStartedFor.current = null;
      setCookieActive(false);
    }
  }, [logout]);

  /*
   * `checking` dura lo que dura el arranque de Privy; `checking_session`, lo que
   * dura el `GET`. Ninguno de los dos muestra la puerta: mostrarla es el síntoma
   * que esto reemplaza.
   */
  const status: SessionStatus = !ready
    ? 'checking'
    : cookieActive === null
      ? 'checking_session'
      : cookieActive && authenticated
        ? 'authenticated'
        : authenticated
          ? exchangeState === 'failed'
            ? 'exchange_failed'
            : 'exchanging'
          : 'anonymous';

  return {
    ready,
    status,
    profile: user ? deriveProfileFromPrivy(user) : null,
    exchangeError,
    signOut,
    restartFromCleanState,
  };
};