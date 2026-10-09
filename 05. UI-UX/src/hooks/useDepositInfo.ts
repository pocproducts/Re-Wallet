/**
 * El catálogo de depósito de esta persona: qué se puede recibir, en qué red y con
 * qué dirección **de ella**.
 *
 * ── Por qué es un hook y no un `fetch` en la pantalla ─────────────────────────
 *
 * `/api/deposit-info` lee las filas de cartera una vez por pedido, y la pantalla
 * de depósito abre y cierra varias veces: volver a leer en cada apertura es una
 * ida a la base por cada toque. El hook corta la repetición acá, con el mismo
 * patrón que `usePortfolio` y `useUserWallets`: **la identidad de la sesión**,
 * no los datos.
 *
 * Y la lectura vive en un `useEffect`, nunca en el cuerpo del render.
 *
 * ── Cuándo se vuelve a leer ──────────────────────────────────────────────────
 *
 * - Al abrirse la sesión: una vez.
 * - Cuando `enabled` pasa a `false` se libera el corte, así que la próxima
 *   sesión lee de nuevo en vez de mostrar el catálogo de la anterior — que sería
 *   mostrar **las direcciones de otra persona**, la peor falla posible acá.
 * - A mano, con `reload()`, que es lo que usaría un botón "actualizar".
 *
 * ── Lo que este hook NO hace ─────────────────────────────────────────────────
 *
 * No trae ninguna lista propia. Si el backend no respondió, no hay catálogo, y lo
 * que la pantalla muestra es "no pudimos leer dónde podés recibir" — no una red
 * inventada, y no un `0`. Tampoco deduce direcciones: las que hay son las que el
 * backend leyó de `rewallet.wallets`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  assetsBySymbol,
  assetsOfKind,
  readDepositInfo,
  type DepositAssetView,
  type DepositCatalog,
  type DepositNetworkView,
} from '../services/depositInfo';
import { ApiError } from '../services/api';

export type DepositInfoStatus =
  /** Todavía no se pidió nada. */
  | 'idle'
  /** La lectura está en vuelo. */
  | 'loading'
  /** Llegó una respuesta. Puede traer redes sin billetera: eso es información. */
  | 'ready'
  /** La lectura entera falló: no hay catálogo para mostrar. */
  | 'error';

export interface DepositInfoView {
  readonly status: DepositInfoStatus;
  /** El código del fallo, o `null`. El texto lo pone quien lo muestra. */
  readonly failureCode: string | null;
  /** Todas las redes del catálogo, en el orden del backend. */
  readonly networks: readonly DepositNetworkView[];
  /** El catálogo agrupado por activo: una entrada por símbolo, con sus redes. */
  /** Todos los activos del catálogo, sin clasificar. */
  readonly assets: readonly DepositAssetView[];
  /**
   * Los dos caminos, filtrados **desde el mismo catálogo**. Que una pantalla
   * decida con dos listas escritas a mano es lo que hace que agregar USDT sea
   * editar dos archivos y olvidarse de uno.
   */
  readonly cryptoAssets: readonly DepositAssetView[];
  readonly dollarAssets: readonly DepositAssetView[];
  /** El sello de tiempo de la respuesta, o `null`. */
  readonly generatedAt: string | null;
  /** Vuelve a leer. Lo decide la persona, nunca un render. */
  readonly reload: () => void;
}

/**
 * @param enabled `true` sólo cuando la sesión ya está abierta: la cookie es lo
 *                que prueba que hay sesión, y sin cookie esta ruta responde 401.
 */
export const useDepositInfo = (enabled: boolean): DepositInfoView => {
  const [status, setStatus] = useState<DepositInfoStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<DepositCatalog | null>(null);

  /* Sin esto, un fallo del backend reintentaría solo y para siempre. */
  const loadedFor = useRef<boolean>(false);

  /*
   * El token de esta pasada. `vigente` no pregunta si el hook sigue montado:
   * pregunta si **esta** pasada es la de **esta** sesión, así un `reload()` no
   * pisa una lectura que todavía está en vuelo.
   */
  const activeRun = useRef<symbol | null>(null);

  const load = useCallback((): void => {
    const run = Symbol('useDepositInfo:pasada');
    activeRun.current = run;

    setStatus('loading');

    void (async () => {
      try {
        const next = await readDepositInfo();
        if (activeRun.current !== run) return;

        setCatalog(next);
        setFailureCode(null);
        setStatus('ready');
      } catch (error) {
        if (activeRun.current !== run) return;

        setFailureCode(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR');
        setStatus('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Cierre de sesión: se libera el corte, y también el catálogo, para que no
      // quede en memoria la dirección de la persona anterior.
      loadedFor.current = false;
      activeRun.current = null;
      setCatalog(null);
      setStatus('idle');
      return;
    }

    if (loadedFor.current) return;
    loadedFor.current = true;

    load();
  }, [enabled, load]);

  return useMemo<DepositInfoView>(
    () => ({
      status,
      failureCode,
      networks: catalog === null ? [] : catalog.networks,
      assets: catalog === null ? [] : assetsBySymbol(catalog.networks),
      cryptoAssets: catalog === null ? [] : assetsOfKind(catalog.networks, 'crypto'),
      dollarAssets: catalog === null ? [] : assetsOfKind(catalog.networks, 'dollar'),
      generatedAt: catalog === null ? null : catalog.generatedAt,
      reload: load,
    }),
    [catalog, status, failureCode, load],
  );
};
