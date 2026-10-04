import React, { useState } from 'react';
import { ArrowLeft, ShieldCheck, Loader2 } from 'lucide-react';

import { DepositToPoolModal } from './DepositToPoolModal';
import { formatAmount, formatPercent, projectYearlyGain } from '../../services/pool';
import type { PoolScreenView } from '../../hooks/usePool';
import type { PoolAmount, PoolField } from '../../services/pool';
import { usePoolDeposit, type PoolDeposit } from '../../hooks/usePoolDeposit';

interface AavePoolsViewProps {
  onBack: () => void;
  /** La lectura del pool, hecha una vez por sesión en el `App`. */
  pool: PoolScreenView;
  /** Vuelve a leer el pool: lo que se llama después de un depósito firmado. */
  onReload: () => void;
}

/**
 * EL DETALLE DEL POOL, CON LOS NÚMEROS QUE DIJO LA CADENA.
 *
 * ── Qué cambió y por qué ─────────────────────────────────────────────────────
 *
 * Antes esta pantalla no mostraba ninguna cifra del pool: decía, con todas sus
 * letras, que todavía no había conexión con Aave, y pintaba `—` con la palabra
 * "sin cifra todavía" al lado. Antes de eso había mostrado `3,90%`,
 * `$150.198.641`, `89%` y `89,21%`: tasas y totales escritos a mano, sin fuente.
 *
 * Ahora los cuatro espacios vuelven a ser cifras, y lo que cambia no es el lugar
 * sino **de dónde sale cada una**: de `GET /api/pool`, que va a Monad a leer
 * `getReserveData` en el `AaveProtocolDataProvider` y la posición de esta persona
 * en `aMonUSDC`.
 *
 * ── Lo que sigue sin-catching ────────────────────────────────────────────────
 *
 * - Una reserva ilegible **no** muestra `0%`: dice que no se pudo leer. Un `0%`
 *   de rendimiento es una afirmación sobre plata que la persona no tiene.
 * - La proyección anual lleva la palabra "estimación" y la frase de que el ritmo
 *   cambia. No es una promesa: es aritmética sobre el APR de este momento.
 * - El frontend **no** conoce ninguna dirección de contrato. Lo que firma son
 *   transacciones que el servidor construyó.
 */

/** Un importe de la lectura, con su unidad y su escala. */
const PoolAmountCell: React.FC<{
  field: PoolField<PoolAmount>;
  readonly prefix?: string;
  readonly fallback: string;
}> = ({ field, prefix = '', fallback }) => {
  if (field.status !== 'ok' || field.value === undefined) {
    return <span className="text-xs font-bold text-amber-600">{fallback}</span>;
  }
  return (
    <span className="text-xs font-bold text-slate-800">
      {formatAmount(BigInt(field.value.raw), field.value.decimals, prefix)}
    </span>
  );
};

export const AavePoolsView: React.FC<AavePoolsViewProps> = ({ onBack, pool, onReload }) => {
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const flow: PoolDeposit = usePoolDeposit(onReload);

  const view = pool.pool;
  const supplyApr = view?.displayableSupplyApr ?? null;
  const borrowApr = view?.apr.borrow.status === 'ok' ? view.apr.borrow.value ?? null : null;
  const position = view?.position.aTokenBalance;

  /*
   * Lo que el depósito de esta persona rendería en un año, al ritmo de este
   * momento. Es una proyección y el texto lo dice: un número que no se puede
   * prometer no se muestra como promesa.
   */
  const yearly =
    view !== null && position?.status === 'ok' && position.value !== undefined && supplyApr !== null
      ? projectYearlyGain(BigInt(position.value.raw), position.value.decimals, supplyApr)
      : null;

  const busy = flow.phase === 'preparing' || flow.phase === 'signing';

  return (
    <div className="absolute inset-0 z-50 bg-[#f0f2f5] flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans">
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
          <h1 className="text-base font-bold font-display text-slate-900 leading-tight">Tu dinero</h1>
          <p className="text-[11px] text-slate-500 font-medium">Rendimiento de tus dólares</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3.5">
        {/* CARD 1: LA TASA REAL, O LA FRASE DE QUE NO SE PUDO LEER */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          {pool.status === 'loading' || pool.status === 'idle' ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Leyendo el pool…
            </div>
          ) : supplyApr === null ? (
            <>
              <div className="flex items-baseline">
                <span className="text-4xl sm:text-[42px] font-black font-display tracking-tight text-slate-300">—</span>
                <span className="text-sm font-semibold text-slate-500 ml-2">sin cifra legible</span>
              </div>
              <div className="bg-amber-50 rounded-2xl p-3 text-[11px] text-amber-700 leading-relaxed">
                No pudimos leer la reserva de USDC del pool. No te mostramos un 0%
                porque un 0% de rendimiento se lee como plata perdida, y no es lo
                que pasó: es que la lectura falló.
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline">
                <span className="text-4xl sm:text-[42px] font-black font-display tracking-tight text-slate-900">
                  {formatPercent(supplyApr)}
                </span>
                <span className="text-sm font-semibold text-slate-500 ml-2">anual</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[11px] tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  LEÍDO DE LA CADENA
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {view?.lastUpdate === null || view === null ? '' : `Actualizado ${view.lastUpdate}`}
                </span>
              </div>
            </>
          )}

          {/* El depósito, o la frase de por qué no se puede hacer todavía. */}
          {view !== null &&
            (position?.status === 'unreadable' ? (
              <div className="bg-amber-50 rounded-2xl p-3 text-[11px] text-amber-700 leading-relaxed">
                No pudimos leer tu posición en el pool. No podés depositar sobre un
                saldo que no conocemos.
              </div>
            ) : (
              <button
                onClick={() => setIsDepositOpen(true)}
                type="button"
                disabled={busy}
                className="w-full py-3 rounded-full bg-black text-[#ccff00] font-bold text-sm disabled:bg-slate-200 disabled:text-slate-400 active:scale-[0.99] transition-all"
              >
                {busy ? 'Esperando tu firma…' : 'Depositar USDC'}
              </button>
            ))}
        </div>

        {/* CARD 2: TU POSICIÓN */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3.5 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display">
            TU POSICIÓN
          </span>

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Depositado (aMonUSDC)</span>
            <PoolAmountCell field={position ?? { status: 'unreadable', reason: 'UNREADABLE' }} prefix="U$" fallback="No se pudo leer" />
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">En un año (estimación)</span>
            {yearly === null ? (
              <span className="text-xs font-bold text-amber-600">Sin dato</span>
            ) : (
              <span className="text-xs font-extrabold text-emerald-600">+{yearly.label} U$</span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            La estimación multiplica tu depósito por el ritmo de este momento. El
            ritmo cambia con el uso del pool: no es una promesa de rendimiento.
          </p>
        </div>

        {/* CARD 3: EL POOL */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display block">
            EL POOL DE USDC
          </span>

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Te pagan</span>
            {supplyApr === null ? (
              <span className="text-xs font-bold text-amber-600">Sin cifra</span>
            ) : (
              <span className="text-xs font-extrabold text-slate-900">{formatPercent(supplyApr)} anual</span>
            )}
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Cuesta pedir prestado</span>
            {borrowApr === null ? (
              <span className="text-xs font-bold text-amber-600">Sin cifra</span>
            ) : (
              <span className="text-xs font-bold text-slate-700">{formatPercent(borrowApr)} anual</span>
            )}
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Total depositado</span>
            <PoolAmountCell field={view?.totals.supplied ?? { status: 'unreadable', reason: 'UNREADABLE' }} prefix="U$" fallback="Sin dato" />
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">En uso</span>
            {view?.totals.utilisation.status === 'ok' ? (
              <span className="text-xs font-bold text-slate-800">
                {formatPercent(view.totals.utilisation.value ?? null)}
              </span>
            ) : (
              <span className="text-xs font-bold text-amber-600">Sin dato</span>
            )}
          </div>

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">Disponible para retirar</span>
            <PoolAmountCell field={view?.totals.available ?? { status: 'unreadable', reason: 'UNREADABLE' }} prefix="U$" fallback="Sin dato" />
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            Todo lo de esta tarjeta sale de la reserva leída en la cadena, en
            {view === null ? ' la red del pool' : ` ${view.network.name}`}, y no de
            un número escrito acá.
          </p>
        </div>

        {/* CARD 4: LO QUE ESTÁ PASANDO */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500 stroke-[2.2]" />
            <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display">
              CÓMO SE CALCULA
            </span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal">
            El pool paga la tasa de depósito a quien aporta y cobra la de préstamo a
            quien pide prestado. La diferencia se reparte entre el pool y el
            protocolo. Cuando la tasa que te mostramos no se puede reproducir con
            esos tres números, preferimos no mostrarla.
          </p>

          <div className="bg-[#f8f9fa] rounded-2xl p-3 text-[11px] text-slate-600 leading-relaxed">
            {view === null
              ? 'Todavía no leímos la reserva.'
              : view.aprReconciles
                ? 'La tasa que ves se pudo reproducir desde la tasa de préstamo, el uso del pool y el reserve factor del contrato.'
                : 'La tasa de la reserva no se pudo reproducir con el resto de sus números, así que no la mostramos.'}
          </div>
        </div>
      </div>

      {isDepositOpen && view !== null && (
        <DepositToPoolModal pool={view} flow={flow} onClose={() => setIsDepositOpen(false)} />
      )}
    </div>
  );
};
