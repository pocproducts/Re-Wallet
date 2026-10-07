<<<<<<< HEAD
import React, { useMemo, useState } from 'react';
=======
import React, { useState } from 'react';
>>>>>>> origin/main
import {
  Search,
  Bell,
  Bug,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react';
<<<<<<< HEAD
import { splitUsdDisplay } from '../../services/portfolio';
import type { PortfolioView } from '../../hooks/usePortfolio';
=======
>>>>>>> origin/main
import { UserProfileData } from '../../types';

interface InvestmentsViewProps {
  profile: UserProfileData | null;
<<<<<<< HEAD
  /** Saldos de la cadena, leídos una vez por sesión en el `App`. */
  portfolio?: PortfolioView;
=======
>>>>>>> origin/main
  onOpenProfile?: () => void;
  onNavigateToWallet?: () => void;
  onOpenSearch?: () => void;
  onOpenBugModal?: () => void;
  onOpenNotifications?: () => void;
<<<<<<< HEAD
  /**
   * Hay avisos que esta persona todavía no vio en su última visita.
   *
   * Sólo un booleano: el feed vive en `App` y el texto sale del backend. Sin
   * la prop, no hay punto — un punto falso es peor que ningún punto.
   */
  hasUnreadNotifications?: boolean;
=======
>>>>>>> origin/main
  onOpenDigitalDollars?: () => void;
  onOpenCryptoList?: () => void;
}

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({
  profile,
<<<<<<< HEAD
  portfolio,
=======
>>>>>>> origin/main
  onOpenProfile,
  onNavigateToWallet,
  onOpenSearch,
  onOpenBugModal,
  onOpenNotifications,
<<<<<<< HEAD
  hasUnreadNotifications,
=======
>>>>>>> origin/main
  onOpenDigitalDollars,
  onOpenCryptoList,
}) => {
  const [showBalance, setShowBalance] = useState<boolean>(true);

<<<<<<< HEAD
  /*
   * Los saldos de esta pantalla.
   *
   * Los dólares digitales son un saldo real y se muestran. El total de
   * inversiones y el total de *Bitcoin & Crypto* **no**: `/api/portfolio` trae
   * cantidades y no trae precios, así que un total en dólares exigiría un precio
   * de mercado que esta tarea no tiene. Las dos cifras que estaban acá
   * (`U$20,15` y su `≈ $31.640,71`) eran números escritos a mano, y una
   * invertidora ve más que nada cuando ve un total: se quedan con ese número.
   * Sin precio, se dice que no hay precio.
   *
   * ── El cero que sí se sabe ────────────────────────────────────────────────
   *
   * `—` significa "no lo sé" y `U$0,00` significa "lo sé". Con todo leído y todo
   * en cero, el total en dólares también es cero —cero por cualquier precio es
   * cero—, así que ahí el total se muestra, y una billetera vacía tiene que poder
   * parecer vacía. Con saldo pero sin precio, el total sigue siendo `—` con la
   * frase de siempre: no hay feed, y no se inventa.
   *
   * Son dos signals distintos a propósito: alcanza con que **uno** de los dos
   * tenga saldo para que el balance total deje de ser un cero.
   */
  const usd = useMemo(
    () => splitUsdDisplay(portfolio?.usdcTotal ?? null, 'U$'),
    [portfolio?.usdcTotal],
  );

  const balanceIsZero = portfolio?.status === 'ready' && portfolio.balanceIsZero === true;
  const cryptoBalanceIsZero =
    portfolio?.status === 'ready' && portfolio.cryptoBalanceIsZero === true;

=======
>>>>>>> origin/main
  const userTag = profile?.nombre
    ? '$' + profile.nombre.toLowerCase().replace(/\s+/g, '').slice(0, 10)
    : '$joadata';

  return (
    <div className="w-full h-full overflow-y-auto bg-[#f3f4f6] p-4 pb-24 max-w-md mx-auto select-none space-y-4 animate-in fade-in duration-200">
      {/* =========================================================================
          HEADER SUPERIOR: Avatar con $tag + Lupa y Campana
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

        {/* Iconos de la derecha: Bug y Notificaciones */}
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
<<<<<<< HEAD
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
=======
            aria-label="Notificaciones"
            title="Notificaciones"
            className="w-11 h-11 flex items-center justify-center text-black hover:opacity-75 active:scale-90 transition-all cursor-pointer relative"
          >
            <Bell className="w-5 h-5 stroke-[2.2]" />
>>>>>>> origin/main
          </button>
        </div>
      </div>

      {/* =========================================================================
          TARJETA PRINCIPAL DE INVERSIONES
         ========================================================================= */}
      <div className="rounded-[32px] overflow-hidden shadow-[0_4px_25px_rgba(0,0,0,0.05)] border border-slate-200/80 bg-white">
        {/* Cabecera de pestañas integradas: Billetera / Inversiones */}
        <div className="flex items-center bg-[#ccff00]">
          <button
            onClick={onNavigateToWallet}
            type="button"
            className="flex-1 py-3 text-center text-sm font-bold text-black bg-[#ccff00] rounded-tl-[32px] active:opacity-90 transition-opacity cursor-pointer"
          >
            Billetera
          </button>

          <button
            type="button"
            className="flex-1 py-3 text-center text-sm font-bold text-black bg-white rounded-t-[32px] shadow-sm"
          >
            Inversiones
          </button>
        </div>

        {/* CONTENIDO DE LA TARJETA SUPERIOR */}
        <div className="p-6 pt-5 pb-6 space-y-2">
          {/* Balance total y ojo */}
          <div className="flex items-center gap-2 text-slate-800">
            <span className="text-sm font-bold text-black font-display">Balance total</span>
            <button
              onClick={() => setShowBalance(!showBalance)}
              type="button"
              aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
              className="text-slate-400 hover:text-black transition-colors"
            >
              {showBalance ? (
                <Eye className="w-4 h-4 stroke-[2.2]" />
              ) : (
                <EyeOff className="w-4 h-4 stroke-[2.2]" />
              )}
            </button>
          </div>

          {/* Importe U$20,15 */}
          <div className="flex items-baseline font-display">
            <span className="text-4xl font-extrabold text-black tracking-tight">
<<<<<<< HEAD
              {showBalance ? (balanceIsZero ? 'U$0,00' : '—') : '••••'}
            </span>
          </div>

          {/* Sin precio de mercado no hay total en dólares. La frase va donde
              estaba el equivalente en pesos, que tampoco se puede calcular.
              Con todo en cero sí hay total —cero— y se dice otro motivo. */}
          <p className="text-xs font-semibold text-slate-400 font-mono tracking-tight pt-1">
            {showBalance
              ? balanceIsZero
                ? 'No tenés saldos en ninguna billetera.'
                : 'Sin precio de mercado, sin total'
              : '≈ ••••••••'}
=======
              {showBalance ? 'U$20' : '••••'}
            </span>
            <span className="text-2xl font-bold text-slate-300 ml-0.5">
              {showBalance ? ',15' : ''}
            </span>
          </div>

          {/* Equivalente en pesos ≈ $31.640,71 */}
          <p className="text-xs font-semibold text-slate-400 font-mono tracking-tight pt-1">
            {showBalance ? '≈ $31.640,71' : '≈ ••••••••'}
>>>>>>> origin/main
          </p>
        </div>
      </div>

      {/* =========================================================================
          ACTIVAS EN INVERSIONES:
          1. Bitcoin & Crypto (Abre layout 3er nivel CryptoAssetsListView)
          2. Dólares digitales (Abre layout 3er nivel DigitalDollarsView)
         ========================================================================= */}
      <div className="grid grid-cols-2 gap-3">
        {/* TARJETA 1: Bitcoin & Crypto -> Abre 3er nivel */}
        <div
          onClick={onOpenCryptoList}
          className="bg-white rounded-[28px] p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-200/80 flex flex-col justify-between space-y-4 hover:border-black/20 active:scale-98 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            {/* Círculo gris con ₿ */}
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-extrabold text-sm">
              ₿
            </div>

            <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5]" />
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-500 block">Bitcoin & Crypto</span>
            <div className="flex items-baseline font-display mt-0.5">
              <span className="text-lg font-extrabold text-black">
<<<<<<< HEAD
                {showBalance ? (cryptoBalanceIsZero ? 'U$0,00' : '—') : '••'}
=======
                {showBalance ? 'U$20' : '••'}
              </span>
              <span className="text-sm font-bold text-slate-300 ml-0.5">
                {showBalance ? ',15' : ''}
>>>>>>> origin/main
              </span>
            </div>
          </div>
        </div>

        {/* TARJETA 2: Dólares digitales -> Abre 3er nivel con el diseño adjunto */}
        <div
          onClick={onOpenDigitalDollars}
          className="bg-white rounded-[28px] p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-200/80 flex flex-col justify-between space-y-4 hover:border-black/20 active:scale-98 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            {/* Círculo gris con U$ */}
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-extrabold text-xs">
              U$
            </div>

            {/* Píldora 3,46% con flecha */}
            <div className="flex items-center gap-1">
              <span className="px-2 py-0.5 rounded-full bg-[#ccff00] text-black font-extrabold text-[11px]">
                3,46%
              </span>
              <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5]" />
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-500 block">Dólares digitales</span>
            <div className="flex items-baseline font-display mt-0.5">
              <span className="text-lg font-extrabold text-black">
<<<<<<< HEAD
                {!showBalance || usd === null ? '••' : usd.whole}
              </span>
              <span className="text-sm font-bold text-slate-300 ml-0.5">
                {!showBalance || usd === null ? '' : usd.cents}
=======
                {showBalance ? 'U$0' : '••'}
              </span>
              <span className="text-sm font-bold text-slate-300 ml-0.5">
                {showBalance ? ',00002' : ''}
>>>>>>> origin/main
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
