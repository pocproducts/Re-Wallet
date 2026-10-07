import React, { useState, useEffect } from 'react';
import {
  X,
  QrCode,
  Copy,
  Check,
  Share2,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { TransactionItem } from '../../types';

interface ChargeQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  userTag: string;
  btcBalance?: number;
  onUpdateBtcBalance?: (newBalance: number) => void;
  onAddTransaction: (tx: TransactionItem) => void;
  onNavigateToActivity?: () => void;
}

export const ChargeQrModal: React.FC<ChargeQrModalProps> = ({
  isOpen,
  onClose,
  userTag,
  btcBalance = 0.000186,
  onUpdateBtcBalance,
  onAddTransaction,
}) => {
  const [step, setStep] = useState<
    'select_action' | 'charge_input' | 'charge_qr' | 'pay_scan' | 'pay_success'
  >('select_action');
  const [amount, setAmount] = useState('0');
  const [copied, setCopied] = useState(false);
  const [currentBtc, setCurrentBtc] = useState<number>(btcBalance);
  const [paidBtcAmount, setPaidBtcAmount] = useState<number>(0.00005);

  useEffect(() => {
    setCurrentBtc(btcBalance);
  }, [btcBalance]);

  // Al abrir el modal, siempre reiniciar en la pantalla inicial de selección
  useEffect(() => {
    if (isOpen) {
      setStep('select_action');
      setAmount('0');
      setCopied(false);
    }
  }, [isOpen]);

  // Escaneo automático cuando entra a 'pay_scan'
  useEffect(() => {
    if (step === 'pay_scan') {
      const timer = setTimeout(() => {
        const paymentAmount = 0.00005;
        const newBalance = Math.max(0, currentBtc - paymentAmount);
        setCurrentBtc(newBalance);
        setPaidBtcAmount(paymentAmount);
        if (onUpdateBtcBalance) {
          onUpdateBtcBalance(newBalance);
        }

        // Registrar en Actividad
        const now = new Date();
        const newTx: TransactionItem = {
          id: `pay-btc-${Date.now()}`,
          title: 'Pago con QR',
          date: `Hoy, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hs`,
          amount: `- ${paymentAmount.toFixed(6)} BTC`,
          isPositive: false,
          type: 'btc',
          section: 'Hoy',
          status: 'Completada',
        };
        onAddTransaction(newTx);

        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#000000', '#F7931A', '#ffffff'],
        });

        setStep('pay_success');
      }, 1800);

      return () => clearTimeout(timer);
    }
  }, [step]);

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
      qrPayload: `rewallet://pay?tag=${encodeURIComponent(userTag)}&amount=${amount}`,
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
    const link = `https://rewallet.me/pay/${userTag.replace('$', '')}?amount=${amount}`;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    const link = `https://rewallet.me/pay/${userTag.replace('$', '')}?amount=${amount}`;
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

              <button
                type="button"
                disabled={amount === '0'}
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
          4. PAGAR CON QR: ESCANEO AUTOMÁTICO
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

                <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-1 bg-[#ccff00] shadow-[0_0_15px_#ccff00] animate-pulse" />

                <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-[#F7931A] text-2xl font-black mb-2">
                  ₿
                </div>
                <span className="text-xs font-bold text-white/80">
                  Escaneando factura...
                </span>
              </div>
            </div>

            <div className="h-4" />
          </div>
        </div>
      )}

      {/* =====================================================================
          5. PAGO REALIZADO (SIN DIV DE NUEVO SALDO, SIN BOTÓN X, SOLO BOTÓN LISTO)
         ===================================================================== */}
      {step === 'pay_success' && (
        <div className="w-full h-full max-w-md bg-[#ccff00] text-black flex flex-col justify-between overflow-hidden shadow-2xl">
          <div className="flex-1 flex flex-col justify-between p-6 h-full animate-in zoom-in-95 duration-200">
            {/* Sin botón X en la cabecera */}
            <div className="h-8" />

            {/* Mensaje de Pago Realizado */}
            <div className="max-w-sm mx-auto w-full my-auto text-center space-y-4 py-4">
              <div className="w-20 h-20 rounded-full bg-black text-[#ccff00] flex items-center justify-center mx-auto shadow-xl">
                <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
              </div>

              <div className="space-y-1">
                <h2 className="text-2xl font-black font-display text-black">
                  ¡Pago realizado!
                </h2>
                <span className="text-3xl font-black font-display text-black block tracking-tight">
                  {paidBtcAmount.toFixed(6)} BTC
                </span>
              </div>
            </div>

            {/* SOLO EL BOTÓN LISTO */}
            <div className="max-w-sm mx-auto w-full pb-3">
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-4 rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-sm shadow-xl active:scale-98 transition-all cursor-pointer"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
