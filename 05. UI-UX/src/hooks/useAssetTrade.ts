/**
 * `useAssetTrade` — el par de activos que se está convirtiendo y todo lo que sale de él.
 *
 * ── Por qué vive en un hook y no en cada pantalla ──────────────────────────
 *
 * Convertir un activo en otro aparece en cuatro pantallas: Comprar y Vender del
 * flujo "Usar", y Comprar y Vender del detalle de un cripto. Antes de este hook,
 * cada una tenía su propio par en el estado, sus propios derivados y sus propias
 * hojas de activos: cuatro copias de la misma aritmética.
 *
 * Y cuatro copias ya produjeron el bug que este hook viene a cerrar: el flujo
 * "Usar" quedó en dólares y con el catálogo de activos, mientras el detalle del
 * cripto seguía en pesos y con el par fijo Bitcoin/Dólares. Dos pantallas que
 * hacen lo mismo, con unidades distintas, enseñan reglas contradictorias a
 * quien las lea.
 *
 * ── El monto es controlado desde el padre ──────────────────────────────────
 *
 * El teclado lo comparte el padre con los flujos de envío, así que el monto se
 * recibe como texto y se devuelve el setter. Es patrón controlado normal, sin
 * refs ni trucos: el hook no es dueño del monto porque no es lo único que lo usa.
 */

import { useCallback, useMemo, useState } from 'react';

import { DEFAULT_DESTINATION, DEFAULT_SOURCE } from '../config/assets';
import { assetOrDefault, balanceLabel, convert, decimalsOf, formatAmount, toUsd } from '../config/markets';
import { formatFiat } from '../config/displayCurrency';
import type { Asset } from '../config/assets';

/** Qué lado de la conversión tiene abierta la hoja de activos. */
export type TradeSide = 'source' | 'destination';

export interface UseAssetTradeOptions {
  /** Texto tipeado en el teclado, con coma decimal. */
  readonly amountText: string;
  /** Escribe en el teclado. */
  readonly setAmountText: (text: string) => void;
  /** Activo del que se parte. Por defecto, los Dólares Digitales. */
  readonly initialSource?: Asset;
  /** Activo al que se llega. Por defecto, Bitcoin. */
  readonly initialDestination?: Asset;
}

export interface AssetTrade {
  readonly source: Asset;
  readonly destination: Asset;
  /** Qué hoja está abierta, o ninguna. */
  readonly sheetSide: TradeSide | null;
  readonly openSheet: (side: TradeSide) => void;
  readonly closeSheet: () => void;
  readonly selectAsset: (side: TradeSide, ticker: string) => void;
  /** Intercambia origen y destino. */
  readonly invert: () => void;
  /** Pone el monto en el saldo completo del origen. */
  readonly setMaxAmount: () => void;

  /** El monto tipeado, formateado para la cifra grande. */
  readonly sourceAmountText: string;
  /** Cuánto del activo destino hace ese monto. */
  readonly destinationAmountText: string;
  /**
   * El equivalente del monto, arriba a la derecha del origen.
   *
   * La moneda no está escrita acá: la decide `config/displayCurrency`, que es el
   * único lugar donde esa decisión vive.
   */
  readonly equivalentText: string;
  /** El saldo de cada lado, ya formateado. */
  readonly sourceBalanceText: string;
  readonly destinationBalanceText: string;
}

/**
 * Los decimales de la cifra grande, con un tope de 6.
 *
 * El saldo se muestra con todos los decimales del activo, pero el monto que
 * ocupa la pantalla no: a 8 decimales un Bitcoin se escribe en diez caracteres
 * y a `text-4xl` no entra al lado del ticker — se sale de la tarjeta y empuja el
 * chevron. Seis alcanzan para leer un monto y entran siempre.
 *
 * El saldo completo sigue dos líneas más abajo, en la fila de "Saldo", así que
 * la precisión no se pierde: cambia dónde se lee, no cuánto se sabe.
 */
const MAX_DISPLAY_DECIMALS = 6;

export function useAssetTrade({
  amountText,
  setAmountText,
  initialSource = DEFAULT_SOURCE,
  initialDestination = DEFAULT_DESTINATION,
}: UseAssetTradeOptions): AssetTrade {
  const [source, setSource] = useState<Asset>(initialSource);
  const [destination, setDestination] = useState<Asset>(initialDestination);
  const [sheetSide, setSheetSide] = useState<TradeSide | null>(null);

  const openSheet = useCallback((side: TradeSide) => setSheetSide(side), []);
  const closeSheet = useCallback(() => setSheetSide(null), []);

  const selectAsset = useCallback((side: TradeSide, ticker: string) => {
    const next = assetOrDefault(ticker);
    if (side === 'source') setSource(next);
    else setDestination(next);
  }, []);

  /**
   * Intercambia origen y destino.
   *
   * El monto tipeado se conserva y pasa a estar expresado en la nueva unidad de
   * origen, que es el comportamiento estándar de un selector de par: si tenías
   * 100 dólares y lo pasás a Bitcoin, el campo sigue diciendo 100 y ahora son 100
   * bitcoins. Lo contrario —dejar el número fijo y cambiar solo las etiquetas—
   * mostraría un monto que ya no corresponde a nada.
   */
  const invert = useCallback(() => {
    setSource(destination);
    setDestination(source);
    setSheetSide(null);
  }, [source, destination]);

  const setMaxAmount = useCallback(
    () => setAmountText(balanceLabel(source.ticker)),
    [setAmountText, source.ticker],
  );

  const displayDecimals = (ticker: string) => Math.min(decimalsOf(ticker), MAX_DISPLAY_DECIMALS);

  const amount = amountText === '0' ? 0 : parseFloat(amountText.replace(',', '.')) || 0;

  const sourceAmountText = amount === 0 ? '0' : formatAmount(amount, displayDecimals(source.ticker));
  const destinationAmountText =
    amount === 0
      ? '0'
      : formatAmount(convert(amount, source.ticker, destination.ticker), displayDecimals(destination.ticker));
  const equivalentText = formatFiat(toUsd(amount, source.ticker));

  return useMemo(
    () => ({
      source,
      destination,
      sheetSide,
      openSheet,
      closeSheet,
      selectAsset,
      invert,
      setMaxAmount,
      sourceAmountText,
      destinationAmountText,
      equivalentText,
      sourceBalanceText: balanceLabel(source.ticker),
      destinationBalanceText: balanceLabel(destination.ticker),
    }),
    [
      source,
      destination,
      sheetSide,
      openSheet,
      closeSheet,
      selectAsset,
      invert,
      setMaxAmount,
      sourceAmountText,
      destinationAmountText,
      equivalentText,
    ],
  );
}