import React, { useMemo, useState } from 'react';
import { ArrowLeft, ShieldCheck, Loader2 } from 'lucide-react';

import { DepositToPoolModal } from './DepositToPoolModal';
import { formatAmount, formatPercent, projectYearlyGain } from '../../services/pool';
import {
  venueRowsOf,
  YIELD_VENUE_CHAINS,
  type WalletBalanceChain,
  type YieldVenueView,
} from '../../services/walletBalance';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';
import type { PoolScreenView } from '../../hooks/usePool';
import type { PoolAmount, PoolField } from '../../services/pool';
import { usePoolDeposit, type PoolDeposit } from '../../hooks/usePoolDeposit';

/**
 * EL VENUE PARA EL QUE ESTA PANTALLA TIENE UN FLUJO DE DEPÓSITO.
 *
 * No es una lista de venues con botón —esa lista la da el servidor, en
 * `depositReady`, y por eso la fila no la escribe—: es el nombre del flujo que
 * existe. Hoy hay un solo flujo (`usePoolDeposit` arma approve + deposit contra
 * el pool de Aave en Monad), y su fila es la única que puede abrirlo. Cuando el
 * servidor marque otro venue como listo, esta fila sigue de ser la única con
 * botón hasta que ese flujo exista: abrir el flujo de otro venue es la forma
 * corta de mover plata en una cadena que no es la de la fila.
 */
const DEPOSIT_FLOW_VENUE_KEY = 'invest.aave_v3_usdc_monad';

/**
 * Los pasos del flujo que piden una firma: aprobar y depositar.
 *
 * Se cuentan del propio flujo (`flow.steps`) y no de un número escrito acá, para
 * que el aviso y el flujo no puedan desincronizarse: si mañana el depósito deja
 * de pedir `approve` porque el allowance ya está dado, el rótulo baja solo.
 */
const signatureSteps = (flow: PoolDeposit): number =>
  flow.steps.filter((entry) => entry.id === 'approve' || entry.id === 'deposit').length;

interface AavePoolsViewProps {
  onBack: () => void;
  /** La lectura del pool, hecha una vez por sesión en el `App`. */
  pool: PoolScreenView;
  /**
   * El balance completo, también leído una vez por sesión en el `App`. Trae una
   * fila por lugar donde el dinero rinde: sin él, esta tarjeta sólo puede hablar
   * de Aave y fingir que es todo.
   */
  balance: WalletBalanceScreenView;
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
 * - Una reserva ilegible **no** muestra `0%`: deja el hueco con su guion. Un
 *   `0%` de rendimiento es una afirmación sobre plata que la persona no tiene.
 * - La proyección anual lleva la palabra "estimación", dice **en Aave** —porque
 *   es la proyección de Aave, no de toda la billetera— y la frase de que el ritmo
 *   cambia. No es una promesa: es aritmética sobre el APR de este momento.
 * - La posición se lista **por lugar**: una fila por cada venue legible del
 *   balance, con su nombre y su cifra exacta. Un cero se muestra como cero; un
 *   lugar que no se pudo leer no se dibuja.
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

export const AavePoolsView: React.FC<AavePoolsViewProps> = ({ onBack, pool, balance, onReload }) => {
  const [depositVenueKey, setDepositVenueKey] = useState<string | null>(null);
  const flow: PoolDeposit = usePoolDeposit(onReload);

  const view = pool.pool;
  const supplyApr = view?.displayableSupplyApr ?? null;
  const borrowApr = view?.apr.borrow.status === 'ok' ? view.apr.borrow.value ?? null : null;
  const position = view?.position.aTokenBalance;

  /*
   * TU POSICIÓN ES DE TODOS LOS LUGARES, NO DE UNO, Y EL BOTÓN ES DE CADA FILA.
   *
   * Esta tarjeta se llama "Tu dinero" y antes listaba una sola fila: lo depositado
   * en Aave. El detalle de Aave tiene su propia lectura, y esa fila se queda como
   * respaldo para cuando todavía no llegó el balance —sin él, la tarjeta se
   * dibujaría vacía por culpa de otra lectura que aún no terminó, y eso no es
   * verdad sobre el dinero de nadie.
   *
   * El botón de depósito **no** está en la tarjeta de arriba: está acá, en la fila
   * de su venue. La fila *es* el destino, y por eso no hay un paso de elegir
   * destino: tocás donde está tu plata y sabés a dónde va. Antes había un botón
   * de ancho completo con un destino compilado en el código, y nadie elegía nada.
   *
   * Y la fila **no** dibuja botón por decisión propia: `venueRowActionOf` pregunta
   * al servidor (`depositReady`) y al saldo de origen (`depositable`), y lo que no
   * se pudo leer no se dibuja. Esa decisión es lógica pura y tiene pruebas sin
   * DOM; acá sólo se pinta lo que ella devuelve.
   */
  const yieldView = balance?.yield ?? null;
  const rows = useMemo(() => {
    if (yieldView === null) return [];
    const all = venueRowsOf(yieldView.venues, YIELD_VENUE_CHAINS, DEPOSIT_FLOW_VENUE_KEY);
    /*
     * Un venue que no se pudo leer **no se dibuja**: es la regla de esta app —lo
     * que no se pudo leer no se muestra, y cuando se vuelve a poder leer aparece—
     * y la fila de un balance entero no es el lugar para escribir "no pudimos
     * leer". Su decisión de botón tampoco dependería de él: no hay botón sin un
     * saldo de origen legible.
     */
    return all.filter((row) => row.venue === null || row.venue.status === 'ok');
  }, [yieldView]);

  const signatures = signatureSteps(flow);

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
        {/*
          ESTA TARJETA NO TIENE BOTÓN, Y ES A PROPÓSITO.
          El depósito se hace desde la fila de su venue, en "TU POSICIÓN": la fila
          *es* el destino. Un botón de ancho completo acá tenía el destino
          compilado en el código —el servidor decidía a dónde iba la plata y nadie
          preguntaba—, y además ponía el mismo botón a un lado de una lista donde
          hay más de un lugar. La acción se mudó de tarjeta; no quedó una copia.
        */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3 border border-slate-100">
          {pool.status === 'loading' || pool.status === 'idle' ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Leyendo el pool…
            </div>
          ) : supplyApr === null ? (
            /*
             * La reserva no se pudo leer: no hay cifra y no hay cartel que lo
             * explique. Un `0%` sería una afirmación sobre plata que la persona
             * no tiene, así que se deja el hueco con su guion y se sigue. La
             * lectura vuelve sola en la próxima.
             */
            <div className="flex items-baseline">
              <span className="text-4xl sm:text-[42px] font-black font-display tracking-tight text-slate-300">—</span>
            </div>
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
        </div>

        {/* CARD 2: TU POSICIÓN */}
        <div className="bg-white rounded-[28px] p-5 shadow-xs space-y-3.5 border border-slate-100">
          <span className="text-xs font-bold text-slate-600 tracking-wider uppercase font-display">
            TU POSICIÓN
          </span>

          {/*
            UNA FILA POR RED, Y CADA FILA CON SU PROPIA DECISIÓN.

            Las redes salen del catálogo de la app, las venues del balance, y la
            decisión de dibujar botón la toma `venueRowActionOf` a partir de lo que
            dijo el servidor. El resultado de esa decisión es una frase que se
            pinta **tal cual**: el motivo vive en el servicio y no en el JSX, para
            que agregar un caso nuevo no sea agregar un texto suelto en una vista.
          */}
          {rows.length > 0 ? (
            rows.map((row) => {
              const action = row.action;
              const venue = row.venue;
              const venueBalance = venue !== null && venue.status === 'ok' ? venue.balance : null;
              return (
              <div key={row.chain} className="py-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">
                    {venue === null ? row.chainLabel : venue.label}
                  </span>
                  {/*
                    Una red sin venue no muestra cifra: no hay nada que valuar
                    todavía. Decir `U$0,00` ahí sería una afirmación sobre plata que
                    nadie depositó en ningún lado.
                  */}
                  {venueBalance === null ? (
                    <span className="text-xs font-bold text-slate-400">sin destino</span>
                  ) : (
                    <span
                      className={`text-xs font-bold ${
                        venueBalance.isZero ? 'text-slate-400' : 'text-slate-800'
                      }`}
                    >
                      {`U$${venueBalance.formatted}`}
                    </span>
                  )}
                </div>

                {/*
                  EL BOTÓN, O LA FRASE DE POR QUÉ NO.

                  No hay una variante “deshabilitado” ni un “próximamente”: si la
                  fila no puede recibir el depósito, no dibuja botón. Un botón que
                  se pinta y después falla en la red principal es peor que un botón
                  que todavía no existe —y eso lo decidió el owner cuando la
                  instrucción del farm de Kamino quedó sin verificar—.
                */}
                {action.kind === 'deposit' ? (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => setDepositVenueKey(action.venueKey)}
                      type="button"
                      disabled={busy}
                      className="px-4 py-2 rounded-full bg-black text-[#ccff00] font-bold text-xs disabled:bg-slate-200 disabled:text-slate-400 active:scale-[0.99] transition-all"
                    >
                      {busy ? 'Esperando tu firma…' : 'Depositar'}
                    </button>
                    {/*
                      Las dos firmas se dicen **antes** de la primera. Nadie
                      debería descubrir encima que el depósito necesita un approve y
                      un deposit, y por eso el número sale del propio flujo.
                    */}
                    {signatures > 1 && (
                      <span className="text-[10px] font-medium text-slate-500">
                        Son {signatures} firmas: aprobar y depositar
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] leading-relaxed text-slate-500">{action.message}</p>
                )}
              </div>
              );
            })
          ) : (
            <div className="flex items-center justify-between py-1">
              <span className="text-xs font-medium text-slate-700">Depositado (aMonUSDC)</span>
              <PoolAmountCell field={position ?? { status: 'unreadable', reason: 'UNREADABLE' }} prefix="U$" fallback="No se pudo leer" />
            </div>
          )}

          <div className="border-t border-slate-100" />

          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-slate-700">
              En un año en Aave (estimación)
            </span>
            {yearly === null ? (
              <span className="text-xs font-bold text-amber-600">Sin dato</span>
            ) : (
              <span className="text-xs font-extrabold text-emerald-600">+{yearly.label} U$</span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed font-normal pt-1">
            La estimación multiplica tu depósito en Aave por el ritmo de este
            momento. El ritmo cambia con el uso del pool: no es una promesa de
            rendimiento, ni de toda tu billetera.
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

      {/*
        El modal se abre para la fila que se tocó, y sólo existe uno: el flujo de
        depósito de esta pantalla. Que la fila haya sido la que lo abrió es lo que
        hace que el destino sea el que la persona eligió, y no uno compilado.
      */}
      {depositVenueKey === DEPOSIT_FLOW_VENUE_KEY && view !== null && (
        <DepositToPoolModal
          pool={view}
          venue={rows.find((row) => row.venue?.key === depositVenueKey)?.venue ?? null}
          flow={flow}
          onClose={() => setDepositVenueKey(null)}
        />
      )}
    </div>
  );
};
