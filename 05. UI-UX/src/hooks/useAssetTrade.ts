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
 * ── Por qué la lista llega de la pantalla y no de un config ─────────────────
 *
 * El hook ya no sabe qué activos existen. Antes los sacaba de `config/assets` y
 * los saldos y los precios de `config/markets`, dos archivos que se declaran
 * simulacros en su primera línea: ocho filas escritas a mano —cuatro de las
 * cuales el backend rechaza con `ASSET_NOT_ON_CHAIN`—, precios fijos y saldos
 * inventados. Ahora la pantalla le pasa el catálogo real que ya tiene en
 * props, y si no se lo pasa la lista está vacía.
 *
 * Un hook sin catálogo no inventa uno. Esa es la diferencia entre una pantalla
 * que dice "no sé" y una que dice "cero" mintiendo.
 *
 * ── Por qué no hay conversión, ni equivalente, ni MAX sin dato ──────────────
 *
 * No hay motor de swap todavía (es la fase 2, y depende de llaves que no están).
 * Todo lo que salía de acá antes —cuánto del otro activo comprás, el equivalente
 * en dólares, el saldo del ticker— venía de multiplicar dos constantes escritas a
 * mano. Eso no era una conversión: era una cifra con forma de cotización.
 *
 * Así que acá ya no se calcula nada: se muestra lo que se leyó y, para lo que no
 * se leyó, nada. El botón final tampoco lo ofrece todavía.
 *
 * ── El monto es controlado desde el padre ──────────────────────────────────
 *
 * El teclado lo comparte el padre con los flujos de envío, así que el monto se
 * recibe como texto y se devuelve el setter. Es patrón controlado normal, sin
 * refs ni trucos: el hook no es dueño del monto porque no es lo único que lo usa.
 */

import { useCallback, useMemo, useState } from 'react';

import { identityOf } from '../services/portfolioIdentity';
import { formatUnitPrice, type WalletBalancePart } from '../services/walletBalance';
import { sendChainByKey } from '../config/send';
import type { PortfolioHolding } from '../services/portfolio';
import type { DepositInfoView } from './useDepositInfo';
import type { WalletBalanceScreenView } from './useWalletBalance';
import type { TradeAssetIdentity, TradeAssetRow } from '../types/trade.types';

/**
 * Lo que dicen las pantallas de comprar, vender y cambiar mientras no haya motor.
 *
 * Vive acá —y no en una pantalla— porque lo dicen **cinco** pantallas: las dos
 * del flujo "Usar" y las tres del detalle de un cripto. Una frase repetida cinco
 * veces es cinco frases que un día dejan de decir lo mismo, y esta es la que le
 * dice a una persona, con las mismas palabras, que la app no puede hacer lo que
 * la app no puede hacer.
 *
 * Antes, cada una de esas pantallas tenía su propio botón con su propio confeti
 * y su propio `alert` de "completada". Todas mentían y ninguna coincidía.
 *
 * El texto habla de "cambio entre activos" y no sólo de comprar y vender
 * porque es lo que las cinco pantallas hacen —las tres del detalle tienen su
 * propio "Cambiar"—: un mensaje que nombra dos de los tres casos le está
 * mintiendo al tercero.
 */
export const TRADE_UNAVAILABLE_TEXT =
  'Todavía no podés comprar ni vender: el cambio entre activos no está disponible en ReWALLET.';

/** Qué lado de la conversión tiene abierta la hoja de activos. */
export type TradeSide = 'source' | 'destination';

/**
 * Lo que se muestra cuando no hay nada que mostrar.
 *
 * El resto de la app ya usa el guion largo para "no lo sé" —los tipos sin tasa,
 * las piezas sin precio—, y es lo mismo: una ausencia declarada. No es un `0`.
 */
const NOTHING_TO_SHOW = '—';

export interface UseAssetTradeOptions {
  /** Texto tipeado en el teclado, con coma decimal. */
  readonly amountText: string;
  /** Escribe en el teclado. */
  readonly setAmountText: (text: string) => void;
  /**
   * Las filas reales de la lista, ya con su saldo y su precio leídos.
   *
   * Sin catálogo, la lista queda vacía y el par se arma con las identidades de
   * abajo, **sin ninguna cifra**. Es lo que pasa con las pantallas que todavía
   * no leen el catálogo: preferimos un selector vacío a uno lleno de mock.
   */
  readonly catalog?: readonly TradeAssetRow[];
  /** Identidad del activo del que se parte, si la pantalla no tiene catálogo. */
  readonly initialSource?: TradeAssetIdentity;
  /** Identidad del activo al que se llega, si la pantalla no tiene catálogo. */
  readonly initialDestination?: TradeAssetIdentity;
}

export interface AssetTrade {
  /** Las filas que la hoja muestra. Vacías si la pantalla no pasó catálogo. */
  readonly assets: readonly TradeAssetRow[];
  readonly source: TradeAssetRow;
  readonly destination: TradeAssetRow;
  /** Qué hoja está abierta, o ninguna. */
  readonly sheetSide: TradeSide | null;
  readonly openSheet: (side: TradeSide) => void;
  readonly closeSheet: () => void;
  /** Se elige una fila por su clave, `"monad:USDC"`. */
  readonly selectAsset: (side: TradeSide, key: string) => void;
  /** Intercambia origen y destino. */
  readonly invert: () => void;
  /** Pone el monto en el saldo completo del origen, si ese saldo se leyó. */
  readonly setMaxAmount: () => void;
  /**
   * Si el botón MAX tiene algo real que poner.
   *
   * `false` cuando el saldo del origen no se pudo leer: no hay nada que
   * completar. El control se esconde en vez de quedar pulsable y mudo, porque un
   * botón que parece hacer algo y no hace nada es peor que un botón que no está.
   */
  readonly canUseMax: boolean;

  /** El monto tipeado, formateado para la cifra grande. */
  readonly sourceAmountText: string;
  /**
   * Cuánto del activo destino hace ese monto.
   *
   * Vacío mientras no haya motor: sin cotización real, la cifra sería inventada,
   * y una cotización inventada es la forma más convincente de mentir.
   */
  readonly destinationAmountText: string;
  /**
   * El equivalente del monto. Vacío: sin motor no hay tipo de cambio real, y el
   * que había salía de una tabla de precios escrita a mano.
   */
  readonly equivalentText: string;
  /** El saldo de cada lado, ya formateado, o el guion de "no lo sé". */
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

/**
 * Un número como se muestra en pantalla: `"0,00852543"`, `"250,00"`.
 *
 * Vive acá y no en `config/markets` porque ese archivo es el simulacro que se
 * está desarmando, y el formateo —que no es un dato— es lo único que de él nos
 * hacía falta. La coma decimal es la misma que usa el teclado del padre, así que
 * lo que se muestra y lo que se tipea hablan el mismo idioma.
 */
const formatTradeAmount = (amount: number, decimals: number): string =>
  amount.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * Una identidad sin cifras, para cuando la pantalla no pasó catálogo.
 *
 * `balanceText` y `priceText` en `null`: es la forma que dice "no lo sé" en
 * esta app, y acá es lo único que se puede decir con honestidad.
 */
const rowFromIdentity = (identity: TradeAssetIdentity): TradeAssetRow => ({
  ...identity,
  key: identity.ticker,
  chainLabel: null,
  kind: 'crypto',
  balanceText: null,
  priceText: null,
});

/** Las tres lecturas que arman el catálogo. Ninguna es obligatoria. */
export interface TradeCatalogSources {
  /** El catálogo y las direcciones: `GET /api/deposit-info`. */
  readonly depositInfo: DepositInfoView | null | undefined;
  /** Los saldos por cadena: `GET /api/portfolio`. */
  readonly holdings: readonly PortfolioHolding[];
  /** El balance con precio por pieza: `GET /api/wallet-balance`. */
  readonly balance: WalletBalanceScreenView | null | undefined;
}

/**
 * La lista real de activos para comprar, vender y cambiar.
 *
 * ── Por qué vive acá y no en una pantalla ──────────────────────────────────
 *
 * Porque la construyeron dos pantallas y las dos la necesitan: el flujo "Usar" y
 * el detalle de un cripto. Un constructor de catálogo copiado en dos archivos es
 * un catálogo que un día dice una cosa en un lado y otra en el otro, y nadie se
 * entera: las dos pantallas siguen compilando y las dos se ven bien. Es la
 * duplication que este hook vino a cerrar con el par de activos, repetida con la
 * lista.
 *
 * ── Las dos reglas que deciden qué aparece ─────────────────────────────────
 *
 * Las dos son de otro lado, y por eso ninguna se decide acá:
 *
 * 1. **Lo que el backend conoce.** Se recorre el catálogo de `deposit-info`, así
 *    que un activo que el servidor no lista no se ofrece. Nadie filtra una lista
 *    completa: la que llega ya es la que el backend puede servir. Por eso
 *    `BTC`, `TRX`, `DOGE` y `USDT` —que el servidor rechaza con
 *    `ASSET_NOT_ON_CHAIN`— no aparecen, y es lo correcto.
 * 2. **Lo que esta billetera puede firmar.** Una red sin id EIP-155 no sirve:
 *    sin firma no hay operación. Sale del mismo `config/send.ts` que decide qué
 *    redes se ofrecen en el flujo de enviar.
 *
 * ── Por qué la fila nombra su red y no sólo el símbolo ─────────────────────
 *
 * USDC está en tres redes del catálogo y una persona puede tenerlo en más de
 * una. Una fila que dice "USDC" no dice cuál: no es una verdad, es una palabra.
 * Por eso cada fila es un par red + símbolo, con clave propia, y siempre muestra
 * su red. Consecuencia aceptada: la lista se ve más repetida, porque "USDC en
 * Monad" y "USDC en Ethereum" son dos hechos y no uno.
 *
 * ── Las dos cifras, cada una de su lectura ─────────────────────────────────
 *
 * El saldo sale de `/api/portfolio` y el precio de `/api/wallet-balance`, que
 * son dos preguntas distintas al backend. Si una no se pudo leer, la celda queda
 * vacía: no se pone un `0`, porque un `0` en un saldo afirma que la persona no
 * tiene esa plata, y acá lo que sabemos es que no lo supimos.
 */
export const buildTradeCatalog = ({
  depositInfo,
  holdings,
  balance,
}: TradeCatalogSources): readonly TradeAssetRow[] => {
  /*
   * El precio, indexado por red y símbolo: `monad:USDC`.
   *
   * Por red y no por símbolo porque el precio que importa es el de la red donde
   * está esa fila. Se leen los dos cubos —cripto y dólares digitales— porque una
   * fila puede ser de cualquiera de los dos, y el precio de un dólar peggeado
   * viene en el segundo.
   */
  const partByChainSymbol = new Map<string, WalletBalancePart>();
  for (const part of [
    ...(balance?.balance?.cryptoValue.parts ?? []),
    ...(balance?.balance?.digitalDollarsValue.parts ?? []),
  ]) {
    if (part.chain === null) continue;
    const symbol = part.key.split('.').at(-1);
    if (symbol === undefined || symbol.length === 0) continue;
    partByChainSymbol.set(`${part.chain}:${symbol}`, part);
  }

  const rows: TradeAssetRow[] = [];

  for (const network of depositInfo?.networks ?? []) {
    // Regla 2: sin firma no hay operación, así que la red no se ofrece.
    if (sendChainByKey(network.chain) === null) continue;

    for (const asset of network.assets) {
      const identity = identityOf(asset.symbol);
      const part = partByChainSymbol.get(`${network.chain}:${asset.symbol}`);

      rows.push({
        // La clave es red y símbolo juntos: el símbolo solo no distingue dos
        // filas del mismo activo en dos redes.
        key: `${network.chain}:${asset.symbol}`,
        ticker: asset.symbol,
        name: asset.name,
        // Nombre, glifo y color: identidad de producto, no un dato del mercado.
        // Sale del mismo helper que usa el resto de la app.
        glyph: identity?.glyph ?? asset.symbol.slice(0, 1),
        iconBg: identity?.iconBg ?? 'bg-slate-200',
        decimals: asset.decimals,
        chainLabel: network.label,
        kind: asset.kind,
        // El holding es de una red: no se suma con el de otra red, porque esta
        // fila habla de una sola. `null` cuando esa red no se pudo leer.
        balanceText:
          holdings.find((holding) => holding.chain === network.chain && holding.symbol === asset.symbol)
            ?.amountLabel ?? null,
        // El precio, sólo si la pieza se pudo valorar. Un `null` es "no lo sé",
        // nunca un precio inventado ni un cero.
        priceText: part !== undefined && part.status === 'ok' ? formatUnitPrice(part.price) : null,
      });
    }
  }

  return rows;
};

/**
 * El catálogo real, memorizado.
 *
 * Es un hook y no una función pelada porque las dos pantallas lo llaman en cada
 * render: sin memo, cada tecla del teclado rebuilda las filas y rompe la
 * identidad de la lista.
 */
export const useTradeCatalog = (sources: TradeCatalogSources): readonly TradeAssetRow[] =>
  useMemo(
    () => buildTradeCatalog(sources),
    [sources.depositInfo, sources.holdings, sources.balance],
  );

export function useAssetTrade({
  amountText,
  setAmountText,
  catalog = [],
  initialSource,
  initialDestination,
}: UseAssetTradeOptions): AssetTrade {
  /*
   * El par se guarda por clave, no por objeto.
   *
   * Guardar la fila entera la congelaría: cuando los saldos se releen, el par
   * seguiría mostrando el saldo viejo. Con la clave, la fila se busca en el
   * catálogo en cada render y siempre es la última lectura.
   */
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [destinationKey, setDestinationKey] = useState<string | null>(null);
  const [sheetSide, setSheetSide] = useState<TradeSide | null>(null);

  const openSheet = useCallback((side: TradeSide) => setSheetSide(side), []);
  const closeSheet = useCallback(() => setSheetSide(null), []);

  const selectAsset = useCallback((side: TradeSide, key: string) => {
    if (side === 'source') setSourceKey(key);
    else setDestinationKey(key);
  }, []);

  /**
   * La fila de un lado del par.
   *
   * Cuatro pasos y en orden: la fila elegida si su clave sigue en el catálogo;
   * si la pantalla dijo de qué activo se trata —el detalle de un cripto sabe que
   * se está viendo MON— y ese ticker está en el catálogo, esa fila; si no dijo
   * nada, la primera fila de ese camino, que es de dónde sale y a dónde llega la
   * plata en este producto; y si la pantalla no pasó catálogo, la identidad
   * suelta, sin cifras. Nunca un activo que el backend no listó, y nunca un
   * activo sin fila real cuando el catálogo sí la tiene.
   */
  const rowFor = useCallback(
    (side: TradeSide): TradeAssetRow => {
      const identity = side === 'source' ? initialSource : initialDestination;
      const chosen = (side === 'source' ? sourceKey : destinationKey) ?? '';
      const picked = catalog.find((row) => row.key === chosen);
      if (picked !== undefined) return picked;

      // La identidad que pasó la pantalla manda sobre el default del camino:
      // en el detalle de un cripto, el destino es el activo que se está viendo.
      const named = identity === undefined ? undefined : catalog.find((row) => row.ticker === identity.ticker);
      if (named !== undefined) return named;

      const wantedKind = side === 'source' ? 'dollar' : 'crypto';
      const byKind = catalog.find((row) => row.kind === wantedKind);
      if (byKind !== undefined) return byKind;

      const first = catalog[0];
      if (first !== undefined) return first;

      return identity === undefined
        ? rowFromIdentity({ ticker: '', name: '', glyph: '', iconBg: 'bg-slate-200', decimals: 0 })
        : rowFromIdentity(identity);
    },
    [catalog, sourceKey, destinationKey, initialSource, initialDestination],
  );

  const source = rowFor('source');
  const destination = rowFor('destination');

  /**
   * Intercambia origen y destino.
   *
   * Se intercambian las claves y no las filas: el saldo y el precio vuelven a
   * salir del catálogo, y no se arrastra de un lado al otro.
   */
  const invert = useCallback(() => {
    setSourceKey(destination.key);
    setDestinationKey(source.key);
    setSheetSide(null);
  }, [source.key, destination.key]);

  /**
   * MAX pone el saldo completo, **si existe**.
   *
   * Si el saldo de esa fila no se pudo leer, el campo no se toca. Antes se
   * llenaba con una tabla escrita a mano, así que el MAX de un activo sin saldo
   * ponía un número que el backend nunca había dicho.
   */
  const setMaxAmount = useCallback(() => {
    if (source.balanceText === null) return;
    setAmountText(source.balanceText);
  }, [setAmountText, source.balanceText]);

  const canUseMax = source.balanceText !== null;

  const displayDecimals = Math.min(source.decimals, MAX_DISPLAY_DECIMALS);

  const amount = amountText === '0' ? 0 : parseFloat(amountText.replace(',', '.')) || 0;

  const sourceAmountText = amount === 0 ? '0' : formatTradeAmount(amount, displayDecimals);
  const destinationAmountText = amount === 0 ? '0' : NOTHING_TO_SHOW;
  const equivalentText = '';

  return useMemo(
    () => ({
      assets: catalog,
      source,
      destination,
      sheetSide,
      openSheet,
      closeSheet,
      selectAsset,
      invert,
      setMaxAmount,
      canUseMax,
      sourceAmountText,
      destinationAmountText,
      equivalentText,
      sourceBalanceText: source.balanceText ?? NOTHING_TO_SHOW,
      destinationBalanceText: destination.balanceText ?? NOTHING_TO_SHOW,
    }),
    [
      catalog,
      source,
      destination,
      sheetSide,
      openSheet,
      closeSheet,
      selectAsset,
      invert,
      setMaxAmount,
      canUseMax,
      sourceAmountText,
      destinationAmountText,
      equivalentText,
    ],
  );
}
