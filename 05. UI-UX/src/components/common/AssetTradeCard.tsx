/**
 * `AssetTradeCard` — la tarjeta de conversión con las dos hojas de activos.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El par de cableado entre `TradePairCard`, `AssetSheet` y el estado era de unas
 * treinta líneas por pantalla, repetidas en cuatro. Cuatro copias de eso son
 * cuatro lugares donde se puede olvidar una hoja, un `disabledTickers` o un
 * `onMax`, y el síntoma es una pantalla que se comporta distinto de su gemela.
 *
 * Acá está el cableado una vez. La pantalla solo dice qué título va arriba, qué
 * título va abajo y qué número hay en el teclado.
 */

import React, { useRef } from 'react';

import { AssetSheet } from './AssetSheet';
import { TradePairCard } from './TradePairCard';
import type { AssetTrade } from '../../hooks/useAssetTrade';

interface AssetTradeCardProps {
  /** El estado que devuelve `useAssetTrade`. */
  readonly trade: AssetTrade;
  /** Título de la tarjeta de origen: "Quiero usar", "Quiero vender". */
  readonly sourceTitle: string;
  /** Título de la tarjeta de destino: "Para comprar", "Para recibir". */
  readonly destinationTitle: string;
  /**
   * Etiqueta del botón que abre la hoja, para lectores de pantalla.
   *
   * Se pasa porque "Quiero usar" y "Quiero vender" son pares distintos y el
   * announce correcto no se puede adivinar desde el componente.
   */
  readonly sourcePickerLabel: string;
  readonly destinationPickerLabel: string;
}

export const AssetTradeCard: React.FC<AssetTradeCardProps> = ({
  trade,
  sourceTitle,
  destinationTitle,
  sourcePickerLabel,
  destinationPickerLabel,
}) => {
  /*
   * Los disparadores se crean acá, no en la pantalla: las hojas necesitan
   * devolverles el foco al cerrarse, y el elemento que hay que enfocar es
   * justamente este, no uno que la pantalla tendría que mantener en sincronía.
   */
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const destinationTrigger = useRef<HTMLButtonElement>(null);

  return (
    <TradePairCard
      sourceTitle={sourceTitle}
      sourceEquivalent={trade.equivalentText}
      sourceIconBg={trade.source.iconBg}
      sourceIconText={trade.source.glyph}
      sourceTicker={trade.source.ticker}
      sourceAmount={trade.sourceAmountText}
      sourceBalance={trade.sourceBalanceText}
      onSourceMax={trade.setMaxAmount}
      onSelectSourceAsset={() => trade.openSheet('source')}
      sourceAssetSheetOpen={trade.sheetSide === 'source'}
      sourceAssetSheet={
        <AssetSheet
          open={trade.sheetSide === 'source'}
          selected={trade.source.ticker}
          disabledTickers={[trade.destination.ticker]}
          triggerRef={sourceTrigger}
          onSelect={(ticker) => trade.selectAsset('source', ticker)}
          onClose={trade.closeSheet}
        />
      }
      destinationTitle={destinationTitle}
      destinationIconBg={trade.destination.iconBg}
      destinationIconText={trade.destination.glyph}
      destinationTicker={trade.destination.ticker}
      destinationAmount={trade.destinationAmountText}
      destinationBalance={trade.destinationBalanceText}
      onSelectDestinationAsset={() => trade.openSheet('destination')}
      destinationAssetSheetOpen={trade.sheetSide === 'destination'}
      destinationAssetSheet={
        <AssetSheet
          open={trade.sheetSide === 'destination'}
          selected={trade.destination.ticker}
          disabledTickers={[trade.source.ticker]}
          triggerRef={destinationTrigger}
          onSelect={(ticker) => trade.selectAsset('destination', ticker)}
          onClose={trade.closeSheet}
        />
      }
      feeBadgeText="Comisión incluida"
      showInvertButton
      onInvert={trade.invert}
      sourcePickerLabel={sourcePickerLabel}
      destinationPickerLabel={destinationPickerLabel}
    />
  );
};