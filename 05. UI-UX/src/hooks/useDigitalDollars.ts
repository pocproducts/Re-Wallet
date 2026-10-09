/**
 * El total de dólares digitales de esta persona: **un número**, leído una vez por
 * sesión.
 *
 * ── Por qué es un hook y no un `fetch` en la pantalla ─────────────────────────
 *
 * `/api/digital-dollars` es una composición de dos lecturas de cadena —las
 * billeteras y la posición en Aave—, así que pedirlo desde cada pantalla sería
 * dos viajes extra a la cadena por cada navegación. El hook corta la repetición
 * con el mismo patrón que `usePortfolio`, `usePool` y `useDepositInfo`: **la
 * identidad de la sesión**, no los datos.
 *
 * ── Cuándo se vuelve a leer ──────────────────────────────────────────────────
 *
 * - Al abrirse la sesión: una vez.
 * - Cuando `enabled` pasa a `false` se libera el corte y se borra la lectura, así
 *   que la próxima sesión lee de nuevo en vez de mostrar el saldo de otra
 *   persona.
 * - A mano, con `reload()`, que es lo que usaría un botón "actualizar" y lo que
 *   se llama después de un depósito firmado.
 *
 * ── Lo que este hook NO hace ─────────────────────────────────────────────────
 *
 * No suma nada, no calcula precios y no convierte una pieza ilegible en cero. Y
 * no **oculta** un total parcial: lo expone con `complete` en `false` y con la
 * frase que nombra lo que falta, porque un hook que se comiera esa frase sería
 * el lugar exacto donde la mentira volvería a entrar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readRewalletDigitalDollars, type DigitalDollarsView } from '../services/digitalDollars';
import { ApiError } from '../services/api';

export type DigitalDollarsStatus =
  /** Todavía no se pidió nada. */
  | 'idle'
  /** La lectura está en vuelo. */
  | 'loading'
  /** Llegó una respuesta. Puede venir incompleta: eso es información. */
  | 'ready'
  /** La lectura entera falló: no hay ningún número para mostrar. */
  | 'error';

export interface DigitalDollarsScreenView {
  readonly status: DigitalDollarsStatus;
  /** El código del fallo, o `null`. El texto lo pone quien lo muestra. */
  readonly failureCode: string | null;
  /** La lectura normalizada, o `null` si todavía no llegó. */
  readonly totals: DigitalDollarsView | null;
  /** El total pintado, o `null` si no se pudo leer. **No** implica completo. */
  readonly total: string | null;
  /**
   * `false` cuando alguna pieza no se pudo leer: el total de arriba es parcial.
   *
   * Un `true` con `total === null` no es posible, y un `total` con `false` se
   * tiene que decir en pantalla.
   */
  readonly complete: boolean;
  /** La frase para un total parcial, o `null` si el total es entero. */
  readonly note: string | null;
  /** Vuelve a leer. Lo decide la persona o un depósito firmado, nunca un render. */
  readonly reload: () => void;
}

/**
 * @param enabled `true` sólo cuando la sesión ya está abierta: la cookie es lo
 *                que prueba que hay sesión, y sin cookie esta ruta responde 401.
 */
export const useDigitalDollars = (enabled: boolean): DigitalDollarsScreenView => {
  const [status, setStatus] = useState<DigitalDollarsStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [totals, setTotals] = useState<DigitalDollarsView | null>(null);

  /* Sin esto, un fallo del backend reintentaría solo y para siempre. */
  const loadedFor = useRef<boolean>(false);

  /*
   * El token de esta pasada. `vigente` no pregunta si el hook sigue montado:
   * pregunta si **esta** pasada es la de **esta** sesión, así un `reload()` no
   * pisa una lectura que todavía está en vuelo.
   */
  const activeRun = useRef<symbol | null>(null);

  const load = useCallback((): void => {
    const run = Symbol('useDigitalDollars:pasada');
    activeRun.current = run;

    setStatus('loading');

    void (async () => {
      try {
        const next = await readRewalletDigitalDollars();
        if (activeRun.current !== run) return;

        /*
         * Una respuesta que no se puede interpretar **no es un cero**: es una
         * lectura fallida. Se marca como error para que la pantalla diga que no
         * pudo leer el total, en vez de mostrar `U$0,00` por una respuesta
         * corrupta.
         */
        if (next === null) {
          setTotals(null);
          setFailureCode('MALFORMED_RESPONSE');
          setStatus('error');
          return;
        }

        setTotals(next);
        setFailureCode(null);
        setStatus('ready');
      } catch (error) {
        if (activeRun.current !== run) return;

        setTotals(null);
        setFailureCode(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
        setStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Cierre de sesión: se libera el corte y la lectura, para que no quede en
      // memoria el saldo de la persona anterior.
      loadedFor.current = false;
      activeRun.current = null;
      setTotals(null);
      setStatus('idle');
      return;
    }

    if (loadedFor.current) return;
    loadedFor.current = true;

    load();
  }, [enabled, load]);

  return useMemo<DigitalDollarsScreenView>(
    () => ({
      status,
      failureCode,
      totals,
      total: totals === null ? null : totals.total,
      complete: totals !== null && totals.complete,
      note: totals === null ? null : totals.incompletenessNote,
      reload: load,
    }),
    [status, failureCode, totals, load],
  );
};