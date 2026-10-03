import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

import { formatApr } from '../../config/markets';

interface AavePoolsViewProps {
  onBack: () => void;
}

export const AavePoolsView: React.FC<AavePoolsViewProps> = ({ onBack }) => {
  return (
    <div className="absolute inset-0 z-50 bg-[#f0f2f5] flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans">
      {/* =========================================================================
          CABECERA SUPERIOR: BOTÓN ATRÁS CIRCULAR + TÍTULO Y SUBTÍTULO
         ========================================================================= */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          type="button"
          aria-label="Volver atrás"
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-slate-800 shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <div>
          <h1 className="text-base font-bold font-display text-slate-900 leading-tight">
            Tu dinero
          </h1>
          <p className="text-[11px] text-slate-500 font-medium">
            Rendimiento de tus dólares
          </p>
        </div>
      </div>

      {/* =========================================================================
          CONTENIDO CON CARDS BLANCAS SEGÚN DISEÑO EXACTO
         ========================================================================= */}
      <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3.5">
        {/* CARD 1: RENDIMIENTO PRINCIPAL */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <div className="flex items-baseline">
            {/*
              El signo NO va escrito acá. Va adentro del número que trae
              `formatApr()`, y es a propósito: la tasa no siempre es positiva, y
              un `+` fijo de esta pantalla mostraría `+-0,50%` el día que el pool
              deje de rendir. La promesa del producto es que el dinero rinde; si
              un día no rinde, el número lo dice solo y sin que nadie le grite.
            */}
            <span className="text-4xl sm:text-[42px] font-black font-display tracking-tight text-black">
              {formatApr()}%
            </span>
            <span className="text-sm font-semibold text-slate-600 ml-2">
              anual
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 font-bold text-[11px] tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              ACTUALIZADO AHORA
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Se actualiza solo
            </span>
          </div>

          <div className="bg-[#f8f9fa] rounded-2xl p-3 text-[11px] text-slate-600 leading-relaxed font-normal">
            Esto es lo que está ganando tu dinero ahora mismo.
          </div>
        </div>

        {/* CARD 2: ¿POR QUÉ ES SEGURO? */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3.5 border border-slate-100">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500 stroke-[2.2]" />
            <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display">
              ¿POR QUÉ ES SEGURO?
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
              <span className="text-xs sm:text-[13px] font-extrabold text-black font-display tracking-tight">
                $150.198.641
              </span>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                AHÍ ESTÁ
              </span>
            </div>

            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
              <span className="text-sm sm:text-base font-extrabold text-black font-display">
                89%
              </span>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                EN USO
              </span>
            </div>

            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
              <span className="text-sm sm:text-base font-extrabold text-slate-400 font-display">
                —
              </span>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                VOS TENÉS
              </span>
            </div>
          </div>
        </div>

        {/* CARD 3: HISTORIAL */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
            TU RENDIMIENTO
          </span>

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Cuánto ganaste</span>
            <span className="text-xs font-bold text-slate-400">—</span>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Rendimiento acumulado</span>
            <span className="text-xs font-bold text-slate-400">—</span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            Tu rendimiento se calcula con los movimientos de cada día, así que no cambia de un día para otro.
          </p>
        </div>

        {/* CARD 4: LIQUIDEZ */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
            TU DISPONIBILIDAD
          </span>

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Podés sacar tu dinero</span>
            <span className="text-xs font-bold text-slate-400">—</span>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Cuándo</span>
            <div className="text-right">
              <span className="text-xs font-bold text-black block">Cuando quieras</span>
              <span className="text-[11px] text-slate-400 font-medium block -mt-0.5">
                Sin esperas ni costos
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            Tu dinero está disponible cuando lo necesites. No hay esperas, ni bloqueos, ni penalizaciones.
          </p>
        </div>

        {/* CARD 5: DETALLE DEL POOL */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
            CÓMO SE CALCULA
          </span>

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Tu ganancia</span>
            <div className="text-right">
              <span className="text-xs font-extrabold text-black font-display">{formatApr()}</span>
              <span className="text-[11px] font-semibold text-slate-500 ml-1">anual</span>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Lo que te cuesta</span>
            <div className="text-right">
              <span className="text-xs font-bold text-slate-400">—</span>
              <span className="text-[11px] font-semibold text-slate-400 ml-1">anual</span>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">En uso</span>
            <div className="text-right">
              <div>
                <span className="text-xs font-extrabold text-black font-display">89,21</span>
                <span className="text-[11px] font-semibold text-slate-500 ml-0.5">%</span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium block -mt-0.5">
                del dinero depositado
              </span>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Respaldo</span>
            <span className="text-xs font-bold text-slate-400">—</span>
          </div>
        </div>

        {/* CARD 6: ESTADO DEL POOL */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3.5 border border-slate-100 mb-6">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
            SIEMPRE DISPONIBLE
          </span>

          <div className="grid grid-cols-4 gap-2">
            {['Seguro', 'Sin esperas', 'Sin comisiones', 'Todos los días'].map((status) => (
              <div
                key={status}
                className="bg-[#f4f7fa] text-slate-700 font-medium text-[11px] py-1.5 px-2 rounded-full text-center flex items-center justify-center gap-1"
              >
                <span className="w-1 h-1 rounded-full bg-slate-400" />
                <span>{status}</span>
              </div>
            ))}
          </div>

          {/*
            El enlace al explorador de la cadena se eliminó a propósito.

            Mandaba a la persona a verificar un contrato en un explorador de
            bloques: era la forma más directa de contarle que detrás hay blockchain.
            La confianza se demuestra con lo que la app puede responder por sí
            misma —tu saldo, tu ganancia, cuándo podés sacarlo— y no con una
            dirección que hay que copiar a otro sitio.

            Si alguna vez hace falta dejar constancia pública de las reservas, ese
            es un asunto de la tesorería y del contrato legal, no un botón de
            esta pantalla.
          */}
        </div>
      </div>
    </div>
  );
};
