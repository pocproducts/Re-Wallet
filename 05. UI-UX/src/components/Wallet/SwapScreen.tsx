/**
 * LA PANTALLA DEL SWAP.
 *
 * ── Por qué sigue el estándar de Uniswap ────────────────────────────────────
 *
 * Porque "Comprar" y "Vender" como dos pantallas espejadas no quedaban claras.
 * El patrón que el estándar probó es uno solo: **un** panel de salida, **un**
 * panel de entrada, un botón circular que invierte la dirección, la cotización
 * debajo, el detalle del contrato y un único botón de acción. Es la anatomía de
 * `src/components/Swap/` de `@uniswap/widgets` (Input → ReverseButton → Output
 * → Toolbar → SwapActionButton), adaptada a este teléfono.
 *
 * ── Qué es real y qué no ─────────────────────────────────────────────────────
 *
 * En `beta.rewallet.win` y en el servidor local todo es una **simulación**, y la
 * pantalla lo dice en un cartel: el precio lo inventa `quoteSwapMock` y el botón
 * no firma nada. En `app.rewallet.win` la cotización sale del backend real
 * (`POST /api/wallet/swap/quote`) y el botón sigue siendo una simulación del
 * evento, porque la firma real —Permit2 + `/api/wallet/swap/execute`— todavía
 * no existe en el front. La distinción exacta la decide `isSwapMockEnabled()`,
 * en un solo lugar.
 *
 * ── Qué no se muestra y por qué ─────────────────────────────────────────────
 *
 * El estándar de Uniswap lista price impact, fee de red y ruta. El backend hoy
 * no los entrega por HTTP, así que la pantalla no tiene esas filas: una cifra
 * que la pantalla se inventara para "completar" el estándar sería exactamente
 * el tipo de mentira que esta app se comprometió a no contar.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Settings } from 'lucide-react';

import { AssetTradeCard } from '../common';
import { useAssetTrade, useTradeCatalog } from '../../hooks/useAssetTrade';
import type { QuoteFailure as SwapQuoteFailure } from '../../services/swap';
import { isSwapMockEnabled, quoteSwapMock } from '../../services/swap';
import type { DepositInfoView } from '../../hooks/useDepositInfo';
import type { PortfolioHolding } from '../../services/portfolio';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';

/** Comprar es salir de dólares; vender es volver a ellos. */
export type SwapDirection = 'buy' | 'sell';

interface SwapScreenProps {
  readonly direction: SwapDirection;
  readonly onBack: () => void;
  readonly depositInfo: DepositInfoView;
  readonly holdings: readonly PortfolioHolding[];
  readonly balance?: WalletBalanceScreenView;
}

/*
 * Los presets de tolerancia al deslizamiento.
 *
 * 0,5% es el "Auto" del estándar. 0,1% y 1% son los dos extremos razonables: la
 * cotización viaja con el valor elegido, así que el control no es cosmético.
 */
const SLIPPAGE_PRESETS: ReadonlyArray<{ readonly bips: number; readonly label: string }> = [
  { bips: 10, label: '0,1%' },
  { bips: 50, label: '0,5%' },
  { bips: 100, label: '1%' },
];

/*
 * Cada forma de "no hay precio" explica la causa real.
 *
 * No hay una frase genérica: el vuelo de "algo falló" le miente a la persona,
 * porque "sin mercado" y "sin red" implican decisiones distintas. El código lo
 * trae el backend discriminado para esto, y la prosa es nuestra.
 */
const FAILURE_TEXT: Record<SwapQuoteFailure, string> = {
  NETWORK_UNAVAILABLE: 'No pudimos preguntar el precio: la red no respondió. Probá de nuevo.',
  NO_ROUTE: 'Ese par no tiene mercado hoy.',
  NOT_ENOUGH_LIQUIDITY: 'No hay liquidez suficiente para ese monto.',
  NOT_CONFIGURED: 'La cotización de este par no está configurada en este despliegue.',
};

export const SwapScreen: React.FC<SwapScreenProps> = ({
  direction,
  onBack,
  depositInfo,
  holdings,
  balance,
}) => {
  const [amountText, setAmountText] = useState('0');
  const [slippageBips, setSlippageBips] = useState(50);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [simulatedId, setSimulatedId] = useState<string | null>(null);

  const catalog = useTradeCatalog({ depositInfo, holdings, balance });

  const trade = useAssetTrade({
    amountText,
    setAmountText,
    catalog,
    slippageBips,
    quoteSwap: isSwapMockEnabled() ? quoteSwapMock : undefined,
  });

  /*
   * La dirección se fija un movimiento, no un estado persistente.
   *
   * El par por defecto lo resuelve el catálogo (dólares → primera cripto), que
   * hace la cotización real posible sólo cuando las dos filas son de Monad. Un
   * "vender" es el mismo par al revés, así que tras el montaje se invierte una
   * vez y punto. No hay identidades escribidas a mano: la lista que la persona
   * ve es siempre la que el backend respaldó.
   */
  const appliedDirection = useRef(false);
  useEffect(() => {
    if (appliedDirection.current) return;
    appliedDirection.current = true;
    if (direction === 'sell') trade.invert();
    // La inversión vlad el par; re-agregar `trade` reinicia el ciclo por diseño.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  const mockQuote = isSwapMockEnabled();

  const handleKeypadPress = (val: string) => {
    if (val === 'backspace') {
      setAmountText((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
    } else if (val === ',') {
      if (!amountText.includes(',')) setAmountText((prev) => `${prev},`);
    } else {
      setAmountText((prev) => (prev === '0' ? val : prev + val));
    }
  };

  const handleSimulate = () => {
    /*
     * No hay firma y no hay transacción: lo único que pasa es un aviso.
     *
     * El identificador sale con el prefijo `simulado-` y no como 64 hex. Uno
     * que empiece con `0x` ya se lee como un hash, y acá no hubo ninguno.
     */
    const id = `simulado-${Math.random().toString(36).slice(2, 10)}`;
    window.dispatchEvent(
      new CustomEvent('mock-swap-executed', { detail: { simulated: true, simulatedId: id } }),
    );
    setSimulatedId(id);
  };

  const hasQuote = trade.equivalentText !== '';
  const amountIsZero = parseFloat(amountText.replace(',', '.')) === 0 || amountText === '0';

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f8f9fa] select-none">
      {/* 1. Header: atrás, título, ajustes */}
      <div className="p-4 pt-5 max-[360px]:p-3 max-[360px]:pt-3 max-[360px]:pb-2 [@media(max-height:620px)]:pt-2 [@media(max-height:620px)]:pb-1 flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          type="button"
          aria-label="Volver"
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h2 className="text-base font-extrabold font-display text-black">Cambiar</h2>
        <button
          onClick={() => setSettingsOpen((open) => !open)}
          type="button"
          aria-label="Ajustes del swap"
          className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
        >
          <Settings className="w-5 h-5 stroke-[2.2]" />
        </button>
      </div>

      {/* El aviso de simulación va primero: es el marco de todo lo que sigue. */}
      <div className="px-5 max-[360px]:px-3 max-w-sm mx-auto w-full">
        {mockQuote ? (
          <p className="text-center text-xs font-extrabold uppercase tracking-wide leading-relaxed text-amber-900 bg-amber-100 rounded-2xl border-2 border-amber-500 px-4 py-3">
            Cotización simulada: datos falsos, no mueve dinero
          </p>
        ) : (
          <p className="text-center text-xs font-extrabold uppercase tracking-wide leading-relaxed text-amber-900 bg-amber-100 rounded-2xl border-2 border-amber-500 px-4 py-3">
            La cotización es real. El botón simula la operación: no mueve dinero
          </p>
        )}
      </div>

      {settingsOpen && (
        <div className="px-5 pt-3 max-[360px]:px-3 max-w-sm mx-auto w-full">
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">Deslizamiento máximo</p>
            <div className="flex gap-2">
              {SLIPPAGE_PRESETS.map((preset) => (
                <button
                  key={preset.bips}
                  type="button"
                  onClick={() => setSlippageBips(preset.bips)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                    slippageBips === preset.bips
                      ? 'bg-black text-[#ccff00]'
                      : 'bg-slate-100 text-black hover:bg-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              Si el precio se mueve más que eso contra vos, la operación no se hace.
            </p>
          </div>
        </div>
      )}

      {/* 2. Los dos paneles, con el inversor al medio — el corazón del estándar. */}
      <div className="px-5 pt-3 max-[360px]:px-3 max-w-sm mx-auto w-full">
        <AssetTradeCard
          trade={trade}
          sourceTitle="Pagás"
          destinationTitle="Recibí"
          sourcePickerLabel="Elegir la moneda con la que querés pagar"
          destinationPickerLabel="Elegir la moneda que querés recibir"
        />
      </div>

      {/* 3. El detalle del contrato: sólo filas con un número que se pueda sostener. */}
      <div className="px-5 pt-3 max-[360px]:px-3 max-w-sm mx-auto w-full">
        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-1 divide-y divide-slate-100">
          <div className="flex items-center justify-between py-3">
            <span className="text-xs font-semibold text-slate-500">Precio</span>
            <span className="text-xs font-bold text-black">
              {hasQuote ? trade.equivalentText : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-xs font-semibold text-slate-500">Mínimo recibido</span>
            <span className="text-xs font-bold text-black">
              {hasQuote ? `${trade.minimumReceivedText} ${trade.destination.ticker}` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-xs font-semibold text-slate-500">Deslizamiento máximo</span>
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              className="text-xs font-bold text-black underline underline-offset-2 cursor-pointer"
            >
              {(slippageBips / 100).toLocaleString('es-AR')}%
            </button>
          </div>
        </div>
      </div>

      {/* 4. El fracaso se dice con su causa, no con un guion. */}
      {trade.quoteFailure !== null && !amountIsZero && (
        <div className="px-5 pt-3 max-[360px]:px-3 max-w-sm mx-auto w-full">
          <p className="text-center text-xs font-semibold leading-relaxed text-slate-500 bg-white rounded-2xl border border-slate-200 px-4 py-3">
            {FAILURE_TEXT[trade.quoteFailure]}
          </p>
        </div>
      )}

      {/* 5. Un solo botón de acción, con el texto honesto de lo que hace. */}
      <div className="px-5 pt-3 max-[360px]:px-3 max-[360px]:pt-2 max-w-sm mx-auto w-full">
        {simulatedId !== null ? (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 text-center space-y-1">
            <p className="text-xs font-bold text-black">
              Simulación registrada: {simulatedId}
            </p>
            <p className="text-xs text-slate-500">No se movió dinero.</p>
            <button
              type="button"
              onClick={() => setSimulatedId(null)}
              className="text-xs font-bold text-black underline underline-offset-2 pt-1 cursor-pointer"
            >
              Volver a cotizar
            </button>
          </div>
        ) : amountIsZero ? (
          <button
            type="button"
            disabled
            className="w-full py-3.5 rounded-2xl bg-slate-200 text-slate-400 font-bold text-sm"
          >
            Ingresá un monto
          </button>
        ) : hasQuote ? (
          <button
            type="button"
            onClick={handleSimulate}
            className="w-full py-3.5 rounded-2xl bg-black text-white font-bold text-sm cursor-pointer active:scale-95 transition-all shadow-md hover:bg-slate-900"
          >
            Simular el swap (no mueve dinero)
          </button>
        ) : null}
      </div>

      {/* 6. El teclado: crece con la pantalla para no dejar hueco muerto. */}
      <div className="flex-1 flex flex-col px-5 pt-3 pb-6 max-[360px]:px-3 space-y-3 [@media(max-height:620px)]:pt-2 [@media(max-height:620px)]:pb-3 max-w-sm mx-auto w-full">
        <div className="grid grid-cols-3 gap-1.5 pt-1 flex-1 min-h-[212px] [@media(max-height:620px)]:min-h-[152px] auto-rows-fr">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => handleKeypadPress(k)}
              className="h-full py-3 [@media(max-height:620px)]:py-1.5 bg-white hover:bg-slate-100 rounded-xl font-display font-extrabold text-base text-black active:scale-95 transition-all shadow-2xs flex items-center justify-center cursor-pointer"
            >
              {k === 'backspace' ? <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> : k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
