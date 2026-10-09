import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import { BalancePieceRow } from '../Investments/BalancePieceRow';
import { byUsdValueDesc } from '../../services/walletBalance';
import type { WalletBalancePart } from '../../services/walletBalance';
import type { WalletBalanceScreenView } from '../../hooks/useWalletBalance';
import { QrScannerModal } from './QrScannerModal';
import { TRADE_UNAVAILABLE_TEXT, useAssetTrade, useTradeCatalog } from '../../hooks/useAssetTrade';
import type { DepositInfoView } from '../../hooks/useDepositInfo';
import { assetOn, isEvmNetwork, truncateAddress, type DepositNetworkView } from '../../services/depositInfo';
import type { DepositChainId } from '../../types/deposit.types';
import { SEND_FAILURE_TEXT, useSendTransfer, type SendTransfer } from '../../hooks/useSendTransfer';
import { sendAmountToRaw } from '../../services/send';
import {
  isValidRecipientForChain,
  classifyRecipient,
  looksLikeRewalletTag,
  type RecipientKind,
  sendChainByKey,
  type SendChainId,
  type SendChainView,
} from '../../config/send';
import { evmChainById } from '../../config/chains';
import { formatScaledTrimmed, toScaled } from '../../services/portfolio';
import type { PortfolioHolding } from '../../services/portfolio';
import { identityOf } from '../../services/portfolioIdentity';
import { assetByTicker } from '../../config/assets';

/**
 * Qué acción abre este modal.
 *
 * `'usar'` abre el menú de Comprar/Vender (swap).
 *
 * `'depositar'` y `'enviar'` son las acciones de movimiento de plata.
 */
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

  /**
   * El balance que ya leyó `GET /api/wallet-balance`, para que las filas de esta
   * pantalla se vean **exactamente** como las de *Bitcoin & Crypto*.
   *
   * No se pide un dato nuevo: es la misma lectura que ya está en pantalla en
   * otro lado, y sin ella esta pantalla no podría pintar el valor en dólares
   * sin inventarlo.
   */
  balance?: WalletBalanceScreenView;
  /**
   * Avisa que los saldos hay que volver a leerlos.
   *
   * Va **opcional** a propósito: el modal no puede exigirle a quien lo usa que
   * sepa esto, y sin él el flujo del envío sigue funcionando —lo que pasa es que
   * la pantalla no refresca sola y la persona tiene que recargar. Quien lo tiene
   * lo pasa, y el refresh del envío es de verdad.
   */
  onBalancesChanged?: () => void;
}

export const ActionFlowModal: React.FC<ActionFlowModalProps> = ({
  action,
  onClose,
  userTag,
  depositInfo,
  holdings,
  balance,
  onBalancesChanged,
}) => {
  /*
   * The dollar value of each crypto asset, indexed by symbol.
   *
   * The deposit list is one row per **symbol**, while the backend's pieces are
   * one per **(chain, symbol)**. Today every crypto asset here is native to a
   * single chain, so the match is one to one and the row can paint a number the
   * backend composed.
   *
   * If a symbol ever had pieces on two chains, this deliberately paints
   * **nothing** rather than adding them up: that sum is the backend's job, and
   * a browser that adds two pieces by hand is how two screens end up showing
   * two different totals.
   */
  const partBySymbol = useMemo(() => {
    const index = new Map<string, WalletBalancePart[]>();
    for (const part of balance?.balance?.cryptoValue.parts ?? []) {
      const symbol = part.key.split('.').at(-1);
      if (symbol === undefined || symbol.length === 0) continue;
      index.set(symbol, [...(index.get(symbol) ?? []), part]);
    }
    return index;
  }, [balance]);

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
  /**
   * La red del envío, como clave de catálogo. `null` mientras no se eligió.
   *
   * Antes el flujo no tenía red: anunciaba once redes en la prosa y no firmaba
   * ninguna. Ahora sale del catálogo del servidor.
   */
  const [sendNetwork, setSendNetwork] = useState<SendChainId | null>(null);
  /** El monto que no se pudo convertir, o `null`. */
  const [sendAmountError, setSendAmountError] = useState<string | null>(null);
  /**
   * El escáner del paso de destino, abierto o no.
   *
   * Vive acá y no en `App.tsx` porque el escáner **es** parte del envío: es lo que
   * reemplaza pegar una dirección, y necesita la red del envío para no aceptar
   * una dirección de otra cadena. Abrirlo no pide la cámara todavía: eso pasa
   * cuando el escáner se monta, y se apaga al cerrarlo.
   *
   * Cancelar no escribe acá: `setDestinationAddress` sólo se llama con una
   * dirección que el escáner ya validó, así que el paso queda intacto.
   */
  const [isSendScannerOpen, setIsSendScannerOpen] = useState(false);

  /* =========================================================================
     ENVÍO: EL FLUJO QUE FIRMA
     ========================================================================= */

  /**
   * Firmar la transferencia, y volver a leer los saldos cuando terminó.
   *
   * El refresh usa las dos fuentes que hay: `depositInfo.reload()` relee el
   * catálogo —que va a la cadena— y `onBalancesChanged` avisa a quien pasó los
   * saldos. Ninguna de las dos calcula el saldo a partir del botón apretado.
   */
  const sendFlow: SendTransfer = useSendTransfer(() => {
    depositInfo.reload();
    onBalancesChanged?.();
  });

  /** El saldo de esta persona para `chain:symbol`, si el portfolio lo leyó. */
  const holdingOf = (chain: DepositChainId, symbol: string): PortfolioHolding | null =>
    holdings.find((holding) => holding.chain === chain && holding.symbol === symbol) ?? null;

  /**
   * La lista real de "Comprar" y "Vender".
   *
   * No se construye acá: la construye `useTradeCatalog`, que es el mismo
   * constructor que usa el detalle de un cripto. Copiarlo en dos pantallas es
   * como las dos dejaron de decir lo mismo —una lista de activos y otra— sin que
   * ninguna se quejara. Esta pantalla le pasa las tres lecturas que ya tiene.
   */
  const tradeCatalog = useTradeCatalog({ depositInfo, holdings, balance });

  /*
   * El par que se convierte en los dos sentidos.
   *
   * Los dos leen el mismo catálogo real, así que no pueden mostrar activos que
   * el backend no conoce ni saldos inventados. El par inicial lo decide el
   * catálogo —de los dólares a la primera cripto— y no dos constantes escritas a
   * mano: el destino por defecto era Bitcoin, que esta billetera no puede
   * mover. Esta pantalla no pasa identidades, y por eso el par lo elige el
   * catálogo entero; el detalle de un cripto sí pasa el activo que se está
   * viendo.
   */
  const buyTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
    catalog: tradeCatalog,
  });
  const sellTrade = useAssetTrade({
    amountText: keypadAmount,
    setAmountText: setKeypadAmount,
    catalog: tradeCatalog,
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
      setSendAmountError(null);
      setSelectedNetwork(null);
      setDepoSource('crypto');
      setSheetSide(null);
      /*
       * Abrir el flujo de enviar arranca una intención nueva: el `requestId` con
       * el que se protege el doble toque pertenece a un intento, no a la app.
       */
      setSendNetwork(null);
      sendFlow.reset();
    }
  }, [action, sendFlow.reset]);

  /*
   * `openBuy` y `openSell` se fueron con el menú de "Usar": eran sus únicas
   * llamadoras y sin menú no hay a dónde abrir. Las pantallas `use_buy` y
   * `use_sell` de más abajo quedan estacionadas — con su `buyTrade`, su
   * `sellTrade` y su `AssetTradeCard` — a la espera del motor de swap de la
   * Fase 2. Volver a armar el menú es una línea; no una reconstrucción.
   */

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

  /* =========================================================================
     ENVÍO: QUÉ SE PUEDE ENVIAR Y A DÓNDE
     ========================================================================= */

  /**
   * Las redes en las que este activo se puede **enviar**, según el catálogo.
   *
   * Dos filtros, y los dos importan. El primero —"¿este activo está en esta
   * red?"— sale del backend, así que no hay lista de redes escrita a mano. El
   * segundo —"¿esta red se puede firmar?"— sale de `config/send.ts`, que es la
   * configuración de red del proyecto: el flujo firma con `eth_sendTransaction`,
   * así que una red sin id EIP-155 no se ofrece aunque esté en el catálogo.
   *
   * Antes esta pantalla no tenía ninguno de los dos: anunciaba once redes
   * escritas a mano, de las que el backend soporta dos.
   */
  const sendChainsForCoin: readonly SendChainView[] = networksForCoin(selectedCoin).flatMap((network) => {
    const chain = sendChainByKey(network.chain);
    // El nombre sale del catálogo del servidor; el de `config` es el respaldo.
    return chain === null ? [] : [{ ...chain, label: network.label }];
  });

  /** La red elegida, ya con su catálogo. `null` mientras no se eligió. */
  const sendChain: SendChainView | null =
    sendNetwork === null ? null : (sendChainsForCoin.find((chain) => chain.chain === sendNetwork) ?? null);

  /**
   * La red de envío implícita cuando hay una sola: un activo que sólo existe en
   * una red no necesita que se le pregunte por ella.
   */
  const sendChainResolved: SendChainView | null =
    sendChain ?? (sendChainsForCoin.length === 1 ? (sendChainsForCoin[0] ?? null) : null);

  /** El activo en la red de envío, con los decimales del catálogo. */
  const sendAsset =
    sendChainResolved === null
      ? null
      : (depositInfo.networks
          .find((network) => network.chain === sendChainResolved.chain)
          ?.assets.find((asset) => asset.symbol === selectedCoin) ?? null);

  /** La dirección de esta persona en la red de envío: contra ella se firma. */
  const sendSenderAddress: string | null =
    sendChainResolved === null
      ? null
      : (depositInfo.networks.find((network) => network.chain === sendChainResolved.chain)?.address ?? null);

  /**
   * ¿La dirección pegada sirve para la red elegida?
   *
   * Es la misma regla del backend, escrita para frenar el error obvio sin gastar
   * una ida y vuelta. **No es una garantía**: el servidor vuelve a validarla y es
   * la que decide. Ver `config/send.ts`.
   */
  /*
   * La caja acepta **dos** cosas y el mismo predicado decide cuál es cuál: una
   * dirección válida para la red de este envío, o un identificador de ReWALLET
   * que el backend resuelve por dentro. Que acepte las dos no es ampliar el
   * alcance: la dirección casi nunca la escribe nadie, la deja el escáner.
   */
  const sendRecipientKind: RecipientKind =
    sendChainResolved === null
      ? 'unusable'
      : classifyRecipient(sendChainResolved.chain, destinationAddress.trim());

  const sendRecipientValid: boolean = sendRecipientKind !== 'unusable';

  /** Lo que la pantalla dice cuando lo escrito no sirve, o `null`. */
  const sendRecipientError: string | null =
    destinationAddress.trim().length === 0 || sendChainResolved === null
      ? null
      : sendRecipientValid
        ? null
      : looksLikeRewalletTag(destinationAddress.trim())
        ? 'Ese identificador no existe en ReWALLET.'
        : `Esa dirección no es válida en ${sendChainResolved.label}. Revisala y pegala de nuevo.`;

  /**
   * El enlace a la transacción en la exploradora de la red, o `null`.
   *
   * La base sale de `config/chains.ts`, que ya fue verificada contra la cadena:
   * un link a una exploradora equivocada en una billetera es una página que
   * parece phishing. El hash es un identificador de transacción, no una
   * dirección, y es lo que hace el envío comprobable.
   */
  const sendExplorerUrl: string | null = (() => {
    if (sendFlow.transferHash === null || sendChainResolved === null) return null;
    const base = evmChainById(sendChainResolved.chainId)?.blockExplorers?.default.url;
    return base === undefined ? null : `${base}/tx/${sendFlow.transferHash}`;
  })();

  /**
   * Los activos que se pueden **enviar**, según el catálogo.
   *
   * Las dos listas decoins que elegían el flujo estaban escritas a mano —`USDC`,
   * `USDT`, `USDS` de un lado; `BTC`, `ETH`, `SOL`, `USDT` del otro— y ninguna
   * coincidía con el catálogo: `USDT` no existe en el backend y `USDS` tampoco,
   * así que las dos offers eran destinos que el servidor rechaza. Ahora salen de
   * `depositInfo.assets`, que es la respuesta del servidor, y se quedan afuera las
   * que no tienen ninguna red que esta billetera pueda firmar.
   */
  const sendableAssets: readonly typeof depositInfo.assets[number][] = depositInfo.assets.filter((asset) =>
    asset.networks.some((network) => sendChainByKey(network.chain) !== null),
  );

  /** La lista de un camino: los dólares o las cripto, del mismo catálogo. */
  const sendableAssetsOfKind = (kind: 'crypto' | 'dollar'): readonly typeof depositInfo.assets[number][] =>
    sendableAssets.filter((asset) => asset.kind === kind);

  /**
   * La pieza del backend de este símbolo, **si hay exactamente una**.
   *
   * El catálogo es una fila por símbolo y las piezas son una por (cadena,
   * símbolo). Hoy cada cripto es nativo de una sola cadena, así que el match es
   * 1 a 1. Con más de una no se pinta valor: sumarlas en el navegador es la
   * suma del backend, y dos copias de esa suma divergen.
   */
  const partForSymbol = (symbol: string): WalletBalancePart | null => {
    const matches = partBySymbol.get(symbol) ?? [];
    return matches.length === 1 ? matches[0] : null;
  };

  /** Un activo del catálogo con su pieza y su posición por valor en dólares. */
  const sortedByUsd = (
    items: readonly typeof depositInfo.assets[number][],
  ): readonly { asset: typeof depositInfo.assets[number]; part: WalletBalancePart | null }[] =>
    [...items]
      .map((asset) => ({ asset, part: partForSymbol(asset.symbol) }))
      .sort((a, b) => byUsdValueDesc(a.part, b.part));

  /*
   * La pieza que se puede pedir como fila, o `null` si no lo es.
   *
   * `BalancePieceRow` conserva su rama de "no se pudo leer" —no se le borra—,
   * pero acá no se le pide una: una pieza ilegible no es una fila, y la fila que
   * se arma decide qué se muestra en su lugar. Lo que se muestra, si hay algo,
   * es la cantidad que la cadena sí respondió (`assetBalanceLabel`), que es un
   * hecho verdadero; si tampoco esa existe, la celda queda con el chevron solo
   * y la fila conserva su lugar sin decir nada que nadie verificó.
   */
  const readablePart = (part: WalletBalancePart | null): WalletBalancePart | null =>
    part !== null && part.status === 'ok' ? part : null;

  /**
   * Arranca el envío: convierte el monto a la unidad mínima y se lo pasa al hook.
   *
   * La conversión es exacta y recorta en vez de redondear —`sendAmountToRaw`—: un
   * redondeo acá mandaría una plata que la persona no escribió. Si no se puede
   * convertir, no se llama al hook: la pantalla dice qué pasó y no sale nada.
   *
   * La escala es la del catálogo y no la del locale, porque a la escala
   * equivocada `1500000` no es el envío que la persona escribió.
   */
  const startSend = (): void => {
    if (sendChainResolved === null || sendAsset === null || sendSenderAddress === null) return;

    let amountRaw: string;
    try {
      amountRaw = sendAmountToRaw(keypadAmount, sendAsset.decimals);
    } catch {
      setSendAmountError('El monto no es un número válido para este activo.');
      return;
    }

    /*
     * Lo que la persona escribió decide por qué puerta sale, y esa decisión vive
     * en `classifyRecipient`, no acá.
     *
     * Un identificador sale por `recipientTag` y **el backend resuelve la
     * dirección por dentro**: es la mitad de "nadie escribe una dirección ni la
     * ve". Una dirección sale pegada, y esa no la escribió casi nadie: la dejó
     * el escáner.
     *
     * Ninguna de las dos se muestra ni se transforma acá. El texto sale como se
     * escribió, en la caja, y no se le pone mayúscula ni se le recorta.
     */
    const destino = destinationAddress.trim();
    const kind = classifyRecipient(sendChainResolved.chain, destino);
    if (kind === 'unusable') {
      setSendAmountError(
        looksLikeRewalletTag(destino)
          ? 'Ese identificador no existe.'
          : 'Esa dirección no es válida en la red de este envío.',
      );
      return;
    }

    setSendAmountError(null);
    setCurrentStep('send_result');
    void sendFlow.send({
      chain: sendChainResolved.chain,
      symbol: sendAsset.symbol,
      decimals: sendAsset.decimals,
      ...(kind === 'rewallet'
        ? { recipient: null, recipientTag: destino.replace(/^@/, '') }
        : { recipient: destino }),
      amountRaw,
      senderAddress: sendSenderAddress,
    });
  };

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
                  Dólares Digitales
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('depo_crypto_list');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Activos Digitales
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
                  Dólares Digitales
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('send_crypto_list');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Activos Digitales
                </button>
              </div>
            </div>
          )}

          {/*
            ACÁ ESTABA EL MENÚ DE "USAR": "Comprar crypto" y "Vender crypto".

            Sus dos opciones eran el mismo cambio de activo en dos direcciones, y
            las dos Applican una conversión que hoy no tiene motor: no hay
            backend que la cotice ni transacción que la ejecute. Un botón que no
            puede hacer lo que promete no se ofrece. Las dos pantallas de compra y
            venta NO se borraron — están más abajo, en `use_buy` y `use_sell`, y
            son la base de la Fase 2 ya decidida. Lo que se cerró fue la puerta.
          */}
          {/* ACCIÓN: USAR (Comprar/Vender/Intercambiar) */}
          {action === 'usar' && (
            <div className="space-y-6">
              <h2 className="text-3xl font-black font-display text-black tracking-tight mb-8">
                ¿Qué querés hacer?
              </h2>

              <div className="space-y-4 flex flex-col items-start">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('use_buy');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Comprar
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('use_sell');
                  }}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Vender
                </button>
              </div>
            </div>
          )}

          {/*
            ACÁ ESTABA EL MENÚ DE "USAR": "Comprar crypto" y "Vender crypto".

            Sus dos opciones eran el mismo cambio de activo en dos direcciones, y
            las dos Applican una conversión que hoy no tiene motor: no hay
            backend que la cotice ni transacción que la ejecute. Un botón que no
            puede hacer lo que promete no se pone en pantalla.

            Las dos pantallas de compra y venta NO se borraron — están más abajo,
            en `use_buy` y `use_sell`, y son la base de la Fase 2 ya decidida.
            Lo que se cerró fue la puerta.
          */}
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
                    <span className="text-base font-bold text-black block">
                      {coin.symbol}
                    </span>
                    <span className="text-xs text-slate-400 font-medium block">
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
            {sortedByUsd(
              depositInfo.cryptoAssets.filter(
                (asset) =>
                  cryptoSearch.trim().length === 0 ||
                  asset.symbol.toLowerCase().includes(cryptoSearch.trim().toLowerCase()) ||
                  asset.name.toLowerCase().includes(cryptoSearch.trim().toLowerCase()),
              ),
            ).map(({ asset, part }) => {
                const identity = identityOf(asset.symbol);
                const balance = assetBalanceLabel(asset.symbol);
                const readable = readablePart(part);

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
                        {/*
                          Título arriba y símbolo abajo, como en las filas de
                          *Bitcoin & Crypto*. Antes iba al revés —símbolo de
                          título y nombre de subtítulo— y por eso esta pantalla
                          se veía distinta de todas las demás.
                        */}
                        <span className="text-sm font-extrabold text-black block leading-none">{asset.name}</span>
                        <span className="text-xs font-mono font-bold text-slate-400 block mt-1">{asset.symbol}</span>
                        {/*
                          La lista de redes ya no se pinta: la red se elige en el
                          paso siguiente y la fila quedó igual que en *Bitcoin &
                          Crypto*.

                          Lo que **no** puede desaparecer es el aviso de que un
                          activo no se puede recibir en ninguna parte. `assetsOfKind`
                          no filtra por redes con dirección, así que un activo sin
                          destino aparece igual en la lista y tocarlo lleva a un
                          callejón sin salida. Un activo con redes no dice nada, como
                          en el resto de las filas.
                        */}
                        {asset.receivableNetworkCount === 0 && (
                          <span className="text-[11px] font-medium text-amber-600 block mt-0.5">
                            Todavía no tenés dónde recibirlo
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {readable !== null ? (
                        /* El mismo renglón que las otras pantallas: valor arriba,
                           cantidad abajo. */
                        <BalancePieceRow part={readable} hideLabel />
                      ) : (
                        <>
                          {/*
                            La pieza no se pudo leer: no va valor, ni motivo, ni un
                            cero de reemplazo. Si la cadena sí respondió la
                            cantidad, esa cantidad se muestra —es verdadera y no
                            necesita precio— y si no, la celda queda con el
                            chevron, que es lo único que la fila necesita para
                            seguir siendo una fila.
                          */}
                          {balance !== null && (
                            <span className="text-sm font-extrabold font-display text-black block leading-none">
                              {balance}
                            </span>
                          )}
                          <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5] ml-auto mt-1" />
                        </>
                      )}
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
                {/*
                 * Este botón de "Escanear QR" escribía `$lujyyctz` en el campo: un
                 * tag inventado, de la lista de contactos de mentira que hay dos
                 * pantallas más abajo. Tampoco escaneaba, y el escaneo de verdad no
                 * existe todavía en la app. Se saca.
                 */}
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
            {/*
             * Este botón decía "✓ ¡Transferencia enviada!" con confetti después
             * de no mover un peso: un $ReTag no es una dirección, no hay red de
             * pagos interna —una app que se paga a sí misma es una app que puede
             * perder plata— y este camino no tiene a qué dirección firmar.
             *
             * Un botón que anuncia un envío que no ocurrió es la misma mentira que
             * announce el escaneo de QR, y en la pantalla donde se decide a quién
             * se le manda la plata es la peor de las tres. Por eso no dice
             * "enviado": dice que todavía no está disponible y por dónde sí.
             */}
            <div className="space-y-2">
              <button
                disabled
                type="button"
                className="w-full py-4 rounded-2xl bg-slate-200 text-slate-500 font-extrabold text-sm cursor-not-allowed"
              >
                Enviar a un $ReTag todavía no está disponible
              </button>
              <button
                onClick={() => {
                  sendFlow.reset();
                  setSelectedRecipient(null);
                  setCurrentStep('send_where');
                }}
                type="button"
                className="w-full py-3 rounded-2xl bg-white text-black font-extrabold text-sm shadow-2xs active:scale-95 transition-all border border-slate-200 cursor-pointer"
              >
                Enviar a una wallet crypto
              </button>
            </div>
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
              {/*
               * La lista sale de `sendableAssetsOfKind('dollar')`, que viene del
               * catálogo del servidor. Estaba escrita a mano —`USDC`, `USDT`,
               * `USDS`— y dos de esos tres no existen en el backend: eran
               * promesas de envío que el servidor rechaza con
               * `ASSET_NOT_ON_CHAIN`.
               */}
              {sendableAssetsOfKind('dollar').map((coin) => {
                const known = assetByTicker(coin.symbol);
                return (
                  <div
                    key={coin.symbol}
                    onClick={() => {
                      setSelectedCoin(coin.symbol);
                      setSendNetwork(null);
                      setDestinationAddress('');
                      setCurrentStep('send_dest_input');
                    }}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-full ${known?.iconBg ?? 'bg-slate-200'} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}
                      >
                        {known?.glyph ?? coin.symbol.slice(0, 1)}
                      </div>
                      <div>
                        <span className="text-base font-bold text-black block">{coin.symbol}</span>
                        <span className="text-xs text-slate-400 font-medium block">{coin.name}</span>
                      </div>
                    </div>
                    <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                  </div>
                );
              })}
              {sendableAssetsOfKind('dollar').length === 0 && (
                <p className="p-4 text-sm font-medium text-slate-400">
                  Todavía no hay dólares digitales que se puedan enviar.
                </p>
              )}
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
                A quién le querés enviar
              </h1>
              {/*
               * La frase que estaba acá anunciaba once redes escritas a mano
               * —"Arbitrum, Base, Bnb Chain (BEP20), CELO, Ethereum (ERC20),
               * Monad, Optimism, Polygon, Solana, Stellar o ZKsync Era"—, de las
               * que el backend prepara dos. Prometía destinos donde la plata se
               * pierde sin error. Ahora sale de `sendChainsForCoin`, que es el
               * catálogo del servidor filtrado por las redes que esta billetera
               * puede firmar: no hay ninguna red escrita en esta pantalla.
               */}
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                {sendChainsForCoin.length === 0 ? (
                  <>Todavía no podemos enviar {selectedCoin}.</>
                ) : (
                  <>
                    Hoy el envío funciona en{' '}
                    {joinNetworkLabels(sendChainsForCoin.map((chain) => chain.label))}. En otra red el
                    backend no lo prepara y la plata se pierde.
                  </>
                )}
              </p>
              {/*
               * Y por qué hay un campo de dirección, cuando ReWALLET no muestra
               * direcciones. El envío llega por QR o por nombre y la app resuelve
               * el destino sola; ésta es la excepción técnica inevitable del envío
               * a una wallet externa, y la copia lo dice para que quede claro que
               * no hay que aprenderse ni transcribir nada.
               */}
              <p className="text-xs text-slate-400 font-medium leading-relaxed pt-1">
                ReWALLET no te muestra direcciones ni te pide que memorices ninguna. Escaneá el QR
                de la otra wallet con el botón de acá al lado, o pegá la que te dio.
              </p>
            </div>

            {/* Red del envío: sale del catálogo, nunca de una lista escrita acá */}
            {sendChainsForCoin.length > 1 && (
              <div className="space-y-2">
                <span className="text-xs font-bold text-black font-display block">En qué red</span>
                <div className="bg-white rounded-3xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
                  {sendChainsForCoin.map((chain) => (
                    <div
                      key={chain.chain}
                      onClick={() => setSendNetwork(chain.chain)}
                      className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                    >
                      <span className="text-sm font-bold text-black">{chain.label}</span>
                      {chain.chain === sendChain?.chain ? (
                        <Check className="w-5 h-5 text-black stroke-[3]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Input dirección, con escanear y pegar. Ver el botón de QR abajo. */}
            <div className="p-4 bg-slate-100 rounded-3xl flex items-center justify-between gap-2 border border-slate-200">
              <input
                type="text"
                value={destinationAddress}
                onChange={(e) => setDestinationAddress(e.target.value)}
                placeholder="Escaneá el QR, o escribí @identificador"
                className="bg-transparent text-base text-black placeholder-slate-400 focus:outline-none w-full font-mono font-medium"
              />
              <div className="flex items-center gap-2 shrink-0">
                {/*
                 * El botón de escanear QR.

                 * El que estaba acá escribía una dirección fija —`0xCcBe2540…`,
                 * que no es la de ninguna wallet de ReWALLET— y por eso se sacó:
                 * un botón que no hace lo que su nombre dice, en la pantalla donde
                 * se decide a quién se le manda la plata, es peor que no tenerlo.

                 * Ahora hace lo que dice: abre la cámara, y lo que se lee es el
                 * frame de la cámara con `jsqr`, **en este teléfono**. No hay
                 * servicio de por medio: mandarle el frame a alguien a ser quien
                 * dice a quién le estás pagando, y el video ni siquiera se
                 * prende hasta que alguien toca este botón.

                 * Lo que escaneó se valida contra la red elegida del mismo modo
                 * que lo pegado —`config/send.ts`—, así que un `0x…` en un envío
                 * por Solana no llega al campo: lo dice el escáner y vuelve a
                 * dejarla donde estaba.
                 */}
                <button
                  type="button"
                  onClick={() => setIsSendScannerOpen(true)}
                  title="Escanear un código QR"
                  aria-label="Escanear un código QR"
                  className="p-1.5 rounded-lg text-slate-600 hover:text-black"
                >
                  <QrCode className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard?.readText();
                      if (text) setDestinationAddress(text.trim());
                    } catch {}
                  }}
                  title="Pegar del portapapeles"
                  aria-label="Pegar del portapapeles"
                  className="p-1.5 rounded-lg text-slate-600 hover:text-black"
                >
                  <Clipboard className="w-5 h-5" />
                </button>
              </div>
            </div>

            {sendRecipientError !== null && (
              <p className="text-xs font-semibold text-red-600 leading-relaxed -mt-2">{sendRecipientError}</p>
            )}

            {/* El escáner va montado en este paso, no en `App`: es lo único que
                sabe la red del envío, y la cámara no se pide hasta que aparece. */}
            {isSendScannerOpen && (
              <QrScannerModal
                isOpen={isSendScannerOpen}
                chain={sendChainResolved}
                onClose={() => setIsSendScannerOpen(false)}
                onScanSuccess={(address) => {
                  setDestinationAddress(address);
                  setIsSendScannerOpen(false);
                }}
              />
            )}

            {/*
             * "Mi agenda" mostraba un contacto —"Prueba ReWALLET", `0xcCbe…`— que
             * tampoco existe en esta app, y tocarlo escribía la misma dirección
             * falsa. No hay agenda: los contactos salen de los envíos, que es la
             * tarea siguiente. La fila se va porque una agenda con un contacto
             * falso es una agenda que manda plata a la nada.
             */}

            <button
              onClick={() => {
                setKeypadAmount('0');
                setCurrentStep('send_amount');
              }}
              disabled={!sendRecipientValid || sendChainResolved === null}
              type="button"
              className="w-full py-4 rounded-full bg-[#ccff00] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continuar al envío
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR: MONTO
         =====================================================================
         Este paso no existía: el flujo.crypto llegaba a un `alert()` sin monto
         siquiera. Un envío sin monto no es un envío, así que el paso se agregó
         con el mismo reparto visual que los otros —monto arriba, teclado abajo—,
         sin tocar la navegación que ya estaba.
         ===================================================================== */}
      {currentStep === 'send_amount' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f3f4f6] select-none">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setCurrentStep('send_dest_input')}
              type="button"
              aria-label="Volver"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-sm font-extrabold font-display text-black">Enviar {selectedCoin}</h2>
            <div className="w-9" />
          </div>

          <div className="flex-1 flex flex-col px-5 pb-6 space-y-4 max-w-sm mx-auto w-full">
            {/* Destinatario: se muestra recortado y con el monto al lado, nunca
                como algo que haya que leer, comparar ni reescribir. */}
            <div className="bg-white rounded-2xl p-3 border border-slate-200/80 flex items-center justify-between gap-3 shadow-2xs">
              <div className="min-w-0">
                <span className="text-xs text-slate-400 font-medium block">Vas a enviar a</span>
                <span className="text-sm font-mono font-bold text-black block truncate">
                  {truncateAddress(destinationAddress.trim(), 8, 6)}
                </span>
              </div>
              <span className="text-xs font-bold text-slate-500 shrink-0">{sendChainResolved?.label}</span>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-slate-200/80 text-center shadow-xs space-y-1">
              <span className="text-xs font-bold uppercase text-slate-400 font-display">Monto a enviar</span>
              <div className="flex items-baseline justify-center font-display">
                <span className="text-2xl font-bold text-slate-400 mr-1">U$</span>
                <span className="text-5xl font-black text-black tracking-tight">{keypadAmount}</span>
              </div>
              <span className="text-[11px] text-slate-400 block pt-1 font-medium">
                {sendAsset === null
                  ? 'No pudimos leer este activo en la red elegida.'
                  : `Tu saldo disponible se descuenta de ${sendChainResolved?.label}.`}
              </span>
            </div>

            {sendAmountError !== null && (
              <p className="text-xs font-semibold text-red-600 leading-relaxed">{sendAmountError}</p>
            )}

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

            <button
              onClick={startSend}
              type="button"
              className="w-full py-4 rounded-2xl bg-[#ccff00] hover:bg-[#b8e600] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer"
            >
              {`Enviar ${keypadAmount} ${selectedCoin}`}
            </button>
          </div>
          <div className="pb-4" />
        </div>
      )}

      {/* =====================================================================
          FLUJO ENVIAR: RESULTADO — CADA PASO Y EL HASH
         =====================================================================
         La regla de la tarea: **un envío sin hash visible no es un envío, es una
         promesa**. Por eso el resultado no muestra "listo": muestra los cuatro
         pasos con su estado, el hash de la transacción y el motivo del corte
         cuando lo hubo. Los saldos se releen al final; nada de esto se calcula
         a partir del botón.
         ===================================================================== */}
      {currentStep === 'send_result' && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#f3f4f6]">
          <div className="p-4 pt-5 flex items-center justify-between shrink-0">
            <button
              onClick={() => {
                if (sendFlow.phase === 'signing' || sendFlow.phase === 'preparing') return;
                sendFlow.reset();
                setCurrentStep('send_amount');
              }}
              type="button"
              aria-label="Volver"
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black shadow-2xs cursor-pointer disabled:opacity-40"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
            <h2 className="text-sm font-extrabold font-display text-black">Envío</h2>
            <div className="w-9" />
          </div>

          <div className="flex-1 flex flex-col px-5 pb-6 space-y-4 max-w-sm mx-auto w-full">
            {/* Los pasos, uno por uno */}
            <div className="bg-white rounded-3xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {sendFlow.steps.map((entry) => (
                <div key={entry.id} className="p-4 flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-300" aria-hidden />
                  <span
                    className={`text-sm font-semibold flex-1 ${
                      entry.status === 'failed'
                        ? 'text-red-600'
                        : entry.status === 'signed'
                          ? 'text-black'
                          : 'text-slate-400'
                    }`}
                  >
                    {entry.label}
                  </span>
                  <span className="text-xs font-bold text-slate-400">
                    {entry.status === 'running'
                      ? '…'
                      : entry.status === 'signed'
                        ? 'Listo'
                        : entry.status === 'failed'
                          ? 'Falló'
                          : ''}
                  </span>
                </div>
              ))}
            </div>

            {/* El hash. Sin hash no hay envío. */}
            {sendFlow.transferHash !== null && (
              <div className="bg-white rounded-3xl border border-slate-200/80 p-4 space-y-3 shadow-xs">
                <span className="text-xs font-bold uppercase text-slate-400 font-display block">
                  Comprobante de la transacción
                </span>
                <p className="text-[11px] leading-relaxed text-slate-500 font-medium">
                  Tu envío está en la red. Todavía puede tardar unos segundos en confirmarse, pero desde
                  este hash se puede seguir y verificar sin creernos.
                </p>
                <div className="bg-slate-100 rounded-2xl px-3 py-2.5 flex items-center gap-2">
                  <code className="text-[11px] font-mono font-bold text-black break-all flex-1 min-w-0">
                    {sendFlow.transferHash}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(sendFlow.transferHash ?? '')}
                    aria-label="Copiar el hash"
                    className="shrink-0 text-slate-500 hover:text-black active:scale-90"
                  >
                    <Copy className="w-4 h-4 stroke-[2]" />
                  </button>
                </div>
                {sendExplorerUrl !== null && (
                  <a
                    href={sendExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-center text-xs font-bold text-slate-600 underline underline-offset-2"
                  >
                    Ver la transacción en la exploradora
                  </a>
                )}
              </div>
            )}

            {/* El corte, si lo hubo. El texto sale de la tabla del hook. */}
            {sendFlow.failureCode !== null && (
              <div className="bg-white rounded-3xl border border-red-200 p-4 space-y-1 shadow-xs">
                <span className="text-xs font-bold uppercase text-red-500 font-display block">
                  No se completó
                </span>
                <p className="text-sm font-semibold text-black leading-relaxed">
                  {SEND_FAILURE_TEXT[sendFlow.failureCode] ?? 'No pudimos completar el envío.'}
                </p>
              </div>
            )}

            <div className="flex-1" />

            {sendFlow.phase === 'done' ? (
              <button
                onClick={onClose}
                type="button"
                className="w-full py-4 rounded-2xl bg-[#ccff00] text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer"
              >
                Listo
              </button>
            ) : sendFlow.phase === 'failed' ? (
              <button
                onClick={() => {
                  /*
                   * Reintentar es una intención nueva con un `requestId` nuevo, y
                   * sólo se ofrece cuando **nada** se firmó: si hay un hash, el
                   * botón de arriba ya no aparece y el envío se dio por hecho.
                   */
                  if (sendFlow.transferHash !== null) return;
                  sendFlow.reset();
                  setCurrentStep('send_amount');
                }}
                disabled={sendFlow.transferHash !== null}
                type="button"
                className="w-full py-4 rounded-2xl bg-white text-black font-extrabold text-sm shadow-md active:scale-95 transition-transform cursor-pointer border border-slate-200"
              >
                Reintentar
              </button>
            ) : (
              <p className="text-center text-xs font-semibold text-slate-400 pb-2">
                Confirmá en tu wallet. No cierres la app.
              </p>
            )}
          </div>
          <div className="pb-4" />
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
              {/* También del catálogo del servidor, no de una lista escrita a mano. */}
              {sortedByUsd(sendableAssetsOfKind('crypto')).map(({ asset: c, part }) => {
                const known = assetByTicker(c.symbol);
                const readable = readablePart(part);
                const quantity = assetBalanceLabel(c.symbol);
                return (
                  <div
                    key={c.symbol}
                    onClick={() => {
                      setSelectedCoin(c.symbol);
                      setSendNetwork(null);
                      setDestinationAddress('');
                      setCurrentStep('send_dest_input');
                    }}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-full ${known?.iconBg ?? 'bg-slate-200'} text-white font-extrabold flex items-center justify-center text-sm shadow-xs`}
                      >
                        {known?.glyph ?? c.symbol.slice(0, 1)}
                      </div>
                      <div>
                        {/* Nombre arriba y símbolo abajo, como en *Bitcoin & Crypto*. */}
                        <span className="text-sm font-extrabold text-black block leading-none">{c.name}</span>
                        <span className="text-xs font-mono font-bold text-slate-400 block mt-1">{c.symbol}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {/* Valor en dólares arriba y cantidad abajo, como en las
                          otras pantallas. Antes esta fila no mostraba ninguna
                          cifra: sólo el chevron. */}
                      {readable !== null ? (
                        <BalancePieceRow part={readable} hideLabel />
                      ) : (
                        /*
                          Una pieza ilegible no se pinta: ni valor, ni un `—` que
                          alguien leería como saldo cero, ni una frase de fallo.
                          Lo que sobrevive es la cantidad que la cadena sí
                          contestó, cuando la contestó; el chevron queda siempre,
                          así que la fila ni se rompe ni se vacía.
                        */
                        <div className="flex items-center justify-end gap-2">
                          {quantity !== null && (
                            <span className="text-sm font-extrabold font-display text-black leading-none">
                              {quantity}
                            </span>
                          )}
                          <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 stroke-[2.5]" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {sendableAssetsOfKind('crypto').length === 0 && (
                <p className="p-4 text-sm font-medium text-slate-400">Todavía no hay cripto que se pueda enviar.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLUJO USAR: COMPRAR CRYPTO (ESTILO REUTILIZABLE A CAMBIAR SIN INVERTIR)
         ===================================================================== */}
      {/*
        FLUJO USAR: COMPRAR / VENDER — ESTACIONADO A PROPOSITO.

        Esta pantalla y la de `use_sell` ya no tienen puerta de entrada: el botón
        "Usar" de la billetera se sacó porque su menú era exactamente este
        compraventa, y sin motor de swap una acción que no puede ejecutarse no se
        ofrece.

        No es código muerto por olvido: es la Fase 2 de
        `odd/tasks/comprar-o-vender.md`, ya decidida —1inch para EVM, Jupiter
        para Solana— y ya terminada del lado de la lista real (el mismo
        `useTradeCatalog`, los mismos saldos, la misma `AssetTradeCard`). Lo que
        falta es el motor. Cuando exista, la puerta vuelve y estas dos pantallas
        son las que la reciben.
      */}
      {currentStep === 'use_buy' && (
        /*
         * `justify-between` empujaba el bloque entero contra el borde inferior y dejaba
         * un hueco muerto entre el header y la tarjeta. Ahora la tarjeta vive pegada al
         * header y el grupo aviso + teclado va justo debajo: no queda espacio basura ni
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
            {/*
              Sin botón, y a propósito.

              El que estaba acá pintaba confeti y un `alert` de compra
              completada sin haber hecho ninguna llamada. Un control que no
              ejecuta nada no debe tener la forma de un control: se dice que la
              operación no existe y la pantalla sigue sirviendo para elegir
              activos y ver saldos, que eso sí es real.
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
            {/*
              Sin botón, y por lo mismo que en "Comprar": el de acá pintaba
              confeti y anunciaba una venta completada que nadie ejecutó.
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
    </div>
  );
};
