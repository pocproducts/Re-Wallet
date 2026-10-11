/**
 * La puerta de entrada: **una sola**, correo y código.
 *
 * ── Esta pantalla es para gente que NO está autenticada en Privy ─────────────
 *
 * Ese es el cambio que evita el bug de producción. Cuando Privy ya reporta una
 * persona autenticada y lo único que falta es el intercambio con nuestro
 * backend, pedir un código por correo no es un reintento: Privy lo interpreta
 * como un intento de **enlazar** un segundo correo del mismo tipo y contesta
 * `cannot_link_more_of_type`, todas las veces. Ese camino ya no existe acá:
 *
 *   - Si `usePrivy().authenticated` es `true`, esta pantalla **no se muestra**.
 *     Lo decide `hooks/useSessionGate.ts`, que va directo a `getAccessToken()` +
 *     `POST /api/auth/session`.
 *   - Y si por un desajuste de render se llegara a montar con `authenticated` en
 *     `true`, el guarda de más abajo vuelve a negarse a mostrar el formulario.
 *     La defensa está en los dos lados a propósito: el síntoma era invisible.
 *
 * ── Una puerta, no dos ───────────────────────────────────────────────────────
 *
 * Antes había dos: "Comenzar" contra "Ya tengo cuenta", y esa bifuración fue
 * durante días la fuente del problema, porque `sendCode` tenía que saber para
 * qué lado de la puerta estaba la persona. Ahora `sendCode({ email })` **sin
 * `disableSignup`** hace las dos cosas: la primera vez crea la cuenta, la
 * segunda entra a la que ya existe. Es la misma llamada y no hay forma de que
 * se las distinga, porque del lado de Privy no se distinguen.
 *
 * ── El código de 6 dígitos no se reimplementa ────────────────────────────────
 *
 * `CodeVerification` ya existe, ya tiene la cuenta regresiva de reenvío, el
 * pegado del código del sistema y el borrado. Acá se usa y no se toca: una
 * segunda entrada de dígitos es una segunda fuente de bugs de la misma
 * pantalla.
 *
 * ── Después del código no hay nada nuestro que hacer ──────────────────────────
 *
 * Si `loginWithCode` sirve, Privy queda autenticado, y desde ese momento el
 * intercambio con el backend lo maneja `useSessionGate` por su cuenta. Esta
 * pantalla no llama a `/api/auth/session` ni vuelve a pedir tokens: si lo
 * hiciera, tendría dos caminos al mismo `POST` y volvería el bug de las dos
 * verdades.
 */
import React, { useCallback, useState } from 'react';
import { useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { ChevronLeft, Loader2, Mail } from 'lucide-react';

import { CodeVerification } from './CodeVerification';
import { API_BASE_URL } from '../../services/api';
import {
  CODE_RESEND_AVAILABLE_IN_SECONDS,
  PRIVY_ERROR_TOO_MANY_REQUESTS,
  readPrivyErrorCode,
  reportPrivyError,
  toDiagnosticCode,
} from '../../services/privy';

/** Una etapa del circuito, para que el log del Worker diga dónde se cortó. */
const ETAPA_ENVIO = 'login_envio_codigo';
const ETAPA_CODIGO = 'login_codigo';

/** Lo más honesto que se puede validar en el navegador, sin adivinar. */
const esCorreo = (valor: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());

/*
 * Etapas del flujo: `bienvenida` es la puerta pure-visual de la maqueta — las
 * dos palabras (“Crear cuenta” / “Ya tengo una cuenta”) llevan a la misma
 * etapa `correo`, porque `sendCode({ email })` en Privy crea o entra igual:
 * no hay bifurcación de lógica, solo de copy.
 */
type Etapa = 'bienvenida' | 'correo' | 'codigo';

/*
 * El neón de marca es `--color-lemon` (`#ccff00`) de `index.css`. La maqueta
 * muestra `#D4FF00`, pero la app entera ya vive en lemon: se usa el token, no
 * el valor literal de la maqueta. Los fondos dark vienen de la maqueta:
 * `#0A0A0A` página, `#1C1C1E` superficies, `#2C2C2E` bordes, `#8E8E93` suaves.
 */

export const LoginGate: React.FC = () => {
  const { ready, authenticated } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [etapa, setEtapa] = useState<Etapa>('bienvenida');
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [codigoInvalido, setCodigoInvalido] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** El envío falló: se queda en la pantalla del correo, con el texto. */
  const handleSendCode = async () => {
    const correo = email.trim();
    setErrorMessage(null);

    if (!esCorreo(correo)) {
      setErrorMessage('Revisá el correo: no parece una dirección completa.');
      return;
    }

    setEnviando(true);
    try {
      await sendCode({ email: correo });
      setEtapa('codigo');
    } catch (error) {
      const codigo = readPrivyErrorCode(error);
      void reportPrivyError(ETAPA_ENVIO, toDiagnosticCode(codigo), API_BASE_URL);

      setErrorMessage(
        codigo === PRIVY_ERROR_TOO_MANY_REQUESTS
          ? 'Pedimos demasiados códigos seguidos. Esperá un minuto y probá de nuevo.'
          : 'No pudimos mandarte el código. Revisá tu conexión y probá de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  };

  const handleResend = async () => {
    setCodigoInvalido(false);
    setErrorMessage(null);
    setVerificando(true);

    try {
      await sendCode({ email: email.trim() });
    } catch (error) {
      const codigo = readPrivyErrorCode(error);
      void reportPrivyError(ETAPA_ENVIO, toDiagnosticCode(codigo), API_BASE_URL);
      setErrorMessage(
        codigo === PRIVY_ERROR_TOO_MANY_REQUESTS
          ? 'Pedimos demasiados códigos seguidos. Esperá un minuto y probá de nuevo.'
          : 'No pudimos mandarte otro código. Probá de nuevo en un momento.',
      );
    } finally {
      setVerificando(false);
    }
  };

  const handleVerifyCode = useCallback(
    async (code: string) => {
      setCodigoInvalido(false);
      setErrorMessage(null);
      setVerificando(true);

      /*
       * `loginWithCode` es **todo** lo que esta pantalla hace. Si el código
       * sirve, Privy queda autenticado y `useSessionGate` sigue solo con el
       * intercambio; si no sirve, el código va al log del Worker con su etapa.
       */
      try {
        await loginWithCode({ code });
      } catch (error) {
        const codigoPrivy = readPrivyErrorCode(error);
        void reportPrivyError(ETAPA_CODIGO, toDiagnosticCode(codigoPrivy), API_BASE_URL);
        setCodigoInvalido(true);
        setErrorMessage(
          codigoPrivy === PRIVY_ERROR_TOO_MANY_REQUESTS
            ? 'Demasiados intentos con ese código. Pedí uno nuevo.'
            : 'Ese código no sirvió. Revisá el correo y pedí uno nuevo.',
        );
        setVerificando(false);
      }
    },
    [loginWithCode],
  );

  /*
   * Privy todavía no terminó de arrancar: no hay forma de mandar un código, y
   * mandar a alguien a una pantalla que no puede usar es peor que esperar.
   */
  if (!ready) {
    return (
      <div className="w-full h-full bg-[#0A0A0A] flex flex-col items-center justify-center gap-3 font-sans">
        <Loader2 className="w-6 h-6 text-lemon animate-spin" />
        <p className="text-xs font-medium text-[#8E8E93]">Preparando el ingreso…</p>
      </div>
    );
  }

  /*
   * Privy ya tiene a esta persona autenticada. El formulario de correo **no**
   * puede mostrarse acá: sería pedirle un código para algo que ya tiene, y la
   * respuesta sería `cannot_link_more_of_type`. Se espera el intercambio.
   */
  if (authenticated) {
    return (
      <div className="w-full h-full bg-[#f8f9fa] flex flex-col items-center justify-center gap-3 font-sans">
        <Loader2 className="w-6 h-6 text-black animate-spin" />
        <p className="text-xs font-medium text-slate-500">Abriendo tu sesión…</p>
      </div>
    );
  }

  if (etapa === 'codigo') {
    return (
      <div className="relative w-full h-full">
        <CodeVerification
          email={email.trim()}
          onSubmit={(code) => void handleVerifyCode(code)}
          onResend={() => void handleResend()}
          resendAvailableInSeconds={CODE_RESEND_AVAILABLE_IN_SECONDS}
          invalid={codigoInvalido}
          errorMessage={codigoInvalido ? errorMessage : null}
          onBack={() => {
            setCodigoInvalido(false);
            setErrorMessage(null);
            setEtapa('correo');
          }}
        />

        {verificando && (
          <div className="absolute inset-0 bg-[#0A0A0A]/80 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-lemon animate-spin" />
          </div>
        )}
      </div>
    );
  }

  const ocupado = enviando;

  if (etapa === 'bienvenida') {
    return (
      <div className="w-full h-full bg-[#0A0A0A] text-white flex flex-col px-6 safe-top-5 safe-bottom-5 font-sans">
        {/* Cabecera: marca */}
        <div className="flex items-center justify-between pt-2 shrink-0">
          <span className="text-lemon text-2xl font-black tracking-tight">rewallet.</span>
          <span className="bg-white/10 text-white text-[12px] font-semibold px-3 py-1.5 rounded-full">
            ES
          </span>
        </div>

        {/* Claim */}
        <div className="flex-1 flex flex-col justify-center">
          <p className="text-[15px] text-[#8E8E93] mb-2">Tu dinero.</p>
          <h1 className="text-[38px] leading-[1.05] font-black tracking-tight mb-4">
            UNA BILLETERA INTELIGENTE
          </h1>
          <p className="text-[15px] leading-relaxed text-[#8E8E93] mb-10">
            Gastá, enviá y ahorrá desde una sola cuenta. Enviá a cualquiera con su
            $ReTag o su código QR.
          </p>
        </div>

        {/* Una puerta, dos palabras: ambas llevan al mismo paso correo→código */}
        <div className="shrink-0 pb-2">
          <button
            type="button"
            onClick={() => setEtapa('correo')}
            className="w-full min-h-[56px] rounded-full bg-lemon text-black text-base font-bold active:scale-[0.98] transition-transform cursor-pointer mb-3"
          >
            Crear cuenta
          </button>
          <button
            type="button"
            onClick={() => setEtapa('correo')}
            className="w-full min-h-[56px] rounded-full bg-[#1C1C1E] border border-[#2C2C2E] text-white text-base font-bold active:bg-[#2C2C2E] active:scale-[0.98] transition-all cursor-pointer"
          >
            Ya tengo una cuenta
          </button>

          <p className="text-[10px] text-[#555555] text-center leading-relaxed mt-6">
            Al continuar aceptás nuestros Términos y Política de Privacidad.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#0A0A0A] text-white flex flex-col px-6 safe-top-5 safe-bottom-5 font-sans">
      {/* Cabecera: volver a la bienvenida */}
      <div className="flex items-center justify-between pt-2 mb-8 shrink-0">
        <button
          onClick={() => {
            setErrorMessage(null);
            setEtapa('bienvenida');
          }}
          type="button"
          aria-label="Volver"
          className="w-11 h-11 flex items-center justify-center bg-[#1C1C1E] border border-[#2C2C2E] text-white rounded-full active:scale-95 transition-transform cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <span className="text-lemon text-xl font-black tracking-tight">rewallet.</span>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <div className="w-14 h-14 rounded-2xl bg-[#1C1C1E] border border-[#2C2C2E] text-lemon flex items-center justify-center mb-6">
          <Mail className="w-6 h-6 stroke-[2.2]" />
        </div>

        <div className="space-y-2 mb-8">
          <h1 className="text-2xl font-black text-white tracking-tight">
            Entrá con tu correo
          </h1>
          <p className="text-xs text-[#8E8E93] font-medium">
            Escribí tu correo y te mandamos un código de 6 dígitos. Con ese código
            entrás: si es la primera vez, la cuenta se crea sola.
          </p>
        </div>

        <div className="space-y-4">
          <label htmlFor="login-email" className="block text-xs font-bold text-white">
            Correo electrónico
          </label>

          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrorMessage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !ocupado) void handleSendCode();
            }}
            placeholder="vos@correo.com"
            disabled={ocupado}
            className="w-full min-h-[52px] bg-[#1C1C1E] border border-[#2C2C2E] focus:border-lemon rounded-full px-5 text-base text-white placeholder-[#8E8E93] focus:outline-none transition-colors font-medium disabled:opacity-60"
          />

          {errorMessage && (
            <p className="text-[12px] font-bold text-rose-400 leading-snug">{errorMessage}</p>
          )}

          <button
            type="button"
            onClick={() => void handleSendCode()}
            disabled={ocupado}
            className="w-full min-h-[56px] rounded-full bg-lemon text-black text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-all cursor-pointer"
          >
            {ocupado ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mandando…</span>
              </>
            ) : (
              <span>Continuar</span>
            )}
          </button>
        </div>
      </div>

      <p className="text-[11px] font-medium text-[#555555] text-center shrink-0 pb-1">
        Te mandamos un código a ese correo. No hace falta crear la cuenta antes.
      </p>
    </div>
  );
};