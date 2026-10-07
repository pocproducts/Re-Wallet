import React, { useMemo, useState } from 'react';
import {
  Search,
  Bell,
  Bug,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react';
import { splitUsdDisplay } from '../../services/portfolio';
import { formatVenueRate } from '../../services/walletBalance';
import type { WalletBalanceBucketView } from '../../services/walletBalance';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';
import { UserProfileData } from '../../types';

/**
 * El lugar de Aave V3 en Monad, por la **key** que publica el backend.
 *
 * Se busca por key y no por etiqueta a propósito: el nombre es texto del
 * servidor y puede cambiar; la identidad del lugar no.
 */
const AAVE_VENUE_KEY = 'invest.aave_v3_usdc_monad';

interface InvestmentsViewProps {
  profile: UserProfileData | null;
  /**
   * El balance completo, leído una vez por sesión en el `App`.
   *
   * Trae las dos cubetas ya valuadas y el total ya compuesto. Esta pantalla
   * **no** suma nada y **no** filtra nada: pinta lo que llegó.
   */
  balance?: WalletBalanceScreenView;
  onOpenProfile?: () => void;
  onNavigateToWallet?: () => void;
  onOpenSearch?: () => void;
  onOpenBugModal?: () => void;
  onOpenNotifications?: () => void;
  /**
   * Hay avisos que esta persona todavía no vio en su última visita.
   *
   * Sólo un booleano: el feed vive en `App` y el texto sale del backend. Sin
   * la prop, no hay punto — un punto falso es peor que ningún punto.
   */
  hasUnreadNotifications?: boolean;
  onOpenDigitalDollars?: () => void;
  onOpenCryptoList?: () => void;
}

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({
  profile,
  balance,
  onOpenProfile,
  onNavigateToWallet,
  onOpenSearch,
  onOpenBugModal,
  onOpenNotifications,
  hasUnreadNotifications,
  onOpenDigitalDollars,
  onOpenCryptoList,
}) => {
  const [showBalance, setShowBalance] = useState<boolean>(true);

  /*
   * EL BALANCE: tres cifras del backend y ninguna suma del navegador.
   *
   * El titular es `total`, que el backend compuso como `cryptoValue +
   * digitalDollarsValue` en enteros y sin redondear. Las dos tarjetas de abajo son
   * sus dos mitades, cada una con **su propio** total:
   *
   *  - `cryptoValue` → **Bitcoin & Crypto**: la cripto libre que **no** está
   *    pegada al dólar (MON, ETH, SOL, BTC).
   *  - `digitalDollarsValue` → **Dólares digitales**: todo lo que sí lo está, el
   *    USDC libre de cada cadena más lo que está en los pools.
   *
   * El backend ya sacó el USDC de la primera cubeta usando la tabla del peg, así
   * que acá no hay filtro ninguno: un filtro en el navegador sería una segunda
   * copia de esa tabla, capaz de contradecir al servidor.
   *
   * Son signals distintos a propósito: `—` es "no lo sé" y `U$0,00` es "lo sé".
   * Con todo leído y todo en cero, el total es cero y se muestra —una billetera
   * vacía tiene que poder parecer vacía—; con saldo pero sin precio, se dice que
   * no hay precio y no se inventa.
   */
  const total = useMemo(
    () => splitUsdDisplay(balance?.balance?.total?.usd?.formatted ?? null, 'U$'),
    [balance?.balance?.total?.usd],
  );

  const cryptoValue: WalletBalanceBucketView | null = balance?.balance?.cryptoValue ?? null;
  const digitalDollarsValue: WalletBalanceBucketView | null = balance?.balance?.digitalDollarsValue ?? null;

  const cryptoTotal = useMemo(
    () => splitUsdDisplay(cryptoValue?.total?.formatted ?? null, 'U$'),
    [cryptoValue?.total],
  );
  const dollarsTotal = useMemo(
    () => splitUsdDisplay(digitalDollarsValue?.total?.formatted ?? null, 'U$'),
    [digitalDollarsValue?.total],
  );

  /*
   * No hay frase de incompletitud en esta pantalla, y es a propósito.
   *
   * Una pieza que no se pudo leer no se nombra: ni acá, ni en la tarjeta de
   * cripto, ni en la de dólares. Un aviso que dice qué falta es un recordatorio
   * permanente de un problema de lectura, y la pieza desaparece de todos modos;
   * cuando la lectura llega, la pieza vuelve sola, sin que haya que quitar nada
   * a mano.
   * El servicio sigue componiendo la frase (`buildIncompletenessNote`): esta
   * pasada sólo decidió que acá no se pinta.
   */

  /*
   * La píldora de rendimiento sale de la tasa del **venue de Aave dentro del
   * balance** que esta pantalla ya tiene. Antes venía de `GET /api/pool`, que es
   * un segundo viaje a la cadena en cada carga de página para leer un número que
   * el backend ya publica en el balance con la misma guarda: si la reserva no
   * reconcilia, no hay tasa.
   *
   * El redondeo lo hace `formatVenueRate`, en `bigint` y una sola vez, como el
   * titular combinado: una componente no vuelve a armar un porcentaje a mano.
   */
  const aprLabel = useMemo(() => {
    const venue = (balance?.yield?.venues ?? []).find(
      (candidate) => candidate.key === AAVE_VENUE_KEY && candidate.status === 'ok',
    );

    return formatVenueRate(venue?.rate ?? null);
  }, [balance?.yield]);

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

          {/* EL TOTAL DEL BACKEND, TAL CUAL LLEGÓ

              Cuando el número no llegó, la cifra queda en puntos como cuando la
              persona la oculta: los puntos no afirman nada sobre la plata, y un
              `—` o un cero dirían "no sé cuánto" o "no tenés nada", que son dos
              afirmaciones que nadie verificó. */}
          <div className="flex items-baseline font-display">
            <span className="text-4xl font-extrabold text-black tracking-tight">
              {!showBalance || total === null ? '••••' : total.whole}
            </span>
            <span className="text-2xl font-bold text-slate-300 ml-0.5">
              {!showBalance || total === null ? '' : total.cents}
            </span>
          </div>

          </div>
      </div>

      {/* =========================================================================
          ACTIVAS EN INVERSIONES:
          1. Bitcoin & Crypto (Abre layout 3er nivel CryptoAssetsListView)
          2. Dólares digitales (Abre layout 3er nivel DigitalDollarsView)

          Las dos tarjetas, en dos columnas, con sus títulos y su drill-down de
          siempre. Lo que cambió no fue el diseño: fue de dónde sale cada
          número. `cryptoValue` ya no trae USDC, y `digitalDollarsValue` trae
          el USDC libre de cada cadena junto con lo depositado en los pools.
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
                {!showBalance || cryptoTotal === null ? '••' : cryptoTotal.whole}
              </span>
              <span className="text-sm font-bold text-slate-300 ml-0.5">
                {!showBalance || cryptoTotal === null ? '' : cryptoTotal.cents}
              </span>
            </div>
            {/*
              La cubeta incompleta no dice nada acá abajo. El número es lo que
              se leyó y se muestra; la pieza que faltó no se nombra, y un cero
              real tampoco necesita aviso: cero por cualquier precio es cero, y
              una billetera vacía tiene que poder parecer vacía.
            */}
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

            {/* Píldora de la tasa del lugar de Aave, o nada si no se pudo leer */}
            <div className="flex items-center gap-1">
              {aprLabel !== null && (
                <span className="px-2 py-0.5 rounded-full bg-[#ccff00] text-black font-extrabold text-[11px]">
                  {aprLabel}
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5]" />
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-500 block">Dólares digitales</span>
            <div className="flex items-baseline font-display mt-0.5">
              <span className="text-lg font-extrabold text-black">
                {!showBalance || dollarsTotal === null ? '••' : dollarsTotal.whole}
              </span>
              <span className="text-sm font-bold text-slate-300 ml-0.5">
                {!showBalance || dollarsTotal === null ? '' : dollarsTotal.cents}
              </span>
            </div>
            {/* Mismo criterio que la tarjeta de cripto: lo ilegible no se nombra. */}
          </div>
        </div>
      </div>
    </div>
  );
};
