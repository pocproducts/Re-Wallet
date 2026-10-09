/**
 * PAGAR UN COBRO: entrar por el link, ver quién pide y cuánto, y firmar.
 *
 * ── Por qué esta pantalla no tiene un campo de dirección ─────────────────────
 *
 * Porque no hay ninguna. `docs/contrato-dinero.md:26` — *"nadie escribe una
 * dirección ni la ve"*— y el que cobra no expone la suya: el backend la resuelve
 * por dentro, contra `rewallet.wallets`, cuando alguien paga. Esta pantalla pide
 * un id, elige en qué activo se paga, y firma una transacción que el servidor armó
 * con un destino que ella nunca vio.
 *
 * Si esta pantalla pudiera mostrar una dirección, el contrato estaría roto. No hay
 * ningún campo en el tipo de la respuesta donde una pudiera entrar, así que la
 * prohibición es una propiedad del código y no una promesa.
 *
 * ── Por qué se ve el `@tag` de quien cobra y no su dirección ────────────────
 *
 * Porque el `@tag` es la identidad que el contrato ya usa para **encontrar** a una
 * persona, y es lo único que se puede leer en voz alta y comparar con la persona
 * que te está pidiendo la plata. Si el tag no vino, la pantalla dice el importe y
 * no dice quién: no inventa un nombre.
 *
 * ── Por qué los pasos del envío se muestran tal cual ─────────────────────────
 *
 * Porque es el mismo hook y el mismo resultado: preparar, cambiar de red, enviar,
 * releer saldos. La lista no se adapta a "es un cobro" porque adaptarla sería
 * empezar a tener dos pantallas de firma, y la segunda es la que nadie actualiza.
 *
 * ── Por qué el resultado no dice "pagaste" sin hash ──────────────────────────
 *
 * Porque sin hash no hay pago: hay una transacción firmada que todavía puede no
 * haber llegado. El hash es lo que se puede verificar sin creerse, y sin él esta
 * pantalla no afirma que la plata se movió.
 */
import React from 'react';
import { Copy, Loader2 } from 'lucide-react';

import { BackButton } from '../common';
import { usePayCharge, chargeFailureText, type PayableOption } from '../../hooks/usePayCharge';
import { useDepositInfo } from '../../hooks/useDepositInfo';
import type { PaymentRequest } from '../../types/paymentRequest.types';

interface PayChargeViewProps {
  /** El id del link, o `null` cuando no vino de un link. */
  id: string | null;
  onClose: () => void;
}

/** `150.25` → `150,25`, el formato con el que esta app muestra plata. */
const asDisplay = (amount: string): string => amount.replace('.', ',');

/** La hora de vencimiento, en el formato que ya usa el resto de la app. */
const expiryLabel = (expiresAt: string): string | null => {
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ChargeBody: React.FC<{ charge: PaymentRequest }> = ({ charge }) => (
  <>
    {charge.requesterTag !== null && (
      <p className="text-xs font-bold text-slate-500 text-center">
        Te pide <span className="text-black">@{charge.requesterTag}</span>
      </p>
    )}
    <div className="text-center py-2">
      <span className="text-4xl font-black font-display text-black tracking-tight">
        U$ {asDisplay(charge.amount)}
      </span>
    </div>
    {charge.note !== null && (
      <div className="rounded-3xl bg-white border border-slate-200/80 p-4 shadow-xs">
        <span className="text-[11px] font-bold uppercase text-slate-400 font-display block">Nota</span>
        <p className="text-sm font-semibold text-black leading-relaxed mt-1">{charge.note}</p>
      </div>
    )}
  </>
);

export const PayChargeView: React.FC<PayChargeViewProps> = ({ id, onClose }) => {
  /*
   * El catálogo de depósito, y de ahí salen las opciones de pago.
   *
   * Es el mismo `GET /api/deposit-info` que ya se lee una vez por sesión en el
   * `App` para la pantalla de depósito; esta pantalla lo vuelve a pedir porque
   * vive detrás de una puerta y puede abrirse mucho después de esa lectura. Son
   * datos que no cambian, y una lectura vieja es mejor que una pantalla que no
   * puede pagar.
   */
  const depositInfo = useDepositInfo(id !== null);
  const { status, charge, failureCode, reload, options, chosen, choose, chain, flow, pay } = usePayCharge(
    id,
    depositInfo.networks,
  );

  const showSteps = flow.phase !== 'idle';

  const header = (
    <div className="p-4 pt-5 flex items-center gap-3 shrink-0">
      <BackButton onClick={onClose} ariaLabel="Cerrar el cobro" />
      <h2 className="text-sm font-extrabold font-display text-black flex-1">Cobro</h2>
    </div>
  );

  /* ═══ LEYENDO ═══════════════════════════════════════════════════════════════ */
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex-1 w-full h-full bg-[#f3f4f6] flex flex-col font-sans">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 text-black animate-spin" />
          <p className="text-xs font-medium text-slate-500">Cargando el cobro…</p>
        </div>
      </div>
    );
  }

  /* ═══ NO EXISTE ════════════════════════════════════════════════════════════
     *
     * Un link que no lleva a ningún cobro. No es lo mismo que un link que no
     * pudimos leer, y por eso es una pantalla distinta del ámbar de más abajo:
     * uno se arregla pidiendo el link de nuevo, el otro se arregla probando en un
     * rato.
     */
  if (status === 'not_found') {
    return (
      <div className="flex-1 w-full h-full bg-[#f3f4f6] flex flex-col font-sans">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="text-sm font-extrabold font-display text-black">Este link no existe</span>
          <p className="text-xs font-medium text-slate-500 leading-relaxed">
            Puede que el cobro se haya vencido, o que el link esté incompleto. Pedile
            a quien te lo pasó que te mande uno nuevo.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 py-3 px-6 rounded-2xl bg-black text-[#ccff00] text-xs font-black uppercase tracking-wider active:scale-95 transition-transform cursor-pointer"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  /* ═══ NO SE PUDO LEER ═══════════════════════════════════════════════════════
     *
     * Deliberadamente **no** es la pantalla anterior: acá puede haber un cobro
     * perfectamente real que no llegamos a leer. Decir "este link no existe"
     * cuando no lo sabemos afirmaría algo falso, y además mandaría a una persona
     * a reclamarle a quien le cobró.
     */
  if (status === 'unavailable' || charge === null) {
    return (
      <div className="flex-1 w-full h-full bg-[#f3f4f6] flex flex-col font-sans">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="text-sm font-extrabold font-display text-black">No pudimos leer el cobro</span>
          <p className="text-xs font-medium text-slate-500 leading-relaxed">
            {chargeFailureText(failureCode ?? '')}
          </p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={reload}
              className="py-3 px-6 rounded-2xl bg-black text-[#ccff00] text-xs font-black uppercase tracking-wider active:scale-95 transition-transform cursor-pointer"
            >
              Probar de nuevo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-3 px-6 rounded-2xl bg-white text-black text-xs font-black uppercase tracking-wider border border-slate-200 active:scale-95 transition-transform cursor-pointer"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  const expiresAt = expiryLabel(charge.expiresAt);

  /* ═══ RESULTADO DE LA FIRMA ═════════════════════════════════════════════════ */
  if (showSteps) {
    return (
      <div className="flex-1 w-full h-full bg-[#f3f4f6] flex flex-col font-sans overflow-y-auto">
        <div className="p-4 pt-5 flex items-center gap-3 shrink-0">
          <BackButton
            onClick={onClose}
            ariaLabel="Cerrar el cobro"
          />
          <h2 className="text-sm font-extrabold font-display text-black flex-1">Pago del cobro</h2>
        </div>

        <div className="flex-1 px-5 pb-6 space-y-4 max-w-sm mx-auto w-full">
          <div className="bg-white rounded-3xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
            {flow.steps.map((entry) => (
              <div key={entry.id} className="p-4 flex items-center gap-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    entry.status === 'failed'
                      ? 'bg-red-500'
                      : entry.status === 'signed'
                        ? 'bg-black'
                        : entry.status === 'skipped'
                          ? 'bg-slate-200'
                          : 'bg-slate-300'
                  }`}
                  aria-hidden
                />
                <span
                  className={`text-sm font-semibold flex-1 ${
                    entry.status === 'failed' ? 'text-red-600' : 'text-black'
                  }`}
                >
                  {entry.label}
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {entry.status === 'running'
                    ? '…'
                    : entry.status === 'signed'
                      ? 'Listo'
                      : entry.status === 'failed'
                        ? 'Falló'
                        : entry.status === 'skipped'
                          ? '—'
                          : ''}
                </span>
              </div>
            ))}
          </div>

          {flow.transferHash !== null && (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-4 space-y-3 shadow-xs">
              <span className="text-xs font-bold uppercase text-slate-400 font-display block">
                Comprobante de la transacción
              </span>
              <div className="bg-slate-100 rounded-2xl px-3 py-2.5 flex items-center gap-2">
                <code className="text-[11px] font-mono font-bold text-black break-all flex-1 min-w-0">
                  {flow.transferHash}
                </code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(flow.transferHash ?? '')}
                  aria-label="Copiar el hash"
                  className="shrink-0 text-slate-500 hover:text-black active:scale-90 cursor-pointer"
                >
                  <Copy className="w-4 h-4 stroke-[2]" />
                </button>
              </div>
            </div>
          )}

          {flow.failureCode !== null && (
            <div className="bg-white rounded-3xl border border-red-200 p-4 space-y-1 shadow-xs">
              <span className="text-xs font-bold uppercase text-red-500 font-display block">
                No se completó
              </span>
              <p className="text-sm font-semibold text-black leading-relaxed">
                {chargeFailureText(flow.failureCode)}
              </p>
            </div>
          )}

          <div className="flex-1" />

          {flow.phase === 'done' ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-4 rounded-2xl bg-[#ccff00] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              Listo
            </button>
          ) : flow.phase === 'failed' ? (
            <button
              type="button"
              onClick={flow.reset}
              disabled={flow.transferHash !== null}
              className="w-full py-4 rounded-2xl bg-white text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform border border-slate-200 disabled:opacity-40 cursor-pointer"
            >
              Volver a intentarlo
            </button>
          ) : (
            <p className="text-center text-xs font-semibold text-slate-400 pb-2">
              Confirmá en tu wallet. No cierres la app.
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ═══ EL COBRO ═════════════════════════════════════════════════════════════ */
  const alreadySettled = charge.status !== 'pending';

  return (
    <div className="flex-1 w-full h-full bg-[#f3f4f6] flex flex-col font-sans overflow-y-auto">
      {header}

      <div className="flex-1 px-5 pb-6 space-y-4 max-w-sm mx-auto w-full">
        <ChargeBody charge={charge} />

        {expiresAt !== null && (
          <p className="text-[11px] font-semibold text-slate-400 text-center">
            Vence el {expiresAt}
          </p>
        )}

        {/*
          Un cobro que ya no está `pending` no se paga: se dice qué pasó y se
          termina. Ofrecer el botón igual sería ofrecer una acción que el servidor
          va a rechazar, y una pantalla que ofrece lo que no puede hacer.
        */}
        {alreadySettled && (
          <div
            className={`rounded-3xl border p-4 space-y-1 shadow-xs ${
              charge.status === 'paid'
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-amber-50 border-amber-200'
            }`}
          >
            <span
              className={`text-xs font-bold uppercase font-display block ${
                charge.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {charge.status === 'paid' ? 'Ya pagado' : 'Este cobro venció'}
            </span>
            <p className="text-sm font-semibold text-black leading-relaxed">
              {charge.status === 'paid'
                ? 'Este link es de un solo uso: ya se pagó y no vuelve a abrirse.'
                : 'Pasó la fecha del cobro. Pedile uno nuevo a quien te lo pasó.'}
            </p>
          </div>
        )}

        {!alreadySettled && (
          <>
            {/*
              En qué se paga. Las opciones salen del mismo catálogo de depósito que
              usa la pantalla de depósito, así que no hay una lista de activos acá
              que pueda quedar vieja: el backend la valida igual.
            */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase text-slate-400 font-display block px-1">
                Cómo lo pagás
              </span>
              {options.length === 0 ? (
                <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2 leading-snug">
                  Todavía no pudimos leer en qué activos podés pagar. Probá de nuevo
                  en un momento.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {options.map((option: PayableOption) => {
                    const active = option.key === chosen?.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => choose(option.key)}
                        aria-pressed={active}
                        className={`px-3.5 py-2 rounded-full text-xs font-bold active:scale-95 transition-all cursor-pointer border ${
                          active
                            ? 'bg-black text-[#ccff00] border-black'
                            : 'bg-white text-black border-slate-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-1" />

            <button
              type="button"
              onClick={pay}
              disabled={chain === null || chosen === null}
              className="w-full py-4 rounded-2xl bg-[#ccff00] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Pagar U$ {asDisplay(charge.amount)}
            </button>

            <p className="text-[11px] font-semibold text-slate-400 text-center leading-snug">
              {chain === null
                ? 'Ese activo todavía no se puede pagar desde la app.'
                : 'Vas a firmar en tu wallet. El pago es de un solo uso.'}
            </p>
          </>
        )}

        {alreadySettled && (
          <button
            type="button"
            onClick={onClose}
            className="w-full py-4 rounded-2xl bg-black text-[#ccff00] font-extrabold text-sm active:scale-95 transition-transform cursor-pointer"
          >
            Volver
          </button>
        )}
      </div>
    </div>
  );
};
