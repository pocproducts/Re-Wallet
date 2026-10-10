import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Mail, ShieldCheck, X } from 'lucide-react';

const CODE_LENGTH = 6;

/**
 * Entrada de código de 6 dígitos, una casilla por dígito.
 *
 * El componente **no llama a la red** y **no valida nada**: recibe el código
 * entero por `onSubmit` y quien lo renderiza decide qué hacer con él. Tampoco
 * decide cuánto se espera para reenviar: ese plazo viene por prop
 * (`resendAvailableInSeconds`), porque es del proveedor de correo, no nuestro.
 */
interface CodeVerificationProps {
  /** Correo al que se mandó el código. Se muestra tal cual. */
  email: string;
  /** Callback con el código completo de 6 dígitos. */
  onSubmit: (code: string) => void;
  /** Callback del botón de reenvío. Solo se dispara cuando la cuenta regresiva llegó a 0. */
  onResend?: () => void;
  /** Segundos que hay que esperar antes de poder pedir otro código. No lo decide este componente. */
  resendAvailableInSeconds: number;
  /** El código que se mandó no sirvió: la pantalla muestra el mensaje de reintento. */
  invalid?: boolean;

  /** El texto del error. Lo decide quien usa la pantalla, no esta. */
  errorMessage?: string | null;
  /** Vuelve a la pantalla anterior (por ejemplo, a corregir el correo). */
  onBack?: () => void;
}

export const CodeVerification: React.FC<CodeVerificationProps> = ({
  email,
  onSubmit,
  onResend,
  resendAvailableInSeconds,
  invalid = false,
  errorMessage = null,
  onBack,
}) => {
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [error, setError] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(resendAvailableInSeconds);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const lastSubmitted = useRef<string>('');

  // La cuenta regresiva arranca cuando el componente aparece y no se reinicia
  // sola: el plazo es del proveedor, no un efecto de esta pantalla.
  useEffect(() => {
    setSecondsLeft(resendAvailableInSeconds);
  }, [resendAvailableInSeconds]);

  // El componente no valida: quien lo usa le avisa que el código no sirvió y
  // recién ahí aparece el mensaje con su acción.
  useEffect(() => {
    if (invalid) setError(true);
  }, [invalid]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const code = useMemo(() => digits.join(''), [digits]);

  const focusAt = (index: number) => {
    const input = inputsRef.current[index];
    if (input) input.focus();
  };

  const clearAll = () => {
    setDigits(Array(CODE_LENGTH).fill(''));
    setError(false);
    lastSubmitted.current = '';
    focusAt(0);
  };

  /** Escribe un dígito en la casilla `index` y avanza a la siguiente. */
  const setDigit = (index: number, digit: string) => {
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError(false);

    if (digit && index < CODE_LENGTH - 1) {
      focusAt(index + 1);
    }

    // Se entrega el código solo cuando las seis casillas están llenas.
    const complete = next.join('');
    if (complete.length === CODE_LENGTH && lastSubmitted.current !== complete) {
      lastSubmitted.current = complete;
      onSubmit(complete);
    }
  };

  const handleChange = (index: number, raw: string) => {
    /*
     * `autoComplete="one-time-code"` puede inyectar el código entero en la
     * casilla enfocada. Si entra más de un dígito en una sola casilla se
     * reparte entre las que siguen, que es exactamente lo que se ve cuando el
     * sistema autocompleta el código.
     */
    const typed = raw.replace(/\D/g, '');
    if (typed.length === 0) {
      setDigit(index, '');
      return;
    }

    if (typed.length > 1) {
      const merged = [...digits];
      for (let offset = 0; offset < typed.length && index + offset < CODE_LENGTH; offset++) {
        merged[index + offset] = typed[offset];
      }
      const complete = merged.join('');
      setDigits(merged);
      setError(false);
      const filled = merged.filter(Boolean).length;
      if (filled === CODE_LENGTH) {
        if (lastSubmitted.current !== complete) {
          lastSubmitted.current = complete;
          onSubmit(complete);
        }
      } else {
        focusAt(Math.min(filled, CODE_LENGTH - 1));
      }
      return;
    }

    setDigit(index, typed);
  };

  /** Retroceso: borra la casilla actual, o la anterior si ya estaba vacía. */
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      focusAt(index - 1);
    }
  };

  /** Pegado del código completo: es el caso real, no la excepción. */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
    if (pasted.length === 0) return;

    e.preventDefault();
    const merged = [...digits];
    for (let offset = 0; offset < pasted.length && index + offset < CODE_LENGTH; offset++) {
      merged[index + offset] = pasted[offset];
    }

    setDigits(merged);
    setError(false);
    lastSubmitted.current = '';

    const filled = merged.filter(Boolean).length;
    const complete = merged.join('');
    if (filled === CODE_LENGTH) {
      lastSubmitted.current = complete;
      onSubmit(complete);
    } else {
      focusAt(Math.min(filled, CODE_LENGTH - 1));
    }
  };

  const handleResend = () => {
    setError(false);
    setSecondsLeft(resendAvailableInSeconds);
    clearAll();
    onResend?.();
  };

  return (
    <div className="w-full h-full bg-[#0A0A0A] text-white flex flex-col px-6 safe-top-5 safe-bottom-5 font-sans">
      {/* Cabecera: volver + aviso de a dónde se manda el código */}
      <div className="flex items-center justify-between mb-6 pt-2 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            type="button"
            aria-label="Volver"
            className="w-11 h-11 flex items-center justify-center bg-[#1C1C1E] border border-[#2C2C2E] text-white rounded-full active:scale-95 transition-transform cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto min-w-0">
          <Mail className="w-3.5 h-3.5 text-[#8E8E93] shrink-0" />
          <span className="text-[11px] font-extrabold text-white bg-[#1C1C1E] px-3 py-1.5 rounded-full border border-[#2C2C2E] truncate">
            {email}
          </span>
        </div>
      </div>

      {/* Título */}
      <div className="space-y-2 mb-6 shrink-0">
        <h2 className="text-2xl font-black text-white tracking-tight uppercase">
          Verificar correo
        </h2>
        <p className="text-sm text-[#8E8E93] font-medium leading-relaxed">
          Te mandamos un código de {CODE_LENGTH} dígitos a <span className="font-bold text-white">{email}</span>.
        </p>
      </div>

      {/* Casillas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#8E8E93]" />
            <span>Código de {CODE_LENGTH} dígitos</span>
          </span>

          {digits.some(Boolean) && (
            <button
              onClick={clearAll}
              type="button"
              aria-label="Borrar el código"
              className="text-[11px] font-bold text-[#8E8E93] hover:text-white flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
            >
              <X className="w-3.5 h-3.5" strokeWidth={2.4} />
              <span>Borrar todo</span>
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              value={digit}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={(e) => handlePaste(e, index)}
              onFocus={(e) => e.currentTarget.select()}
              type="text"
              inputMode="numeric"
              maxLength={1}
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              aria-label={`Dígito ${index + 1} de ${CODE_LENGTH}`}
              className={`flex-1 min-w-0 h-[55px] bg-[#1C1C1E] border rounded-xl text-center text-2xl font-black placeholder-[#555555] focus:outline-none transition-all caret-lemon ${
                digit
                  ? 'border-lemon text-lemon shadow-[0_0_15px_rgba(204,255,0,0.2)]'
                  : 'border-[#2C2C2E] text-white focus:border-lemon'
              }`}
            />
          ))}
        </div>

        {/*
         * Mensaje de error **sin botón**.
         *
         * Había dos controles que hacían lo mismo: el "Reintentar" de este
         * bloque y el "¿No te llegó? Mandá otro código" de abajo. Dos botones
         * para una acción, y el de arriba encima repetía la palabra "Reintentar"
         * sobre algo que no era un reintento de la app sino un pedido de otro
         * código.
         *
         * Queda **un solo botón para pedir otro código**, abajo. Y el mensaje
         * se queda: sin él, un código equivocado no daría ninguna señal, y
         * eso no es simplicidad, es silencio.
         */}
        {error && (
          <div className="mt-4 rounded-2xl bg-rose-500/10 border border-rose-500/40 p-3.5 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            <p className="text-[12px] font-bold text-white leading-snug flex-1">
              {errorMessage ?? 'Ese código no sirvió. Pedí uno nuevo.'}
            </p>
          </div>
        )}
      </div>

      {/* Reenvío: el plazo lo recibe por prop, no lo decide esta pantalla */}
      <div className="flex-1 flex items-end justify-center pb-2">
        {secondsLeft > 0 ? (
          <p className="text-xs font-medium text-[#8E8E93] text-center">
            Podés pedir otro código en {secondsLeft}{' '}
            {secondsLeft === 1 ? 'segundo' : 'segundos'}.
          </p>
        ) : (
          <button
            onClick={handleResend}
            type="button"
            className="text-sm font-bold text-lemon active:scale-95 transition-transform cursor-pointer"
          >
            ¿No te llegó? Reenviar código
          </button>
        )}
      </div>
    </div>
  );
};