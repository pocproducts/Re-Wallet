import React, { useState, useEffect } from 'react';
import {
  X,
  QrCode,
  Copy,
  Check,
  Share2,
  ArrowLeft,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { TransactionItem } from '../../types';

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
   * `null` no se rellena: no se genera el QR. Un QR de cobro sin destino real
   * es una pantalla que le pide a alguien que confíe en un número.
   */
  receiveAddress: ChargeReceiveAddress | null;
  onAddTransaction: (tx: TransactionItem) => void;
  onNavigateToActivity?: () => void;
}

export const ChargeQrModal: React.FC<ChargeQrModalProps> = ({
  isOpen,
  onClose,
  receiveAddress,
  onAddTransaction,
}) => {
  const [step, setStep] = useState<
    'select_action' | 'charge_input' | 'charge_qr' | 'pay_scan'
  >('select_action');
  const [amount, setAmount] = useState('0');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Al abrir el modal, siempre reiniciar en la pantalla inicial de selección
    if (isOpen) {
      setStep('select_action');
      setAmount('0');
      setCopied(false);
    }
  }, [isOpen]);

  /*
   * El pago con QR ya no simula un pago.
   *
   * Antes, 1,8 segundos después de entrar a `pay_scan` esta pantalla restaba
   * `0,00005 BTC` de un saldo inventado, disparaba confeti, escribía un
   * movimiento con ese importe en Actividad y mostraba “¡Pago realizado!”
   * con la cifra. Nadie había pagado nada: el número lo escribía el modal, y
   * el saldo que tocaba ni siquiera venía de la cadena.
   *
   * Hoy no hay lector de facturas conectado, así que no hay nada que confirmar:
   * por eso la pantalla **dice eso** en lugar de fabricar un comprobante. Cuando
   * el lector exista, el importe del cobro va a venir de la factura escaneada —
   * nunca de acá.
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

  // Generar QR de cobro
  const handleGenerateCharge = () => {
    const numAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(numAmount) || numAmount <= 0) return;

    /*
     * Sin dirección real no se genera el cobro. El botón queda deshabilitado
     * mientras `receiveAddress` sea `null`, y este guarda es la segunda línea:
     * un QR sin destino real sería pedirle a alguien que mande plata a un lugar
     * que la app no puede decir que es suyo.
     */
    if (receiveAddress === null) return;

    const now = new Date();
    const expiresTomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const expireTimeStr = expiresTomorrow.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const newTx: TransactionItem = {
      id: `charge-${Date.now()}`,
      title: 'Cobro por QR',
      date: `Hoy, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hs`,
      amount: `+ U$ ${amount}`,
      isPositive: true,
      type: 'qr_charge',
      section: 'Hoy',
      status: 'Pendiente',
      expiresAt: `Expira mañana a las ${expireTimeStr} hs`,
      /*
       * El payload lleva la **dirección real** de esta persona. Antes llevaba
       * sólo el `@user`, que no es una dirección: no alcanzaba para pagar, y
       * obligaba a que la app resolviera el destino por su cuenta.
       */
      qrPayload: `rewallet://pay?addr=${encodeURIComponent(receiveAddress.address)}&amount=${amount}`,
    };

    onAddTransaction(newTx);

    confetti({
      particleCount: 45,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#000000', '#ffffff', '#10b981'],
    });

    setStep('charge_qr');
  };

  const handleCopyLink = () => {
    if (receiveAddress === null) return;
    const link = `https://rewallet.me/pay/${receiveAddress.address}?amount=${amount}`;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    if (receiveAddress === null) return;
    const link = `https://rewallet.me/pay/${receiveAddress.address}?amount=${amount}`;
    if (navigator.share) {
      navigator
        .share({
          title: `Cobro ReWALLET`,
          text: `Te envío un enlace de cobro por U$ ${amount}`,
          url: link,
        })
        .catch(() => {});
    } else {
      handleCopyLink();
    }
  };

  const handleClose = () => {
    setStep('select_action');
    setAmount('0');
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
                <button
                  type="button"
                  onClick={() => setStep('pay_scan')}
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
              <span className="text-sm font-black uppercase tracking-widest text-black/60 font-display">
                Importe a cobrar
              </span>
              <div className="flex items-baseline justify-center font-display px-2">
                <span className="text-4xl sm:text-5xl font-black text-black/40 mr-2">
                  U$
                </span>
                <span className="text-7xl sm:text-8xl font-black text-black tracking-tight select-all">
                  {amount}
                </span>
              </div>
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

              <button
                type="button"
                disabled={amount === '0' || receiveAddress === null}
                onClick={handleGenerateCharge}
                className="w-full mt-4 py-4 rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-base shadow-xl active:scale-98 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              >
                <QrCode className="w-5 h-5 stroke-[2.5]" />
                <span>Generar QR de cobro</span>
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
              <div>
                <span className="text-4xl sm:text-5xl font-black font-display text-black tracking-tight block">
                  U$ {amount}
                </span>
              </div>

              <div className="bg-white rounded-[32px] p-6 shadow-2xl border-2 border-black/10 max-w-[280px] mx-auto flex items-center justify-center">
                <div className="relative w-56 h-56 bg-black p-3.5 rounded-[26px] flex items-center justify-center shadow-md">
                  <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center p-2 relative overflow-hidden">
                    <QrCode className="w-full h-full text-black stroke-[1.15]" />
                    <div className="w-12 h-12 rounded-full border-[3px] border-white bg-black shadow-lg flex items-center justify-center absolute">
                      <span className="font-display font-black text-[#ccff00] text-sm tracking-tighter">
                        Re
                      </span>
                    </div>
                  </div>
                </div>
              </div>

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

      {/* =====================================================================
          4. PAGAR CON QR: VISOR DE ESCANEO (sin pago simulado)
         ===================================================================== */}
      {step === 'pay_scan' && (
        <div className="w-full h-full max-w-md bg-[#ccff00] text-black flex flex-col justify-between overflow-hidden shadow-2xl">
          <div className="flex-1 flex flex-col justify-between p-5 h-full animate-in fade-in slide-in-from-right-3 duration-200">
            {/* Header */}
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
                Pagar con QR
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

            {/* Visor de Escaneo */}
            <div className="my-auto max-w-sm mx-auto w-full space-y-6 text-center">
              <div className="relative w-64 h-64 mx-auto bg-black rounded-[36px] overflow-hidden p-6 flex flex-col items-center justify-center shadow-2xl border-4 border-black">
                <div className="absolute top-4 left-4 w-7 h-7 border-t-4 border-l-4 border-[#ccff00] rounded-tl-xl" />
                <div className="absolute top-4 right-4 w-7 h-7 border-t-4 border-r-4 border-[#ccff00] rounded-tr-xl" />
                <div className="absolute bottom-4 left-4 w-7 h-7 border-b-4 border-l-4 border-[#ccff00] rounded-bl-xl" />
                <div className="absolute bottom-4 right-4 w-7 h-7 border-b-4 border-r-4 border-[#ccff00] rounded-br-xl" />

                <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-[#F7931A] text-2xl font-black mb-2">
                  ₿
                </div>
                {/*
                  El visor sigue siendo el mismo —esa es la interacción que la
                  persona conoce—, pero ya no se resuelve solo. Antes un
                  temporizador de 1,8 segundos daba el pago por hecho, restaba
                  una cantidad de un saldo inventado y mostraba un comprobante
                  con esa cifra. Ahora dice la verdad: todavía no hay lector de
                  facturas, así que no se puede confirmar ningún pago desde
                  acá.
                */}
                <span className="text-xs font-bold text-white/80">
                  Todavía no podemos leer el código
                </span>
                <span className="text-[11px] font-medium text-white/50 mt-1 px-4 text-center leading-snug">
                  Tu saldo no se movió.
                </span>
              </div>
            </div>

            <div className="h-4" />
          </div>
        </div>
      )}

    </div>
  );
};
