import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

<<<<<<< HEAD
=======
import { formatApr } from '../../config/markets';

>>>>>>> origin/main
interface AavePoolsViewProps {
  onBack: () => void;
}

<<<<<<< HEAD
/*
 * ESTA PANTALLA NO MUESTRA NINGÚN NÚMERO DEL POOL, Y ESO ES LO VERDADERO.
 *
 * Antes mostraba `3,90%`, `$150.198.641`, `89%` y `89,21%`: una tasa, un total
 * depositado, un uso del pool y otro uso, todos escritos a mano. No había conexión
 * con Aave —la tarea T5 del plan todavía no arrancó—, así que ninguna de esas
 * cuatro cosas venía de la cadena.
 *
 * El riesgo no era que estuvieran viejas. Una cifra de rendimiento escrita a mano
 * se lee como plata que la persona ya está ganando, y un total de `$150.198.641`
 * se lee como un pool del que ese total es parte. Por eso no se cambia ningún
 * número por otro número, ni por un cero, ni por un guion suelto: un guion en una
 * fila de dinero se lee como un valor que todavía no llegó. Se dice la verdad
 * sobre lo que todavía no existe, y el guion aparece únicamente acompañado de las
 * palabras que lo explican —el mismo guion que ya usa `DigitalDollarsView`.
 *
 * Cuando T5 conecte el pool, esta pantalla recibe la lectura y los espacios
 * vuelven a ser cifras. El lugar de cada una no cambia: cambia de dónde sale.
 */
=======
>>>>>>> origin/main
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
<<<<<<< HEAD
              El guion va en `text-slate-300` y al lado, en palabras, está "sin
              cifra todavía": es lo que impide que se lea como un cero. La tasa
              real, cuando exista, entra acá con su signo adentro del número,
              porque la tasa no siempre es positiva.
            */}
            <span className="text-4xl sm:text-[42px] font-black font-display tracking-tight text-slate-300">
              —
            </span>
            <span className="text-sm font-semibold text-slate-500 ml-2">
              sin cifra todavía
            </span>
          </div>

          {/*
            La píldora antes decía "ACTUALIZADO AHORA" con un punto verde
            latiendo: eso promete una lectura viva de una tasa que no existe.
            Misma forma, misma posición, otro significado.
          */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-bold text-[11px] tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              SIN CONEXIÓN A AAVE
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Todavía no leemos la cadena
=======
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
>>>>>>> origin/main
            </span>
          </div>

          <div className="bg-[#f8f9fa] rounded-2xl p-3 text-[11px] text-slate-600 leading-relaxed font-normal">
<<<<<<< HEAD
            Todavía no estamos conectados a Aave, así que no hay tasa que
            mostrarte. Tu rendimiento es cero porque no depositás nada, no porque
            el pool rinda poco.
=======
            Esto es lo que está ganando tu dinero ahora mismo.
>>>>>>> origin/main
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

<<<<<<< HEAD
          {/* Las IPPIs están, y las tres muestran que no hay dato. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
              <span className="text-xs sm:text-[13px] font-extrabold text-slate-500 font-display tracking-tight">
                Sin datos
=======
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
              <span className="text-xs sm:text-[13px] font-extrabold text-black font-display tracking-tight">
                $150.198.641
>>>>>>> origin/main
              </span>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                AHÍ ESTÁ
              </span>
            </div>

            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
<<<<<<< HEAD
              <span className="text-xs sm:text-[13px] font-extrabold text-slate-500 font-display tracking-tight">
                Sin datos
=======
              <span className="text-sm sm:text-base font-extrabold text-black font-display">
                89%
>>>>>>> origin/main
              </span>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                EN USO
              </span>
            </div>

            <div className="bg-[#f8f9fa] rounded-2xl p-3 py-3.5 text-center flex flex-col justify-center">
<<<<<<< HEAD
              <span className="text-xs sm:text-[13px] font-extrabold text-slate-500 font-display tracking-tight">
                No depositás nada
=======
              <span className="text-sm sm:text-base font-extrabold text-slate-400 font-display">
                —
>>>>>>> origin/main
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
<<<<<<< HEAD
            <span className="text-xs font-bold text-slate-500">Nada todavía</span>
=======
            <span className="text-xs font-bold text-slate-400">—</span>
>>>>>>> origin/main
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Rendimiento acumulado</span>
<<<<<<< HEAD
            <span className="text-xs font-bold text-slate-500">Cero: no depositás nada</span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            Tu rendimiento se calcula con los movimientos de cada día, así que no
            cambia de un día para otro.
=======
            <span className="text-xs font-bold text-slate-400">—</span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            Tu rendimiento se calcula con los movimientos de cada día, así que no cambia de un día para otro.
>>>>>>> origin/main
          </p>
        </div>

        {/* CARD 4: LIQUIDEZ */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
            TU DISPONIBILIDAD
          </span>

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Podés sacar tu dinero</span>
<<<<<<< HEAD
            <span className="text-xs font-bold text-slate-500">No hay depósito</span>
=======
            <span className="text-xs font-bold text-slate-400">—</span>
>>>>>>> origin/main
          </div>

          <div className="border-t border-slate-100" />

<<<<<<< HEAD
          {/*
            Antes, acá, decía "Cuando quieras / Sin esperas ni costos". Son
            promesas sobre un contrato que todavía no conectamos, y una promesa de
            retiro sin fuente es peor que una cifra inventada: la persona puede
            contar con plata que no llega.
          */}
          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Cuándo</span>
            <div className="text-right">
              <span className="text-xs font-bold text-slate-500 block">Todavía no se puede retirar</span>
              <span className="text-[11px] text-slate-400 font-medium block -mt-0.5">
                Porque no depositás nada
=======
          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Cuándo</span>
            <div className="text-right">
              <span className="text-xs font-bold text-black block">Cuando quieras</span>
              <span className="text-[11px] text-slate-400 font-medium block -mt-0.5">
                Sin esperas ni costos
>>>>>>> origin/main
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
<<<<<<< HEAD
            No podemos decirte todavía cuándo vas a poder sacar tu dinero: eso lo
            contesta el contrato del pool, y todavía no lo estamos leyendo.
=======
            Tu dinero está disponible cuando lo necesites. No hay esperas, ni bloqueos, ni penalizaciones.
>>>>>>> origin/main
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
<<<<<<< HEAD
              <span className="text-xs font-extrabold text-slate-500 font-display">Sin cifra todavía</span>
=======
              <span className="text-xs font-extrabold text-black font-display">{formatApr()}</span>
              <span className="text-[11px] font-semibold text-slate-500 ml-1">anual</span>
>>>>>>> origin/main
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Lo que te cuesta</span>
            <div className="text-right">
<<<<<<< HEAD
              <span className="text-xs font-bold text-slate-500">Sin cifra todavía</span>
=======
              <span className="text-xs font-bold text-slate-400">—</span>
              <span className="text-[11px] font-semibold text-slate-400 ml-1">anual</span>
>>>>>>> origin/main
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">En uso</span>
            <div className="text-right">
<<<<<<< HEAD
              <span className="text-xs font-bold text-slate-500 block">Sin datos</span>
=======
              <div>
                <span className="text-xs font-extrabold text-black font-display">89,21</span>
                <span className="text-[11px] font-semibold text-slate-500 ml-0.5">%</span>
              </div>
>>>>>>> origin/main
              <span className="text-[11px] text-slate-400 font-medium block -mt-0.5">
                del dinero depositado
              </span>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Respaldo</span>
<<<<<<< HEAD
            <span className="text-xs font-bold text-slate-500">Sin datos</span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            Cuando haya conexión, acá va a estar de dónde sale cada número. Nada
            de esto se escribe a mano.
          </p>
=======
            <span className="text-xs font-bold text-slate-400">—</span>
          </div>
>>>>>>> origin/main
        </div>

        {/* CARD 6: ESTADO DEL POOL */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3.5 border border-slate-100 mb-6">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
<<<<<<< HEAD
            ESTADO ACTUAL
          </span>

          {/*
            Antes decía "SIEMPRE DISPONIBLE" con cuatro píldoras: Seguro, Sin
            esperas, Sin comisiones, Todos los días. "Sin comisiones" es una tasa
            y ninguna de las cuatro cosas sale de un lugar que estemos leyendo.
            Las cuatro píldoras quedan, con la misma forma, diciendo lo que sí
            sabemos: que todavía no hay nada.
          */}
          <div className="grid grid-cols-4 gap-2">
            {['Sin conexión', 'Sin depósitos', 'Sin saldo', 'Sin retiros'].map((status) => (
              <div
                key={status}
                className="bg-[#f4f7fa] text-slate-500 font-medium text-[11px] py-1.5 px-2 rounded-full text-center flex items-center justify-center gap-1"
              >
                <span className="w-1 h-1 rounded-full bg-slate-300" />
=======
            SIEMPRE DISPONIBLE
          </span>

          <div className="grid grid-cols-4 gap-2">
            {['Seguro', 'Sin esperas', 'Sin comisiones', 'Todos los días'].map((status) => (
              <div
                key={status}
                className="bg-[#f4f7fa] text-slate-700 font-medium text-[11px] py-1.5 px-2 rounded-full text-center flex items-center justify-center gap-1"
              >
                <span className="w-1 h-1 rounded-full bg-slate-400" />
>>>>>>> origin/main
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
<<<<<<< HEAD
};
=======
};
>>>>>>> origin/main
