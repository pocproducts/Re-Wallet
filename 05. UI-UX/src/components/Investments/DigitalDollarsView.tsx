import React, { useMemo, useState } from 'react';

/*
 * `formatApr` ya no se importa acá. La tasa del pool no sale de ninguna fuente
 * real todavía —no hay conexión con Aave—, y una tasa escrita a mano en pantalla
 * es una promesa de rendimiento. Cuando T5 exista, la tasa entra desde el pool.
 */
import { splitUsdDisplay } from '../../services/portfolio';
import {
  BALANCE_UNREADABLE_NOTE,
  YIELD_UNREADABLE_NOTE,
  formatYieldRate,
} from '../../services/walletBalance';
import { BalancePieceRow } from './BalancePieceRow';
import { YieldVenueRow } from './YieldVenueRow';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';
import { formatPercent, projectYearlyGain } from '../../services/pool';
import type { PoolScreenView } from '../../hooks/usePool';
import {
  ArrowLeft,
  HelpCircle,
  ChevronRight,
  Info,
  X,
} from 'lucide-react';

interface DigitalDollarsViewProps {
  onBack: () => void;
  onOpenAavePools?: () => void;
  onOpenDeposit?: () => void;
  onOpenSend?: () => void;
  /** El pool de Aave, leído una vez por sesión en el `App`. */
  pool?: PoolScreenView;
  /**
   * El balance completo, leído una vez por sesión en el `App`.
   *
   * Esta pantalla es donde los dólares digitales se explican: el número de arriba
   * es `digitalDollarsValue.total` —el mismo que ve la persona en la tarjeta de
   * Dólares digitales— y las filas de abajo son de dónde sale.
   */
  balance?: WalletBalanceScreenView;
}

export const DigitalDollarsView: React.FC<DigitalDollarsViewProps> = ({
  onBack,
  onOpenAavePools,
  pool,
  balance,
}) => {
  const [showInfoModal, setShowInfoModal] = useState(false);

  /*
   * UN número, y es el mismo que ve la persona en la tarjeta de Dólares digitales.
   *
   * Es `digitalDollarsValue.total`: todo lo que está pegado al dólar, libre o
   * depositado. El USDC de cada cadena y el USDC de los pools son la misma unidad
   * valuada a 1 por definición, así que el backend los suma en un solo número —
   * y esta pantalla lo pinta como llegó, sin sumar nada.
   *
   * Y el total no se muestra solo: `complete` viaja con él. Un total parcial se
   * muestra **con** la advertencia que nombra lo que falta, nunca como si fuera
   * todo. Un cero real, en cambio, se muestra como cero: una billetera vacía
   * tiene que poder parecer vacía.
   */
  const dollars = balance?.balance?.digitalDollarsValue ?? null;
  const usd = useMemo(
    () => splitUsdDisplay(dollars?.total?.formatted ?? null, 'U$'),
    [dollars?.total],
  );

  const parts = dollars?.parts ?? [];
  const note = balance?.note ?? (balance?.status === 'error' ? BALANCE_UNREADABLE_NOTE : null);

  /*
   * EL RENDIMIENTO COMBINADO, y nada más.
   *
   * El titular de esta tarjeta dejó de ser el APR de Aave: el dinero de la
   * persona rinde en más de un lugar, así que el número que la representa es la
   * media ponderada que ya compuso el backend, con su desglose debajo. El APR del
   * pool no desaparece —sigue siendo una de las filas y el detalle de "Conectado
   * a Aave"—, pero deja de vestirse de número único.
   *
   * Esta línea no redondea ni arma frases: pasa lo que el servicio ya decidió.
   */
  const yieldView = balance?.yield ?? null;
  const combinedRate = yieldView === null ? null : formatYieldRate(yieldView);
  /*
   * La frase que acompaña a un titular que no existe. La del servicio cuando el
   * rendimiento se leyó incompleto —y nombra qué falta—, la misma del balance
   * cuando la lectura entera no llegó. Nunca un `0,00%`: un cero sería una
   * afirmación sobre plata que nadie verificó.
   */
  const yieldNote =
    yieldView === null
      ? balance !== undefined && (balance.status === 'idle' || balance.status === 'loading')
        ? 'Estamos leyendo dónde rinde tu plata.'
        : YIELD_UNREADABLE_NOTE
      : yieldView.incompletenessNote;

  return (
    <div className="absolute inset-0 z-50 bg-[#f3f4f6] flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans">
      {/* =========================================================================
          CABECERA SUPERIOR: FLECHA ATRÁS + TÍTULO + AYUDA (?)
         ========================================================================= */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          type="button"
          aria-label="Volver atrás"
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/80"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <h1 className="text-base font-extrabold font-display text-black tracking-tight">
          Dólares digitales
        </h1>

        <button
          onClick={() => setShowInfoModal(true)}
          type="button"
          aria-label="Ayuda e información"
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-slate-500 shadow-xs hover:text-black hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/80"
        >
          <HelpCircle className="w-5 h-5 stroke-[2]" />
        </button>
      </div>

      {/* =========================================================================
          CONTENIDO CON CARDS
         ========================================================================= */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3.5">
        {/* =====================================================================
            CARD 1: DÓLARES DIGITALES — USDC, libre y depositado
           ===================================================================== */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display block">
              DÓLARES DIGITALES — {dollars?.unit ?? 'USD'}
            </span>
            <div className="text-4xl sm:text-5xl font-extrabold font-display text-black tracking-tight">
              {usd === null ? '••••' : `${usd.whole}${usd.cents}`}
            </div>
            {/*
              El total es parcial. El número queda porque lo que sí se pudo leer
              también es cierto —tirar la suma parcial sería tirar lo que
              sabemos— pero la frase dice cuál es la parte que falta, para que
              nadie lea ese número como su saldo completo.
            */}
            {dollars?.complete === false && dollars.incompletenessNote !== null && (
              <div className="bg-amber-50 rounded-2xl p-3 mt-3 text-[11px] text-amber-700 leading-relaxed font-medium">
                {dollars.incompletenessNote}
              </div>
            )}
            {/*
              Una lectura que no llegó no muestra un cero: dice que no se pudo
              leer.
            */}
            {usd === null && note !== null && (
              <p className="text-xs font-medium text-amber-600 leading-snug pt-1">
                {note}
              </p>
            )}
          </div>
        </div>

        {/* =====================================================================
            CARD 2: RENDIMIENTO (la tasa combinada de todos los lugares)
           ===================================================================== */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 font-display">
              RENDIMIENTO
            </span>

            <button
              onClick={onOpenAavePools}
              type="button"
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#ccff00] hover:bg-[#b8e600] text-black font-extrabold text-xs shadow-2xs active:scale-95 transition-all cursor-pointer"
            >
              <span>Ver más</span>
              <ChevronRight className="w-3.5 h-3.5 stroke-[3]" />
            </button>
          </div>

          {/*
            LA TARSA COMBINADA, Y SU DESGLOSE.

            Antes ponía `3,90%` —el APR de un solo lugar— como si todo el dinero
            de la persona rindiera ahí, y dos cifras más escritas a mano. Ahora el
            titular es la media ponderada que ya compuso el backend y debajo está
            la fila de cada lugar con su propia tasa, leída de la misma fuente.

            El titular tiene tres estados y ninguno de ellos es un cero: la tasa
            real, la frase que nombra el lugar que no se pudo leer, o la frase de
            que no se pudo leer el rendimiento. Un guion acá no es estilo: es la
            diferencia entre "no rinde" y "no lo sabemos", y con plata de por
            medio esa diferencia importa.
          */}
          {(() => {
            const view = pool?.pool;
            const supplyApr = view?.displayableSupplyApr ?? null;
            const position = view?.position.aTokenBalance;
            const positionRaw = position?.status === 'ok' ? BigInt(position.value?.raw ?? '0') : null;
            const yearly =
              positionRaw !== null && position?.status === 'ok' && supplyApr !== null
                ? projectYearlyGain(positionRaw, position.value?.decimals ?? 6, supplyApr)
                : null;

            return (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-black font-display text-slate-900 tracking-tight">
                    {combinedRate ?? '—'}
                  </span>
                  {combinedRate !== null && (
                    <span className="text-sm font-semibold text-slate-500">anual</span>
                  )}
                </div>

                {combinedRate === null && (
                  <div className="bg-amber-50 rounded-2xl p-3 text-[11px] text-amber-700 leading-relaxed">
                    {yieldNote}
                  </div>
                )}

                {/*
                  EL DESGLOSE, una fila por lugar.

                  Se pinta aunque el titular no exista: las filas son hechos
                  propios y ya se leyeron. Y cada fila decide sola qué muestra —
                  una tasa, un "sin saldo depositado" o un "no se pudo leer"—
                  porque un lugar que no tiene nada y un lugar que no supimos
                  leer son dos verdades distintas, no dos versiones de la misma
                  fila vacía.
                */}
                {yieldView !== null && yieldView.venues.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display block">
                      En cada lugar
                    </span>
                    {yieldView.venues.map((venue) => (
                      <YieldVenueRow key={venue.key} venue={venue} />
                    ))}
                  </div>
                )}

                <div className="space-y-3 pt-3 border-t border-slate-100 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Conectado a Aave</span>
                    <span className="font-extrabold text-black">
                      {view === null ? 'No todavía' : 'Sí, en lectura'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">APR de Aave</span>
                    {/*
                      La tasa del pool, con su propio nombre. Sigue siendo el
                      detalle de la conexión con Aave —no el titular— porque el
                      titular ya es la media de todos los lugares.
                    */}
                    <span className="font-extrabold text-black">
                      {supplyApr === null ? '—' : formatPercent(supplyApr)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Tu dinero en el pool</span>
                    {/*
                      La posición sale del **mismo** total, no de otra lectura: es
                      la fila de Aave de la tarjeta "de dónde sale". Una sola
                      fuente para la misma plata, así que no puede contradecirse
                      con el número de arriba.
                    */}
                    {(() => {
                      const position = parts.find((part) => part.source === 'pool_position');
                      if (position === undefined || position.status !== 'ok') {
                        return <span className="font-extrabold text-amber-600">No se pudo leer</span>;
                      }
                      return position.value.isZero ? (
                        <span className="font-extrabold text-black">No depositás nada</span>
                      ) : (
                        <span className="font-extrabold text-black">{`U$${position.value.formatted}`}</span>
                      );
                    })()}
                  </div>

                  <div className="flex items-center justify-between">
                    {/*
                      La estimación dice de qué lugar habla. Multiplicar el
                      depósito por el ritmo de Aave y llamarlo "en un año" sin
                      más sería volver a presentar un solo venue como si fuera
                      todo.
                    */}
                    <span className="text-slate-400 font-medium">En un año en Aave (estimación)</span>
                    {yearly === null ? (
                      <span className="font-extrabold text-slate-400">—</span>
                    ) : (
                      <span className="font-extrabold text-emerald-600">+{yearly.label} U$</span>
                    )}
                  </div>
                </div>

                {supplyApr !== null && (
                  <p className="text-[11px] text-slate-500 leading-relaxed font-normal">
                    La estimación multiplica tu depósito por el ritmo de este momento,
                    que cambia con el uso del pool. No es una promesa.
                  </p>
                )}
              </>
            );
          })()}
        </div>

        {/* =====================================================================
            CARD 3: ÚLTIMOS RENDIMIENTOS
           ===================================================================== */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 font-display">
              ÚLTIMOS RENDIMIENTOS
            </span>

            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400">
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </div>
          </div>

          <div className="py-6 text-center">
            <p className="text-sm font-medium text-slate-400">
              Todavía no hay rendimientos acreditados.
            </p>
          </div>
        </div>

        {/* =====================================================================
            TEXTO LEGAL / EXPLICATIVO AL PIE
           ===================================================================== */}
        <p className="text-center text-[11px] text-slate-400 leading-relaxed px-4 pt-2 font-medium">
          El rendimiento combinado es la media ponderada de las tasas de cada
          lugar donde está depositada tu plata, leídas de la cadena. En Aave, eso
          sale del pool de Aave V3 en Monad. Depositar requiere USDC y MON para el
          gas: es la red principal.
        </p>
      </div>

      {/* Modal Informativo al presionar (?) */}
      {showInfoModal && (
        <div className="absolute inset-0 z-60 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pt-4 safe-bottom-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-[36px] p-6 shadow-2xl relative space-y-4">
            <button
              onClick={() => setShowInfoModal(false)}
              type="button"
              className="absolute top-5 right-5 w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-[#ccff00] text-black flex items-center justify-center font-bold">
              <Info className="w-6 h-6 stroke-[2.5]" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-extrabold font-display text-black">
                ¿Qué son los Dólares Digitales?
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Son monedas estables (USDC) respaldadas 1 a 1 por dólares estadounidenses depositados en reservas auditadas.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-600 space-y-1">
              <p>
                <p className="font-medium">
                Generan rendimientos pasivos automáticos conectándose a los pools
                descentralizados de Aave V3. Eso es lo que van a hacer cuando la
                conexión esté; hoy todavía no hay conexión.
              </p>
              </p>
            </div>

            <button
              onClick={() => setShowInfoModal(false)}
              type="button"
              className="w-full py-3 rounded-full bg-black text-[#ccff00] font-bold text-xs"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
