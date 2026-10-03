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
 * ── Por qué hay un estado `checking` y no un booleano ────────────────────────
 *
 * Porque hay dos esperas que existen al mismo tiempo: que Privy termine de
 * arrancar (y con él, de recuperar su propia sesión) y que el backend conteste
 * si la cookie sirve. Mostrar la puerta durante cualquiera de las dos
 * produce el peor síntoma posible —*ves la pantalla de ingreso y después la
 * app, sin haber hecho nada*— y mostrar la app antes de saber produce el
 * simétrico: una billetera vacía de alguien que no entra.
 *
 * ── Por qué hacen falta **las dos** condiciones ───────────────────────────────
 *
 * La cookie del backend y la sesión de Privy son dos cosas distintas, y
 * pueden vivir en estados distintos: la cookie puede seguir viva con la sesión
 * de Privy caída (el token de Privy expira antes que la cookie). En ese
 * estado **no hay perfil que derivar**, así que no se muestra la app: se
 * muestra la puerta. Entrar de nuevo refresca la cookie y es la única
 * reparación posible desde el navegador.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

import { closeRewalletSession, isRewalletSessionActive } from '../services/session';
import { deriveProfileFromPrivy } from '../services/profile';
import { UserProfileData } from '../types';

export type SessionStatus =
  /** Todavía no se sabe. Se muestra una pantalla neutra, nunca la puerta. */
  | 'checking'
  /** Hay cookie del backend **y** sesión de Privy: se muestra la app. */
  | 'authenticated'
  /** No hay sesión: se muestra la puerta. */
  | 'anonymous';

export interface SessionGate {
  /** `false` mientras Privy no terminó de arrancar. */
  readonly ready: boolean;
  readonly status: SessionStatus;
  /** El perfil derivado del usuario de Privy, o `null` si no hay usuario. */
  readonly profile: UserProfileData | null;
  /** Se llama **después** de que `POST /auth/session` respondió bien. */
  readonly confirmSessionOpened: () => void;
  /** Cierra la sesión del backend y la de Privy, en ese orden. */
  readonly signOut: () => Promise<void>;
}

export const useSessionGate = (): SessionGate => {
  const { ready, authenticated, user, logout } = usePrivy();
  const [cookieActive, setCookieActive] = useState<boolean | null>(null);

  /*
   * La pregunta al backend se hace una sola vez, cuando Privy ya arrancó: antes
   * de eso la respuesta no significa nada, porque todavía no sabemos si hay
   * sesión que preguntar. Y no se vuelve a preguntar en cada render: `logout`
   * cambia de estado a propósito y el hook ya sabe cerrar su propia sesión.
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

  const signOut = useCallback(async () => {
    // Primero el backend: si tira, igual se cierra igual la de Privy, que es la
    // que decide si esta persona puede volver a entrar.
    await closeRewalletSession();
    await logout();
    setCookieActive(false);
  }, [logout]);

  // `checking` dura lo que duran las dos esperas: que Privy arranque y que el
  // backend conteste. Después la decisión es de las dos condiciones.
  const status: SessionStatus =
    !ready || cookieActive === null
      ? 'checking'
      : cookieActive && authenticated
        ? 'authenticated'
        : 'anonymous';

  return {
    ready,
    status,
    profile: user ? deriveProfileFromPrivy(user) : null,
    confirmSessionOpened: useCallback(() => setCookieActive(true), []),
    signOut,
  };
};