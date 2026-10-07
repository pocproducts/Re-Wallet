import React from 'react';
import { ChevronDown, RotateCw } from 'lucide-react';

import { FittedNumber } from './FittedNumber';

export interface TradePairCardProps {
  // Origen (Top Card)
  sourceTitle: string;
  /**
   * El equivalente de lo tipeado, en la unidad que el flujo use.
   *
   * Se llama así y no `sourceEquivalentArs` porque en Comprar y Vender el
   * equivalente se muestra en DÓLARES: el nombre viejo ya mentía sobre lo que
   * pinta en pantalla.
   */
  sourceEquivalent?: string;
  sourceIconBg: string;
  sourceIconText: string;
  sourceTicker: string;
  sourceAmount: string;
  sourceBalance: string;
  /**
   * Qué hace el botón MAX del origen.
   *
   * Y **si se muestra**, porque antes no había forma de saberlo: el botón se
   * dibujaba siempre y, cuando el saldo no se había podido leer, pulsarlo no
   * completaba nada. Un control que parece completar el monto y no lo completa
   * es la misma clase de mentira que un botón de "comprar" que no compra, sólo
   * que más chica y más difícil de notar. Se esconde cuando no hay nada que
   * poner, y cuando lo hay pone el saldo real.
   */
  onSourceMax?: () => void;
  /** Abre el selector de activo del origen. Si no viene, el ticker no es táctil. */
  onSelectSourceAsset?: () => void;
  /** Si la hoja del origen está abierta, para el `aria-expanded`. */
  sourceAssetSheetOpen?: boolean;
  /** Nombre accesible del botón del ticker de origen, si es táctil. */
  sourcePickerLabel?: string;
  /**
   * El desplegable del origen, ya armado por el padre.
   *
   * Se pasa como `ReactNode` y no se construye adentro a propósito: la tarjeta no
   * tiene que saber qué es un activo ni qué precios hay, así el mismo
   * componente sirve con una hoja de activos, con otra cosa o sin ninguna.
   */
  sourceAssetSheet?: React.ReactNode;

  // Destino (Bottom Card)
  destinationTitle: string;
  destinationIconBg: string;
  destinationIconText: string;
  destinationTicker: string;
  destinationAmount: string;
  destinationBalance: string;
  /** Abre el selector de activo del destino. Si no viene, el ticker no es táctil. */
  onSelectDestinationAsset?: () => void;
  /** Si la hoja del destino está abierta, para el `aria-expanded`. */
  destinationAssetSheetOpen?: boolean;
  /** Nombre accesible del botón del ticker de destino, si es táctil. */
  destinationPickerLabel?: string;
  /** La hoja de activos del destino, ya armada por el padre. */
  destinationAssetSheet?: React.ReactNode;
  feeBadgeText?: string;

  // Invert button (only for Cambiar/Swap)
  showInvertButton?: boolean;
  isInverted?: boolean;
  onInvert?: () => void;
}

export const TradePairCard: React.FC<TradePairCardProps> = ({
  sourceTitle,
  sourceEquivalent,
  sourceIconBg,
  sourceIconText,
  sourceTicker,
  sourceAmount,
  sourceBalance,
  onSourceMax,
  onSelectSourceAsset,
  sourceAssetSheetOpen = false,
  sourcePickerLabel = 'Elegir activo de origen',
  sourceAssetSheet,
  destinationTitle,
  destinationIconBg,
  destinationIconText,
  destinationTicker,
  destinationAmount,
  destinationBalance,
  onSelectDestinationAsset,
  destinationAssetSheetOpen = false,
  destinationPickerLabel = 'Elegir activo de destino',
  destinationAssetSheet,
  feeBadgeText = 'Comisión incluida',
  showInvertButton = false,
  isInverted = false,
  onInvert,
}) => {
  /*
   * El bloque ticker + chevron es el mismo elemento en las dos tarjetas, y solo
   * se vuelve táctil cuando el padre pasa el handler. Las pantallas que no
   * permiten cambiar el activo (Comprar y Vender del detalle del cripto) siguen
   * recibiendo el chevron decorativo de siempre, sin tocar su markup.
   */
  const renderTicker = (
    ticker: string,
    iconBg: string,
    iconText: string,
    tickerClassName: string,
    onSelect: (() => void) | undefined,
    pickerOpen: boolean,
    label: string,
  ) => {
    const row = (
      <>
        <div
          className={`w-8 h-8 rounded-full ${iconBg} text-white font-bold flex items-center justify-center text-xs shadow-2xs`}
        >
          {iconText}
        </div>
        <div className={`flex items-center gap-1 text-black font-display ${tickerClassName}`}>
          <span>{ticker}</span>
          <ChevronDown className="w-4 h-4 stroke-[2.5]" />
        </div>
      </>
    );

    if (!onSelect) {
      return <div className="flex items-center gap-2">{row}</div>;
    }

    return (
      <button
        type="button"
        onClick={onSelect}
        aria-label={label}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-slate-50 active:scale-95 cursor-pointer"
      >
        {row}
      </button>
    );
  };

  return (
    <div className="space-y-3 w-full">
      {/* TARJETA SUPERIOR (ORIGEN) */}
      <div className="relative bg-white rounded-3xl p-4.5 border border-slate-200/80 shadow-xs space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-600">{sourceTitle}</span>
          {sourceEquivalent && (
            <span className="font-bold text-black flex items-center gap-1 font-mono">
              <span>{sourceEquivalent}</span>
              <span className="text-emerald-500 font-black">⇅</span>
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          {renderTicker(
            sourceTicker,
            sourceIconBg,
            sourceIconText,
            // El origen pesa más que el destino, y es a propósito: es el activo
            // del que se parte. Estos grosores vienen del diseño original.
            'font-extrabold text-lg',
            onSelectSourceAsset,
            sourceAssetSheetOpen,
            sourcePickerLabel,
          )}

          <FittedNumber value={sourceAmount} className="font-black font-display text-black" />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-slate-400 font-medium">
            Saldo: {sourceBalance}
          </span>
          {/*
            Sin MAX no queda nada a la derecha del saldo, y eso está bien: la
            fila se queda con su texto y el peso se va al otro lado. Antes se
            dibujaba el botón siempre y, sin saldo leído, no completaba nada.
          */}
          {onSourceMax && (
            <button
              type="button"
              onClick={onSourceMax}
              className="text-xs font-black text-black uppercase hover:opacity-70 active:scale-95 transition-all cursor-pointer"
            >
              MAX
            </button>
          )}
        </div>

        {sourceAssetSheet}
      </div>

      {/* BOTÓN INVERTIR (OPCIONAL, SOLO PARA SWAP / CAMBIAR) */}
      {showInvertButton && onInvert && (
        <div className="flex justify-center -my-1 z-10 relative">
          <button
            type="button"
            onClick={onInvert}
            title="Invertir monedas"
            aria-label="Invertir monedas"
            className="w-11 h-11 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center shadow-sm active:scale-90 transition-all cursor-pointer"
          >
            <RotateCw
              className={`w-5 h-5 stroke-[2.5] text-emerald-600 transition-transform duration-300 ${
                isInverted ? 'rotate-180 text-black' : 'rotate-0'
              }`}
            />
          </button>
        </div>
      )}

      {/* TARJETA INFERIOR (DESTINO) */}
      <div className="relative bg-white rounded-3xl p-4.5 border border-slate-200/80 shadow-xs space-y-2">
        <span className="font-semibold text-slate-600 text-xs block">
          {destinationTitle}
        </span>

        <div className="flex items-center justify-between pt-1">
          {renderTicker(
            destinationTicker,
            destinationIconBg,
            destinationIconText,
            'font-bold text-base',
            onSelectDestinationAsset,
            destinationAssetSheetOpen,
            destinationPickerLabel,
          )}

          <FittedNumber
            value={destinationAmount}
            className="font-black font-display text-black"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-slate-400 font-medium">
            Saldo: {destinationBalance}
          </span>
          {feeBadgeText && (
            <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold">
              {feeBadgeText}
            </span>
          )}
        </div>

        {destinationAssetSheet}
      </div>
    </div>
  );
};
