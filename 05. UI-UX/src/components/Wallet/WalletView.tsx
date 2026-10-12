import React, { useMemo, useState } from 'react';

import { Bug, Bell, Eye, EyeOff, ArrowDown, ArrowUp, ArrowLeftRight, ChevronRight } from 'lucide-react';
import { UserProfileData } from '../../types';
import { splitUsdDisplay } from '../../services/portfolio';
import { formatVenueRate } from '../../services/walletBalance';
/*
 * Los dos tipos de las props de datos salen de los hooks que las producen, no
 * de los servicios: `usePortfolio` devuelve `PortfolioView` y `useWalletBalance`
 * devuelve `WalletBalanceScreenView`. Antes esta pantalla no los importaba y
 * TS los daba por no definidos; el `any` implícito de `.find(...)` más abajo
 * era la consecuencia, no una causa aparte.
 */
import type { PortfolioView } from '../../hooks/usePortfolio';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';

/**
 * El lugar de Aave V3 en Monad, por la **key** que publica el backend.
 *
 * Se busca por key y no por etiqueta a propósito: el nombre es texto del
 * servidor y puede cambiar; la identidad del lugar no.
 */
const AAVE_VENUE_KEY = 'invest.aave_v3_usdc_monad';

interface WalletViewProps {
  profile: UserProfileData | null;
  /**
   * Los saldos leídos de la cadena. Viene del hook del `App` para que la
   * lectura sea **una por sesión**: si cada pantalla montara el suyo, abrir y
   * cerrar la lista de cripto sería una lectura de blockchain por cada apertura.
   */
  portfolio?: PortfolioView;
  /**
   * El balance, leído una vez por sesión en el `App`.
   *
   * Es **un** número y ya está compuesto: la cripto libre más lo invertido en
   * los pools. Antes esta pantalla mostraba el USDC libre de la billetera y la
   * posición se veía en otra pantalla, y la persona tenía que sumar dos números
   * en su cabeza para saber cuánto tenía.
   */
  balance?: WalletBalanceScreenView;
  onOpenProfile?: () => void;
  onNavigateToInvestments?: () => void;
  onNavigateToActivity?: () => void;
  /**
   * Qué acción abre la persona desde la fila de abajo.
   *
   * `'usar'` volvió a la unión. Se había ido porque su menú —Comprar/Vender—
   * prometía un cambio de activo que no tenía motor. El motor existe: el
   * backend cotiza en `/api/wallet/swap/quote` y la pantalla que abre sigue la
   * disposición documentada por Uniswap. Lo que falta es la firma real de la
   * ejecución, y por eso en este estado la operación es una simulación que la
   * pantalla nombra como tal.
   */
  onOpenAction?: (action: 'depositar' | 'usar' | 'enviar') => void;
  onOpenChargeModal?: () => void;
  onOpenSearch?: () => void;
  onOpenScanner?: () => void;
  onOpenBugModal?: () => void;
  onOpenNotifications?: () => void;
  /**
   * Hay avisos que esta persona todavía no vio en su última visita.
   *
   * Sólo un booleano: el feed vive en `App` y el texto sale del backend. Sin
   * la prop, no hay punto — un punto falso es peor que ningún punto.
   */
  hasUnreadNotifications?: boolean;
  onOpenAavePools?: () => void;
}

export const WalletView: React.FC<WalletViewProps> = ({
  profile,
  portfolio,
  balance,
  onOpenProfile,
  onNavigateToInvestments,
  onOpenAction,
  onOpenChargeModal,
  onOpenSearch,
  onOpenScanner,
  onOpenBugModal,
  onOpenNotifications,
  hasUnreadNotifications,
  onOpenAavePools,
}) => {
  const [showBalance, setShowBalance] = useState<boolean>(true);

  /*
   * El saldo grande: **un solo número**, y es el `total` que compuso el backend
   * en `GET /api/wallet-balance`.
   *
   * Acá no hay suma: ni `cryptoValue + investedValue`, ni el USDC libre más
   * "algo". Un operador aritmético entre dos números del servidor en el navegador
   * es exactamente el defecto que esta pantalla vino a matar, y además lo haría
   * con coma flotante y con un redondeo que el servidor nunca aplica. El número
   * se imprime tal cual llegó.
   *
   * La diferencia entre "no lo sé" y "lo sé y es cero" sigue siendo el `null`:
   * un cero que se leyó se muestra como cero (`u$0,00`), y una lectura que no
   * llegó se muestra como puntos con la frase que lo dice. Un `0,00` sobre una
   * lectura fallida es una billetera vacía que no existe.
   */
  const usd = useMemo(() => splitUsdDisplay(balance?.total ?? null), [balance?.total]);

  /*
   * La única frase que esta pantalla todavía escribe bajo el saldo.
   *
   * `balance.note` y `BALANCE_UNREADABLE_NOTE` no se pintan: las dos hablan de
   * una lectura que no llegó, y lo que no se pudo leer no se nombra. La parte de
   * `usdcNote` que nombra cadenas ilegibles tampoco.
   *
   * Lo que queda es su otra mitad —"No hay dólares digitales en tus
   * billeteras."—, que no habla de una falla sino de un hecho: no hay saldo, y
   * eso se muestra igual que se muestra un cero leído.
   */
  const balanceNote = useMemo(() => {
    if (portfolio === undefined) return null;
    if (portfolio.unreadableChains.length > 0) return null;

    return portfolio.usdcNote;
  }, [portfolio]);

  /*
   * La etiqueta acompaña al dato, y no lo anuncia: dice "Balance total" porque lo
   * que se muestra es el total de las dos cubetas. Antes decía "Sin lectura"
   * cuando el número no había llegado, que es una forma de escribir en pantalla
   * que algo no se pudo leer —y algo que no se pudo leer no se nombra—; cuando
   * no hay lectura, la cifra queda en puntos y la etiqueta sigue diciendo qué
   * cifra es.
   */
  const balanceLabel = 'Balance total';

  // Derivar el handle de usuario como $joadata o $nombre
  const userTag = profile?.nombre
    ? '$' + profile.nombre.toLowerCase().replace(/\s+/g, '').slice(0, 10)
    : '$joadata';

  return (
    <div className="w-full h-full overflow-y-auto bg-[#f3f4f6] p-4 pb-24 max-w-md mx-auto select-none space-y-4 animate-in fade-in duration-200">
      {/* =========================================================================
          HEADER SUPERIOR: Avatar en cápsula con $tag + Botón Bug y Campana
         ========================================================================= */}
      <div className="flex items-center justify-between pt-1">
        {/* Cápsula de Usuario ($tag) que abre el Perfil */}
        <button
          onClick={onOpenProfile}
          type="button"
          title="Ver perfil de usuario"
          aria-label="Abrir perfil de usuario"
          className="bg-white rounded-full py-1.5 pl-1.5 pr-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-slate-100 flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-200 via-emerald-300 to-teal-400 p-0.5 flex items-center justify-center overflow-hidden">
            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-xs font-bold text-[#ccff00]">
              {profile?.nombre ? profile.nombre.charAt(0).toUpperCase() : '👾'}
            </div>
          </div>
          <span className="text-sm font-bold text-black font-display tracking-tight">
            {userTag}
          </span>
        </button>

        {/* Iconos de la derecha: Reportar Bug y Campana */}
        <div className="flex items-center gap-3 text-black pr-1">
          <button
            onClick={onOpenBugModal}
            type="button"
            aria-label="Reportar Bug o Feedback"
            title="Reportar Bug o Feedback"
            className="w-11 h-11 flex items-center justify-center text-black hover:opacity-75 active:scale-90 transition-all cursor-pointer"
          >
            <Bug className="w-5 h-5 stroke-[2.2]" />
          </button>

          <button
            onClick={onOpenNotifications}
            type="button"
            aria-label={hasUnreadNotifications ? 'Notificaciones: hay avisos nuevos' : 'Notificaciones'}
            title={hasUnreadNotifications ? 'Notificaciones: hay avisos nuevos' : 'Notificaciones'}
            className="w-11 h-11 flex items-center justify-center text-black hover:opacity-75 active:scale-90 transition-all cursor-pointer relative"
          >
            <Bell className="w-5 h-5 stroke-[2.2]" />
            {/*
             * El punto de "hay algo nuevo" va **superpuesto**: `absolute` sobre
             * un botón que ya es `relative`, así que no empuja la campana ni
             * cambia el alto de la fila. Es el único modo de poner una señal acá
             * sin desarmar la composición del header.
             *
             * Lo decide un `id` guardado localmente contra el `id` más nuevo del
             * feed, no un contador inventado — ver `useNotifications`.
             */}
            {hasUnreadNotifications === true && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#ccff00] border border-black"
              />
            )}
          </button>
        </div>
      </div>

      {/* =========================================================================
          TARJETA PRINCIPAL CON PESTAÑAS (BILLETERA / INVERSIONES)
         ========================================================================= */}
      <div className="relative rounded-[32px] overflow-hidden shadow-[0_10px_35px_rgba(0,0,0,0.06)] border border-slate-200/80 bg-white">
        {/* Cabecera de pestañas integradas: Billetera / Inversiones */}
        <div className="flex items-center bg-[#ccff00]">
          <button
            type="button"
            className="flex-1 py-3 text-center text-sm font-bold bg-white text-black rounded-t-[32px] shadow-sm"
          >
            Billetera
          </button>

          <button
            onClick={onNavigateToInvestments}
            type="button"
            className="flex-1 py-3 text-center text-sm font-bold bg-[#ccff00] text-black/80 hover:text-black transition-colors cursor-pointer"
          >
            Inversiones
          </button>
        </div>

        {/* CONTENIDO SUPERIOR BLANCO */}
        <div className="bg-white px-6 pt-5 pb-7 rounded-b-[32px]">
          <div className="space-y-4">
            {/* Selector de moneda y Ojo */}
            <div className="flex items-center gap-2 text-slate-800">
              <span className="text-sm font-semibold">{balanceLabel}</span>
              <button
                onClick={() => setShowBalance(!showBalance)}
                type="button"
                aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
                className="text-slate-500 hover:text-black transition-colors cursor-pointer"
              >
                {showBalance ? (
                  <Eye className="w-4 h-4 stroke-[2.2]" />
                ) : (
                  <EyeOff className="w-4 h-4 stroke-[2.2]" />
                )}
              </button>
            </div>

            {/* Saldo Grande */}
            <div className="flex items-baseline font-display">
              {/*
               * Tres estados, y ninguno se disfraza de otro:
               *   • sin lectura todavía o cadena caída → puntos, como el balance oculto
               *   • saldo real, incluido cero → `u$0,00`
               *   • oculto por el ojo → los mismos puntos de siempre
               */}
              <span className="text-4xl font-extrabold text-black tracking-tight">
                {!showBalance || usd === null ? '••••' : usd.whole}
              </span>
              <span className="text-2xl font-bold text-slate-300 ml-0.5">
                {!showBalance || usd === null ? '' : usd.cents}
              </span>
            </div>

            {/*
             * La línea aparece sólo para lo que sí sabemos: la frase verdadera
             * del portfolio, o el aviso de que el saldo está oculto —que es una
             * decisión de esta pantalla, no una lectura que falló—. Cuando lo que
             * hay es una lectura que no llegó, no se escribe nada.
             */}
            {usd === null && (!showBalance || balanceNote !== null) && (
              <p className="text-xs font-medium text-amber-600 leading-snug">
                {showBalance ? balanceNote : 'Saldo oculto'}
              </p>
            )}

            {/*
              Un total parcial ya no lleva la frase que lo nombraba. El número
              queda, que es lo que sí se pudo leer; la parte que faltó no se
              nombra, y vuelve sola con la pieza cuando la lectura llega.
            */}

            {/*
              La píldora antes decía `Rindiendo 3,90% anual`, con el número
              escrito a mano en `config/markets.ts`, y después lo tomaba de
              `GET /api/pool`. Ahora sale de la tasa del **venue de Aave dentro
              del mismo balance** que ya está en pantalla: es el mismo número con
              la misma guarda —el backend no publica esa tasa si la reserva no
              reconcilia—, y preguntar `/api/pool` desde la pestaña de la billetera
              era un segundo viaje a la cadena en cada carga de página.

              Cuando no hay tasa, no se dice `0%`: un 0% de rendimiento es una
              afirmación sobre plata.

              Sigue siendo el mismo botón: abre el detalle del pool.
            */}
            <div>
              <button
                onClick={onOpenAavePools}
                type="button"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#ccff00] hover:bg-[#b8e600] text-black text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
              >
                <span>
                  {(() => {
                    /*
                     * El venue se busca por su **key**, no por su etiqueta: el
                     * nombre es del backend y puede cambiar; la identidad del
                     * lugar no.
                     */
                    const venue = (balance?.yield?.venues ?? []).find(
                      (candidate) => candidate.key === AAVE_VENUE_KEY && candidate.status === 'ok',
                    );
                    const label = formatVenueRate(venue?.rate ?? null);
                    return label === null ? 'Tasa no disponible' : `Rindiendo ${label} anual`;
                  })()}
                </span>
                <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            </div>

            {/*
              Tres acciones: Depositar, Usar y Enviar.

              "Usar" volvió con el motor afuera todavía sin firma: su pantalla
              cotiza de verdad contra `/api/wallet/swap/quote` y ejecuta una
              simulación etiquetada como simulación hasta que la firma real
              exista (Permit2 + `/api/wallet/swap/execute`). Un botón que no
              puede hacer lo que promete no se ofrece; uno que hace sólo de
              demostración se ofrece diciéndolo.
            */}
            <div className="grid grid-cols-3 gap-3 pt-4">
              {/* Depositar */}
              <div className="flex flex-col items-center">
                <button
                  onClick={() => onOpenAction?.('depositar')}
                  type="button"
                  className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-[#ccff00] shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                >
                  <ArrowDown className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="text-xs font-semibold text-black mt-2">
                  Depositar
                </span>
              </div>

              {/* Usar (swap) */}
              <div className="flex flex-col items-center">
                <button
                  onClick={() => onOpenAction?.('usar')}
                  type="button"
                  className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-[#ccff00] shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                >
                  <ArrowLeftRight className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="text-xs font-semibold text-black mt-2">
                  Usar
                </span>
              </div>

              {/* Enviar */}
              <div className="flex flex-col items-center">
                <button
                  onClick={() => onOpenAction?.('enviar')}
                  type="button"
                  className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-[#ccff00] shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                >
                  <ArrowUp className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="text-xs font-semibold text-black mt-2">
                  Enviar
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
