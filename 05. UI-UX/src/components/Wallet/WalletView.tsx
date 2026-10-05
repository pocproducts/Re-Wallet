import React, { useMemo, useState } from 'react';

import { splitUsdDisplay } from '../../services/portfolio';
import { formatPercent } from '../../services/pool';
import type { PoolScreenView } from '../../hooks/usePool';
import { usePortfolio, type PortfolioView } from '../../hooks/usePortfolio';
import {
  Bug,
  Bell,
  Eye,
  EyeOff,
  ArrowDown,
  ArrowUp,
  DollarSign,
  Receipt,
  ChevronRight,
} from 'lucide-react';
import { UserProfileData } from '../../types';

interface WalletViewProps {
  profile: UserProfileData | null;
  /**
   * Los saldos leídos de la cadena. Viene del hook del `App` para que la
   * lectura sea **una por sesión**: si cada pantalla montara el suyo, abrir y
   * cerrar la lista de cripto sería una lectura de blockchain por cada apertura.
   */
  portfolio?: PortfolioView;
  /** El pool de Aave en Monad, leído una vez por sesión en el `App`. */
  pool?: PoolScreenView;
  onOpenProfile?: () => void;
  onNavigateToInvestments?: () => void;
  onNavigateToActivity?: () => void;
  onOpenAction?: (action: 'depositar' | 'usar' | 'enviar') => void;
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
  /**
   * Abrir la pantalla de **cobrar por link**.
   *
   * Es el cuarto camino de acción, junto a Depositar, Usar y Enviar, y está en
   * esta pantalla a propósito: cobrar y enviar son las dos mitades del mismo
   * dinero. Va con un prop y no con un import del modal porque el flujo de cobro
   * por link es una pantalla de tercer nivel —se entra, se hace, se vuelve— y no
   * el modal de dos pasos que hay en la barra inferior.
   */
  onOpenCreateCharge?: () => void;
}

export const WalletView: React.FC<WalletViewProps> = ({
  profile,
  portfolio,
  pool,
  onOpenProfile,
  onNavigateToInvestments,
  onOpenAction,
  onOpenSearch,
  onOpenScanner,
  onOpenBugModal,
  onOpenNotifications,
  hasUnreadNotifications,
  onOpenAavePools,
  onOpenCreateCharge,
}) => {
  const [showBalance, setShowBalance] = useState<boolean>(true);

  /*
   * El saldo grande es el de los dólares digitales, leído de la cadena.
   *
   * Antes esta línea escribía `'$0'` y `',00'` en el JSX: un cero escrito a mano
   * que se veía exactamente igual que un cero real. La diferencia entre "no
   * tenés nada" y "no lo sabemos" es el `null`, y por eso el hook devuelve
   * `null` cuando ninguna cadena se pudo leer.
   *
   * El cero de verdad se muestra: `"0,00"`. Es un saldo, no una ausencia.
   */
  const usd = useMemo(() => splitUsdDisplay(portfolio?.usdcTotal ?? null), [portfolio?.usdcTotal]);

  /*
   * La etiqueta de la moneda también viene del dato: dice "Dólares digitales"
   * porque lo que se está mostrando son dólares digitales.
   */
  const balanceLabel = usd === null ? 'Sin lectura' : 'Dólares digitales';

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
             * Una cadena que no se pudo leer se dice, en castellano y sin
             * jerga. `usd === null` es justamente ese caso, y también el de una
             * sesión que todavía no terminó de leer: por eso la línea sólo
             * aparece cuando hay una frase que decir.
             */}
            {usd === null && portfolio?.usdcNote !== null && portfolio?.usdcNote !== undefined && (
              <p className="text-xs font-medium text-amber-600 leading-snug">
                {showBalance ? portfolio.usdcNote : 'Saldo oculto'}
              </p>
            )}

            {/*
              La píldora antes decía `Rindiendo 3,90% anual`, con el número
              escrito a mano en `config/markets.ts`. Ahora muestra la tasa que
              devolvió `GET /api/pool` —la reserva leída en la cadena— y cuando esa
              lectura no llegó, dice que no se pudo leer en vez de inventar un 0%:
              un 0% de rendimiento es una afirmación sobre plata.

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
                    const apr = pool?.pool?.displayableSupplyApr ?? null;
                    const label = formatPercent(apr);
                    return label === null ? 'Tasa no disponible' : `Rindiendo ${label} anual`;
                  })()}
                </span>
                <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            </div>

            {/* 4 Botones Circulares de Acción (Negro + Verde Fluo) */}
            <div className="grid grid-cols-4 gap-3 pt-4">
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

              {/* Usar */}
              <div className="flex flex-col items-center">
                <button
                  onClick={() => onOpenAction?.('usar')}
                  type="button"
                  className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-[#ccff00] shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                >
                  <DollarSign className="w-5 h-5 stroke-[2.5]" />
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

              {/*
                Cobrar. Es la otra mitad de "Enviar": el mismo movimiento de
                plata, del otro lado del link. Va acá y no escondido en un menú
                porque el contrato dice que el dinero entra por un link
                compartido o por QR, y las dos tienen que estar a un toque.
              */}
              {onOpenCreateCharge !== undefined && (
                <div className="flex flex-col items-center">
                  <button
                    onClick={onOpenCreateCharge}
                    type="button"
                    aria-label="Cobrar por link"
                    className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-[#ccff00] shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                  >
                    <Receipt className="w-5 h-5 stroke-[2.5]" />
                  </button>
                  <span className="text-xs font-semibold text-black mt-2">
                    Cobrar
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
