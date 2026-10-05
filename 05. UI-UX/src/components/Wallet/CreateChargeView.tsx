/**
 * CREAR UN COBRO: el importe, una nota opcional, y el link para compartir.
 *
 * ── Qué es esta pantalla y qué no es ─────────────────────────────────────────
 *
 * Es el otro camino de la misma puerta que el QR: `contrato-dinero.md` dice que
 * el dinero entra *"por un link compartido"* o *"por QR"*, y este es el primero.
 * La diferencia con el modal de cobrar por QR es que acá **no hay una dirección**
 * —no se muestra, no se copia, no existe para la app—: hay un link, y el link es
 * un identificador de 32 caracteres que el servidor drew al azar.
 *
 * ── Por qué el link y no un QR ───────────────────────────────────────────────
 *
 * Porque un QR con la dirección de esta persona la muestra. Un QR con el link no:
 * lo que viaja es un id, y ese id no se puede usar para robar nada salvo que ya
 * tengas el link. El QR de dirección sigue existiendo en el modal de cobrar y es
 * otra pantalla; esta no lo reemplaza, lo acompaña.
 *
 * ── Por qué el importe es un texto y no un número ────────────────────────────
 *
 * Porque lo que se manda es `numeric(20,6)` y va como cadena. `chargeAmountToDecimal`
 * hace la cuenta con enteros: el punto del teclado es separador de miles, la coma
 * es el decimal, y los decimales de más se recortan en vez de redondearse. Un
 * `parseFloat` acá mandaría plata que nadie escribió.
 *
 * ── Por qué no hay "cancelar" ────────────────────────────────────────────────
 *
 * Porque `status = 'cancelled'` existe en la tabla pero esta tarea no lo escribe:
 * un cobro que nadie pagó no tiene plata que devolver, así que cancelarlo no le
 * devuelve nada a nadie —lo libera, y con 24 horas de plazo eso ya pasa solo—. Es
 * una decisión de producto, no un olvido, y está anotada en el README del backend.
 *
 * ── Por qué el confeti es el único festejo de acá ────────────────────────────
 *
 * Porque es lo único que pasó: se creó un link. No se movió plata, no se pagó
 * nada, y la pantalla de resultado no dice "cobraste": dice "cobro generado". El
 * festejo tiene que describir el hecho y nada más.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Share2, X } from 'lucide-react';
import confetti from 'canvas-confetti';

import { NumericKeypad } from '../common';
import {
  CHARGE_FAILURE_TEXT,
  chargeAmountToDecimal,
  createPaymentRequest,
  type PaymentRequest,
} from '../../services/paymentRequests';
import { paymentRequestShareUrl } from '../../config/paymentLinks';

interface CreateChargeViewProps {
  onClose: () => void;
  /**
   * El origen donde la persona está, para armar el link.
   *
   * Lo pasa el `App` en vez de leerlo acá: esta pantalla no sabe de dónde vino la
   * app, y el único que lo sabe es el que la montó. Sin un origen real el link
   * sería un texto que no abre nada.
   */
  origin: string;
}

/** El estado de la pantalla: el importe primero, el link después. */
type Step = 'amount' | 'created';

export const CreateChargeView: React.FC<CreateChargeViewProps> = ({ onClose, origin }) => {
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('0');
  const [note, setNote] = useState('');
  const [charge, setCharge] = useState<PaymentRequest | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const shareUrl = useMemo(
    () => (charge === null ? null : paymentRequestShareUrl(charge.id, origin)),
    [charge, origin],
  );

  const onKeyPress = useCallback((key: string) => {
    setAmount((current) => {
      if (key === 'backspace') return current.length <= 1 ? '0' : current.slice(0, -1);
      if (key === ',') return current.includes(',') ? current : `${current},`;
      if (current === '0') return key;
      // Once coma, los decimales se cuentan: un importe no es un número sin fin.
      if (current.includes(',') && current.split(',')[1].length >= 6) return current;
      return current.length < 12 ? `${current}${key}` : current;
    });
  }, []);

  const create = useCallback(async () => {
    if (creating) return;

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
        note: note.trim().length === 0 ? null : note.trim(),
      });
      setCharge(created);
      setStep('created');
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#000000', '#ffffff', '#ccff00'],
      });
    } catch (error) {
      setFailureCode((error as { code?: string }).code ?? 'PAYMENT_REQUEST_CREATE_FAILED');
    } finally {
      setCreating(false);
    }
  }, [amount, creating, note]);

  const copyLink = useCallback(() => {
    if (shareUrl === null) return;
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const share = useCallback(() => {
    if (shareUrl === null) return;
    if (typeof navigator.share === 'function') {
      void navigator
        .share({
          title: 'Cobro de ReWALLET',
          text: `Te estoy cobrando U$ ${charge?.amount ?? amount}`,
          url: shareUrl,
        })
        .catch(() => {
          /* Quien cancela el compartir no necesita un error en pantalla. */
        });
      return;
    }
    // Sin `navigator.share` —un escritorio viejo, un navegador sin soporte— el
    // compartir es copiar, y se dice lo mismo en vez de no hacer nada.
    copyLink();
  }, [amount, charge, copyLink, shareUrl]);

  const close = useCallback(() => {
    setStep('amount');
    setAmount('0');
    setNote('');
    setCharge(null);
    setFailureCode(null);
    setCopied(false);
    onClose();
  }, [onClose]);

  /* ═══ IMPORTE ═══════════════════════════════════════════════════════════════ */
  if (step === 'amount') {
    return (
      <div className="flex-1 w-full h-full bg-[#ccff00] text-black flex flex-col overflow-y-auto font-sans">
        <div className="flex items-center justify-between shrink-0 p-5 pt-6">
          <button
            onClick={close}
            type="button"
            aria-label="Volver"
            className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h2 className="text-base font-black font-display uppercase tracking-wider">Cobrar por link</h2>
          <button
            onClick={close}
            type="button"
            aria-label="Cerrar"
            className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center py-2 space-y-3">
          <span className="text-xs font-black uppercase tracking-widest text-black/60 font-display">
            Importe a cobrar
          </span>
          <div className="flex items-baseline justify-center font-display px-3">
            <span className="text-3xl font-black text-black/40 mr-2">U$</span>
            <span className="text-6xl sm:text-7xl font-black text-black tracking-tight">{amount}</span>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4 max-w-sm mx-auto w-full shrink-0">
          {/*
            La nota es opcional y corta a propósito: es lo que quien paga lee antes
            de decidir, y un párrafo no se lee en el momento en que se paga.
          */}
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 280))}
            placeholder="Nota (opcional): ¿es por qué?"
            maxLength={280}
            className="w-full min-h-[48px] bg-black/5 border border-black/10 focus:border-black rounded-2xl px-3.5 text-sm text-black placeholder-black/40 focus:outline-none transition-colors font-medium"
          />

          {failureCode !== null && (
            <p className="text-[11px] font-bold text-black/70 bg-black/10 rounded-xl px-3 py-2 leading-snug">
              {CHARGE_FAILURE_TEXT[failureCode] ?? 'No pudimos crear el cobro.'}
            </p>
          )}

          <NumericKeypad onKeyPress={onKeyPress} />

          <button
            type="button"
            onClick={() => void create()}
            disabled={amount === '0' || creating}
            className="w-full py-4 rounded-2xl bg-black text-[#ccff00] font-extrabold text-sm shadow-xl active:scale-98 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            {creating ? 'Creando el link…' : 'Generar link de cobro'}
          </button>

          <p className="text-[11px] font-semibold text-black/55 text-center leading-snug">
            El link vence en 24 horas y se puede pagar una sola vez. Quien lo abra ve
            el importe y tu nombre, nunca una dirección.
          </p>
        </div>
      </div>
    );
  }

  /* ═══ LINK CREADO ═══════════════════════════════════════════════════════════ */
  return (
    <div className="flex-1 w-full h-full bg-[#ccff00] text-black flex flex-col overflow-y-auto font-sans">
      <div className="flex items-center justify-between shrink-0 p-5 pt-6">
        <div className="w-11" />
        <h2 className="text-base font-black font-display uppercase tracking-wider">Cobro generado</h2>
        <button
          onClick={close}
          type="button"
          aria-label="Cerrar"
          className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
        >
          <X className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 max-w-sm mx-auto w-full text-center">
        <span className="text-5xl font-black font-display tracking-tight">
          U$ {charge?.amount ?? amount}
        </span>
        {charge?.note ? (
          <span className="text-xs font-semibold text-black/60 leading-snug">{charge.note}</span>
        ) : null}

        {/*
          El link, y sólo el link.

          Es lo que se comparte y lo que se abre: un identificador de 32 caracteres
          que el servidor no puede adivinar. No hay una dirección en esta pantalla
          porque no hay una dirección en este producto — quien cobra no la expone y
          quien paga no la necesita—.
        */}
        <div className="w-full bg-white rounded-[28px] p-4 shadow-xl border-2 border-black/10 space-y-2">
          <span className="text-[11px] font-black uppercase tracking-wider text-black/45 block">
            Link para cobrar
          </span>
          <p className="text-[11px] font-mono font-bold text-black/80 break-all leading-snug">
            {shareUrl}
          </p>
        </div>

        <div className="w-full grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={share}
            className="py-4 bg-black text-white font-extrabold text-sm rounded-2xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
          >
            <Share2 className="w-4 h-4 stroke-[2.2]" />
            <span>Compartir</span>
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="py-4 bg-white text-black font-extrabold text-sm rounded-2xl active:scale-95 transition-all shadow-sm flex items-center justify-center gap-2 border border-black/10 cursor-pointer"
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

      <div className="px-5 pb-6 max-w-sm mx-auto w-full shrink-0">
        <button
          type="button"
          onClick={close}
          className="w-full py-4 rounded-2xl bg-black/10 text-black font-extrabold text-sm active:scale-95 transition-all cursor-pointer"
        >
          Listo
        </button>
      </div>
    </div>
  );
};
