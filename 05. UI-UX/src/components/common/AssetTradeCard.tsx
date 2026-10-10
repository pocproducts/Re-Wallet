/**
 * `AssetTradeCard` — la tarjeta de conversión con las dos hojas de activos.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El par de cableado entre `TradePairCard`, `AssetSheet` y el estado era de unas
 * treinta líneas por pantalla, repetidas en cuatro. Cuatro copias de eso son
 * cuatro lugares donde se puede olvidar una hoja, un `disabledKeys` o un
 * `onMax`, y el síntoma es una pantalla que se comporta distinto de su gemela.
 *
 * Acá está el cableado una vez. La pantalla solo dice qué título va arriba, qué
 * título va abajo y qué número hay en el teclado.
 *
 * ── Por qué esta tarjeta no sabe qué activos existen ────────────────────────
 *
 * Recibe filas que ya traen su red, su saldo y su precio, y sólo las muestra.
 * Antes tomaba la lista de una hoja que caía en un catálogo escrito a mano, así
 * que esta tarjeta terminaba siendo la razón por la que BTC y TRX aparecían en
 * una app que no puede moverlos. Saber qué se puede tradear es del backend.
 *
 * ── Por qué no se pasa etiqueta de comisión ─────────────────────────────────
 *
 * La tarjeta tenía `feeBadgeText="Comisión incluida"`, y eso es una afirmación
 * sobre una operación que todavía no se puede hacer: sin motor no hay comisión,
 * ni incluida ni de ningún tipo. La pastilla vuelve cuando exista una
 * cotización real que la declare.
 */

import React, { useRef } from 'react';

import { AssetSheet } from './AssetSheet';
import { TradePairCard } from './TradePairCard';
import type { AssetTrade } from '../../hooks/useAssetTrade';
import type { TradeAssetRow } from '../../types/trade.types';

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
  /**
   * Las filas de la hoja, si la pantalla las tiene.
   *
   * Por defecto salen de `trade.assets`, que es el catálogo real que la pantalla
   * le pasó al hook. Antes esta tarjeta no pasaba nada y la hoja caía en un
   * catálogo escrito a mano; hoy, sin catálogo, la hoja está vacía: es preferible
   * no ofrecer un activo que no existe a ofrecer uno falso.
   */
  readonly assets?: readonly TradeAssetRow[];
}

export const AssetTradeCard: React.FC<AssetTradeCardProps> = ({
  trade,
  sourceTitle,
  destinationTitle,
  sourcePickerLabel,
  destinationPickerLabel,
  assets = trade.assets,
}) => {
  /*
   * Los disparadores se crean acá, no en la pantalla: las hojas necesitan
   * devolverles el foco al cerrarse, y el elemento que hay que enfocar es
   * justamente este, no uno que la pantalla tendría que mantener en sincronía.
   */
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const destinationTrigger = useRef<HTMLButtonElement>(null);

  /*
   * El ticker de la tarjeta nombra también la red.
   *
   * USDC vive en tres redes y una persona puede tenerlo en más de una: un
   * "USDC" suelto en la tarjeta no dice de cuál se está hablando, y el par que
   * se está armando depende justamente de eso. Cuando la fila no tiene red —el
   * respaldo sin catálogo— se muestra el símbolo solo, porque ahí no hay una red
   * que pueda mentir.
   *
   * Ojo con este string: viaja entero ("USDC · Ethereum") hasta `TradePairCard`
   * porque es el texto que la persona lee. El logo del círculo NO lo usa entero:
   * `TradePairCard` corta antes del ` · ` y busca el archivo con el ticker del
   * activo. Esta tarjeta no hace falta que le pase el ticker por separado.
   */
  const tickerOf = (row: TradeAssetRow): string =>
    row.chainLabel === null ? row.ticker : `${row.ticker} · ${row.chainLabel}`;

  return (
    <TradePairCard
      sourceTitle={sourceTitle}
      sourceEquivalent={trade.equivalentText}
      sourceIconBg={trade.source.iconBg}
      sourceIconText={trade.source.glyph}
      sourceTicker={tickerOf(trade.source)}
      sourceAmount={trade.sourceAmountText}
      sourceBalance={trade.sourceBalanceText}
      onSourceMax={trade.canUseMax ? trade.setMaxAmount : undefined}
      onSelectSourceAsset={() => trade.openSheet('source')}
      sourceAssetSheetOpen={trade.sheetSide === 'source'}
      sourceAssetSheet={
        <AssetSheet
          open={trade.sheetSide === 'source'}
          assets={assets}
          selected={trade.source.key}
          disabledKeys={[trade.destination.key]}
          triggerRef={sourceTrigger}
          onSelect={(key) => trade.selectAsset('source', key)}
          onClose={trade.closeSheet}
        />
      }
      destinationTitle={destinationTitle}
      destinationIconBg={trade.destination.iconBg}
      destinationIconText={trade.destination.glyph}
      destinationTicker={tickerOf(trade.destination)}
      destinationAmount={trade.destinationAmountText}
      destinationBalance={trade.destinationBalanceText}
      onSelectDestinationAsset={() => trade.openSheet('destination')}
      destinationAssetSheetOpen={trade.sheetSide === 'destination'}
      destinationAssetSheet={
        <AssetSheet
          open={trade.sheetSide === 'destination'}
          assets={assets}
          selected={trade.destination.key}
          disabledKeys={[trade.source.key]}
          triggerRef={destinationTrigger}
          onSelect={(key) => trade.selectAsset('destination', key)}
          onClose={trade.closeSheet}
        />
      }
      showInvertButton
      onInvert={trade.invert}
      sourcePickerLabel={sourcePickerLabel}
      destinationPickerLabel={destinationPickerLabel}
    />
  );
};