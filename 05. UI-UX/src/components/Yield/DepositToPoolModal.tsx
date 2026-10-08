import React, { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, ShieldAlert, Wallet as WalletIcon } from 'lucide-react';

import { NumericKeypad } from '../common/NumericKeypad';
import { toScaled, formatAmount, formatPercent } from '../../services/pool';
import type { PoolAmount, PoolField, PoolView } from '../../services/pool';
import type { YieldVenueView } from '../../services/walletBalance';
import { DEPOSIT_FAILURE_TEXT, type PoolDeposit } from '../../hooks/usePoolDeposit';

/**
 * EL DEPÓSITO EN AAVE, PASO A PASO, Y CON LOS NÚMEROS DE LA CADENA.
 *
 * ── Por qué el monto se pide en la unidad mínima ──────────────────────────────
 *
 * El backend recibe el importe entero (`"1000000"`) y construye las transacciones
 * con él. La pantalla pide un número con coma, lo convierte **una vez** con
 * enteros y manda texto. Un monto que no entra entero en seis decimales se
 * rechaza acá, con una frase, en vez de llegar al backend y ser rechazado allí sin
 * que la persona entienda por qué.
 *
 * ── Por qué los estados van antes de la firma ────────────────────────────────
 *
 * "No tenés USDC" y "no tenés MON para el gas" se dicen **antes** de que la
 * persona firme nada. Después de firmar, un cartel de error es un problema;
 * antes, es una frase. Lo que no se pudo leer ya no se anuncia con una caja: la
 * acción que dependía de esa cifra simplemente no se habilita, y el rótulo
 * deshabilitado ya lo dice.
 *
 * ── Por qué el gas es un estado y no un detalle ───────────────────────────────
 *
 * El depósito es **mainnet**: sin MON no hay transacción, por más USDC que haya.
 * Es el estado que más veces convierte un "no se pudo" en un "no había MON", y por
 * eso tiene su propio cartel y no comparte sitio con el saldo.
 */

interface DepositToPoolModalProps {
  readonly pool: PoolView;
  /**
   * La fila que se tocó, que es el destino.
   *
   * Antes este modal era “el depósito de Aave” con el destino dentro del código.
   * Ahora lo recibe: el nombre del lugar y su saldo de origen viajan desde la fila
   * que la persona tocó, y no de un rótulo escrito acá. `null` sólo cuando la fila
   * se cerró antes de que llegara el balance, y en ese caso se usan los del pool.
   */
  readonly venue: YieldVenueView | null;
  readonly flow: PoolDeposit;
  readonly onClose: () => void;
}

const MAX_DIGITS_BEFORE_DECIMAL = 12;

export const DepositToPoolModal: React.FC<DepositToPoolModalProps> = ({ pool, venue, flow, onClose }) => {
  const [amountText, setAmountText] = useState<string>('');

  const decimals = pool.asset.decimals;

  /*
   * El estado de las tres cosas que tienen que ser ciertas antes de firmar. Se
   * calculan del `PoolView` y de la fila, no del estado del flujo: lo que no se
   * pudo leer no habilita un botón.
   *
   * El **saldo de origen** viene de la fila (`depositable`), que es el USDC libre
   * de la cadena de ese venue. Antes venía de `pool.position.availableUsdc`: dos
   * lecturas del mismo número en el mismo formulario, y dos chances de que no
   * sean el mismo. El gas sigue viniendo del pool porque es del chain de la
   * transacción, y no hay un campo de red en la fila que lo traiga.
   */
  const available: PoolField<PoolAmount> =
    venue === null
      ? pool.position.availableUsdc
      : venue.depositable.status === 'ok'
        ? {
            status: 'ok',
            value: {
              raw: venue.depositable.amount.raw.toString(),
              amount: venue.depositable.amount.formatted,
              decimals: venue.depositable.amount.decimals,
              unit: venue.depositable.amount.unit,
            },
          }
        : { status: 'unreadable', reason: venue.depositable.reason };
  const gas = pool.position.gasBalance;
  const supplyApr = pool.displayableSupplyApr;

  /*
   * El rótulo dice el lugar de verdad. Antes decía “Aave · Monad” escrito en el
   * componente, que es exactamente el destino compilado en el cliente que este
   * flujo vino a sacar.
   */
  const title = venue === null ? 'Depositar' : `Depositar en ${venue.label}`;
  const subtitle =
    venue === null ? 'USDC en el pool de Aave · Monad' : 'Tocaste esta fila: acá va tu plata';

  const availableRaw = available.status === 'ok' ? BigInt(available.value?.raw ?? '0') : null;
  const hasUsdc = availableRaw !== null && availableRaw > 0n;
  const hasGas = gas.status === 'ok' && BigInt(gas.value?.raw ?? '0') > 0n;

  const amountError = useMemo((): string | null => {
    if (amountText.length === 0) return null;
    const normalized = amountText.replace(',', '.');
    if (!/^\d*(\.\d*)?$/.test(normalized)) return 'El monto no es un número válido.';
    const [, fraction = ''] = normalized.split('.');
    if (fraction.length > decimals) return `USDC tiene ${decimals} decimales: no podés poner más.`;
    if (amountText.replace(/[^\d]/g, '').length > MAX_DIGITS_BEFORE_DECIMAL) {
      return 'Ese monto es demasiado grande.';
    }
    if (availableRaw !== null && decimals >= 0) {
      let raw = 0n;
      try {
        raw = toScaled(normalized, decimals);
      } catch {
        return 'El monto no es un número válido.';
      }
      if (raw > availableRaw) return 'No tenés tanto USDC disponible.';
      if (raw === 0n) return 'El monto tiene que ser mayor que cero.';
    }
    return null;
  }, [amountText, decimals, availableRaw]);

  const amountRaw = useMemo((): string | null => {
    if (amountError !== null) return null;
    if (amountText.length === 0) return null;
    try {
      const raw = toScaled(amountText.replace(',', '.'), decimals);
      return raw > 0n ? raw.toString() : null;
    } catch {
      return null;
    }
  }, [amountText, decimals, amountError]);

  const onKey = (key: string): void => {
    setAmountText((current) => {
      if (key === 'backspace') return current.slice(0, -1);
      if (key === ',' && current.includes(',')) return current;
      if (key === ',' && current.length > 0) return `${current},`;
      if (current.replace(/[^\d]/g, '').length >= MAX_DIGITS_BEFORE_DECIMAL) return current;
      return `${current}${key}`;
    });
  };

  const depositEverything = available.status === 'ok' ? available.value?.amount ?? '' : '';

  const busy = flow.phase === 'preparing' || flow.phase === 'signing';

  return (
    <div className="absolute inset-0 z-[70] bg-[#f3f4f6] flex flex-col safe-top-0 safe-bottom-0 font-sans animate-in fade-in duration-200">
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 shrink-0">
        <button
          onClick={busy ? () => undefined : onClose}
          type="button"
          aria-label="Volver atrás"
          disabled={busy}
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-slate-800 shadow-2xs border border-slate-200/60 disabled:opacity-40"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <div>
          <h1 className="text-base font-bold font-display text-slate-900 leading-tight">{title}</h1>
          <p className="text-[11px] text-slate-500 font-medium">{subtitle}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {/* El monto, y lo que hay disponible. */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs border border-slate-100 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black font-display tracking-tight text-slate-900">
              {amountText.length === 0 ? '0' : amountText}
            </span>
            <span className="text-sm font-semibold text-slate-500">USDC</span>
          </div>

          {/*
            "Tenés disponible" existe para pintar una cifra que se pudo leer. Si
            no se leyó, la fila no se dibuja: un `No pudimos leerlo` al lado de
            un número que no está es ruido, y la fila ya estaba honestamente
            ausente.
          */}
          {available.status === 'ok' && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Tenés disponible</span>
              <span className="font-bold text-slate-800">
                {formatAmount(BigInt(available.value?.raw ?? '0'), decimals, 'U$')}
              </span>
            </div>
          )}

          {/*
            "Depositar todo" con la cifra exacta que dijo la cadena: sin centavos
            inventados y sin redondeo. Si el saldo no se pudo leer, el botón
            desaparece en vez de ofrecer un "todo" que no existe.
          */}
          {available.status === 'ok' && hasUsdc && (
            <button
              type="button"
              onClick={() => setAmountText(depositEverything)}
              className="w-full py-2 rounded-full bg-slate-100 text-slate-700 font-bold text-xs active:scale-[0.99] transition-all"
            >
              Depositar todo lo disponible
            </button>
          )}

          {amountError !== null && (
            <p className="text-xs font-medium text-amber-600 leading-snug">{amountError}</p>
          )}

          {available.status === 'ok' && !hasUsdc && (
            <div className="bg-[#f8f9fa] rounded-2xl p-3 text-[11px] text-slate-600 leading-relaxed">
              No tenés USDC libre en esta billetera. Con cero USDC no hay depósito
              posible, y eso no es un error: es que todavía no hay nada acá.
            </div>
          )}

          {/*
            El botón de abajo sigue deshabilitado sin la cifra —eso es un hecho
            sobre la acción—, pero acá ya no se lo anuncia: el rótulo deshabilitado
            alcanza y no hace falta repetir el motivo en una caja aparte.
          */}
        </div>

        {/* El gas, dicho antes de firmar y no después. */}
        {/*
          El gas.

          Cero MON es un hecho verdadero y se dice: sin gas no hay transacción,
          y eso hay que explicarlo. Si lo que no se pudo leer es la cifra, en
          cambio, el botón de abajo ya queda deshabilitado —guarda real— y el
          motivo se alcanza a leer en el rótulo: no se abre otra caja de aviso.
        */}
        {gas.status === 'ok' && !hasGas && (
          <div className="bg-amber-50 rounded-[24px] p-4 flex gap-3 items-start">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-800">No tenés MON para el gas</p>
              <p className="text-[11px] text-amber-700 leading-relaxed mt-1">
                El depósito ocurre en la red principal de Monad y necesita MON para
                pagar cada transacción, aunque el monto sea de USDC. Con cero MON no
                hay depósito: no es un problema del monto.
              </p>
            </div>
          </div>
        )}

        {/* La tasa que se va a ver. Si no se pudo leer, se dice. */}
        <div className="bg-white rounded-[24px] p-4 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Rendimiento actual del pool</span>
            <span
              className={`text-sm font-extrabold ${
                supplyApr === null ? 'text-slate-300' : 'text-slate-900'
              }`}
            >
              {supplyApr === null ? '—' : formatPercent(supplyApr)}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mt-2">
            Es el ritmo de este momento. Cambia con el uso del pool y no es una
            promesa de lo que vas a ganar.
          </p>
        </div>

        {/* Los pasos, uno por uno. */}
        {flow.phase !== 'idle' && (
          <div className="bg-white rounded-[24px] p-4 border border-slate-100 space-y-2">
            {flow.steps.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-600 flex items-center gap-2">
                  {entry.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {entry.label}
                </span>
                <span
                  className={`text-[11px] font-bold ${
                    entry.status === 'failed'
                      ? 'text-amber-600'
                      : entry.status === 'signed'
                        ? 'text-emerald-600'
                        : 'text-slate-300'
                  }`}
                >
                  {entry.status === 'signed'
                    ? 'listo'
                    : entry.status === 'failed'
                      ? 'falló'
                      : entry.status === 'running'
                        ? 'en curso'
                        : 'esperando'}
                </span>
              </div>
            ))}
          </div>
        )}

        {flow.phase === 'failed' && flow.failureCode !== null && (
          <div className="bg-amber-50 rounded-[24px] p-4">
            <p className="text-xs font-bold text-amber-800">El depósito no se completó</p>
            <p className="text-[11px] text-amber-700 leading-relaxed mt-1">
              {DEPOSIT_FAILURE_TEXT[flow.failureCode] ?? 'No pudimos completar el depósito.'}
            </p>
          </div>
        )}

        {flow.phase === 'done' && (
          <div className="bg-emerald-50 rounded-[24px] p-4 flex gap-3 items-start">
            <WalletIcon className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              Las dos transacciones se enviaron y tu posición se volvió a leer de la
              cadena. Lo que ves ahora arriba es lo que dijo el pool, no lo que
              calculamos nosotros.
            </p>
          </div>
        )}
      </div>

      {/* Teclado y botón. */}
      <div className="shrink-0 px-4 pb-4 bg-white border-t border-slate-100 safe-bottom-2">
        <NumericKeypad onKeyPress={onKey} className="pt-3 pb-1" />

        <button
          type="button"
          disabled={amountRaw === null || !hasGas || available.status !== 'ok' || busy}
          onClick={() => {
            if (amountRaw === null) return;
            void flow.deposit(amountRaw);
          }}
          className="w-full py-3.5 rounded-full bg-black text-[#ccff00] font-bold text-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed active:scale-[0.99] transition-all"
        >
          {busy ? 'Esperando tu firma…' : 'Depositar en Aave'}
        </button>
      </div>
    </div>
  );
};
