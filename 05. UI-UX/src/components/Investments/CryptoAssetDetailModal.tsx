import React, { useState } from 'react';
import {
  ArrowLeft,
  Heart,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  QrCode,
  Copy,
  Check,
  CheckCircle2,
  Search,
  Clipboard,
  Layers,
  Sparkles,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { AssetTradeCard } from '../common';
import { PriceChart } from './PriceChart';
import { usePriceHistory } from '../../hooks/usePriceHistory';
import {
  TRADE_UNAVAILABLE_TEXT,
  useAssetTrade,
  useTradeCatalog,
} from '../../hooks/useAssetTrade';
import { assetOrDefault } from '../../config/markets';
import type { PortfolioHolding } from '../../services/portfolio';
import type { DepositInfoView } from '../../hooks/useDepositInfo';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';

/**
 * Una dirección acortada para que entre en la fila: `"0x4613…9e50ba"`.
 *
 * No es un dato: es la misma dirección de `/api/portfolio`, recortada para que
 * quepa. El texto completo va al portapapeles, y el botón de copiar copia la
 * entera.
 */
/**
 * Lo que dicen las dos pantallas de envío de este modal.
 *
 * Misma decisión y misma voz que el aviso de trade, y por el mismo motivo: acá
 * no hay envío. El flujo "Usar" sí lo tiene —prepara, firma y muestra el hash—
 * pero este modal no llama a nada: la dirección del segundo paso está escrita a
 * mano en el código y el botón anunciaba "¡Transferencia enviada!" sin que
 * existiera una transacción.
 *
 * El texto habla de envío y no de trade a propósito: decir acá que "el cambio
 * entre activos no está disponible" sería una verdad sobre otra cosa, y una
 * verdad en la pantalla equivocada es tan mentira como la que se estaba
 * borrando. El aviso vuelve a ser un botón cuando este flujo use el mismo
 * `useSendTransfer` que el resto de la app.
 */
const SEND_UNAVAILABLE_TEXT =
  'Todavía no podés enviar desde acá: el envío todavía no está disponible en ReWALLET.';

/** El aviso ya formateado, porque se repite en dos pasos de este modal. */
const SEND_NOT_AVAILABLE = (
  <p className="text-center text-xs font-semibold leading-relaxed text-slate-500 bg-white rounded-2xl border border-slate-200 px-4 py-3">
    {SEND_UNAVAILABLE_TEXT}
  </p>
);

const abbreviateAddress = (address: string): string => {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
};

/**
 * Lo que el detalle de un activo puede mostrar, y lo que no.
 *
 * Antes este tipo tenía `totalUsd: string` y `balanceNumber?: number`, y los dos
 * los llenaba la lista con números escritos a mano. `totalUsd` **desapareció**:
 * `/api/portfolio` no trae precios de mercado, así que un "equivalente en pesos"
 * no se puede calcular sin inventar el precio primero. No hay campo vacío que
 * rellenar con un número: no hay campo.
 *
 * Lo que queda es lo que sí existe: la cantidad y su unidad, y las redes donde
 * vive ese saldo con su dirección.
 */
export interface CryptoAssetData {
  id: string;
  name: string;
  ticker: string;
  iconBg: string;
  iconText: string;
  /** La cantidad real y su unidad, tal como se pinta: `"123,456789 MON"`. */
  totalCrypto: string;
  /** Varía según si hay una variación real; hoy no la hay, y va vacío. */
  change24h: string;
  isPositive: boolean;
  /** Redes donde hay saldo de este activo, con la dirección para depositar. */
  networks?: readonly { readonly label: string; readonly address: string | null }[];
}

interface CryptoAssetDetailModalProps {
  asset: CryptoAssetData | null;
  onClose: () => void;
  userTag: string;
  /**
   * El catálogo de redes y activos: `GET /api/deposit-info`.
   *
   * Antes este modal no tenía ninguna lectura y por eso sus hojas de activos
   * offerscían una lista escrita a mano —con cuatro activos que el backend
   * rechaza— y sus balances salían de una tabla de precios inventada. Ahora
   * arma la lista con el mismo constructor que el flujo "Usar".
   */
  depositInfo: DepositInfoView | null;
  /** Los saldos por cadena: `GET /api/portfolio`. */
  holdings: readonly PortfolioHolding[];
  /** El precio por pieza: `GET /api/wallet-balance`. */
  balance: WalletBalanceScreenView | null;
}

/**
 * Los pasos que esta pantalla todavía sabe mostrar.
 *
 * `compraventa_sheet` se fue con su botón: la hoja que abría era el menú de
 * Comprar y Vender, y `isCompraventaOpen` era el único estado que la alcanzaba.
 *
 * `buy_keypad`, `sell_keypad` y `swap` **se quedan**, aunque hoy nada los
 * escriba. Son la base terminada de la Fase 2 (mismo `useTradeCatalog`, mismos
 * saldos, misma `AssetTradeCard`) y el motor de swap todavía no existe: sin
 * él, un botón de compra, venta o cambio sería una acción que no se puede
 * ejecutar, y una acción así no se ofrece. Cuando el motor llegue, estas
 * pantallas son las que lo reciben.
 */
type ModalView =
  | 'overview'
  | 'deposit_network'
  | 'deposit_lemon'
  | 'deposit_qr'
  | 'buy_keypad'
  | 'sell_keypad'
  | 'swap'
  | 'send_where'
  | 'send_lemon'
  | 'send_lemon_amount'
  | 'send_crypto_address';

export const CryptoAssetDetailModal: React.FC<CryptoAssetDetailModalProps> = ({
  asset,
  onClose,
  userTag,
  depositInfo,
  holdings,
  balance,
}) => {
  const [currentView, setCurrentView] = useState<ModalView>('overview');
  const [timeframe, setTimeframe] = useState<'24H' | '7D' | '1M' | '1A' | 'MAX'>('24H');
  const [isFavorite, setIsFavorite] = useState(false);
  const [keypadAmount, setKeypadAmount] = useState('0');
  const [lemontagSearch, setLemontagSearch] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState<{
    name: string;
    tag: string;
    avatarBg: string;
    avatarImg: string;
  } | null>(null);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [copied, setCopied] = useState(false);

  // Price history from CoinGecko
  const { data: priceHistory, marketData, loading: priceLoading, error: priceError } = usePriceHistory(
    asset?.ticker,
    timeframe
  );

  /*
   * El par de conversión de las dos pantallas de teclado.
   *
   * Antes fijaban Bitcoin y DólaresDigitales escritos en el JSX, y el equivalente
   * se calculaba en pesos. Eso dejó estas dos pantallas dando números distintos a
   * las de "Usar", que ya hacían lo mismo en dólares y con el catálogo. Ahora las
   * cuatro leen del mismo hook, así que no pueden volver a separarse.
   *
   * Comprar sale de los Dólares Digitales y llega al activo de la pantalla; vender
   * sale del activo de la pantalla y llega a los Dólares Digitales.
   *
   * El `?.` y el default no son de abajo: el hook tiene que declararse ANTES del
   * `if (!asset) return null` de más abajo, porque un hook después de un return
   * temprano es un hook condicional y React rompe el orden entre renders. En la
   * práctica el padre nunca monta este componente sin activo, así que el default
   * no se ve nunca; está para que el orden de hooks sea válido.
   */
  const assetForTrade = assetOrDefault(asset?.ticker ?? 'USDC');

  /*
   * La lista real de activos, la misma que ve el flujo "Usar".
   *
   * Antes esta pantalla abría su hoja con una lista de ocho activos escrita a
   * mano, cuatro de los cuales el backend rechaza con `ASSET_NOT_ON_CHAIN`, y
   * con saldos y precios de una tabla inventada. Ahora usa el constructor
   * compartido: mismo catálogo, mismos saldos, mismos precios, y las mismas
   * filas que no se pudieron leer sin cifra en vez de un cero.
   */
  const tradeCatalog = useTradeCatalog({ depositInfo, holdings, balance });

  /*
   * Comprar sale de los Dólares Digitales y llega al activo que se está viendo;
   * vender y cambiar salen de ese activo y llegan a los dólares.
   *
   * La identidad que se pasa acá es sólo el **nombre** del activo de la
   * pantalla: el hook la busca en el catálogo y usa la fila real —con su red, su
   * saldo y su precio— si existe. Si no existe, el activo no se ofrece.
   */
  const buyTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
    catalog: tradeCatalog,
    initialSource: assetOrDefault('USDC'),
    initialDestination: assetForTrade,
  });
  const swapTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
    catalog: tradeCatalog,
    initialSource: assetForTrade,
    initialDestination: assetOrDefault('USDC'),
  });
  const sellTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
    catalog: tradeCatalog,
    initialSource: assetForTrade,
    initialDestination: assetOrDefault('USDC'),
  });

  /*
   * La red de depósito elegida, por posición.
   *
   * El estado vive acá, antes del `if (!asset) return null` de más abajo, por la
   * misma razón que los hooks de compraventa: un hook después de un return temprano
   * es un hook condicional y React rompe el orden entre renders.
   */
  const [selectedNetworkIndex, setSelectedNetworkIndex] = useState(0);

  if (!asset) return null;

  // Manejo de copiado al portapapeles
  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Teclado numérico interactivo
  const handleKeypadPress = (val: string) => {
    if (val === 'backspace') {
      setKeypadAmount((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
    } else if (val === ',') {
      if (!keypadAmount.includes(',')) {
        setKeypadAmount((prev) => prev + ',');
      }
    } else {
      if (keypadAmount === '0') {
        setKeypadAmount(val);
      } else {
        if (keypadAmount.length < 10) {
          setKeypadAmount((prev) => prev + val);
        }
      }
    }
  };

  /*
   * Las redes de un activo son **las que la cadena reportó**, con la dirección de
   * esta persona en cada una.
   *
   * Antes esta cadena de `?:` inventaba la red de cada ticker y terminaba en un
   * `else` que ofrecía Polygon y BNB para cualquier activo que no estuviera en la
   * lista: un activo de Monad aparecía con redes que no son suyas. Y el `else`
   * también era la red que se usaba en la pantalla de depósito.
   */
  const networksForAsset = (asset.networks ?? []).map((network) => ({
    name: network.label,
    desc: 'Tu dirección en esta red',
    icon: network.label.charAt(0),
    bg: 'bg-slate-800',
    address: network.address,
  }));

  /*
   * La red elegida, con su dirección. Cuando la persona elige una red en la
   * pantalla de depósito, la dirección que se muestra es la de ESA red: antes
   * estaba escrita a mano (`0x4613c015949e50ba`) y era la misma para todas.
   *
   * El índice se recorta al largo de la lista porque el activo puede cambiar con
   * el modal abierto, y un índice de una red anterior no puede dejar la pantalla
   * sin dirección.
   */
  const selectedNetworkEntry =
    networksForAsset.length === 0
      ? null
      : (networksForAsset[Math.min(selectedNetworkIndex, networksForAsset.length - 1)] ?? null);
  const selectedNetwork = selectedNetworkEntry?.name ?? null;
  const depositAddress = selectedNetworkEntry?.address ?? null;

  return (
    <div className="absolute inset-0 z-50 bg-[#f3f4f6] text-black flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans w-full max-w-md mx-auto">
      {/* =========================================================================
          VISTA 1: OVERVIEW PRINCIPAL DEL ASSET (IMAGEN 1)
         ========================================================================= */}
      {currentView === 'overview' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          {/* Header Superior: Flecha Atrás + Ticker/Nombre Centrado + Corazón */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={onClose}
              type="button"
              aria-label="Volver"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>

            <div className="text-center">
              <h1 className="text-base font-extrabold font-display text-black leading-tight">
                {asset.ticker}
              </h1>
              <span className="text-xs text-slate-400 font-medium block">
                {asset.name}
              </span>
            </div>

            <button
              onClick={() => setIsFavorite(!isFavorite)}
              type="button"
              aria-label="Favorito"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
            >
              <Heart
                className={`w-5 h-5 transition-colors ${
                  isFavorite ? 'fill-red-500 text-red-500' : 'text-black stroke-[2.2]'
                }`}
              />
            </button>
          </div>

          <div className="px-5 pb-8 space-y-6 max-w-md mx-auto w-full">
            {/* Balance del Asset */}
            <div className="space-y-1 pt-1">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-full ${asset.iconBg} text-white flex items-center justify-center text-xs font-black shrink-0`}
                >
                  {asset.iconText}
                </div>
                <div className="flex items-baseline font-display">
                  <span className="text-3xl font-black text-black tracking-tight">
                    {/*
                      La cantidad real, con su unidad, tal como la trajo
                      `/api/portfolio`. Antes caía en la tabla de saldos de
                      `config/markets`, que devolvía `0` para cualquier ticker que
                      no estuviera en ella: un cero inventado, y además
                      contradicción con el catálogo, porque MON no estaba en esa
                      tabla y sí se podía tener.
                    */}
                    {asset.totalCrypto}
                  </span>
                </div>
              </div>
              {/*
                El "≈ en pesos" desapareció y no se reemplaza por nada: convertirlos
                exige el precio del activo, y `/api/portfolio` no trae precios.
                Ponerlo era poner un precio de tabla y llamarlo equivalente.
              */}
            </div>

            {/* 4 Botones de Acción Circulares (Negro con icono blanco) */}
            {/*
              Dos acciones, no cuatro.

              "Compraventa" (que abría el menú Comprar/Vender) y "Cambiar" se
              sacaron: las dos son cambio de activo, y no hay motor de swap que
              las ejecute. Depositar y Enviar quedan, que es lo que la app sabe
              hacer.

              Las grillas quedan en dos columnas porque es lo que hay. La fila se
              sigue leyendo igual —círculo negro, glifo, rótulo— y no se
              rediseña: sólo se le saca la mitad que no tenía a quién llevar.

              Las pantallas `buy_keypad`, `sell_keypad` y `swap` de más abajo NO
              se tocan: están terminadas y son la Fase 2. Lo que se cerró fue la
              puerta.
            */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              {/* 1. Depositar */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setCurrentView('deposit_network')}
                  className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-white shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                >
                  <ArrowDown className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="text-xs font-bold text-black mt-2">
                  Depositar
                </span>
              </div>

              {/* 2. Enviar */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setCurrentView('send_where')}
                  className="w-14 h-14 rounded-full bg-black flex items-center justify-center text-white shadow-md hover:bg-slate-900 active:scale-90 transition-transform cursor-pointer"
                >
                  <ArrowUp className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="text-xs font-bold text-black mt-2">
                  Enviar
                </span>
              </div>
            </div>

            

{/* Precio actual y variación 24h — datos reales de CoinGecko */}
            <div className="text-center space-y-0.5 pt-1">
              <div className="flex items-baseline justify-center gap-1.5 font-display">
                {marketData !== null && marketData.currentPrice > 0 ? (
                  <>
                    <span className="text-2xl font-black text-black tracking-tight">
                      U${marketData.currentPrice.toLocaleString('en-US', {
                        minimumFractionDigits: marketData.currentPrice >= 1 ? 2 : 6,
                        maximumFractionDigits: marketData.currentPrice >= 1 ? 2 : 6,
                      })}
                    </span>
                    <span className="text-xs font-bold text-slate-400">USD</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl font-black text-slate-300">—</span>
                    <span className="text-xs font-bold text-slate-400">USD</span>
                  </>
                )}
              </div>
              {marketData?.change24h !== null && marketData?.change24h !== undefined && (
                <div className="flex items-center justify-center gap-1">
                  {marketData.change24h >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-500 stroke-[2]" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-500 stroke-[2]" />
                  )}
                  <span className={`text-xs font-bold ${marketData.change24h >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {marketData.change24h >= 0 ? '+' : ''}{marketData.change24h.toFixed(2)}%
                  </span>
                </div>
              )}
              {priceError && (
                <span className="text-[11px] text-amber-600 font-medium">
                  {priceError}
                </span>
              )}
            </div>

{/*
              Aquí ya no hay gráfico fijo: ahora usamos datos reales de CoinGecko.
              
              Cuando exista la serie, la curva vuelve a este mismo lugar.
            */}
            <div className="w-full h-44 relative flex items-center justify-center overflow-hidden bg-white rounded-xl border border-slate-100">
              {priceLoading ? (
                <div className="space-y-1.5 text-center px-8">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-bold text-slate-500">Cargando gráfico…</span>
                  </div>
                </div>
              ) : priceError ? (
                <div className="space-y-1.5 text-center px-8">
                  <span className="text-sm font-bold text-amber-600 block">No se pudo cargar el gráfico</span>
                  <span className="text-[11px] text-slate-400 font-medium block leading-snug">
                    {priceError}
                  </span>
                </div>
              ) : priceHistory.length > 0 ? (
                <PriceChart
                  data={priceHistory}
                  strokeColor="#1a1a2e"
                  fillColor="rgba(26, 26, 46, 0.15)"
                  showArea
                  showGrid
                />
              ) : (
                <div className="space-y-1.5 text-center px-8">
                  <span className="text-sm font-bold text-slate-500 block">Sin datos de precio</span>
                  <span className="text-[11px] text-slate-400 font-medium block leading-snug">
                    No hay serie histórica disponible para este activo
                  </span>
                </div>
              )}
            </div>
            </div>

            {/* Selector de Periodo [ 24H | 7D | 1M | 1A | MAX ] */}
            <div className="flex items-center justify-between bg-slate-200/70 p-1 rounded-2xl">
              {(['24H', '7D', '1M', '1A', 'MAX'] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer text-center ${
                    timeframe === tf
                      ? 'bg-white text-black shadow-xs font-black'
                      : 'text-slate-500 hover:text-black'
                  }`}
                >
                  {tf}
                </button>
              ))}
</div>
        </div>
      )}

      {/* =========================================================================
          VISTA 2: DEPOSITAR {TICKER} - ELECCIÓN DE RED (IMAGEN 2)
         ========================================================================= */}
      {currentView === 'deposit_network' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('overview')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <div className="w-9" />
          </div>

          <div className="px-5 pb-8 space-y-6 max-w-md mx-auto w-full">
            <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
              Elegí por qué red vas a depositar {asset.ticker}
            </h1>

            {/* Card 1: $lemontag */}
            <div
              onClick={() => setCurrentView('deposit_lemon')}
              className="bg-white rounded-3xl p-4.5 shadow-[0_4px_25px_rgba(0,0,0,0.03)] border border-slate-200/80 flex items-center justify-between hover:bg-slate-50 active:scale-99 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-full bg-black text-[#ccff00] flex items-center justify-center font-display font-black text-xs shrink-0">
                  Re
                </div>
                <div>
                  <span className="text-sm font-bold text-black block leading-tight">
                    $ReTag
                  </span>
                  <span className="text-xs text-slate-400 font-medium block mt-0.5 leading-snug">
                    Recibí criptomonedas de tus amigos que utilizan ReWALLET. ¡Es instantáneo y gratuito!
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5] shrink-0" />
            </div>

            {/* Sección: las redes donde hay saldo de este activo. Si la cadena no
                reportó ninguna, se lo dice en vez de ofrecer redes que no son
                del activo. */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-bold text-slate-400 font-display uppercase tracking-wider px-1">
                Tus redes
              </span>

              {networksForAsset.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200/80 p-4 text-xs font-medium text-slate-500 leading-snug">
                  Todavía no tenemos una dirección de depósito para {asset.ticker}.
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
                  {networksForAsset.map((net, index) => (
                    <div
                      key={net.name}
                      onClick={() => {
                        setSelectedNetworkIndex(index);
                        setCurrentView('deposit_qr');
                      }}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-full ${net.bg} text-white font-black flex items-center justify-center text-sm shadow-xs shrink-0`}
                      >
                        {net.icon}
                      </div>
                      <div>
                        <span className="text-sm font-bold text-black block leading-none">
                          {net.name}
                        </span>
                        <span className="text-xs text-slate-400 font-medium block mt-1">
                          {net.desc}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5]" />
                  </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: DEPOSITAR POR LEMONTAG (REUTILIZADA)
         ========================================================================= */}
      {currentView === 'deposit_lemon' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('deposit_network')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-base font-extrabold font-display text-black">
              Depositá {asset.name}
            </h2>
            <div className="w-9" />
          </div>

          <div className="px-4 pb-8 space-y-4 max-w-md mx-auto w-full">
            <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-200/80 space-y-4 text-center">
              <div className="flex items-center gap-3 text-left">
                <div className="w-8 h-8 rounded-full bg-black p-1 flex items-center justify-center font-display font-black text-xs text-[#ccff00]">
                  Re
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-medium block leading-none">Red</span>
                  <span className="text-sm font-bold text-black leading-tight">ReWALLET</span>
                </div>
              </div>

              <div className="relative w-60 h-60 mx-auto bg-black p-3.5 rounded-[32px] flex items-center justify-center shadow-xs">
                <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center p-3 relative overflow-hidden">
                  <QrCode className="w-full h-full text-black stroke-[1.15]" />
                  <div className="w-13 h-13 rounded-full border-[3px] border-white bg-slate-900 shadow-md flex items-center justify-center text-base text-[#ccff00] absolute">
                    👾
                  </div>
                </div>
              </div>

              <div className="text-left space-y-1 pt-1">
                <span className="text-xs text-slate-400 font-medium block">Tu $ReTag</span>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-black font-display text-black">{userTag || '$joadata'}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(userTag || '$joadata')}
                    className="p-2 text-black active:scale-90"
                  >
                    {copied ? <Check className="w-6 h-6 text-emerald-600" /> : <Copy className="w-6 h-6" />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(userTag || '$joadata')}
                className="w-full py-4 rounded-2xl bg-black text-white font-bold text-sm cursor-pointer active:scale-98"
              >
                Compartir datos
              </button>
            </div>

            <div className="bg-[#ccff00] rounded-[28px] p-5 space-y-3">
              <h3 className="text-base font-extrabold text-black">Información Importante</h3>
              <div>
                <span className="text-xs text-black/70 font-semibold block">Comisión</span>
                <p className="text-base font-black text-black">Sin comisiones</p>
              </div>
              <div>
                <span className="text-xs text-black/70 font-semibold block">En tu cuenta</span>
                <p className="text-base font-black text-black">Instantánea</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: DEPOSITAR POR RED BLOCKCHAIN (QR)
         ========================================================================= */}
      {currentView === 'deposit_qr' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('deposit_network')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-base font-extrabold font-display text-black">
              Depositá {asset.name}
            </h2>
            <div className="w-9" />
          </div>

          <div className="px-4 pb-8 space-y-4 max-w-md mx-auto w-full">
            <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-200/80 space-y-4 text-center">
              <div className="text-left space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full ${asset.iconBg} text-white flex items-center justify-center text-xs font-bold`}>
                    {asset.iconText}
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 font-bold uppercase block leading-none">Depositás</span>
                    <span className="text-xs font-extrabold text-black">{asset.name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center text-xs font-bold">
                    ❖
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 font-bold uppercase block leading-none">Red</span>
                    <span className="text-xs font-extrabold text-black">{selectedNetwork ?? '—'}</span>
                  </div>
                </div>
              </div>

              <div className="relative w-60 h-60 mx-auto bg-black p-3.5 rounded-[32px] flex items-center justify-center shadow-xs">
                <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center p-3 relative">
                  <QrCode className="w-full h-full text-black stroke-[1.15]" />
                  <div className={`w-10 h-10 rounded-xl ${asset.iconBg} text-white flex items-center justify-center font-bold text-xs absolute shadow-md`}>
                    {asset.iconText}
                  </div>
                </div>
              </div>

              <div className="text-left space-y-1">
                <span className="text-xs text-slate-400 font-medium block">Dirección</span>
                <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                  {/*
                    Antes esta dirección estaba escrita a mano
                    (`0x4613c015949e50ba`) y era la misma para todas las redes y
                    todos los activos: una dirección que no era de nadie, en una
                    pantalla que sirve para mandar plata. Ahora es la de esta
                    persona en la red elegida, y si no hay, se lo dice.
                  */}
                  <span className="font-mono text-xs font-bold text-black truncate pr-2">
                    {depositAddress === null ? 'Sin dirección disponible' : abbreviateAddress(depositAddress)}
                  </span>
                  <button
                    type="button"
                    disabled={depositAddress === null}
                    onClick={() => depositAddress !== null && handleCopy(depositAddress)}
                    className="p-1 text-black active:scale-90 disabled:opacity-30"
                  >
                    {copied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={depositAddress === null}
                onClick={() => depositAddress !== null && handleCopy(depositAddress)}
                className="w-full py-4 rounded-2xl bg-black text-white font-bold text-sm cursor-pointer active:scale-98 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Compartir datos
              </button>
            </div>

            {/* Advertencia */}
            <p className="text-xs text-slate-500 text-center leading-relaxed px-2 font-medium">
              Asegurate de depositar {asset.ticker} desde la red {selectedNetwork ?? 'elegida'}. De lo contrario, podrías perder tus fondos.
            </p>

            {/* Card Verde Lima: Información Importante */}
            <div className="bg-[#ccff00] rounded-[28px] p-5 space-y-3 shadow-sm text-black">
              <h3 className="text-base font-extrabold text-black font-display">
                Información Importante
              </h3>
              <div>
                <span className="text-xs text-black/70 font-semibold block">Tenés</span>
                <p className="text-base font-black text-black">{asset.name} ({asset.ticker})</p>
              </div>
              <div>
                <span className="text-xs text-black/70 font-semibold block">Red</span>
                <p className="text-base font-black text-black">{selectedNetwork ?? '—'}</p>
              </div>
              <div>
                <span className="text-xs text-black/70 font-semibold block">Comisión</span>
                <p className="text-base font-black text-black">Sin comisiones</p>
              </div>
              <div>
                <span className="text-xs text-black/70 font-semibold block">En tu cuenta</span>
                <p className="text-base font-black text-black">1 a 3 minutos</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: TECLADO COMPRA (BUY) - ESTILO EXACTO A CAMBIAR SIN INVERTIR

          ESTACIONADA A PROPOSITO. Nada la abre hoy: la única puerta era el
          botón "Compraventa" y la hoja "Comprá/Vendé", y las dos se sacaron
          porque no hay motor de swap que ejecute la conversión. No es código
          muerto: es la Fase 2 de `odd/tasks/comprar-o-vender.md`, ya decidida,
          y esta pantalla ya está terminada del lado de la lista real —el mismo
          `useTradeCatalog`, la misma `AssetTradeCard`, los mismos saldos del
          backend—. Falta el motor, no la pantalla.
         ========================================================================= */}
      {currentView === 'buy_keypad' && (
        /* Mismo reparto que en el flujo `usar`: sin `justify-between` (que empujaba
           todo al borde inferior y dejaba un hueco muerto arriba del primer div), la
           tarjeta pegada al header y el sobrante absorbido por el teclado. Ver la nota
           larga en `ActionFlowModal` (`use_buy`). */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f8f9fa] select-none">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('overview')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h1 className="text-base font-extrabold font-display text-black">
              Comprar {asset.ticker}
            </h1>
            <div className="w-9" />
          </div>

          <div className="px-5 pt-1 max-w-sm mx-auto w-full">
            {/* REUTILIZACIÓN DE COMPONENTE ESTILO CAMBIAR (SIN BOTÓN INVERTIR) */}
            <AssetTradeCard
              trade={buyTrade}
              sourceTitle="Quiero usar"
              destinationTitle="Para comprar"
              sourcePickerLabel="Elegir la moneda de la que querés salir"
              destinationPickerLabel="Elegir la moneda que querés comprar"
            />
          </div>

          <div className="flex-1 flex flex-col px-5 pt-3 pb-6 space-y-3 max-w-sm mx-auto w-full">
            {/*
              Sin botón, y por la misma decisión del flujo "Usar": no hay motor,
              así que la acción no existe y no se ofrece. El texto es el mismo de
              las otras pantallas —vive en `useAssetTrade`— porque cinco pantallas
              diciendo la verdad con cinco palabras distintas vuelven a mentir.
            */}
            <p className="text-center text-xs font-semibold leading-relaxed text-slate-500 bg-white rounded-2xl border border-slate-200 px-4 py-3">
              {TRADE_UNAVAILABLE_TEXT}
            </p>

            {/* TECLADO NUMÉRICO: crece con la pantalla para no dejar hueco muerto */}
            <div className="grid grid-cols-3 gap-1.5 pt-1 flex-1 min-h-[212px] auto-rows-fr">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeypadPress(k)}
                  className="h-full py-3 bg-white hover:bg-slate-100 rounded-xl font-display font-extrabold text-base text-black active:scale-95 transition-all shadow-2xs flex items-center justify-center cursor-pointer"
                >
                  {k === 'backspace' ? <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> : k}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: TECLADO VENTA (SELL) - ESTILO EXACTO A CAMBIAR SIN INVERTIR

          ESTACIONADA A PROPOSITO, por lo mismo que la de compra: sin motor de
          swap la venta no se ofrece, y la pantalla queda como base de la Fase 2.
         ========================================================================= */}
      {currentView === 'sell_keypad' && (
        /* Mismo reparto que en `buy_keypad`. */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f8f9fa] select-none">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('overview')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h1 className="text-base font-extrabold font-display text-black">
              Vender {asset.ticker}
            </h1>
            <div className="w-9" />
          </div>

          <div className="px-5 pt-1 max-w-sm mx-auto w-full">
            <AssetTradeCard
              trade={sellTrade}
              sourceTitle="Quiero vender"
              destinationTitle="Para recibir"
              sourcePickerLabel="Elegir la moneda que querés vender"
              destinationPickerLabel="Elegir la moneda que querés recibir"
            />
          </div>

          <div className="flex-1 flex flex-col px-5 pt-3 pb-6 space-y-3 max-w-sm mx-auto w-full">
            {/*
              Sin botón, y por la misma decisión del flujo "Usar": no hay motor,
              así que la acción no existe y no se ofrece. El texto es el mismo de
              las otras pantallas —vive en `useAssetTrade`— porque cinco pantallas
              diciendo la verdad con cinco palabras distintas vuelven a mentir.
            */}
            <p className="text-center text-xs font-semibold leading-relaxed text-slate-500 bg-white rounded-2xl border border-slate-200 px-4 py-3">
              {TRADE_UNAVAILABLE_TEXT}
            </p>

            {/* TECLADO NUMÉRICO: crece con la pantalla para no dejar hueco muerto */}
            <div className="grid grid-cols-3 gap-1.5 pt-1 flex-1 min-h-[212px] auto-rows-fr">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeypadPress(k)}
                  className="h-full py-3 bg-white hover:bg-slate-100 rounded-xl font-display font-extrabold text-base text-black active:scale-95 transition-all shadow-2xs flex items-center justify-center cursor-pointer"
                >
                  {k === 'backspace' ? <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> : k}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VISTA 4: CAMBIAR / SWAP (IMAGEN 4)

          ESTACIONADA A PROPOSITO: su única puerta era el botón "Cambiar", que
          se sacó junto con "Compraventa". Mismo motivo, misma Fase 2.
         ========================================================================= */}
      {currentView === 'swap' && (
        /*
         * Mismo reparto que en `buy_keypad` / `use_buy`: la tarjeta pegada al
         * header y el sobrante absorbido por el teclado. El `<div className="pb-3" />`
         * que cerraba esta pantalla era un relleno manual para despegar el teclado
         * del borde, y ahora lo hace el `pb-6` del grupo.
         *
         * Antes esta pantalla tenía sus propias tarjetas escritas a mano, con el par
         * fijo (la cripto contra USDC) y el equivalente en pesos. Era la quinta
         * copia de lo mismo, y la única que todavía mostraba ARS: el mismo Bitcoin
         * valía 1.573,41 en pesos acá y 813,33 dólares en las otras cuatro. Con el
         * mismo hook y el mismo componente que las demás, ya no puede separarse.
         *
         * El estado `swapTargetCoin` que usaba esta pantalla desapareció con esto:
         * declaraba que se podía elegir entre USDC y USDT, pero ningún botón lo
         * escribía, así que la mitad de la pantalla era código que no podía
         * ejecutarse. Ahora la elección la hace el mismo selector que usan las
         * otras cuatro pantallas, y USDT es una opción de verdad.
         */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f8f9fa] select-none">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('overview')}
              type="button"
              aria-label="Volver"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h1 className="text-base font-extrabold font-display text-black">Cambiar</h1>
            <div className="w-9" />
          </div>

          <div className="px-5 pt-1 max-w-sm mx-auto w-full">
            <AssetTradeCard
              trade={swapTrade}
              sourceTitle="Quiero cambiar"
              destinationTitle="Quiero recibir"
              sourcePickerLabel="Elegir la moneda que querés cambiar"
              destinationPickerLabel="Elegir la moneda que querés recibir"
            />
          </div>

          <div className="flex-1 flex flex-col px-5 pt-3 pb-6 space-y-3 max-w-sm mx-auto w-full">
            {/*
              Sin botón, y por la misma decisión del flujo "Usar": no hay motor,
              así que la acción no existe y no se ofrece. El texto es el mismo de
              las otras pantallas —vive en `useAssetTrade`— porque cinco pantallas
              diciendo la verdad con cinco palabras distintas vuelven a mentir.
            */}
            <p className="text-center text-xs font-semibold leading-relaxed text-slate-500 bg-white rounded-2xl border border-slate-200 px-4 py-3">
              {TRADE_UNAVAILABLE_TEXT}
            </p>

            {/* TECLADO NUMÉRICO: crece con la pantalla para no dejar hueco muerto */}
            <div className="grid grid-cols-3 gap-1.5 pt-1 flex-1 min-h-[212px] auto-rows-fr">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeypadPress(k)}
                  className="h-full py-3 bg-white hover:bg-slate-100 rounded-xl font-display font-extrabold text-base text-black active:scale-95 transition-all shadow-2xs flex items-center justify-center cursor-pointer"
                >
                  {k === 'backspace' ? <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> : k}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VISTA 5: ENVIAR {TICKER} - ELECCIÓN DE DESTINO (IMAGEN 5)
         ========================================================================= */}
      {currentView === 'send_where' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('overview')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <div className="w-9" />
          </div>

          <div className="px-5 pb-8 space-y-6 max-w-md mx-auto w-full">
            <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
              Elegí por dónde vas a enviar {asset.ticker}
            </h1>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
              {/* Opción 1: $lemontag */}
              <div
                onClick={() => setCurrentView('send_lemon')}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-black text-[#ccff00] flex items-center justify-center font-display font-black text-xs shrink-0">
                    Re
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block leading-none">
                      $ReTag
                    </span>
                    <span className="text-xs text-slate-400 font-medium block mt-1 leading-snug">
                      Enviá criptomonedas a tus amigos que utilizan ReWALLET. Gratis e instantánea.
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5] shrink-0" />
              </div>

              {/* Opción 2: A una wallet crypto */}
              <div
                onClick={() => setCurrentView('send_crypto_address')}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-black shrink-0">
                    <Layers className="w-5 h-5 stroke-[2]" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block leading-none">
                      A una wallet crypto
                    </span>
                    <span className="text-xs text-slate-400 font-medium block mt-1">
                      Desde tu cuenta ReWALLET.
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5] shrink-0" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: ENVIAR POR $RETAG
         ========================================================================= */}
      {currentView === 'send_lemon' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('send_where')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <div className="w-9" />
          </div>

          <div className="px-5 pb-8 space-y-4 max-w-md mx-auto w-full">
            <h1 className="text-xl font-black font-display text-black tracking-tight leading-tight">
              Ingresá el $ReTag
            </h1>

            <div className="px-4 py-3.5 bg-slate-200/60 rounded-2xl flex items-center justify-between gap-3 border border-transparent focus-within:border-slate-300 focus-within:bg-white transition-all">
              <input
                type="text"
                value={lemontagSearch}
                onChange={(e) => setLemontagSearch(e.target.value)}
                placeholder="Buscá por $ReTag"
                className="bg-transparent text-base text-black placeholder-slate-500 font-semibold focus:outline-none w-full"
              />
              <div className="flex items-center gap-2 text-black shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard?.readText();
                      if (text) setLemontagSearch(text.startsWith('$') ? text : `$${text}`);
                    } catch {}
                  }}
                  className="p-1 hover:opacity-70 active:scale-90"
                >
                  <Copy className="w-5 h-5 stroke-[2]" />
                </button>
                <button
                  type="button"
                  onClick={() => setLemontagSearch('$lujyyctz')}
                  className="p-1 hover:opacity-70 active:scale-90"
                >
                  <QrCode className="w-5 h-5 stroke-[2]" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <h2 className="text-sm font-bold font-display text-black">
                Últimos envíos
              </h2>
              <button
                type="button"
                className="w-11 h-11 rounded-full bg-slate-200/80 flex items-center justify-center text-slate-800"
              >
                <Search className="w-4 h-4 stroke-[2.2]" />
              </button>
            </div>

            <div className="bg-white rounded-[32px] p-2 shadow-sm border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {[
                { name: 'Luján Del Rosario Cortez', tag: '$lujyyctz', avatarBg: 'bg-emerald-500', avatarImg: '👾' },
                { name: 'Nicolas Facundo Chaves', tag: '$faccha20', avatarBg: 'bg-yellow-400', avatarImg: '🤠' },
                { name: 'Steven Antonio Galeano Bañol', tag: '$rapsesino', avatarBg: 'bg-orange-300', avatarImg: '🧑‍💻' },
                { name: 'Santiago Fernando Diaz Arak...', tag: '$santiagodiazdj2', avatarBg: 'bg-indigo-500', avatarImg: '⚡' },
                { name: 'Taiel Miranda', tag: '$taiel.miranda.okkk', avatarBg: 'bg-emerald-500', avatarImg: '🐼' },
              ]
                .filter((c) =>
                  lemontagSearch.trim()
                    ? c.name.toLowerCase().includes(lemontagSearch.toLowerCase()) ||
                      c.tag.toLowerCase().includes(lemontagSearch.toLowerCase())
                    : true
                )
                .map((contact) => (
                  <div
                    key={contact.tag}
                    onClick={() => {
                      setSelectedRecipient(contact);
                      setKeypadAmount('0');
                      setCurrentView('send_lemon_amount');
                    }}
                    className="p-3.5 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all rounded-2xl"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className={`w-11 h-11 rounded-full ${contact.avatarBg} p-0.5 flex items-center justify-center overflow-hidden shadow-xs shrink-0`}>
                        <span className="text-xl">{contact.avatarImg}</span>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-black block leading-tight">{contact.name}</span>
                        <span className="text-xs text-slate-400 font-medium block mt-0.5">{contact.tag}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 stroke-[2.5]" />
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: MONTO ENVIAR A $LEMONTAG
         ========================================================================= */}
      {currentView === 'send_lemon_amount' && (
        /* Mismo reparto que en `buy_keypad`: sin `justify-between`, y el sobrante de la
           pantalla lo absorbe el teclado en vez de quedar un hueco arriba. */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f3f4f6] select-none">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('send_lemon')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-sm font-extrabold font-display text-black">
              Enviar {asset.ticker}
            </h2>
            <div className="w-9" />
          </div>

          <div className="flex-1 flex flex-col px-5 pb-6 space-y-4 max-w-sm mx-auto w-full">
            {selectedRecipient && (
              <div className="bg-white rounded-2xl p-3 border border-slate-200/80 flex items-center gap-3 shadow-2xs">
                <div className={`w-10 h-10 rounded-full ${selectedRecipient.avatarBg} flex items-center justify-center shrink-0`}>
                  <span className="text-lg">{selectedRecipient.avatarImg}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-medium block">Destinatario</span>
                  <span className="text-sm font-bold text-black block leading-tight">{selectedRecipient.name}</span>
                  <span className="text-xs font-semibold text-emerald-600">{selectedRecipient.tag}</span>
                </div>
              </div>
            )}

            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 text-center shadow-xs space-y-1">
              <span className="text-xs font-bold uppercase text-slate-400 font-display">
                Monto en {asset.ticker}
              </span>
              <div className="flex items-baseline justify-center font-display">
                <span className="text-4xl font-black text-black tracking-tight">
                  {keypadAmount}
                </span>
                <span className="text-lg font-bold text-slate-400 ml-1.5">{asset.ticker}</span>
              </div>
              <span className="text-[11px] text-slate-400 block pt-1 font-medium">
                Sin comisión · Transferencia instantánea por ReWALLET
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 flex-1 min-h-[232px] auto-rows-fr">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKeypadPress(key)}
                  className="h-full py-3.5 bg-white hover:bg-slate-100 rounded-2xl font-display font-extrabold text-lg text-black active:scale-95 transition-all shadow-2xs flex items-center justify-center cursor-pointer"
                >
                  {key === 'backspace' ? <ArrowLeft className="w-5 h-5 stroke-[2.5]" /> : key}
                </button>
              ))}
            </div>

            {SEND_NOT_AVAILABLE}
          </div>
          <div className="pb-4" />
        </div>
      )}

      {/* =========================================================================
          SUB-VISTA: ENVIAR POR DIRECCIÓN DE BLOCKCHAIN
         ========================================================================= */}
      {currentView === 'send_crypto_address' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentView('send_where')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-base font-extrabold font-display text-black">
              Enviar {asset.name}
            </h2>
            <div className="w-9" />
          </div>

          <div className="px-5 pb-6 space-y-5 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
                Ingresá una dirección de destino
              </h1>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Podés enviar a direcciones compatibles con la red nativa o redes soportadas de {asset.name}.
              </p>
            </div>

            <div className="p-4 bg-slate-100 rounded-3xl flex items-center justify-between gap-2 border border-slate-200">
              <input
                type="text"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Dirección de destino"
                className="bg-transparent text-base text-black placeholder-slate-400 focus:outline-none w-full font-mono font-medium"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard?.readText();
                      if (text) setDestinationAddress(text);
                    } catch {}
                  }}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-black"
                >
                  <Clipboard className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDestinationAddress('0xCcBe254009A4e82B96cD3105B89B2EA68f267a6')}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-black"
                >
                  <QrCode className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="mt-4">{SEND_NOT_AVAILABLE}</div>
          </div>
        </div>
      )}
    </div>
  );
};
