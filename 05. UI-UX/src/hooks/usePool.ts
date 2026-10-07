/**
 * El pool de Aave en Monad, leído **una vez por sesión**.
 *
 * ── Por qué un hook y no un `fetch` en la pantalla ───────────────────────────
 *
 * `/api/pool` va a la cadena por pedido: una reserva, tres saldos y un allowance
 * no son una lectura, son cuatro. Si la pantalla lo pidiera en cada render, cada
 * movimiento del dedo sería un viaje a Monad. El hook corta la repetición con el
 * mismo patrón que `usePortfolio` y `useDepositInfo`: **la identidad de la
 * sesión**, no los datos.
 *
 * ── Cuándo se vuelve a leer ──────────────────────────────────────────────────
 *
 * - Al abrirse la sesión: una vez.
 * - Cuando `enabled` pasa a `false` se libera el corte, así que la próxima sesión
 *   lee de nuevo en vez de mostrar la posición de la anterior —que sería mostrar
 *   el depósito de otra persona—.
 * - A mano, con `reload()`, que es lo que se llama **después** de un depósito
 *   firmado: el número de pantalla tiene que salir de la cadena, no del hecho de
 *   que la persona Hous pulsa "Hecho".
 *
 * ── Lo que este hook NO hace ─────────────────────────────────────────────────
 *
 * No inventa una tasa, no convierte una reserva caída en un cero y no calcula
 * precios. Un campo ilegible llega como ilegible, y la pantalla lo dice con
 * palabras.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readRewalletPool, type PoolView } from '../services/pool';
import { ApiError } from '../services/api';

export type PoolStatus =
  /** Todavía no se pidió nada. */
  | 'idle'
  /** La lectura está en vuelo. */
  | 'loading'
  /** Llegó una respuesta. Puede traer campos ilegibles: eso es información. */
  | 'ready'
  /** La lectura entera falló: no hay nada para mostrar. */
  | 'error';

export interface PoolScreenView {
  readonly status: PoolStatus;
  /** El código del fallo, o `null`. El texto lo pone quien lo muestra. */
  readonly failureCode: string | null;
  /** La lectura normalizada, o `null` si todavía no llegó. */
  readonly pool: PoolView | null;
  /** Vuelve a leer. Lo decide la persona o un depósito firmado, nunca un render. */
  readonly reload: () => void;
}

/**
 * @param enabled `true` sólo cuando la sesión ya está abierta: la cookie es lo
 *                que prueba que hay sesión, y sin cookie esta ruta responde 401.
 */
export const usePool = (enabled: boolean): PoolScreenView => {
  const [status, setStatus] = useState<PoolStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolView | null>(null);

  /* Sin esto, un fallo del backend reintentaría solo y para siempre. */
  const loadedFor = useRef<boolean>(false);

  /*
   * El token de esta pasada. No pregunta si el hook sigue montado: pregunta si
   * **esta** pasada es la de **esta** sesión, así que un `reload()` no pisa una
   * lectura que todavía está en vuelo.
   */
  const activeRun = useRef<symbol | null>(null);

  const load = useCallback((): void => {
    const run = Symbol('usePool:pasada');
    activeRun.current = run;

    setStatus('loading');

    void (async () => {
      try {
        const next = await readRewalletPool();
        if (activeRun.current !== run) return;

        setPool(next);
        setFailureCode(null);
        setStatus('ready');
      } catch (error) {
        if (activeRun.current !== run) return;

        setFailureCode(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
        setStatus('ready');
        setPool(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Cierre de sesión: se libera el corte y la lectura, para que no quede en
      // memoria la posición de la persona anterior.
      loadedFor.current = false;
      activeRun.current = null;
      setPool(null);
      setStatus('idle');
      return;
    }

    if (loadedFor.current) return;
    loadedFor.current = true;

    load();
  }, [enabled, load]);

  return useMemo<PoolScreenView>(
    () => ({ status, failureCode, pool, reload: load }),
    [status, failureCode, pool, load],
  );
};
