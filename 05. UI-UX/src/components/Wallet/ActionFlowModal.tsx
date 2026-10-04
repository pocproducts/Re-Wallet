import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ArrowLeft,
  Search,
  Copy,
  Check,
  ChevronDown,
  Share2,
  Eye,
  EyeOff,
  Layers,
  ArrowDown,
  ArrowUp,
  Send,
  HelpCircle,
  QrCode,
  Clipboard,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { AssetTradeCard } from '../common';
import { useAssetTrade } from '../../hooks/useAssetTrade';
import type { DepositInfoView } from '../../hooks/useDepositInfo';
import { assetOn, isEvmNetwork, truncateAddress, type DepositNetworkView } from '../../services/depositInfo';
import type { DepositChainId } from '../../types/deposit.types';
import { formatScaledTrimmed, toScaled } from '../../services/portfolio';
import type { PortfolioHolding } from '../../services/portfolio';
import { identityOf } from '../../services/portfolioIdentity';

export type ActionModalType = 'depositar' | 'usar' | 'enviar' | null;

interface ActionFlowModalProps {
  action: ActionModalType;
  onClose: () => void;
  userTag: string;
  /**
   * El catálogo de depósito y las direcciones de esta persona.
   *
   * Viene de `GET /api/deposit-info`. El modal **no** trae ninguna lista propia de
   * redes ni de activos: antes tenía `Bnb Chain (BEP20)` escrita a mano, nueve
   * redes más y un catálogo mock, y ninguna dirección. Todo eso ahora es la
   * respuesta del servidor.
   */
  depositInfo: DepositInfoView;
  /**
   * Los saldos que ya leyó `GET /api/portfolio`.
   *
   * El catálogo de depósito **no** trae saldos —son preguntas distintas— así que
   * la cifra de un activo sale de acá, y cuando no hay lectura la pantalla dice
   * que no pudo leer en lugar de pintar un cero.
   */
  holdings: readonly PortfolioHolding[];
}

export const ActionFlowModal: React.FC<ActionFlowModalProps> = ({
  action,
  onClose,
  userTag,
  depositInfo,
  holdings,
}) => {
  // Estado del flujo
  const [currentStep, setCurrentStep] = useState<string>('initial'); // 'initial' = pantalla lima
  const [selectedCoin, setSelectedCoin] = useState<string>('USDC');
  /**
   * La red elegida, como `chain` del catálogo —no como su nombre.
   *
   * Antes era el texto `'Bnb Chain (BEP20)'`: un nombre de red escrito a mano,
   * que no significaba nada para la billetera que la persona tenía. Ahora es la
   * clave del catálogo, y la dirección sale de **esa** fila.
   */
  const [selectedNetwork, setSelectedNetwork] = useState<DepositChainId | null>(null);
  /** De qué lista de entrada se eligió el activo: cripto o dólares. */
  const [depoSource, setDepoSource] = useState<'crypto' | 'dollars'>('crypto');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [cryptoSearch, setCryptoSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [keypadAmount, setKeypadAmount] = useState('0');
  const [lemontagSearch, setLemontagSearch] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState<{
    name: string;
    tag: string;
    avatarBg: string;
    avatarImg: string;
  } | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  /*
   * El par que se convierte en los dos sentidos.
   *
   * Comprar sale de los Dólares Digitales, que es de dónde entra la plata en este
   * producto, y llega a Bitcoin. Vender es al revés: sale de Bitcoin —lo primero
   * que alguien vende— y llega a los Dólares Digitales.
   */
  const buyTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
  });
  const sellTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
  });
  /** Qué desplegable está abierto, o ninguno. */
  const [sheetSide, setSheetSide] = useState<'source' | 'destination' | null>(null);


  // Cada vez que se abre una acción, inicializar en la pantalla lima
  useEffect(() => {
    if (action) {
      setCurrentStep('initial');
      setKeypadAmount('0');
      setDestinationAddress('');
      setLemontagSearch('');
      setSelectedRecipient(null);
      setSendSuccess(false);
      setSelectedNetwork(null);
      setDepoSource('crypto');
      setSheetSide(null);
    }
  }, [action]);

  /**
   * Abrir un flujo es cambiar de paso y vaciar el monto.
   *
   * El par de cada uno ya sale de `buyTrade` y `sellTrade`, que nacen con sus
   * activos por defecto —comprar desde los Dólares Digitales, vender desde
   * Bitcoin—, así que acá no se tocan los activos. Antes sí se tocaban, y por eso
   * al volver de Vender a Comprar el par se quedaba con lo último elegido.
   */
  const openBuy = () => {
    setKeypadAmount('0');
    setCurrentStep('use_buy');
  };

  const openSell = () => {
    setKeypadAmount('0');
    setCurrentStep('use_sell');
  };

  /* =========================================================================
     DEPÓSITO: TODO LO QUE VIENE DE `/api/deposit-info`
     ========================================================================= */

  /** La red elegida, ya busca en el catálogo. `null` mientras no se eligió. */
  const depositNetwork: DepositNetworkView | null =
    selectedNetwork === null
      ? null
      : (depositInfo.networks.find((network) => network.chain === selectedNetwork) ?? null);

  /** El activo elegido en la red elegida. `null` si esa red no lo sirve. */
  const depositAsset = depositNetwork === null ? null : assetOn(depositNetwork, selectedCoin);

  /**
   * La dirección de esta persona en la red elegida, o `null` si todavía no se
   * sabe. Un `const` a propósito: el estrechamiento de `null` a `string` se
   * conserva dentro de los manejadores, y ningún botón de copiar tiene que
   * repetir un chequeo que ya está hecho.
   */
  const depositAddress: string | null = depositNetwork === null ? null : depositNetwork.address;

  /** El saldo de esta persona para `chain:symbol`, si el portfolio lo leyó. */
  const holdingOf = (chain: DepositChainId, symbol: string): PortfolioHolding | null =>
    holdings.find((holding) => holding.chain === chain && holding.symbol === symbol) ?? null;

  /**
   * El saldo de un activo en todas las redes donde se puede leer, exacto.
   *
   * `null` significa **"no lo sé"**, y la pantalla lo dice. Nunca devuelve `0`
   * por una cadena que no se pudo leer: un cero ahí se ve igual que una
   * billetera vacía, y son dos verdades opuestas.
   *
   * La suma es con `bigint` sobre los `amount` textuales del backend —la misma
   * aritmética de `services/portfolio`—, así que 6 decimales con 18 no pierden
   * ni inventan un dígito.
   */
  const assetBalanceLabel = (symbol: string): string | null => {
    const networks = depositInfo.assets.find((asset) => asset.symbol === symbol)?.networks ?? [];
    const readable = networks.filter((network) => assetOn(network, symbol)?.balanceReadable === true);

    // Nadie sabe leerlo en ninguna red: es un activo recibible sin cifra.
    if (readable.length === 0) return null;

    const found = readable.map((network) => holdingOf(network.chain, symbol));
    // Una red legible sin holding es una cadena que no se pudo leer: el total no existe.
    if (found.some((holding) => holding === null)) return null;

    const known = found.filter((holding): holding is PortfolioHolding => holding !== null);
    const scale = known.reduce((max, holding) => Math.max(max, holding.decimals), 0);
    const total = known.reduce((sum, holding) => sum + toScaled(holding.amount, holding.decimals, scale), 0n);

    return formatScaledTrimmed(total, scale);
  };

  /** Las redes del catálogo donde este activo se puede recibir. */
  const networksForCoin = (symbol: string): readonly DepositNetworkView[] =>
    depositInfo.networks.filter((network) => assetOn(network, symbol) !== null);

  /** `"Monad y Ethereum"`, o `"Monad"`. Los nombres salen del backend. */
  const joinNetworkLabels = (labels: readonly string[]): string => {
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
  };

  /** ¿Hay más de una red EVM en el catálogo? Así vale la pena explicar la regla. */
  const evmNetworkLabels = depositInfo.networks.filter(isEvmNetwork).map((network) => network.label);

  /** Abrir la lista de redes de un activo, guardando de qué lista se viene. */
  const chooseCoin = (symbol: string, source: 'crypto' | 'dollars'): void => {
    setSelectedCoin(symbol);
    setSelectedNetwork(null);
    setDepoSource(source);

    /*
     * Un activo que vive en **una sola** red no hace falta que se pregunte: se va
     * directo a la dirección de esa red. Preguntar "¿cuál?" cuando hay una sola
     * respuesta es una pantalla de más.
     */
    const receivable = networksForCoin(symbol).filter((network) => network.address !== null);
    if (receivable.length === 1 && receivable[0] !== undefined) {
      setSelectedNetwork(receivable[0].chain);
      setCurrentStep('depo_qr_result');
      return;
    }

    setCurrentStep('depo_network_select');
  };

  if (!action) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    try {
      confetti({ particleCount: 20, spread: 40, origin: { y: 0.6 } });
    } catch {}
  };

  const handleKeypadPress = (val: string) => {
    if (val === 'backspace') {
      setKeypadAmount((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'));
    } else if (val === ',') {
      if (!keypadAmount.includes(',')) {
        setKeypadAmount((prev) => prev + ',');
      }
    } else {
      setKeypadAmount((prev) => (prev === '0' ? val : prev + val));
    }
  };

  // =========================================================================
  // 1. PANTALLA INICIAL LIMA (CUBRE TODA LA PANTALLA DENTRO DEL CONTENEDOR MOBILE)
  // =========================================================================
  if (currentStep === 'initial') {
    return (
      <div className="absolute inset-0 z-50 bg-[#ccff00] text-black flex flex-col justify-between px-6 safe-top-6 safe-bottom-6 select-none animate-in fade-in duration-200 overflow-y-auto font-sans w-full max-w-md mx-auto">
        <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full space-y-6 pt-10 pb-4">
          {/* ACCIÓN: DEPOSITAR (Solo Dólares y Crypto) */}
          {action === 'depositar' && (
            <div className="space-y-6">
              <h2 className="text-3xl font-black font-display text-black tracking-tight mb-8">
                ¿Qué querés depositar?
              </h2>

              <div className="space-y-4 flex flex-col items-start">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('depo_where');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Dólares
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('depo_crypto_list');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Crypto
                </button>
              </div>
            </div>
          )}

          {/* ACCIÓN: ENVIAR (Solo Dólar Digital y Crypto) */}
          {action === 'enviar' && (
            <div className="space-y-6">
              <h2 className="text-3xl font-black font-display text-black tracking-tight mb-8">
                ¿Qué querés enviar?
              </h2>

              <div className="space-y-4 flex flex-col items-start">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('send_where');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Dólar Digital
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('send_crypto_list');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Crypto
                </button>
              </div>
            </div>
          )}

          {/* ACCIÓN: USAR (Comprar, Vender, Invertir, Pedir prestado) */}
          {action === 'usar' && (
            <div className="space-y-6">
              <h2 className="text-3xl font-black font-display text-black tracking-tight mb-8">
                ¿Qué querés hacer?
              </h2>

              <div className="space-y-4 flex flex-col items-start">
                <button
                  type="button"
                  onClick={openBuy}
                  className="flex items-baseline gap-2.5 text-left hover:opacity-75 active:scale-95 transition-all cursor-pointer group"
                >
                  <span className="text-4xl sm:text-5xl font-black font-display text-black tracking-tight">
                    Comprar
                  </span>
                  <span className="text-2xl sm:text-3xl font-medium text-black/80">
                    crypto
                  </span>
                </button>

                <button
                  type="button"
                  onClick={openSell}
                  className="flex items-baseline gap-2.5 text-left hover:opacity-75 active:scale-95 transition-all cursor-pointer group"
                >
                  <span className="text-4xl sm:text-5xl font-black font-display text-black tracking-tight">
                    Vender
                  </span>
                  <span className="text-2xl sm:text-3xl font-medium text-black/80">
                    crypto
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* BOTÓN CIRCULAR NEGRO FLOTANTE CON X EN COLOR LIMA */}
        <div className="flex justify-end pb-4 pr-1 shrink-0">
          <button
            onClick={() => {
              setCurrentStep('initial');
              onClose();
            }}
            type="button"
            aria-label="Cerrar"
            title="Cerrar"
            className="w-16 h-16 rounded-full bg-black flex items-center justify-center shadow-[0_8px_25px_rgba(0,0,0,0.3)] active:scale-90 transition-transform cursor-pointer border border-slate-800"
          >
            <X className="w-7 h-7 text-[#ccff00] stroke-[3]" />
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // SUB-PANTALLAS / FLUJOS SEGÚN LAS CAPTURAS ADJUNTAS
  // =========================================================================

  return (
    <div className="absolute inset-0 z-50 bg-[#f3f4f6] text-black flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans w-full max-w-md mx-auto">
      {/* =====================================================================
          FLUJO DEPOSITAR DÓLARES: PASO 1 (IMG_4522.PNG)
         ===================================================================== */}
      {currentStep === 'depo_where' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('initial')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-6 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
                Elegí desde dónde vas a depositar
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                Ingresá monedas estables, Dólares o Euros y recibí Dólares digitales.
              </p>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
              {/* Opción 1: Desde otra cuenta ReWALLET */}
              <div
                onClick={() => setCurrentStep('depo_lemon_account')}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-black text-[#ccff00] flex items-center justify-center font-display font-black text-xs">
                    Re
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block">
                      Desde otra cuenta ReWALLET
                    </span>
                    <span className="text-xs text-slate-400 font-medium">
                      Gratis e instantáneo.
                    </span>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
              </div>

              {/* Opción 2: Desde una wallet crypto */}
              <div
                onClick={() => setCurrentStep('depo_coin_select')}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-black">
                    <Layers className="w-5 h-5 stroke-[2]" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block">
                      Desde una wallet crypto
                    </span>
                    <span className="text-xs text-slate-400 font-medium">
                      Desde tu cuenta ReWALLET.
                    </span>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO DEPOSITAR DÓLARES: DESDE OTRA CUENTA REWALLET
         ===================================================================== */}
      {currentStep === 'depo_lemon_account' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          {/* Header con flecha atrás + Título centrado */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentStep('depo_where')}
              type="button"
              aria-label="Volver"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h1 className="text-base font-extrabold font-display text-black tracking-tight">
              Depositá Dólares digitales
            </h1>
            <div className="w-9" />
          </div>

          <div className="px-4 pb-8 space-y-4 max-w-md mx-auto w-full">
            {/* CARD 1: BLANCA CON RED REWALLET, QR CON AVATAR, RETAG Y BOTÓN COMPARTIR */}
            <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-5 text-center">
              {/* Red ReWALLET */}
              <div className="flex items-center gap-3 text-left">
                <div className="w-8 h-8 rounded-full bg-black p-1 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200/60">
                  <div className="w-full h-full rounded-full bg-black text-[#ccff00] flex items-center justify-center font-display font-black text-[11px]">
                    Re
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-medium block leading-none">
                    Red
                  </span>
                  <span className="text-sm font-bold text-black leading-tight">
                    ReWALLET
                  </span>
                </div>
              </div>

              {/* QR Code Grande con Avatar Central */}
              <div className="relative w-64 h-64 mx-auto bg-black p-3.5 rounded-[32px] flex items-center justify-center shadow-xs">
                <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center p-3 relative overflow-hidden">
                  <QrCode className="w-full h-full text-black stroke-[1.15]" />
                  {/* Avatar Central en el QR con aro blanco */}
                  <div className="w-14 h-14 rounded-full border-[3.5px] border-white bg-gradient-to-tr from-amber-200 via-emerald-300 to-teal-400 p-0.5 shadow-lg flex items-center justify-center absolute overflow-hidden">
                    <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-base font-bold text-[#ccff00]">
                      👾
                    </div>
                  </div>
                </div>
              </div>

              {/* ReTag + Botón de Copiar */}
              <div className="text-left space-y-1 pt-1">
                <span className="text-xs text-slate-400 font-medium block">
                  Tu $ReTag
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-black font-display text-black tracking-tight">
                    {userTag || '$joadata'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(userTag || '$joadata')}
                    aria-label="Copiar ReTag"
                    className="p-2 text-black hover:text-slate-600 active:scale-90 transition-transform cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-6 h-6 text-emerald-600 stroke-[2.5]" />
                    ) : (
                      <Copy className="w-6 h-6 stroke-[2.2]" />
                    )}
                  </button>
                </div>
              </div>

              {/* Botón Compartir datos */}
              <button
                type="button"
                onClick={() => {
                  if (navigator.share) {
                    navigator
                      .share({
                        title: 'Mi ReTag',
                        text: `Envíame dólares digitales por ReWALLET a mi $ReTag: ${userTag || '$joadata'}`,
                      })
                      .catch(() => {});
                  } else {
                    handleCopy(userTag || '$joadata');
                  }
                }}
                className="w-full py-4 rounded-2xl bg-[#141416] hover:bg-black text-white font-bold text-sm text-center active:scale-98 transition-all cursor-pointer shadow-sm"
              >
                Compartir datos
              </button>
            </div>

            {/* CARD 2: VERDE LIMA DE INFORMACIÓN IMPORTANTE */}
            <div className="bg-[#ccff00] rounded-[28px] p-6 space-y-4 shadow-xs">
              <h3 className="text-base font-extrabold font-display text-black">
                Información Importante
              </h3>

              <div className="space-y-1">
                <span className="text-xs text-black/75 font-semibold block">
                  Comisión
                </span>
                <p className="text-base font-black font-display text-black leading-tight">
                  Sin comisiones
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-black/75 font-semibold block">
                  Acreditación
                </span>
                <p className="text-base font-black font-display text-black leading-tight">
                  Instantánea
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO DEPOSITAR DÓLARES: PASO 2 (IMG_4525.PNG)
         ===================================================================== */}
      {currentStep === 'depo_coin_select' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('depo_where')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-6 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
                Elegí qué moneda vas a depositar
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                Depositá cualquiera de las siguientes monedas y recibí Dólares digitales.
              </p>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
              {/*
                Este camino lista **lo que el catálogo declara como dólar**, en
                Monad y en Ethereum. No hay una lista propia acá: cuando USDT
                entre al catálogo aparece solo, sin tocar esta pantalla.
              */}
              {depositInfo.dollarAssets.map((coin) => (
                <div
                  key={coin.symbol}
                  onClick={() => chooseCoin(coin.symbol, 'dollars')}
                  className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    {(() => {
                      // La identidad visual sale del catalogo de la app, no de
                      // esta fila: el color y el glifo son presentacion, y esta
                      // pantalla ya no lleva su propia lista de activos.
                      const identity = identityOf(coin.symbol);
                      return (
                        <div
                          className={`w-10 h-10 rounded-full ${identity?.iconBg ?? 'bg-slate-400'} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}
                        >
                          {identity?.glyph ?? coin.symbol.slice(0, 1)}
                        </div>
                      );
                    })()}
                    <span className="text-base font-bold text-black">
                      {coin.name}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          DEPÓSITO: PASO "RED" — las redes del catálogo donde el activo se puede
          recibir.

          Antes esta pantalla tenía cuatro redes "más usadas" y nueve en un
          desplegable, todas escritas a mano: BNB, Polygon, Ethereum, Solana,
          Arbitrum, Base, CELO, ZKsync… Ninguna decía nada de esta billetera, y
          elegir una no cambiaba nada porque la dirección que venía después era
          siempre la misma y estaba escrita a mano también.

          Ahora la lista es la del backend y cada fila dice la verdad de esa red
          para esta persona: o tiene una dirección, o no la tiene y se lo dice.
         ===================================================================== */}
      {currentStep === 'depo_network_select' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep(depoSource === 'crypto' ? 'depo_crypto_list' : 'depo_coin_select')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-4 max-w-md mx-auto w-full">
            <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
              Elegí en qué red vas a depositar {selectedCoin}
            </h1>

            {depositInfo.status === 'loading' && (
              <p className="text-sm text-slate-500 font-medium">Buscando en qué redes podés recibir…</p>
            )}

            {/*
              Un activo que el catálogo no sirve. Se lo dice sin inventar redes:
              antes, elegir USDS abría la lista de BNB y Ethereum y terminaba en
              una dirección que no era de nadie.
            */}
            {depositInfo.status === 'ready' && networksForCoin(selectedCoin).length === 0 && (
              <div className="bg-white rounded-3xl border border-slate-200/80 p-5 space-y-1.5">
                <p className="text-sm font-bold text-black">
                  Todavía no podemos recibir {selectedCoin}.
                </p>
                <p className="text-xs text-slate-500 font-medium leading-snug">
                  Las redes y los activos que ReWALLET soporta hoy salen de{' '}
                  {joinNetworkLabels(depositInfo.assets.map((asset) => asset.name))}. Depositá{' '}
                  {depositInfo.assets.map((asset) => asset.symbol).join(' o ')} y te lo acreditamos.
                </p>
              </div>
            )}

            {depositInfo.status === 'error' && (
              <div className="bg-white rounded-3xl border border-slate-200/80 p-5 space-y-1.5">
                <p className="text-sm font-bold text-black">No pudimos leer tus direcciones.</p>
                <p className="text-xs text-slate-500 font-medium leading-snug">
                  Sin la dirección real de esta persona no hay a dónde recibir, así que no te
                  mostramos ninguna red. Probá de nuevo en un momento.
                </p>
              </div>
            )}

            {/* Sólo las redes del catálogo donde este activo existe. */}
            {networksForCoin(selectedCoin).map((network) => {
              const asset = assetOn(network, selectedCoin);
              const identity = identityOf(selectedCoin);
              const receivable = network.address !== null;

              return (
                <div
                  key={network.chain}
                  onClick={() => {
                    if (!receivable || asset === null) return;
                    setSelectedNetwork(network.chain);
                    setCurrentStep('depo_qr_result');
                  }}
                  className={
                    receivable
                      ? 'p-4 bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors'
                      : 'p-4 bg-slate-100 rounded-3xl border border-slate-200/80 flex items-center justify-between'
                  }
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-full ${identity?.iconBg ?? 'bg-slate-300'} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}
                    >
                      {identity?.glyph ?? network.label.slice(0, 1)}
                    </div>
                    <div>
                      <span className="text-sm font-bold text-black block">{network.label}</span>
                      <span className="text-xs text-slate-400 font-medium block leading-tight">
                        {/*
                          Sin billetera no hay adónde recibir. Se lo dice en la fila, no
                          se oculta la fila: una red que desaparece sin explicación
                          parece un producto roto.
                        */}
                        {receivable
                          ? `Recibís en esta dirección de ${network.label}`
                          : `No tenés una billetera en ${network.label}`}
                      </span>
                    </div>
                  </div>
                  {receivable ? (
                    <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5] shrink-0" />
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0">
                      Sin destino
                    </span>
                  )}
                </div>
              );
            })}

            {/*
              La lista es la de la app, y se dice. Antes la pantalla insinuarba
              nueve redes y ninguna era de esta billetera.
            */}
            {depositInfo.status === 'ready' && networksForCoin(selectedCoin).length > 0 && (
              <p className="text-xs text-slate-500 font-medium leading-relaxed px-1">
                Éstas son todas las redes en las que ReWALLET puede recibir {selectedCoin} hoy.
              </p>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          DEPÓSITO: PASO "DIRECCIÓN" — el activo, la red y la dirección pegados.

          La fila de la red y la fila de la dirección están en la misma tarjeta,
          y el aviso de "otra red = fondos perdidos" va debajo de las dos. La
          dirección real viene de `/api/deposit-info`; antes venía de una
          constante escrita a mano en este archivo.
         ===================================================================== */}
      {currentStep === 'depo_qr_result' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('depo_network_select')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-8 space-y-4 max-w-md mx-auto w-full">
            <h1 className="text-2xl font-black font-display text-black tracking-tight text-center leading-tight">
              Depositá {selectedCoin}
            </h1>

            {/*
              Sin red elegida, sin destino. Puede pasar si el backend todavía no
              respondió: se dice, y no se muestra ninguna dirección.
            */}
            {(depositNetwork === null || depositAddress === null) && (
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 space-y-2 text-center">
                <HelpCircle className="w-8 h-8 text-slate-400 mx-auto stroke-[1.8]" />
                <p className="text-sm font-bold text-black">No pudimos leer tu dirección de depósito.</p>
                <p className="text-xs text-slate-500 font-medium leading-snug">
                  No te mostramos ninguna: una dirección inventada manda tu plata a otra
                  billetera.
                </p>
              </div>
            )}

            {depositNetwork !== null && depositAddress !== null && (
              <>
                {/* Card Principal con QR */}
                <div className="bg-white rounded-[32px] p-6 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 space-y-4 text-center">
                  <div className="text-left space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 text-black flex items-center justify-center text-xs font-bold">
                        {(identityOf(selectedCoin)?.glyph ?? selectedCoin.slice(0, 1))}
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 font-bold uppercase block leading-none">Depositás</span>
                        <span className="text-xs font-extrabold text-black">
                          {depositAsset?.name ?? selectedCoin}
                        </span>
                      </div>
                    </div>

                    {/*
                      LA RED, EN LA MISMA TARJETA QUE LA DIRECCIÓN.

                      Es la regla del diseño de esta pantalla: una dirección nunca
                      aparece sin la red a la que pertenece al lado. La misma
                      dirección EVM sirve en Ethereum y en Monad —por eso la
                      repetimos—, y sin la fila de al lado "la misma" se lee como
                      "cualquiera de las dos".
                    */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-black text-[#ccff00] flex items-center justify-center text-xs font-bold">
                        {depositNetwork.label.slice(0, 1)}
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 font-bold uppercase block leading-none">Red</span>
                        <span className="text-xs font-extrabold text-black">{depositNetwork.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* QR con icono central */}
                  <div className="w-56 h-56 mx-auto bg-black p-3 rounded-3xl flex items-center justify-center relative shadow-md">
                    <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center p-3 relative">
                      <QrCode className="w-full h-full text-black stroke-[1.2]" />
                      <div className="w-10 h-10 rounded-xl bg-black text-[#ccff00] flex items-center justify-center font-bold absolute text-sm shadow-md">
                        {depositNetwork.label.slice(0, 1)}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] font-semibold text-slate-400 text-center">
                    QR de tu dirección de {depositNetwork.label}
                  </p>

                  {/*
                    Dirección RECORTADA, con copiar la completa al lado.

                    Se muestra recortada siempre porque una dirección entera escrita
                    a mano se transcribe mal, y una dirección mal transcrita no da
                    error: manda el depósito a ninguna parte. El botón copia la
                    completa, que es lo que se pega en un exchange.
                  */}
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-400 font-bold block text-left">
                      Dirección para {depositNetwork.label}
                    </span>
                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                      <span className="font-mono text-sm font-bold text-black tracking-tight">
                        {truncateAddress(depositAddress)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(depositAddress)}
                          aria-label={`Copiar la dirección completa de ${depositNetwork.label}`}
                          title="Copiar la dirección completa"
                          className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:text-black cursor-pointer"
                        >
                          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {copied && (
                      <p className="text-[11px] font-semibold text-emerald-600 text-left">
                        Dirección completa copiada.
                      </p>
                    )}
                  </div>

                  {/* Botón negro: Compartir datos */}
                  <button
                    type="button"
                    onClick={() => handleCopy(depositAddress)}
                    className="w-full py-3.5 rounded-2xl bg-black hover:bg-slate-900 active:scale-98 text-white font-bold text-sm shadow-md transition-all cursor-pointer"
                  >
                    Copiar dirección completa
                  </button>
                </div>

                {/* Advertencia */}
                <p className="text-xs text-slate-600 text-center leading-relaxed px-2 font-semibold">
                  Asegurate de mandar {selectedCoin} por la red {depositNetwork.label}. Si lo mandás
                  por otra red, perdés los fondos.
                </p>

                {/*
                  EL SALDO, O LA AUSENCIA DE SALDO.

                  Un activo sin lector, o una cadena que no se pudo leer, dicen que
                  no se pudo leer. Nunca muestran `0`: un cero afirma una
                  recepción que nadie verificó, y en un producto de pagos eso no
                  es un detalle de formato.
                */}
                <div className="bg-white rounded-3xl border border-slate-200/80 p-4 text-left">
                  <span className="text-[11px] text-slate-400 font-bold uppercase block leading-none">
                    Tu saldo de {selectedCoin}
                  </span>
                  {depositAsset !== null && depositAsset.balanceReadable && assetBalanceLabel(selectedCoin) !== null ? (
                    <span className="text-base font-black font-display text-black">
                      {assetBalanceLabel(selectedCoin)} {selectedCoin}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-slate-500">
                      No pudimos leer tu saldo de {selectedCoin} en {depositNetwork.label}.
                    </span>
                  )}
                </div>

                {/*
                  LA REGLA DE LAS DIRECCIONES EVM, DICHA.

                  No es una nota técnica: es la explicación de por qué la misma
                  dirección aparece en Ethereum y en Monad, y de por qué una
                  billetera EVM puede recibir un token que esta app todavía no
                  lista. Y se aclara que lo que la app lista es una decisión del
                  producto, no un límite de la billetera.
                */}
                {isEvmNetwork(depositNetwork) && evmNetworkLabels.length > 1 && (
                  <div className="bg-[#ccff00] text-black p-5 rounded-3xl space-y-2 shadow-md font-sans">
                    <h3 className="text-sm font-extrabold font-display">Tu dirección en las redes EVM</h3>
                    <p className="text-xs font-medium leading-relaxed">
                      Esta misma dirección sirve en {joinNetworkLabels(evmNetworkLabels)}: es una sola
                      billetera EVM y puede recibir cualquier token de esas redes, aunque no esté
                      en la lista de arriba.
                    </p>
                    <p className="text-xs font-medium leading-relaxed">
                      La lista de esta pantalla es lo que ReWALLET soporta hoy, no lo que tu
                      billetera puede recibir.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          DEPÓSITO: PASO "ACTIVO" — la lista de activos sale del backend.

          Antes eran seis filas escritas a mano —BTC, ETH, USDT, USDC, USDS,
          PYUSD—, tres de ellas para activos que esta billetera no tiene
          contrato con el que recibirlos y dos para redes que no aparecen en el
          catálogo. Elegir cualquiera terminaba en la misma dirección falsa.
         ===================================================================== */}
      {currentStep === 'depo_crypto_list' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('initial')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-4 max-w-md mx-auto w-full">
            <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
              Ingresar crypto
            </h1>

            {/* Buscador */}
            <div className="relative">
              <input
                type="text"
                value={cryptoSearch}
                onChange={(e) => setCryptoSearch(e.target.value)}
                placeholder="Buscar"
                className="w-full min-h-[46px] bg-slate-100 border border-transparent focus:border-black rounded-2xl pl-10 pr-4 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            </div>

            {depositInfo.status === 'loading' && (
              <p className="text-sm text-slate-500 font-medium">Cargando los activos que podés recibir…</p>
            )}

            {depositInfo.status === 'error' && (
              <div className="bg-white rounded-3xl border border-slate-200/80 p-5 space-y-1.5">
                <p className="text-sm font-bold text-black">No pudimos leer qué se puede recibir.</p>
                <p className="text-xs text-slate-500 font-medium leading-snug">
                  Preferimos no mostrarte una lista inventada: una dirección equivocada acá no da
                  error, te hace perder el depósito.
                </p>
              </div>
            )}

            {depositInfo.status === 'ready' && depositInfo.cryptoAssets.length === 0 && (
              <p className="text-sm text-slate-500 font-medium">
                Todavía no hay ningún activo configurado para recibir.
              </p>
            )}

            {/*
              Una fila por ACTIVO, con las redes donde se puede recibir al lado.
              Elegir un activo que vive en dos redes lleva a la pantalla de redes:
              la dirección depende de la red elegida.
            */}
            {depositInfo.cryptoAssets
              .filter(
                (asset) =>
                  cryptoSearch.trim().length === 0 ||
                  asset.symbol.toLowerCase().includes(cryptoSearch.trim().toLowerCase()) ||
                  asset.name.toLowerCase().includes(cryptoSearch.trim().toLowerCase()),
              )
              .map((asset) => {
                const identity = identityOf(asset.symbol);
                const balance = assetBalanceLabel(asset.symbol);

                return (
                  <div
                    key={asset.symbol}
                    onClick={() => chooseCoin(asset.symbol, 'crypto')}
                    className="p-4 mb-2 bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] flex items-center justify-between cursor-pointer hover:bg-slate-50 active:scale-99 transition-all"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-full ${identity?.iconBg ?? 'bg-slate-300'} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}
                      >
                        {identity?.glyph ?? asset.symbol.slice(0, 1)}
                      </div>
                      <div>
                        <span className="text-sm font-extrabold text-black block leading-none">{asset.symbol}</span>
                        <span className="text-xs text-slate-400 font-medium block mt-0.5">{asset.name}</span>
                        <span className="text-[11px] text-slate-400 font-medium block mt-0.5">
                          {/*
                            Las redes van en la fila del activo, no en una lista aparte: la
                            pregunta "¿en qué red?" tiene que aparecer antes de la
                            dirección, no después.
                          */}
                          {asset.receivableNetworkCount === 0
                            ? 'Todavía no tenés dónde recibirlo'
                            : joinNetworkLabels(asset.networks.map((network) => network.label))}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      {/* `null` es "no lo sé": no se pinta un cero. */}
                      <span className="text-sm font-extrabold text-black block leading-none">
                        {balance === null ? '—' : balance}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5] ml-auto mt-1" />
                    </div>
                  </div>
                );
              })}

            <p className="text-xs text-slate-500 font-medium leading-relaxed px-1">
              Estos son los activos que ReWALLET puede recibir hoy. Elegí uno y después la red.
            </p>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR DÓLAR DIGITAL: PASO 1 (IMG_4529.PNG, IMG_4530.PNG)
         ===================================================================== */}
      {currentStep === 'send_where' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('initial')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-6 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
                Elegí a dónde vas a enviar
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                Enviás dólares digitales como monedas estables o dólares.
              </p>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
              {/* Opción 1: A otra cuenta ReWALLET */}
              <div
                onClick={() => setCurrentStep('send_lemon_account')}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-black text-[#ccff00] flex items-center justify-center font-display font-black text-xs">
                    Re
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block">A otra cuenta ReWALLET</span>
                    <span className="text-xs text-slate-400 font-medium">Gratis e instantáneo.</span>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
              </div>

              {/* Opción 2: A una wallet crypto */}
              <div
                onClick={() => setCurrentStep('send_coin_select')}
                className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-black">
                    <Layers className="w-5 h-5 stroke-[2]" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block">A una wallet crypto</span>
                    <span className="text-xs text-slate-400 font-medium">Desde tu cuenta ReWALLET.</span>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR DÓLAR DIGITAL: A OTRA CUENTA REWALLET
         ===================================================================== */}
      {currentStep === 'send_lemon_account' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          {/* Header con flecha atrás */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentStep('send_where')}
              type="button"
              aria-label="Volver"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <div className="w-9" />
          </div>

          <div className="px-5 pb-8 space-y-4 max-w-md mx-auto w-full">
            {/* Título */}
            <h1 className="text-xl font-black font-display text-black tracking-tight leading-tight">
              Ingresá el $ReTag
            </h1>

            {/* Input Buscá por $ReTag */}
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
                  aria-label="Pegar del portapapeles"
                  title="Pegar"
                  className="p-1 hover:opacity-70 active:scale-90 transition-transform cursor-pointer"
                >
                  <Copy className="w-5 h-5 stroke-[2]" />
                </button>
                <button
                  type="button"
                  onClick={() => setLemontagSearch('$lujyyctz')}
                  aria-label="Escanear QR"
                  title="Escanear QR"
                  className="p-1 hover:opacity-70 active:scale-90 transition-transform cursor-pointer"
                >
                  <QrCode className="w-5 h-5 stroke-[2]" />
                </button>
              </div>
            </div>

            {/* Cabecera de Últimos Envíos con Lupa */}
            <div className="flex items-center justify-between pt-1">
              <h2 className="text-sm font-bold font-display text-black">
                Últimos envíos
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (lemontagSearch) setLemontagSearch('');
                }}
                aria-label="Buscar en últimos envíos"
                className="w-11 h-11 rounded-full bg-slate-200/80 flex items-center justify-center text-slate-800 hover:bg-slate-300 active:scale-90 transition-all cursor-pointer"
              >
                <Search className="w-4 h-4 stroke-[2.2]" />
              </button>
            </div>

            {/* Lista de Contactos según la imagen adjunta */}
            <div className="bg-white rounded-[32px] p-2 shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {[
                {
                  name: 'Luján Del Rosario Cortez',
                  tag: '$lujyyctz',
                  avatarBg: 'bg-emerald-500',
                  avatarImg: '👾',
                },
                {
                  name: 'Nicolas Facundo Chaves',
                  tag: '$faccha20',
                  avatarBg: 'bg-yellow-400',
                  avatarImg: '🤠',
                },
                {
                  name: 'Steven Antonio Galeano Bañol',
                  tag: '$rapsesino',
                  avatarBg: 'bg-orange-300',
                  avatarImg: '🧑‍💻',
                },
                {
                  name: 'Santiago Fernando Diaz Arak...',
                  tag: '$santiagodiazdj2',
                  avatarBg: 'bg-indigo-500',
                  avatarImg: '⚡',
                },
                {
                  name: 'Taiel Miranda',
                  tag: '$taiel.miranda.okkk',
                  avatarBg: 'bg-emerald-500',
                  avatarImg: '🐼',
                },
              ]
                .filter((contact) =>
                  lemontagSearch.trim()
                    ? contact.name.toLowerCase().includes(lemontagSearch.toLowerCase()) ||
                      contact.tag.toLowerCase().includes(lemontagSearch.toLowerCase())
                    : true
                )
                .map((contact) => (
                  <div
                    key={contact.tag}
                    onClick={() => {
                      setSelectedRecipient(contact);
                      setKeypadAmount('0');
                      setCurrentStep('send_lemon_amount');
                    }}
                    className="p-3.5 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all rounded-2xl"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className={`w-11 h-11 rounded-full ${contact.avatarBg} p-0.5 flex items-center justify-center overflow-hidden shadow-xs shrink-0`}>
                        <span className="text-xl">{contact.avatarImg}</span>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-black block leading-tight">
                          {contact.name}
                        </span>
                        <span className="text-xs text-slate-400 font-medium block mt-0.5">
                          {contact.tag}
                        </span>
                      </div>
                    </div>
                    <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR DÓLAR DIGITAL: PASO DE MONTO A CUENTA LEMON
         ===================================================================== */}
      {currentStep === 'send_lemon_amount' && (
        /* Mismo reparto que en `use_buy`: el bloque completo ya no se empuja contra el
           borde inferior, y el sobrante lo absorbe el teclado. */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f3f4f6] select-none">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentStep('send_lemon_account')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-sm font-extrabold font-display text-black">
              Enviar Dólar Digital
            </h2>
            <div className="w-9" />
          </div>

          <div className="flex-1 flex flex-col px-5 pb-6 space-y-4 max-w-sm mx-auto w-full">
            {/* Destinatario seleccionado */}
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

            {/* Display de monto */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 text-center shadow-xs space-y-1">
              <span className="text-xs font-bold uppercase text-slate-400 font-display">
                Monto a Enviar
              </span>
              <div className="flex items-baseline justify-center font-display">
                <span className="text-2xl font-bold text-slate-400 mr-1">U$</span>
                <span className="text-5xl font-black text-black tracking-tight">
                  {keypadAmount}
                </span>
              </div>
              <span className="text-[11px] text-slate-400 block pt-1 font-medium">
                Sin comisión · Transferencia instantánea por ReWALLET
              </span>
            </div>

            {/* Teclado numérico: crece con la pantalla para no dejar hueco muerto */}
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

            {/* Botón de Enviar */}
            <button
              onClick={() => {
                if (keypadAmount === '0' || keypadAmount === '0,') {
                  return;
                }
                confetti({ particleCount: 50, spread: 60 });
                setSendSuccess(true);
                setTimeout(() => {
                  onClose();
                }, 1800);
              }}
              type="button"
              className="w-full py-4 rounded-2xl bg-[#ccff00] hover:bg-[#b8e600] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              {sendSuccess ? '✓ ¡Transferencia enviada!' : `Enviar U$ ${keypadAmount}`}
            </button>
          </div>
          <div className="pb-4" />
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR DÓLAR DIGITAL: PASO 2 SELECCIONAR MONEDA (IMG_4535.PNG)
         ===================================================================== */}
      {currentStep === 'send_coin_select' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('send_where')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-6 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
                Seleccioná qué moneda querés enviar
              </h1>
              <p className="text-sm text-slate-500 font-medium">
                Enviá dólares digitales en el formato que quieras.
              </p>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
              {[
                { symbol: 'USDC', bg: 'bg-[#2775CA]', icon: '$' },
                { symbol: 'USDT', bg: 'bg-[#26A17B]', icon: '₮' },
                { symbol: 'USDS', bg: 'bg-[#F5AC37]', icon: 'S' },
              ].map((coin) => (
                <div
                  key={coin.symbol}
                  onClick={() => {
                    setSelectedCoin(coin.symbol);
                    setCurrentStep('send_dest_input');
                  }}
                  className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    <div className={`w-10 h-10 rounded-full ${coin.bg} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}>
                      {coin.icon}
                    </div>
                    <span className="text-base font-bold text-black">{coin.symbol}</span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR: PASO 3 DIRECCIÓN DE DESTINO (IMG_4534.PNG)
         ===================================================================== */}
      {currentStep === 'send_dest_input' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('send_where')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-5 max-w-md mx-auto w-full">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
                Ingresá una dirección de destino
              </h1>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Podés enviar a direcciones de billeteras que pertenezcan a la red Arbitrum, Base, Bnb Chain (BEP20), CELO, Ethereum (ERC20), Monad, Optimism, Polygon, Solana, Stellar o ZKsync Era.
              </p>
            </div>

            {/* Input dirección con Pegar y QR */}
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
                  title="Pegar del portapapeles"
                  className="p-1.5 rounded-lg text-slate-600 hover:text-black"
                >
                  <Clipboard className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDestinationAddress('0xCcBe254009A4e82B96cD3105B89B2EA68f267a6')}
                  title="Escanear QR"
                  className="p-1.5 rounded-lg text-slate-600 hover:text-black"
                >
                  <QrCode className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mi Agenda */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-black font-display">Mi agenda</span>
                <button
                  type="button"
                  className="px-3 py-1 rounded-full bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  Agregar billetera
                </button>
              </div>

              <div
                onClick={() => setDestinationAddress('0xCcBe254009A4e82B96cD3105B89B2EA68f267a6')}
                className="p-4 bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm">
                    ◎
                  </div>
                  <div>
                    <span className="text-sm font-bold text-black block leading-none">Prueba ReWALLET</span>
                    <span className="text-xs font-mono text-slate-400 block mt-1">0xcCbe254...EA68f267a6</span>
                  </div>
                </div>
                <span className="text-slate-400 font-bold">•••</span>
              </div>
            </div>

            <button
              onClick={() => {
                confetti({ particleCount: 30, spread: 50 });
                alert(`Envío programado de ${selectedCoin} a ${destinationAddress || '0xcCbe...7a6'}`);
                onClose();
              }}
              type="button"
              className="w-full py-4 rounded-full bg-[#ccff00] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform mt-4"
            >
              Continuar al envío
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR CRYPTO: PASO 1 (SELECCIÓN DE MONEDA)
         ===================================================================== */}
      {currentStep === 'send_crypto_list' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
          <div className="p-4 pt-5">
            <button
              onClick={() => setCurrentStep('initial')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>

          <div className="px-5 pb-6 space-y-4 max-w-md mx-auto w-full">
            <h1 className="text-2xl font-black font-display text-black tracking-tight leading-tight">
              Enviar crypto
            </h1>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-[0_4px_25px_rgba(0,0,0,0.03)] divide-y divide-slate-100 overflow-hidden">
              {[
                { symbol: 'BTC', name: 'Bitcoin', bg: 'bg-[#F7931A]', icon: '₿' },
                { symbol: 'ETH', name: 'Ethereum', bg: 'bg-[#627EEA]', icon: 'Ξ' },
                { symbol: 'SOL', name: 'Solana', bg: 'bg-black text-[#14F195]', icon: '◎' },
                { symbol: 'USDT', name: 'Tether USD', bg: 'bg-[#26A17B]', icon: '₮' },
              ].map((c) => (
                <div
                  key={c.symbol}
                  onClick={() => {
                    setSelectedCoin(c.symbol);
                    setCurrentStep('send_dest_input');
                  }}
                  className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    <div className={`w-10 h-10 rounded-full ${c.bg} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}>
                      {c.icon}
                    </div>
                    <div>
                      <span className="text-sm font-extrabold text-black block leading-none">{c.symbol}</span>
                      <span className="text-xs text-slate-400 font-medium block mt-0.5">{c.name}</span>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO USAR: COMPRAR CRYPTO (ESTILO REUTILIZABLE A CAMBIAR SIN INVERTIR)
         ===================================================================== */}
      {currentStep === 'use_buy' && (
        /*
         * `justify-between` empujaba el bloque entero contra el borde inferior y dejaba
         * un hueco muerto entre el header y la tarjeta. Ahora la tarjeta vive pegada al
         * header y el grupo botón + teclado va justo debajo: no queda espacio basura ni
         * arriba ni en el medio.
         *
         * Lo que sobra de la pantalla lo absorbe el TECLADO (`flex-1 auto-rows-fr`),
         * no un hueco: en un teléfono alto las teclas crecen hasta llenar la pantalla y
         * quedan al alcance del pulgar; en uno bajo caen a su tamaño natural
         * (`min-h-[212px]`, 4 filas de 48px más gaps) y la pantalla scrollea en vez de
         * recortar. `pb-6` evita que la última fila quede pegada al borde o debajo de
         * la barra del teléfono.
         */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f8f9fa] select-none">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentStep('initial')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-base font-extrabold font-display text-black">Comprar</h2>
            <div className="w-9" />
          </div>

          <div className="px-5 pt-1 max-w-sm mx-auto w-full">
            <AssetTradeCard
              trade={buyTrade}
              sourceTitle="Quiero usar"
              destinationTitle="Para comprar"
              sourcePickerLabel="Elegir la moneda de la que querés salir"
              destinationPickerLabel="Elegir la moneda que querés comprar"
            />
          </div>

          <div className="flex-1 flex flex-col px-5 pt-3 pb-6 space-y-3 max-w-sm mx-auto w-full">
            <button
              onClick={() => {
                confetti({ particleCount: 30, spread: 50 });
                alert(`¡Compra de ${buyTrade.destination.ticker} completada exitosamente!`);
                onClose();
              }}
              disabled={keypadAmount === '0'}
              type="button"
              className="w-full py-4 rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continuar
            </button>

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

      {/* =====================================================================
          FLUJO USAR: VENDER CRYPTO (ESTILO REUTILIZABLE A CAMBIAR SIN INVERTIR)
         ===================================================================== */}
      {currentStep === 'use_sell' && (
        /* Mismo reparto que en `use_buy`: la tarjeta arriba, el teclado abajo. */
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f8f9fa] select-none">
          {/* Header */}
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentStep('initial')}
              type="button"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs hover:bg-slate-50 cursor-pointer border border-slate-200/60"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-base font-extrabold font-display text-black">Vender</h2>
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
            <button
              onClick={() => {
                confetti({ particleCount: 30, spread: 50 });
                alert(`¡Venta de ${sellTrade.destination.ticker} completada exitosamente!`);
                onClose();
              }}
              disabled={keypadAmount === '0'}
              type="button"
              className="w-full py-4 rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continuar
            </button>

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
    </div>
  );
};
