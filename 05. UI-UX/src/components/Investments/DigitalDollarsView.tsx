import React, { useMemo, useState } from 'react';

/*
 * `formatApr` ya no se importa acá. La tasa del pool no sale de ninguna fuente
 * real todavía —no hay conexión con Aave—, y una tasa escrita a mano en pantalla
 * es una promesa de rendimiento. Cuando T5 exista, la tasa entra desde el pool.
 */
import { splitUsdDisplay } from '../../services/portfolio';
import type { PortfolioView } from '../../hooks/usePortfolio';
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
  /** Saldos de la cadena, leídos una vez por sesión en el `App`. */
  portfolio?: PortfolioView;
}

export const DigitalDollarsView: React.FC<DigitalDollarsViewProps> = ({
  onBack,
  onOpenAavePools,
  portfolio,
}) => {
  const [showInfoModal, setShowInfoModal] = useState(false);

  /*
   * El saldo de dólares, de la cadena.
   *
   * Antes esta tarjeta escribía `U$0,82` en el JSX: una cantidad inventada con
   * forma de saldo. Ahora sale de `portfolio.usdcTotal`, y cuando no se pudo leer
   * no muestra un cero: dice que no se pudo leer.
   */
  const usd = useMemo(
    () => splitUsdDisplay(portfolio?.usdcTotal ?? null, 'U$'),
    [portfolio?.usdcTotal],
  );

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
            CARD 1: DÓLARES DIGITALES — USDC
           ===================================================================== */}
        <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display block">
              DÓLARES DIGITALES — USDC
            </span>
            <div className="text-4xl sm:text-5xl font-extrabold font-display text-black tracking-tight">
              {usd === null ? '••••' : `${usd.whole}${usd.cents}`}
            </div>
            {/*
              Una cadena que no se pudo leer se dice. Un cero acá sería una billetera
              vacía, y no es lo que pasó: no lo sabemos.
            */}
            {usd === null && portfolio?.usdcNote && (
              <p className="text-xs font-medium text-amber-600 leading-snug pt-1">
                {portfolio.usdcNote}
              </p>
            )}
          </div>
        </div>

        {/* =====================================================================
            CARD 2: RENDIMIENTO (la tasa del pool)
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

          {/* =
            ESTA TARJETA NO MUESTRA NINGÚN NÚMERO, Y ESO ES LO VERDADERO.

            Antes ponía `3,90%`, `$150 . 198 . 641` y `89%`: una tasa y dos
            cifras escritas a mano. No había ninguna conexión con Aave —la tarea
            T5 del plan todavía no arrancó—, así que ninguna de esas tres cosas
            venía de la cadena. Y el riesgo no era que estuvieran viejas: una
            cifra de rendimiento escrita a mano se lee como plata que la persona
            ya está ganando. Por eso no se cambia el número por otro número, ni
            por un cero: se dice la verdad sobre lo que todavía no existe.

            Lo que queda son palabras. El guion es el que ya usa el resto de la
            app para "acá no hay dato" —el precio del activo, el detalle del
            pool—, no una cifra escondida.
          = */}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black font-display text-slate-300 tracking-tight">
              —
            </span>
            <span className="text-sm font-semibold text-slate-500">
              sin cifra todavía
            </span>
          </div>

          <div className="space-y-3 pt-3 border-t border-slate-100 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Conectado a Aave</span>
              <span className="font-extrabold text-black">
                Todavía no
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Tu dinero en el pool</span>
              <span className="font-extrabold text-black">
                No depositás nada
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Podés sacar</span>
              <span className="font-extrabold text-black">
                No hay depósito
              </span>
            </div>
          </div>
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
          Todavía no estamos conectados a Aave, así que la tasa no sale de la
          cadena todavía. Tu rendimiento es cero porque no hay nada depositado, no
          porque el pool rinda poco.
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
