import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Share2,
  ArrowLeft,
  ChevronDown,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { TransactionItem } from '../../types';
import { QrScannerModal } from '../Wallet/QrScannerModal';
import { PayChargeView } from '../Wallet/PayChargeView';
import {
  CHARGE_FAILURE_TEXT,
  chargeAssetOptions,
  chargeAmountToDecimal,
  chargeChainLabel,
  createPaymentRequest,
  type ChargeAssetOption,
  type PaymentRequest,
} from '../../services/paymentRequests';
import { useDepositInfo } from '../../hooks/useDepositInfo';
import { identityOf } from '../../services/portfolioIdentity';
import { paymentRequestShareUrl } from '../../config/paymentLinks';
import { AssetIcon } from '../common/AssetIcon';
import { QrCode } from '../common/QrCode';

/**
 * Una dirección de cobro y la red a la que pertenece.
 *
 * Viene de `GET /api/portfolio` y de ningún otro lado. Antes este modal no
 * tenía un receptor real: generaba un QR con el `@user` de la persona y, detrás,
 * un saldo de Bitcoin escrito a mano que además sobrevivía a los recargas.
 */
export interface ChargeReceiveAddress {
  readonly label: string;
  readonly address: string;
}

interface ChargeQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * La dirección real de esta persona, o `null` si todavía no se pudo leer.
   *
   * `null` no se rellena: no se genera el cobro. Un cobro sin destino real es
   * una pantalla que le pide a alguien que confíe en un número.
   */
  receiveAddress: ChargeReceiveAddress | null;
  /**
   * El origen donde la app está, para armar el link del cobro.
   *
   * Lo pasa el `App`, igual que a `CreateChargeView`, y por el mismo motivo: esta
   * pantalla no sabe de dónde vino la app. Un link armado con un origen escrito
   * a mano no abre la app donde la persona la tiene instalada.
   */
  origin: string;
  onAddTransaction: (tx: TransactionItem) => void;
  onNavigateToActivity?: () => void;
}

export const ChargeQrModal: React.FC<ChargeQrModalProps> = ({
  isOpen,
  onClose,
  receiveAddress,
  origin,
  onAddTransaction,
}) => {
  const [step, setStep] = useState<'select_action' | 'charge_input' | 'charge_qr'>('select_action');
  const [amount, setAmount] = useState('0');
  const [copied, setCopied] = useState(false);
  /** El cobro real, o `null` mientras no se creó ninguno. */
  const [charge, setCharge] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  /** El código de por qué no se pudo cobrar, en las palabras de la pantalla. */
  const [failureCode, setFailureCode] = useState<string | null>(null);
  /** La clave `${cadena}:${símbolo}` elegida, o `null` si todavía no eligió. */
  const [assetKey, setAssetKey] = useState<string | null>(null);

  /*
   * EL SELECTOR: la lista sale del catálogo, no de acá.
   *
   * Es el mismo `GET /api/deposit-info` que usan el depósito y el envío, leído por
   * `useDepositInfo`. No hay acá ninguna lista de tickers: agregarla al catálogo
   * la hace aparecer sola, y un ticker escrito a mano sería un cobro en algo que
   * el servidor no tiene.
   *
   * El hook se abre con el modal —antes no se lee nada con el modal cerrado— y
   * puede reusar la lectura con `reload()`, que es lo que hace el botón de
   * reintentar cuando la lectura falló.
   */
  const depositInfo = useDepositInfo(isOpen);
  const assetOptions = useMemo(() => chargeAssetOptions(depositInfo.networks), [depositInfo.networks]);
  const chosen: ChargeAssetOption | null =
    assetOptions.find((option) => option.key === assetKey) ?? null;

  /*
   * PAGAR: no es un paso de este menú, es otra pantalla encima.
   *
   * Durante un tiempo "Pagar" fue un cuarto paso de este mismo menú con un visor
   * falso: un rectángulo negro con cuatro escuadras y la frase *"todavía no
   * podemos leer el código"*. Era un callejón sin salida —no leía nada, no
   * reciénía nada y no dejaba pagar nada— y la forma de arreglarlo sin inventar
   * una pantalla nueva es dejar de fingir que el paso existe.
   *
   * Ahora "Pagar" abre el **escáner de verdad**, que es el mismo componente que ya
   * usa el flujo de envío, en modo `pay`. Y cuando el QR resulta ser un link de
   * cobro, ese id abre `PayChargeView` por encima de todo esto.
   *
   * Dos banderas y no un paso más, y la razón es de navegación: el escáner
   * vuelve a `select_action`, y hacer eso con un `step` obligaría a memorizar un
   * paso que nunca se dibuja —porque durante la lectura la pantalla de arriba es
   * el escáner, no el menú—.
   */
  const [isPayScannerOpen, setIsPayScannerOpen] = useState<boolean>(false);
  /** El cobro escaneado, que se paga en `PayChargeView`, o `null`. */
  const [payForChargeId, setPayForChargeId] = useState<string | null>(null);

  useEffect(() => {
    // Al abrir el modal, siempre reiniciar en la pantalla inicial de selección
    if (isOpen) {
      setStep('select_action');
      setAmount('0');
      setCopied(false);
      setCharge(null);
      setCreating(false);
      setFailureCode(null);
      setIsPayScannerOpen(false);
      setPayForChargeId(null);
      setAssetKey(null);
    }
  }, [isOpen]);

  /*
   * EL COBRO: uno solo, con dos presentaciones.
   *
   * El link y el QR son la **misma fila** de `payment_requests`. El id sale del
   * backend, el link se arma con `paymentRequestShareUrl` y el QR dibuja ese
   * mismo link —no una dirección, no un formato propio, no un payload que
   * esta app no entiende—. Quien escanea el QR y quien copia el texto llegan al
   * mismo `PayChargeView` con el mismo cobro.
   *
   * Antes el QR llevaba un esquema propio —un `pay?addr=…&amount=…` que esta
   * app no leía en ningún lado— y el link de abajo se armaba en el momento, sin
   * registro en el servidor. Dos presentaciones que no eran la misma cosa, y
   * ninguna de las dos era un cobro: el código no lo abría ninguna cámara.
   */
  const shareUrl = useMemo(
    () => (charge === null ? null : paymentRequestShareUrl(charge.id, origin)),
    [charge, origin],
  );

  

  /*
   * El pago con QR ya no simula un pago.
   *
   * Antes, 1,8 segundos después de abrir "Pagar" esta pantalla restaba
   * `0,00005 BTC` de un saldo inventado, disparaba confeti, escribía un
   * movimiento con ese importe en Actividad y mostraba "¡Pago realizado!"
   * con la cifra. Nadie había pagado nada: el número lo escribía el modal, y
   * el saldo que tocaba ni siquiera venía de la cadena.
   *
   * Después hubo un paso "Pagar con QR" con un visor dibujado a mano y la
   * frase *"todavía no podemos leer el código"*. Sigue sin ser un pago, pero ya
   * no es una mentira: es el escáner de verdad, y lo que hace —leer un QR, abrir
   * el cobro que ese QR sea, y no abrir nada si no lo es— es exactamente lo que
   * dice. El importe del cobro, cuando lo hay, lo lee `PayChargeView` del
   * backend: nunca de acá.
   */

  if (!isOpen) return null;

  // Manejo del teclado numérico para cobrar
  const handleKeypadPress = (val: string) => {
    if (val === 'backspace') {
      if (amount.length <= 1) {
        setAmount('0');
      } else {
        setAmount(amount.slice(0, -1));
      }
      return;
    }

    if (val === ',') {
      if (amount.includes(',')) return;
      setAmount(amount + ',');
      return;
    }

    if (amount === '0') {
      setAmount(val);
    } else {
      if (amount.length < 9) {
        setAmount(amount + val);
      }
    }
  };

  /**
   * Crear el cobro de verdad y, sólo si existe, mostrarlo.
   *
   * El importe va al backend como decimal exacto —`chargeAmountToDecimal`, que
   * cuenta con enteros— y el backend devuelve la fila de `payment_requests`. Sin
   * esa fila no hay cobro, así que **no hay atajo**: si la creación falla, la
   * pantalla se queda en el importe y dice por qué. Antes, si algo fallaba,
   * quedaba un QR con la dirección escrita adentro, y eso es lo peor que puede
   * pasar acá: alguien ve un código que parece cobrable y no lo es.
   */
  const handleGenerateCharge = async () => {
    if (creating) return;

    /*
     * Sin dirección real no se genera el cobro. El botón queda deshabilitado
     * mientras `receiveAddress` sea `null`, y este guarda es la segunda línea:
     * un cobro sin destino real sería pedirle a alguien que mande plata a un
     * lugar que la app no puede decir que es suyo.
     */
    if (receiveAddress === null) return;

    /*
     * Sin cadena y activo elegidos no hay cobro. El botón queda deshabilitado
     * mientras `chosen` sea `null` —catálogo sin llegar, o sin elección— y este
     * guarda es la segunda línea. Un cobro sin activo declarado sería el cobro
     * viejo: un importe que no dice en qué se cobra, y que obliga a quien paga a
     * adivinarlo.
     */
    if (chosen === null) return;

    let decimal: string;
    try {
      decimal = chargeAmountToDecimal(amount);
    } catch {
      setFailureCode('AMOUNT_INVALID');
      return;
    }

    setCreating(true);
    setFailureCode(null);
    try {
      const created = await createPaymentRequest({
        amount: decimal,
        chain: chosen.chain,
        asset: { symbol: chosen.symbol },
        note: null,
      });
      setCharge(created);

      const now = new Date();
      const expireTimeStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      onAddTransaction({
        id: `charge-${Date.now()}`,
        title: 'Cobro por QR',
        date: `Hoy, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hs`,
        amount: `+ ${created.amount} ${created.asset.symbol}`,
        isPositive: true,
        type: 'qr_charge',
        section: 'Hoy',
        status: 'Pendiente',
        expiresAt: `Expira mañana a las ${expireTimeStr} hs`,
        /*
         * Lo que va en el QR, tal cual. El movimiento de Actividad y el código
         * que se muestra en la pantalla apuntan al mismo cobro, y el que está
         * escrito acá es el que la persona puede copiar.
         */
        qrPayload: paymentRequestShareUrl(created.id, origin),
      });

      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#000000', '#ffffff', '#10b981'],
      });

      setStep('charge_qr');
    } catch (error) {
      setCharge(null);
      setFailureCode((error as { code?: string }).code ?? 'PAYMENT_REQUEST_CREATE_FAILED');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = () => {
    if (shareUrl === null) return;
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  /**
   * Lo que comparte: el importe **con su activo y su cadena**, porque es lo que
   * le va a pedir a quien lo abre. Un texto con "U$ 10" obligaría a interpretarlo
   * antes de pagar.
   */
  const shareText = (target: PaymentRequest | null): string =>
    target === null
      ? 'Te estoy cobrando'
      : `Te estoy cobrando ${target.amount} ${target.asset.symbol}, en ${chargeChainLabel(target.chain)}`;

  const handleShare = () => {
    if (shareUrl === null) return;
    if (typeof navigator.share === 'function') {
      void navigator
        .share({
          title: 'Cobro de ReWALLET',
          text: shareText(charge),
          url: shareUrl,
        })
        .catch(() => {
          /* Quien cancela el compartir no necesita un error en pantalla. */
        });
      return;
    }
    // Sin `navigator.share` el compartir es copiar, y se dice lo mismo.
    handleCopyLink();
  };

  const handleClose = () => {
    setStep('select_action');
    setAmount('0');
    setCharge(null);
    setFailureCode(null);
    setIsPayScannerOpen(false);
    setPayForChargeId(null);
    setAssetKey(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 select-none animate-in fade-in duration-200">
      {/* =====================================================================
          1. PANTALLA INICIAL: IDÉNTICA AL LAYOUT DE DEPOSITAR
          Toda la pantalla de color lima, título "¿Qué querés hacer?"
          y dos opciones grandes en texto: "Cobrar" y "Pagar"
          + Botón circular negro flotante con X en color lima abajo a la derecha
         ===================================================================== */}
      {step === 'select_action' && (
        <div className="w-full h-full max-w-md bg-[#ccff00] text-black flex flex-col justify-between p-6 select-none overflow-y-auto font-sans shadow-2xl">
          <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full space-y-6 pt-10 pb-4">
            <div className="space-y-6">
              <h2 className="text-3xl font-black font-display text-black tracking-tight mb-8">
                ¿Qué querés hacer?
              </h2>

              <div className="space-y-4 flex flex-col items-start">
                {/* Opción 1: Cobrar */}
                <button
                  type="button"
                  onClick={() => setStep('charge_input')}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Cobrar
                </button>

                {/* Opción 2: Pagar */}
                {/*
                  Abre el escáner de verdad. Antes esta opción iba a un visor
                  dibujado a mano que no leía nada — y una opción del menú que no
                  hace nada es peor que no tenerla.
                */}
                <button
                  type="button"
                  onClick={() => setIsPayScannerOpen(true)}
                  className="text-4xl sm:text-5xl font-black font-display text-black hover:opacity-75 active:scale-95 transition-all text-left tracking-tight cursor-pointer"
                >
                  Pagar
                </button>
              </div>
            </div>
          </div>

          {/* BOTÓN CIRCULAR NEGRO FLOTANTE CON X EN COLOR LIMA (Mismo que Depositar/Usar/Enviar) */}
          <div className="flex justify-end pb-4 pr-1 shrink-0">
            <button
              onClick={handleClose}
              type="button"
              aria-label="Cerrar"
              title="Cerrar"
              className="w-16 h-16 rounded-full bg-black flex items-center justify-center shadow-[0_8px_25px_rgba(0,0,0,0.3)] active:scale-90 transition-transform cursor-pointer border border-slate-800"
            >
              <X className="w-7 h-7 text-[#ccff00] stroke-[3]" />
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. COBRAR: INGRESO DE IMPORTE
         ===================================================================== */}
      {step === 'charge_input' && (
        <div className="w-full h-full max-w-md bg-[#ccff00] text-black flex flex-col justify-between overflow-hidden shadow-2xl">
          <div className="flex-1 flex flex-col justify-between p-5 h-full animate-in fade-in slide-in-from-right-3 duration-200">
            {/* Header con botón Atrás y Cerrar */}
            <div className="flex items-center justify-between shrink-0 pt-2">
              <button
                onClick={() => setStep('select_action')}
                type="button"
                className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 text-black flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
                aria-label="Volver"
              >
                <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
              </button>
              <h2 className="text-base font-black font-display text-black uppercase tracking-wider">
                Cobrar
              </h2>
              <button
                onClick={handleClose}
                type="button"
                className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 text-black flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>

            {/* Espacio Central: Importe Gigante */}
            <div className="flex-1 flex flex-col justify-center items-center my-auto w-full py-4 space-y-3">
              {/*
                EL SELECTOR DE EN QUÉ SE COBRA.

                Antes el importe llevaba un "U$" fijo y no había nada que elegir:
                un cobro que no decía en qué se cobra. Ahora el "U$" lo reemplaza
                el activo que la persona eligió, y ese activo sale del catálogo de
                depósito. El logo va con `AssetIcon`, que cae al glifo si no hay
                archivo: un selector sin logo parece un placeholder.
              */}
              <div className="w-full max-w-sm px-5 space-y-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-black/50 font-display block text-center">
                  En qué cobrás
                </span>

                {/*
                  El estado de la lectura es una verdad, no un hueco. Mientras el
                  catálogo no llega se dice que se está leyendo y no se habilita
                  nada; si falló se dice y se ofrece reintentar. Un selector vacío
                  en los dos casos sería una pantalla que dice "no hay nada para
                  cobrar", que es otra cosa.
                */}
                {depositInfo.status !== 'ready' && (
                  <div className="rounded-2xl bg-black/5 border border-black/10 px-3 py-2.5 text-center">
                    <p className="text-[11px] font-bold text-black/70 leading-snug">
                      {depositInfo.status === 'error'
                        ? 'No pudimos ver en qué currencies podés cobrar.'
                        : 'Estamos viendo en qué monedas podés cobrar…'}
                    </p>
                    {depositInfo.status === 'error' && (
                      <button
                        type="button"
                        onClick={depositInfo.reload}
                        className="mt-1.5 text-[11px] font-black uppercase tracking-wider text-black underline active:opacity-60 cursor-pointer"
                      >
                        Probar de nuevo
                      </button>
                    )}
                  </div>
                )}

                {depositInfo.status === 'ready' && assetOptions.length === 0 && (
                  <p className="rounded-2xl bg-black/5 border border-black/10 px-3 py-2.5 text-[11px] font-bold text-black/70 text-center leading-snug">
                    Todavía no hay ninguna moneda para cobrar.
                  </p>
                )}

                {assetOptions.length > 0 && (
                  <div className="max-h-[104px] overflow-y-auto space-y-1.5 pr-0.5">
                    {assetOptions.map((option) => {
                      const identity = identityOf(option.symbol);
                      const active = option.key === chosen?.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setAssetKey(option.key)}
                          aria-pressed={active}
                          className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all active:scale-[0.98] cursor-pointer border ${
                            active
                              ? 'bg-black text-[#ccff00] border-black'
                              : 'bg-white text-black border-black/10'
                          }`}
                        >
                          <AssetIcon
                            ticker={option.symbol}
                            glyph={identity?.glyph ?? option.symbol.slice(0, 1)}
                            iconBg={identity?.iconBg ?? 'bg-slate-300'}
                            sizeClass="w-8 h-8"
                            glyphClass={active ? 'text-[#ccff00]' : 'text-sm'}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="text-sm font-black font-display block leading-tight">
                              {option.symbol}
                            </span>
                            <span
                              className={`text-[11px] font-semibold block leading-tight ${
                                active ? 'text-[#ccff00]/80' : 'text-black/55'
                              }`}
                            >
                              en {option.chainLabel}
                            </span>
                          </span>
                          {active && <Check className="w-4 h-4 stroke-[3] shrink-0" />}
                          {!active && (
                            <ChevronDown className="w-4 h-4 -rotate-90 stroke-[2.5] opacity-30 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <span className="text-sm font-black uppercase tracking-widest text-black/60 font-display">
                Importe a cobrar
              </span>
              <div className="flex items-baseline justify-center font-display px-2">
                <span className="text-3xl sm:text-4xl font-black text-black/40 mr-2">
                  {chosen === null ? '?' : chosen.symbol}
                </span>
                <span className="text-7xl sm:text-8xl font-black text-black tracking-tight select-all">
                  {amount}
                </span>
              </div>
              <span className="text-[11px] font-bold text-black/55 font-display text-center">
                {chosen === null
                  ? 'Elegí arriba en qué querés cobrar'
                  : `Te lo van a cobrar en ${chosen.symbol}, en ${chosen.chainLabel}`}
              </span>
            </div>

            {/* Teclado Numérico Táctil & Botón */}
            <div className="max-w-sm mx-auto w-full pb-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKeypadPress(k)}
                    className="h-14 flex items-center justify-center font-display text-3xl font-black text-black bg-black/5 hover:bg-black/15 rounded-2xl active:scale-95 transition-all cursor-pointer"
                  >
                    {k === 'backspace' ? <ArrowLeft className="w-6 h-6 stroke-[2.5]" /> : k}
                  </button>
                ))}
              </div>

              {/*
                Sin dirección real, la acción no existe: el botón queda
                deshabilitado y abajo se dice por qué, en castellano y sin
                jerga. Antes se podía “cobrar” a una dirección que la app nunca
                había leído.
              */}
              {receiveAddress === null && (
                <p className="text-[11px] font-semibold text-black/60 text-center leading-snug pb-1">
                  Todavía no pudimos leer tu dirección de cobro. Cuando la
                  tengamos, vas a poder generar el código.
                </p>
              )}

              {/*
                Sin cadena y activo elegidos el botón no existe, y se dice cuál
                de las dos cosas falta. Un "Generar QR" que abre un cobro sin
                activo sería el cobro viejo con otro nombre.
              */}
              {receiveAddress !== null && chosen === null && depositInfo.status === 'ready' && assetOptions.length > 0 && (
                <p className="text-[11px] font-semibold text-black/60 text-center leading-snug pb-1">
                  Elegí en qué querés cobrar antes de generar el código.
                </p>
              )}

              {/*
                Por qué no se pudo cobrar, en las palabras de la pantalla —las
                mismas que usa `CreateChargeView`, porque es el mismo hecho—.
                Acá no hay código: si el cobro no se creó, no hay nada que
                escanear y decirlo es toda la verdad que hay.
              */}
              {failureCode !== null && (
                <p className="text-[11px] font-bold text-black/70 bg-black/10 rounded-xl px-3 py-2 leading-snug mb-2">
                  {CHARGE_FAILURE_TEXT[failureCode] ?? 'No pudimos crear el cobro.'}
                </p>
              )}

              <button
                type="button"
                disabled={amount === '0' || receiveAddress === null || chosen === null || creating}
                onClick={() => void handleGenerateCharge()}
                className="w-full mt-4 py-4 rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-base shadow-xl active:scale-98 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{creating ? 'Generando el cobro…' : 'Generar QR de cobro'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3. COBRO GENERADO
         ===================================================================== */}
      {step === 'charge_qr' && (
        <div className="w-full h-full max-w-md bg-[#ccff00] text-black flex flex-col justify-between overflow-hidden shadow-2xl">
          <div className="flex-1 flex flex-col justify-between p-6 h-full overflow-y-auto animate-in zoom-in-95 duration-200">
            {/* Header: Título y Botón Cerrar */}
            <div className="flex items-center justify-between shrink-0 pt-2">
              <div className="w-10" />
              <h2 className="text-lg font-black font-display text-black uppercase tracking-wider">
                Cobro Generado
              </h2>
              <button
                onClick={handleClose}
                type="button"
                className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 text-black flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>

            {/* Total + Código QR */}
            <div className="max-w-sm mx-auto w-full my-auto py-4 space-y-5 text-center">
              {/*
                El importe con su activo y su cadena, que es lo que el cobro
                nombra: "10 USDC, en Monad". El "U$" fijo se fue porque no decía
                en qué se cobra, y era exactamente lo que había que dejar de
                mostrar.
              */}
              <div className="space-y-1">
                <span className="text-4xl sm:text-5xl font-black font-display text-black tracking-tight block">
                  {charge?.amount ?? amount} {charge?.asset.symbol ?? chosen?.symbol ?? ''}
                </span>
                <span className="text-xs font-black uppercase tracking-widest text-black/55 font-display block">
                  {charge === null
                    ? 'Elegí arriba en qué cobrás'
                    : `en ${chargeChainLabel(charge.chain)}`}
                </span>
              </div>

              {/*
                EL QR: el mismo link que está escrito abajo, dibujado.

                Antes esto no era un QR: era el ícono de un QR de la librería de
                íconos, que es un dibujo y no un código. Ninguna cámara lo leía.
                Ahora los módulos se calculan del link real —el mismo que se
                copia y el mismo que abre `PayChargeView`—, y si el link no se
                puede codificar no se dibuja nada en su lugar: se avisa abajo y
                el link sigue disponible. El que decide eso es `QrCode`, que
                además mide el marco con la misma zona quieta con la que dibuja:
                antes el `viewBox` declaraba `size + 2` sobre un path que ocupa
                `size + 8`, y el código salía cortado contra el borde.
              */}
              <div className="max-w-[280px] mx-auto">
                <QrCode
                  value={shareUrl ?? ''}
                  label="Código QR del cobro"
                  fallback="No pudimos dibujar el código. El link de abajo sirve igual: es el mismo cobro."
                />
              </div>

              {/*
                El link, escrito, seleccionable y copiable.

                Es el **mismo** cobro que el QR de arriba —mismo id, misma fila—
                y por eso está en la misma pantalla y no en otra. Si el QR se
                puede escanear, el texto se puede copiar; si el texto se puede
                copiar, el QR se puede escanear. Ninguna de las dos
                presentaciones es la única.
              */}
              {shareUrl !== null && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-black/50 block">
                    Link del cobro
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="text-xs font-bold font-mono text-black/80 break-all px-2 cursor-pointer active:opacity-60 select-all"
                  >
                    {shareUrl}
                  </button>
                </div>
              )}

              {/*
                La dirección de destino, escrita abajo del código y copiable.

                Antes el QR no llevaba ninguna: llevaba el `@user` de la
                persona, que no es una dirección de blockchain. La red que
                aparece acá sale de `GET /api/portfolio`, y si no hay dirección
                real esta pantalla no llega a existir.
              */}
              {receiveAddress !== null && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-black/50 block">
                    Cobralo en {receiveAddress.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(receiveAddress.address);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="text-xs font-bold font-mono text-black/80 break-all px-2 cursor-pointer active:opacity-60"
                  >
                    {receiveAddress.address}
                  </button>
                </div>
              )}
            </div>

            {/* Acciones: Compartir y Copiar Link */}
            <div className="max-w-sm mx-auto w-full pb-3">
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleShare}
                  className="py-4 bg-black hover:bg-slate-900 text-white font-extrabold text-sm rounded-2xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 stroke-[2.2]" />
                  <span>Compartir</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="py-4 bg-white hover:bg-slate-100 text-black font-extrabold text-sm rounded-2xl active:scale-95 transition-all shadow-sm flex items-center justify-center gap-2 border border-black/10 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 stroke-[2.2]" />
                      <span>Copiar link</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        =====================================================================
        PAGAR: EL ESCÁNER REAL, Y EL COBRO QUE SALGA DE ÉL
        =====================================================================
        No es un cuarto paso: son dos pantallas que se abren **encima** de este
        menú, y por eso son banderas y no `step`.

        - `isPayScannerOpen` abre `QrScannerModal` en modo `pay`: el mismo
          componente —y la misma cámara, la misma linterna, los mismos rechazos— que
          usa el flujo de envío. Volver cierra el escáner y deja el menú tal como
          estaba.
        - `payForChargeId` abre `PayChargeView`, que es la pantalla que paga el
          cobro. Se monta acá y no en el `App` a propósito: el id **viene de un
          escaneo**, no de la barra de direcciones, y no debería recorrer la app
          entera para llegar a una pantalla que sólo existe durante un segundo.

        `z-[60]` y `z-[70]` son los del escáner y los de la pantalla de pago, por
        encima de este menú, que es `z-50`.
      */}
      {isPayScannerOpen && (
        <QrScannerModal
          isOpen
          mode="pay"
          onClose={() => setIsPayScannerOpen(false)}
          onPaymentLink={(chargeId) => {
            setIsPayScannerOpen(false);
            setPayForChargeId(chargeId);
          }}
        />
      )}

      {payForChargeId !== null && (
        <div className="absolute inset-0 z-[70] w-full max-w-md mx-auto bg-[#f3f4f6]">
          <PayChargeView id={payForChargeId} onClose={() => setPayForChargeId(null)} />
        </div>
      )}
    </div>
  );
};
