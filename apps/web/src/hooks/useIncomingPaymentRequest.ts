/**
 * LEER EL LINK AL ARRANCAR: el único lugar del proyecto que mira `location`.
 *
 * ── Por qué esto es infraestructura nueva ───────────────────────────────────
 *
 * Porque hasta T1 la app **no leía su propia URL**: `grep` de `location` y
 * `URLSearchParams` en `src/` no devuelve nada. La navegación era estado de React
 * y una ruta desconocida no significaba nada. Con un link de cobro compartido —que
 * es una de las dos formas de que entre dinero según
 * `docs/contrato-dinero.md`— eso ya no alcanza: si alguien abre el link y la app
 * arranca en la billetera, el cobro se pierde y **no hay ningún error visible** que
 * lo diga. Es el peor modo de falla que existe.
 *
 * ── Por qué no hay un router ─────────────────────────────────────────────────
 *
 * Porque la navegación que ya existe lo expresa: `App.tsx` tiene banderas de
 * "tercer nivel" (`isAavePoolsOpen`, `isProfileOpen`, …) y este hook agrega una
 * más. Un router se justifica con URLs de ida y vuelta, historial y anidamiento;
 * acá hay una pregunta única —"¿con qué ruta arrancó esta persona?"— que se
 * responde **una vez**. Meter un router para eso sería cambiar cómo se mueve toda
 * la app por una función de una línea.
 *
 * ── Por qué se lee una vez y no se escucha ───────────────────────────────────
 *
 * Porque el link se comparte en un chat y se abre en una pestaña nueva: la ruta
 * con la que arranca la app es un hecho de arranque, como el tamaño de la pantalla
 * o el idioma. Después la persona navega normal, y un `popstate` que reabriera un
 * cobro ya pagado cada vez que vuelve atrás sería peor que no escucharlo.
 *
 * ── Por qué `clear()` borra la ruta ─────────────────────────────────────────
 *
 * Porque el link ya está en el portapapeles de quien lo recibió y en el chat de
 * quien lo mandó: la barra de direcciones no necesita seguir siendo el portador.
 * Y una recarga que volviera a abrir la pantalla de pago de un cobro ya pagado es
 * exactamente el bucle que `history.replaceState` corta — sin historial, sin
 * botón de atrás, sin que nadie pueda volver a un cobro muerto.
 */
import { useCallback, useEffect, useState } from 'react';

import { paymentRequestIdFromPath } from '../config/paymentLinks';

export interface IncomingPaymentRequest {
  /** El id del link con el que arrancó la app, o `null` si no vino por un link. */
  readonly id: string | null;
  /** Cierra el cobro y limpia la barra de direcciones. */
  readonly clear: () => void;
}

/** La ruta de arranque, o `null` si no hay `window` (pruebas, SSR). */
const pathOf = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.location.pathname;
};

export const useIncomingPaymentRequest = (): IncomingPaymentRequest => {
  /*
   * El id se lee **una vez**, en el inicializador del estado y no en un efecto:
   * un `useEffect` corre después del primer render, y durante ese primer render
   * la app se dibujaría en la billetera antes de saber que venía de un link.
   * Inicializarlo acá hace que la primera pantalla que se ve ya sea la correcta.
   */
  const [id, setId] = useState<string | null>(() => paymentRequestIdFromPath(pathOf() ?? ''));

  // Un link puede llegar mientras la persona está en la puerta de ingreso: la
  // ruta no cambia, pero el estado tiene que sobrevivir a que la app monte.
  useEffect(() => {
    if (id !== null) return;
    const found = paymentRequestIdFromPath(pathOf() ?? '');
    if (found !== null) setId(found);
  }, [id]);

  const clear = useCallback(() => {
    setId(null);
    /*
     * `replaceState`, no `pushState`: replace **reemplaza** la entrada actual, así
     * que no queda una atrás a la que volver. Un link de cobro es de un solo uso
     * —dice el contrato— y dejar atrás una entrada que vuelve a un cobro pagado
     * sería una forma discreta de romperlo.
     */
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  return { id, clear };
};
