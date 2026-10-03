import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Compass,
  User,
  Mail,
  Phone,
  ScanFace,
  CheckCircle2,
  Sparkles,
  ChevronLeft,
  Check,
  ShieldCheck,
  Pencil,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { UserProfileData } from '../../types';
import { CountrySelect } from './CountrySelect';
import { composePhone, DEFAULT_COUNTRY } from '../../config/countries';
import type { Country } from '../../config/countries';
import { CodeVerification } from '../Auth/CodeVerification';
import { usePrivy, useLinkWithPasskey, useLoginWithEmail } from '@privy-io/react-auth';
import { lookupAccountAction } from '../../services/account';
import { openRewalletSession } from '../../services/session';
import { API_BASE_URL } from '../../services/api';
import {
  CODE_RESEND_AVAILABLE_IN_SECONDS,
  readPrivyErrorCode,
  reportPrivyError,
  PRIVY_ERROR_EMAIL_TAKEN,
  PRIVY_ERROR_USER_DOES_NOT_EXIST,
  PRIVY_ERROR_DISALLOWED_LOGIN_METHOD,
  PRIVY_ERROR_TOO_MANY_REQUESTS,
} from '../../services/privy';

interface OnboardingFlowProps {
  onComplete: (data: UserProfileData) => void;
}

/*
 * Las dos puertas de entrada tienen cantidad distinta de etapas, así que el
 * paso no es un número: es una etapa con nombre, y cada puerta trae su propia
 * lista. La barra y el rótulo "Paso N de M" salen de acá, no de un 3 fijo.
 */
type Step =
  | 'bienvenida'
  | 'datos'
  | 'confirmarCorreo'
  | 'passkey'
  | 'correoRegistrado'
  | 'codigo'
  | 'listo';

/**
 * Las etapas por las que se **navega**, que no es lo mismo que las que se
 * **cuentan**.
 *
 * ── Por qué hay dos listas ─────────────────────────────────────────────────────
 *
 * La barra decía "Paso 3 de 6" cuando la persona vive **cuatro** pasos. La causa
 * es que se contaba todo lo que hay en la lista de navegación, y en esa lista
 * hay dos cosas que no son pasos:
 *
 * - **`listo`** es la pantalla de éxito y la puerta de entrada a la app. **No es
 *   un paso**, y contarla hacía que el último paso real ("verificá tu correo")
 *   dijera 4 de 6 mientras la app ya le estaba abriendo.
 * - **`confirmarCorreo`** es el "¿esto es correcto?" dentro de la etapa de datos.
 *   Se ve después de escribir el correo, sin poner nada nuevo, y el paso que la
 *   persona cuenta sigue siendo "datos".
 *
 * Navegar y contar son dos cosas distintas y por eso viven en dos lugares.
 */
const CREATE_STEPS: Step[] = [
  'bienvenida',
  'datos',
  'confirmarCorreo',
  'codigo',
  'passkey',
  'listo',
];

/** Puerta "Ya tengo cuenta": correo con el que se registró → código. Sin passkey. */
const EXISTING_STEPS: Step[] = ['bienvenida', 'correoRegistrado', 'codigo', 'listo'];

/** Las etapas que la persona cuenta y ve en la barra. */
const COUNTED_CREATE: Step[] = ['bienvenida', 'datos', 'codigo', 'passkey'];
const COUNTED_EXISTING: Step[] = ['bienvenida', 'correoRegistrado', 'codigo'];

/** Las etapas contadas de una lista de navegación. */
const countedFor = (steps: Step[]): Step[] =>
  steps === EXISTING_STEPS ? COUNTED_EXISTING : COUNTED_CREATE;

/**
 * Segundos que hay que esperar antes de poder pedir otro código.
 *
 * No es un número inventado acá dentro: es el freno de la pantalla contra los
 * reenvíos, y vive en `services/privy.ts`, que es donde está la única fuente.
 * El componente de código no lo decide: lo recibe por prop.
 */
const RESEND_AVAILABLE_IN_SECONDS = CODE_RESEND_AVAILABLE_IN_SECONDS;

/**
 * Cómo se llega a la etapa de código, y por qué hay dos caminos distintos.
 *
 * - `signup`: **ya hay un usuario de Privy en este dispositivo**, porque la
 *   passkey lo acaba de crear. Acá el código **linkea el correo** a ese usuario.
 * - `email`: no hay usuario todavía. Acá el código **inicia sesión** por correo.
 *
 * No es un detalle de implementación: son dos métodos de acceso distintos de
 * Privy y confundirlos rompe el alta. Con `signup` hay que usar `useLinkEmail`,
 * porque `useLoginWithEmail` crearía un usuario nuevo desligado del que creó la
 * passkey (Hoja 4, 0.2).
 */
type AccessPath = 'signup' | 'email';

/**
 * Lo que puede salir mal en la etapa de código.
 *
 * Cada caso tiene su frase y su acción, y ninguna dice nada del sistema: el
 * código de error se queda acá adentro (contrato HTTP, regla 1.4).
 */
type CodeStageFailure =
  | 'send'
  | 'email_taken'
  | 'rate_limit'
  | 'rejected'
  | 'session';

const FAILURE_COPY: Record<CodeStageFailure, { message: string; action: string }> = {
  send: {
    message: 'No pudimos mandarte el código. Probá de nuevo.',
    action: 'Reintentar',
  },
  email_taken: {
    message: 'Ese correo ya tiene una cuenta. Entrá con él.',
    action: 'Entrar con este correo',
  },
  /**
   * El código **llegó** y no sirvió.
   *
   * Antes caía en el mensaje de siempre, "No llegó el código. Probá de nuevo.",
   * que es falso: el correo llegó, con el código adentro. Mandar a alguien a
   * revisar la bandeja cuando el código ya está ahí lo hace dudar de lo único
   * que sí funcionó. El mensaje dice lo que pasó y ofrece el reintento.
   */
  rejected: {
    message: 'Ese código no sirvió. Pedí uno nuevo.',
    action: 'Pedir otro código',
  },
  rate_limit: {
    message: 'Esperá un momento antes de pedir otro código.',
    action: 'Reintentar',
  },
  session: {
    message: 'No pudimos completar tu ingreso. Probá de nuevo.',
    action: 'Reintentar',
  },
};

const EMAIL_ERROR = 'Ingresa un correo electrónico válido';

/** Tope de la espera a que Privy marque la sesión, y cada cuánto se mira. */
/*
 * El tope de la espera, en tiempo: 40 intentos de 100 ms son **4 segundos**.
 *
 * Un celular es más lento que una PC y la propagación de sesión de Privy no es
 * instantánea. Un segundo alcanzaba en escritorio y no en el teléfono, que es
 * justo donde se probó. El tope sigue estando: una espera sin límite es una app
 * colgada, que es peor que un error visible.
 */
const AUTH_WAIT_ATTEMPTS = 40;
const AUTH_WAIT_STEP_MS = 100;

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [steps, setSteps] = useState<Step[]>(CREATE_STEPS);
  const [step, setStep] = useState<Step>('bienvenida');

  /*
   * ── Privy ────────────────────────────────────────────────────────────────
   *
   * `ready` NO es opcional: el SDK inicializa el usuario actual al montar, y
   * consumir su estado antes de eso da datos viejos o incompletos. Mientras
   * `ready` sea `false` los botones que dependen de Privy están apagados y no se
   * toca ningún hook de acceso.
   *
   * Los cuatro hooks que se usan acá, y qué devuelve cada uno:
   *
   *   `usePrivy()`                 → { ready, authenticated, user, error, getAccessToken }
   *   `useSignupWithPasskey()`     → { signupWithPasskey(), state: PasskeyFlowState }
   *   `useLinkEmail()`             → { sendCode({email}), linkWithCode({code}), state }
   *   `useLoginWithEmail()`        → { sendCode({email, disableSignup}), loginWithCode({code}), state }
   */
  const { ready: privyReady, authenticated, user: privyUser, error: privyError, getAccessToken } = usePrivy();
  const { linkWithPasskey, state: passkeyState } = useLinkWithPasskey();
  const { sendCode: sendLoginCode, loginWithCode } = useLoginWithEmail();

  /**
   * `authenticated` vive en un ref y no se lee del closure.
   *
   * La carrera: `signupWithPasskey()` resuelve cuando la passkey se creó, pero
   * `usePrivy().authenticated` todavía puede valer `false` un instante después,
   * porque el estado del hook llega en el render siguiente. Si el linkeo del
   * correo sale en ese instante, Privy responde que no hay sesión y la persona
   * ve "No llegó el código" — que además es mentira.
   *
   * Un handler asíncrono no ve renders futuros, así que el valor vivo se copia
   * a un ref en cada render y la espera mira ahí.
   */
  const authenticatedRef = useRef(authenticated);
  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  /**
   * Espera a que Privy marque la sesión, con un tope.
   *
   * El tope no es opcional: una espera sin límite es una app colgada, que es
   * peor que un error visible. Con 20 intentos de 50 ms el techo es de 1 segundo:
   * si en ese segundo Privy no dijo que hay sesión, se corta por el camino de
   * error de siempre, que ofrece entrar por correo.
   */
  /**
   * Espera **un token de acceso de verdad**, no un booleano de React.
   *
   * ── Por qué esta función y no la de arriba ──────────────────────────────────
   *
   * La versión anterior esperaba a que `usePrivy().authenticated` fuera `true`,
   * leído de un `useRef` que solo se actualiza en el render siguiente. Ese valor
   * puede decir `true` —o `false` ya消费— sin que Privy considere autenticado al
   * usuario de verdad, y el resultado fue `must_be_authenticated` al pedir el
   * código: **el booleano y la sesión no son lo mismo.**
   *
   * `getAccessToken()` sí lo es: es la llamada que hace el propio SDK para saber
   * si hay sesión, **refresca el token si venció**, y devuelve el token o `null`.
   * Si devuelve un token, el canje con nuestro backend va a funcionar, porque usa
   * exactamente ese token.
   *
   * El `authenticatedRef` se conserva solo para pintar el estado en pantalla.
   */
  const waitForAccessToken = async (): Promise<string | null> => {
    for (let attempt = 0; attempt < AUTH_WAIT_ATTEMPTS; attempt++) {
      try {
        const token = await getAccessToken();
        if (token) return token;
      } catch {
        // Todavía no hay sesión: se reintenta hasta el tope.
      }
      await new Promise((resolve) => window.setTimeout(resolve, AUTH_WAIT_STEP_MS));
    }
    return null;
  };

  // Datos del titular. Viven solo en memoria: nada se escribe hasta que el
  // código se pone (contrato 0.4).
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  /*
   * El país vive UNA vez para todo el flujo.
   *
   * Antes era un `'+54'` suelto: un prefijo escrito a mano, imposible de cambiar
   * yardo a la derecha del campo. Ahora es un país de `config/countries`, y el
   * prefijo del número compuesto sale de ahí — no de una constante.
   */
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [telefono, setTelefono] = useState('');
  const [errors, setErrors] = useState<{ nombre?: string; correo?: string; telefono?: string }>({});

  // Estados de la etapa de passkey
  const [isVerifying, setIsVerifying] = useState(false);
  const [passkeyError, setPasskeyError] = useState<'fallo' | 'no disponible' | null>(null);

  /**
   * ¿La passkey de esta persona **ya** se creó?
   *
   * Existe para una sola cosa: que volver a esta pantalla **no** vuelva a pedir
   * el alta. El alta es de una vez; repetirla no es reintentar, es crear otra.
   *
   * Y por sí sola **no alcanza**: es estado de React y se pierde al recargar.
   * Con seis intentos seguidos, cada recarga lo borraba y cada una pedía un alta
   * nueva — que es como en el panel de Privy aparecieron dos usuarios con el
   * mismo correo. Por eso la decisión real toma **dos** cosas: esta bandera y que
   * Privy ya tenga una sesión.
   */
  const [passkeyCreated, setPasskeyCreated] = useState(false);

  // Cómo se llega a la etapa de código: con usuario de Privy ya creado, o por
  // correo. Ver `AccessPath`.
  const [accessPath, setAccessPath] = useState<AccessPath>('signup');

  // Estado de la etapa de código
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [isCodeBusy, setIsCodeBusy] = useState(false);
  const [codeStageFailure, setCodeStageFailure] = useState<CodeStageFailure | null>(null);
  const [sendCount, setSendCount] = useState(0);

  // Estado de la consulta "¿este correo ya tiene cuenta?" de la puerta de ingreso
  const [isCheckingAccount, setIsCheckingAccount] = useState(false);

  const stepIndex = steps.indexOf(step);
  const isFirstStep = stepIndex === 0;

  /**
   * El índice y el total salen de las etapas **contadas**, no de las de
   * navegación. `confirmarCorreo` cae dentro de "datos" y `listo` no se cuenta.
   *
   * Si la etapa actual no está en la lista contada —que es el caso de
   * `confirmarCorreo`— se muestra el número del paso **anterior** que sí está:
   * durante esa pantalla la barra tiene que seguir mostrando dónde estás, no
   * avanzar un número que todavía no empezó.
   */
  const counted = countedFor(steps);

  /**
   * En qué paso contado está la persona.
   *
   * `counted.indexOf(step)` da **-1** para las etapas que no se cuentan —como
   * `confirmarCorreo`—, y restarle uno a un -1 tira el número muy para atrás: la
   * primera versión hacía justo eso y daba **Paso 1**, así que al completar los
   * datos la barra volvía al principio.
   *
   * La forma correcta es recorrer `steps` **hacia atrás** desde la etapa actual y
   * quedarse con la última que sí está en la lista contada. Así, durante la
   * pantalla intermedia el número **no se mueve**: la barra dice dónde estás, no
   * que empezaste un paso que todavía no empezó.
   */
  const countedCurrent = (() => {
    const position = steps.indexOf(step);
    for (let i = position; i >= 0; i--) {
      const candidate = steps[i];
      if (candidate !== undefined && counted.includes(candidate)) {
        return counted.indexOf(candidate);
      }
    }
    return 0;
  })();

  const stepCounter = `Paso ${countedCurrent + 1} de ${counted.length}`;

  /**
   * La passkey está trabajando si el botón está esperando o si el propio SDK
   * está en medio de un paso. Se leen los dos: el estado del hook cubre el
   * diálogo nativo del sistema, que es donde se pasa el tiempo.
   */
  const isPasskeyBusy =
    isVerifying ||
    passkeyState.status === 'generating-challenge' ||
    passkeyState.status === 'awaiting-passkey' ||
    passkeyState.status === 'submitting-response';

  /** Cambia de puerta y vuelve al primer paso propio de esa puerta. */
  const goToStep = (next: Step, nextSteps: Step[] = steps) => {
    setSteps(nextSteps);
    setStep(next);
  };

  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#ccff00', '#000000', '#10b981', '#38bdf8', '#ffffff'],
      });

      setTimeout(() => {
        confetti({
          particleCount: 50,
          angle: 60,
          spread: 60,
          origin: { x: 0 },
          colors: ['#ccff00', '#b8e600', '#ffffff'],
        });
        confetti({
          particleCount: 50,
          angle: 120,
          spread: 60,
          origin: { x: 1 },
          colors: ['#ccff00', '#000000', '#10b981'],
        });
      }, 200);
    } catch (e) {
      console.warn('Confetti error:', e);
    }
  };

  /* ==========================================================================
     PUERTA 1 — "COMENZAR"
     ========================================================================== */

  const handleValidateDatos = () => {
    const newErrors: { nombre?: string; correo?: string; telefono?: string } = {};

    if (!nombre.trim() || nombre.trim().length < 3) {
      newErrors.nombre = 'Ingresa tu nombre y apellido';
    }
    if (!correo.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) {
      newErrors.correo = 'Ingresa un correo electrónico válido';
    }
    if (!telefono.trim() || telefono.trim().length < 6) {
      newErrors.telefono = 'Ingresa tu número de teléfono móvil';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    // No se manda nada todavía: primero se confirma el correo.
    goToStep('confirmarCorreo');
  };

  /**
   * Confirmación del correo. Recién con "Sí" se manda el código: escribir mal
   * una dirección no tiene quecostarle un correo enviado a la persona equivocada.
   *
   * Y con "Sí" se manda **el código, no la passkey**. El orden es
   * código → passkey, al revés de lo que dice la lista de etapas:
   * `handleVerifyAccount` llama `linkWithPasskey()`, que **exige sesión de
   * Privy**, y la única llamada que la abre es `loginWithCode`. Entrando directo
   * a la passkey, `linkWithPasskey()` corría sin sesión y respondía
   * `must_be_authenticated` siempre — y el alta se quedaba sin puerta al
   * código, porque el único camino que quedaba era el rescate por correo.
   */
  const handleConfirmEmail = () => {
    setPasskeyError(null);
    void goToCodeStep('signup', CREATE_STEPS);
  };

  const handleFixEmail = () => {
    goToStep('datos');
  };

  /**
   * Manda el código al correo escrito.
   *
   * `signup` = **linkea** el correo al usuario que la passkey acaba de crear.
   * `email`  = **inicia sesión** por correo.
   *
   * Y `disableSignup: true` en el segundo caso, que no es un detalle de robustez:
   * la puerta "Ya tengo cuenta" ya preguntó al backend si la cuenta existe, así
   * que si acá Privy creara un usuario nuevo estaríamos haciendo una segunda
   * cuenta para el mismo correo. Esa puerta no crea cuentas, nunca.
   *
   * @returns `true` si el código salió y ya se puede mostrar la pantalla.
   */
  const requestCode = async (path: AccessPath): Promise<boolean> => {
    const email = correo.trim();

    try {
      /**
       * Los dos caminos usan `sendCode` de login por correo.
       *
       * El de alta **deja `disableSignup` sin poner**, así que Privy crea al
       * usuario si no existe y abre una sesión de verdad. El de ingreso lo pone en
       * `true`, que es lo que impide que "ingresar" sirva de alta encubierta.
       *
       * Antes el alta usaba `useLinkEmail`, que **exige que ya haya sesión**; y
       * la sesión que abre `signupWithPasskey` no alcanza para eso en esta app,
       * que es exactamente lo que respondía `must_be_authenticated`. Ver el
       * comentario de la sección de orden, más abajo.
       */
      await sendLoginCode(path === 'signup' ? { email } : { email, disableSignup: true });
      return true;
    } catch (error) {
      const privyCode = readPrivyErrorCode(error);
      console.warn('No se pudo mandar el código:', privyCode ?? error);
      // El error vive en el navegador, así que no llega al log del Worker ni a
      // una consola de celular. Se lo contamos nosotros. Es diagnóstico: si esta
      // llamada falla, no interrumpe nada.
      void reportPrivyError(path, privyCode, API_BASE_URL);
      setCodeStageFailure(privyCode === PRIVY_ERROR_TOO_MANY_REQUESTS ? 'rate_limit' : 'send');
      return false;
    }
  };

  /**
   * Entra a la etapa de código mandando primero el código.
   *
   * @param path Cómo se llega: linkeando a un usuario existente, o entrando por
   *             correo.
   */
  const goToCodeStep = async (path: AccessPath, nextSteps: Step[] = steps) => {
    setAccessPath(path);
    setCodeInvalid(false);
    setCodeStageFailure(null);
    goToStep('codigo', nextSteps);

    /**
     * El código se manda DESPUÉS de mostrar la etapa, no antes, así que un fallo
     * no devuelve a nadie a la etapa anterior.
     *
     * Antes, si el envío fallaba se hacía `goToStep('datos')`. Eso era peor que
     * el fallo: la persona volvía a llenar los datos, pasaba otra vez por la
     * passkey —que **ya estaba creada**, así que fallaba—, y terminaba viendo
     * "No pudimos crear tu huella" cuando su passkey funcionaba perfecto.
     *
     * Un error de envío se muestra **donde estás**, con el reintento al lado.
     * Volver atrás soloServía para rehacer un paso que ya había salido bien.
     */
    void requestCode(path);
    // El remount por `key` reinicia la entrada de código y la cuenta regresiva.
    setSendCount((n) => n + 1);
  };

  /**
   * Passkey: **crea** la cuenta. Esto es `signupWithPasskey` y no
   * `loginWithPasskey`, y no es un detalle de nombre: crear un usuario y entrar a
   * uno existente son llamadas distintas, y usar la equivocada rompe el alta de
   * la persona que todavía no tiene cuenta.
   *
   * El resultado se **guarda**: si falla, no se sigue al código como si nada.
   * Se muestra el error en esta misma pantalla y la salida es el correo
   * (Hoja 4, 1.4). No se reintenta a ciegas: reintentar es volver a apretar el
   * botón, a mano de la persona.
   */
  const handleVerifyAccount = async () => {
    if (!privyReady || isPasskeyBusy) return;

    setIsVerifying(true);
    setPasskeyError(null);

    const canCreatePasskey =
      typeof window !== 'undefined' && !!window.navigator?.credentials?.create;

    /**
     * Si este navegador NO puede crear una passkey —escritorio, Firefox viejo,
     * contexto no seguro—, no se puede seguir como si la passkey se hubiera
     * creado. Ese caso ahora cae dentro de Privy, y el mensaje es distinto al
     * del fallo de la persona, con la misma salida: entrar por correo.
     */
    if (!canCreatePasskey) {
      setIsVerifying(false);
      setPasskeyError('no disponible');
      return;
    }

    /**
     * Si el SDK ni siquiera pudo inicializarse, la passkey no va a funcionar y
     * no vale la pena pedirle un diálogo que va a fallar: se muestra el mismo
     * mensaje de fallo, que es el que la persona puede resolver.
     */
    if (privyError) {
      setIsVerifying(false);
      setPasskeyError('fallo');
      return;
    }

    /**
     * Pega la passkey a la persona que **ya está identificada**.
     *
     * ── Por qué esto va después del código y no antes ──────────────────────────
     *
     * El orden original del contrato era passkey → código. Con Privy **ese orden
     * no funciona**: el alta con passkey abre el usuario pero no una sesión que
     * `linkEmail` acepte, y el paso siguiente respondía `must_be_authenticated`.
     *
     * El orden que Privy sí soporta es el revés: el correo abre una sesión real y
     * después `useLinkWithPasskey` **pega** la passkey a ese usuario. La passkey
     * no se pierde: se sigue creando, y la persona sigue entrando con su huella.
     *
     * Y en producto el orden nuevo es mejor, no peor: **la passkey queda pegada a
     * alguien que ya verificó su correo**, en vez de a un usuario que todavía no
     * era nadie. Si alguien abandona después del código, queda una cuenta con
     * correo verificado y recuperable por correo — que es la vía de recuperación
     * que ya estaba diseñada (Hoja 4, 6.1).
     *
     * ── Por qué no se reintenta a ciegas ────────────────────────────────────────
     *
     * Pegar dos veces la misma passkey no es "volver a apretar el botón": es
     * **meter a la misma persona dos veces**. La bandera existe para que eso no
     * pase, y el estado de React por sí solo no alcanza: se pierde al recargar, y
     * por eso la decisión también mira si Privy ya tiene a esa persona.
     */
    if (passkeyCreated || privyUser !== null) {
      await finishWithSession();
      return;
    }

    try {
      await linkWithPasskey();
      setPasskeyCreated(true);
    } catch (error) {
      const privyCode = readPrivyErrorCode(error);
      console.warn('Passkey link failed:', readPrivyErrorCode(error) ?? error);
      void reportPrivyError('passkey', privyCode, API_BASE_URL);
      setIsVerifying(false);
      setPasskeyError('fallo');
      return;
    }

    await finishWithSession();
  };

  /**
   * Canjea la sesión de Privy por una de ReWALLET y entra a la app.
   *
   * Va al final porque es lo que **deja entrar**: el token de Privy se verifica en
   * nuestro backend, se crea la cuenta, se provisionan las wallets en orden y se
   * emite la cookie. Antes de esto nada se escribió.
   */
  const finishWithSession = async (): Promise<void> => {
    const token = await waitForAccessToken();
    if (!token) {
      void reportPrivyError('sesion_sin_token', 'must_be_authenticated', API_BASE_URL);
      setIsVerifying(false);
      setPasskeyError('fallo');
      return;
    }

    setIsVerifying(false);
  };

  /**
   * Rescate de la passkey: se entra por correo, que es la segunda puerta y
   * siempre está disponible. Acá cambia el método de acceso: sin passkey no hay
   * usuario de Privy, así que el código **inicia sesión** en vez de linkearse.
   */
  const handleEnterByEmail = () => {
    setPasskeyError(null);
    goToCodeStep('email', EXISTING_STEPS);
  };

  /* ==========================================================================
     PUERTA 2 — "YA TENGO CUENTA"
     ========================================================================== */

  const handleStartExistingAccount = () => {
    setErrors({});
    setPasskeyError(null);
    setCodeInvalid(false);
    goToStep('correoRegistrado', EXISTING_STEPS);
  };

  /**
   * Puerta de ingreso: antes de mandar un código hay que saber qué hacer con ese
   * correo, y eso lo contesta **el backend**, no esta pantalla.
   *
   * `verify_email`  → hay cuenta: se manda el código y entra.
   * `start_signup`  → se lleva a "Comenzar" con el correo ya escrito.
   */
  const handleValidateRegisteredEmail = async () => {
    const email = correo.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors({ correo: EMAIL_ERROR });
      return;
    }
    if (!privyReady || isCheckingAccount) return;

    setErrors({});
    setIsCheckingAccount(true);

    let action: Awaited<ReturnType<typeof lookupAccountAction>>;
    try {
      action = await lookupAccountAction(email);
    } catch {
      // La consulta falló: se dice que no se pudo y se deja a la persona volver a
      // apretar. No se decide a dónde llevarla con una respuesta que no llegó.
      setErrors({ correo: 'No pudimos buscar tu cuenta. Probá de nuevo.' });
      setIsCheckingAccount(false);
      return;
    }
    setIsCheckingAccount(false);

    if (action === 'verify_email') {
      await goToCodeStep('email', EXISTING_STEPS);
      return;
    }

    /*
     * ======================================================================
     * NO ESCRIBIR AQUÍ "ESE CORREO NO ESTÁ REGISTRADO". NUNCA.
     * ======================================================================
     *
     * Decirle a alguien que su correo no tiene cuenta convierte esta pantalla
     * en un oráculo: con dos correos alcanza para descubrir cuáles están
     * dados de alta, y esa es información de otra persona, no un mensaje de
     * error. La regla de seguridad es esa, no una preferencia de redacción.
     *
     * Por eso el camino del "no" es idéntico al del "sí" desde el punto de
     * vista de quien está mirando: se lo lleva a "Comenzar" con el correo ya
     * escrito en el formulario de datos y no se dice absolutamente nada.
     * Quien no tiene cuenta solo puede crearla, que es justamente lo que ofrece
     * la otra puerta.
     */
    setCorreo(email);
    setAccessPath('signup');
    setCodeInvalid(false);
    setCodeStageFailure(null);
    goToStep('datos', CREATE_STEPS);
  };

  /* ==========================================================================
     CÓDIGO DE 6 DÍDIGITOS — LA PUERTA DE ENTRADA
     ========================================================================== */

  /**
   * Canje del token de Privy por la sesión de ReWALLET.
   *
   * El token **nunca se guarda**: va en el `POST`, el backend responde con la
   * cookie httpOnly y el front no recibe ni guarda ningún valor (contrato 4.1:
   * a partir de acá manda la sesión de ReWALLET, no la de Privy).
   *
   * En la puerta de ingreso no hay nombre ni teléfono porque no pasaron por el
   * formulario de datos.
   *
   * PENDIENTE (backend): `POST /auth/session` hoy exige que `name` sea un
   * string, y por eso acá se manda vacío en lugar de inventar un nombre. El
   * arreglo correcto no es del lado del cliente: `name` debería ser obligatorio
   * **solo cuando la cuenta no existe**, porque el backend verifica el token,
   * busca la cuenta por DID y solo necesita el nombre si la está creando. Para
   * una cuenta que ya existe el valor se ignora. Ese cambio se está haciendo
   * del lado del servidor; hasta entonces, vacío y sin datos falsos.
   */
  const exchangeSessionForRewalletSession = async (): Promise<boolean> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setCodeStageFailure('session');
      return false;
    }

    try {
      await openRewalletSession({
        accessToken,
        name: nombre.trim(),
        email: correo.trim(),
        phone: telefono.trim() ? composePhone(telefono, country) : null,
      });
    } catch (error) {
      console.warn('No se pudo abrir la sesión de ReWALLET:', error);
      setCodeStageFailure('session');
      return false;
    }

    return true;
  };

  /**
   * Recibe el código del componente de 6 dígitos y se lo pasa a Privy.
   *
   * **ReWALLET no verifica códigos**: los manda Privy, los verifica Privy y los
   * borra Privy. Acá solo se traduce una respuesta de Privy en algo que una
   * persona pueda entender y hacer.
   */
  const handleCodeSubmit = async (code: string) => {
    if (isCodeBusy || !privyReady) return;

    setIsCodeBusy(true);
    setCodeInvalid(false);
    setCodeStageFailure(null);

    try {
      // El código **siempre** inicia sesión. En el camino de alta, Privy crea al
      // usuario si no existía; en el de ingreso, lo autentica. Los dos casos son
      // la misma llamada, y es la que abre una sesión que después permite pegar la
      // passkey.
      await loginWithCode({ code });
    } catch (error) {
      const privyCode = readPrivyErrorCode(error);
      console.warn('El código no sirvió:', privyCode ?? error);

      if (
        privyCode === PRIVY_ERROR_USER_DOES_NOT_EXIST ||
        privyCode === PRIVY_ERROR_DISALLOWED_LOGIN_METHOD
      ) {
        // El código llegó y no corresponde a nada. Decir "no llegó" sería mentira.
        void reportPrivyError('codigo', privyCode, API_BASE_URL);
        setCodeStageFailure('rejected');
      } else if (privyCode === PRIVY_ERROR_EMAIL_TAKEN) {
        // Hoja 4, 3.5: el correo ya pertenece a otra cuenta. Se lo dice y se
        // ofrece entrar con él — es una app de plata y equivocarse de correo
        // necesita salida, no silencio.
        setCodeStageFailure('email_taken');
      } else if (privyCode === PRIVY_ERROR_TOO_MANY_REQUESTS) {
        setCodeStageFailure('rate_limit');
      } else {
        // Cualquier otra cosa es un código que no llegó o no sirvió: el mensaje
        // es el de siempre, el del componente, con su Reintentar.
        setCodeInvalid(true);
      }
      setIsCodeBusy(false);
      return;
    }

    // El correo quedó verificado y hay sesión. Ahora sí se pega la passkey a
    // **esta** persona, que ya está identificada: antes la passkey era lo
    // primero que se creaba, de un usuario que todavía no era nadie.
    setIsCodeBusy(false);
    setPasskeyError(null);
    goToStep('passkey');
  };

  /** Vuelve a mandar el código al mismo correo. El plazo lo pone el proveedor. */
  const handleResendCode = async () => {
    setCodeInvalid(false);
    setCodeStageFailure(null);
    await requestCode(accessPath);
  };

  /**
   * Acción del cartel de error de la etapa de código.
   *
   * `email_taken` cambia de método de acceso —de linkear a iniciar sesión— y
   * vuelve a mandar el código. Los demás reintentan lo mismo que falló, sin
   * inventarse un camino nuevo.
   */
  const handleCodeFailureAction = async () => {
    if (codeStageFailure === 'email_taken') {
      setAccessPath('email');
      setCodeStageFailure(null);
      setCodeInvalid(false);
      await requestCode('email');
      setSendCount((n) => n + 1);
      return;
    }

    if (codeStageFailure === 'session') {
      setCodeStageFailure(null);
      const opened = await exchangeSessionForRewalletSession();
      if (!opened) return;
      triggerConfetti();
      goToStep('listo');
      return;
    }

    if (codeStageFailure === 'rate_limit' || codeStageFailure === 'send') {
      setCodeStageFailure(null);
      await requestCode(accessPath);
    }
  };

  /**
   * Ingreso a la app. Recién en este botón se arma el perfil que `App` persiste:
   * hasta acá no hubo ninguna escritura.
   */
  const handleEnterApp = () => {
    // El prefijo lo compone el país elegido, nunca el texto que la persona escribió.
    const fullPhone = composePhone(telefono, country);
    const profileData: UserProfileData = {
      nombre: nombre.trim(),
      correo: correo.trim(),
      telefono: fullPhone,
      faceIdLinked: true,
      faceIdKeyId: 'fid_' + Math.random().toString(36).substring(2, 10).toUpperCase(),
      registradoEn: new Date().toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    };

    onComplete(profileData);
  };

  return (
    /*
     * `safe-top-5` / `safe-bottom-5` reemplazan a los `pt-5` / `pb-5` del `p-5`
     * de siempre: son los mismos 20px más el notch arriba y la barra de inicio
     * abajo. Por eso el `p-5` se descompone en `px-5` más las dos utilities.
     */
    <div className="w-full h-full bg-[#f8f9fa] text-black flex flex-col justify-between px-5 safe-top-5 safe-bottom-5 select-none overflow-y-auto font-sans">
      {/* =========================================================================
          BARRA DE PROGRESO — un segmento por etapa real de esta puerta
         ========================================================================= */}
      <div className="w-full max-w-sm mx-auto pt-2 pb-2">
        <div className="flex items-center justify-between gap-2">
          {counted.map((s, index) => (
            <div key={s} className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ease-out ${
                  index <= countedCurrent ? 'bg-black' : 'bg-transparent'
                }`}
                style={{
                  width: index <= countedCurrent ? '100%' : '0%',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/*
          ETAPA 1: BIENVENIDA

          Copia de la pantalla de bienvenida del proyecto Front End: mismo ícono,
          mismo título, mismo párrafo y mismos dos botones. Dos pantallas de
          bienvenida distintas en el mismo producto no son dos pantallas: son un
          fork de diseño que alguien tiene que notar.
         */}
      {step === 'bienvenida' && (
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="flex-1 flex flex-col justify-center py-8">
            <div className="mb-6 w-14 h-14 rounded-2xl bg-black text-[#ccff00] flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]">
              <Compass className="w-7 h-7" strokeWidth={2.4} />
            </div>
            <h1 className="text-[2.75rem] leading-[1.02] tracking-tight font-black font-display text-black">
              Hola
              <br />
              <span className="text-slate-900">¡Bienvenido!</span>
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-slate-500 font-medium">
              Creá tu cuenta en menos de un minuto. Después entrás con tu huella digital, sin
              passwords que olvidarte ni que te roben.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={() => goToStep('datos', CREATE_STEPS)}
              type="button"
              className="w-full min-h-[52px] rounded-2xl bg-black hover:bg-slate-900 text-[#ccff00] font-extrabold text-[15px] flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Comenzar</span>
              <ArrowRight className="w-5 h-5 stroke-[2.5]" />
            </button>

            <button
              onClick={handleStartExistingAccount}
              type="button"
              className="w-full min-h-[46px] rounded-full bg-white hover:bg-slate-100 text-black font-bold text-sm flex items-center justify-center border border-slate-200 transition active:scale-[0.98] cursor-pointer"
            >
              <span>Ya tengo cuenta</span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ETAPA 2: NOMBRE, APELLIDO, CORREO Y TELÉFONO (SIN HANDLE DE PAGO)
         ========================================================================= */}
      {step === 'datos' && (
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in slide-in-from-right-4 duration-300">
          <div>
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => goToStep('bienvenida', CREATE_STEPS)}
                type="button"
                aria-label="Volver"
                className="w-11 h-11 flex items-center justify-center text-black rounded-full bg-white border border-slate-200/80 shadow-2xs hover:bg-slate-50 active:scale-95 transition-transform cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
              </button>

              <span className="text-[11px] font-extrabold text-black bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs">
                {stepCounter}
              </span>
            </div>

            <div className="space-y-1 mb-5">
              <h2 className="text-2xl font-black font-display text-black tracking-tight">
                Datos del Titular
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Completa tus datos para crear tu cuenta en dólares digitales.
              </p>
            </div>

            {/* Formulario en tarjeta blanca de diseño Clean */}
            <div className="bg-white border border-slate-200/80 rounded-[28px] p-5 shadow-xs space-y-4">
              {/* Campo Nombre y Apellido */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-black flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    <span>Nombre y Apellido</span>
                  </span>
                  {nombre.trim().length >= 3 && (
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Válido
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value);
                    if (errors.nombre) setErrors({ ...errors, nombre: undefined });
                  }}
                  placeholder="Ej: Joaquin Cortez"
                  className="w-full min-h-[46px] bg-slate-50 border border-slate-200 focus:border-black rounded-2xl px-4 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium"
                />
                {errors.nombre && (
                  <p className="text-[11px] text-rose-500 font-bold">{errors.nombre}</p>
                )}
              </div>

              {/* Campo Correo Electrónico */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-black flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span>Correo Electrónico</span>
                  </span>
                  {correo.includes('@') && correo.includes('.') && (
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Válido
                    </span>
                  )}
                </label>
                <input
                  type="email"
                  value={correo}
                  onChange={(e) => {
                    setCorreo(e.target.value);
                    if (errors.correo) setErrors({ ...errors, correo: undefined });
                  }}
                  placeholder="tu.nombre@ejemplo.com"
                  className="w-full min-h-[46px] bg-slate-50 border border-slate-200 focus:border-black rounded-2xl px-4 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium"
                />
                {errors.correo && (
                  <p className="text-[11px] text-rose-500 font-bold">{errors.correo}</p>
                )}
              </div>

              {/* Campo Número de Teléfono */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-black flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span>Número de Teléfono</span>
                  </span>
                  {telefono.trim().length >= 6 && (
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Válido
                    </span>
                  )}
                </label>

                {/* Los 198 países: el prefijo se compone del país elegido y el
                    campo nunca le pide a nadie que escriba un `+`. */}
                <div className="flex gap-2">
                  <CountrySelect value={country} onChange={setCountry} />

                  <input
                    type="tel"
                    value={telefono}
                    onChange={(e) => {
                      setTelefono(e.target.value);
                      if (errors.telefono) setErrors({ ...errors, telefono: undefined });
                    }}
                    placeholder="11 2345 6789"
                    /*
                     * `min-w-0` no es decoración: un item flex tiene `min-width: auto`
                     * y por lo tanto NO baja de su ancho min-content. Con el input en
                     * 16px ese mínimo pasó del ancho disponible y el campo se salía de
                     * la tarjeta en un teléfono de 390px. `min-w-0` le devuelve al flex
                     * la autoridad de encogerlo.
                     */
                    className="flex-1 min-w-0 min-h-[46px] bg-slate-50 border border-slate-200 focus:border-black rounded-2xl px-4 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium"
                  />
                </div>
                {errors.telefono && (
                  <p className="text-[11px] text-rose-500 font-bold">{errors.telefono}</p>
                )}
              </div>
            </div>
          </div>

          {/* Botón Crear cuenta */}
          <div className="pt-3">
            <button
              onClick={handleValidateDatos}
              type="button"
              className="w-full min-h-[52px] rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Crear cuenta</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ETAPA: CONFIRMAR EL CORREO — no se manda nada hasta que se diga "Sí"
         ========================================================================= */}
      {step === 'confirmarCorreo' && (
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in slide-in-from-right-4 duration-300">
          <div>
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={handleFixEmail}
                type="button"
                aria-label="Volver"
                className="w-11 h-11 flex items-center justify-center text-black rounded-full bg-white border border-slate-200/80 shadow-2xs hover:bg-slate-50 active:scale-95 transition-transform cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
              </button>

              <span className="text-[11px] font-extrabold text-black bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs">
                {stepCounter}
              </span>
            </div>

            <div className="space-y-1 mb-5">
              <h2 className="text-2xl font-black font-display text-black tracking-tight">
                Revisá tu correo
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Te vamos a mandar un código de 6 dígitos a este correo.
              </p>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-[28px] p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-4">
                <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="text-base font-extrabold text-black break-all min-w-0">
                  {correo.trim()}
                </span>
              </div>

              <p className="text-sm font-bold text-black">¿Es correcto?</p>

              <div className="mt-4 space-y-2.5">
                <button
                  onClick={handleConfirmEmail}
                  type="button"
                  className="w-full min-h-[52px] rounded-2xl bg-black hover:bg-slate-900 text-[#ccff00] font-extrabold text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Sí</span>
                </button>

                <button
                  onClick={handleFixEmail}
                  type="button"
                  className="w-full min-h-[46px] rounded-full bg-white hover:bg-slate-100 text-black font-bold text-sm flex items-center justify-center gap-2 border border-slate-200 transition active:scale-[0.98] cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Corregir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ETAPA: PASSKEY — crea la cuenta. Si falla, se entra por correo.
         ========================================================================= */}
      {step === 'passkey' && (
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in slide-in-from-right-4 duration-300">
          {/* Header Superior con Flecha y Pasos */}
          <div className="shrink-0">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => goToStep('confirmarCorreo', CREATE_STEPS)}
                type="button"
                aria-label="Volver"
                className="w-11 h-11 flex items-center justify-center text-black rounded-full bg-white border border-slate-200/80 shadow-2xs hover:bg-slate-50 active:scale-95 transition-transform cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
              </button>

              <span className="text-[11px] font-extrabold text-black bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs ml-auto">
                {stepCounter}
              </span>
            </div>

            {/* Título y Subtítulo */}
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-black font-display text-black tracking-tight">
                Verificación Biométrica
              </h2>
              <p className="text-xs text-slate-500 max-w-xs mx-auto font-medium">
                Verifica tu identidad de forma segura para proteger tus fondos y confirmar tu registro.
              </p>
            </div>
          </div>

          {/* DIV EN EL CENTRO DEL ESPACIO LIBRE QUE HAY ENTRE LA DESCRIPCIÓN Y EL BOTÓN */}
          <div className="flex-1 flex flex-col items-center justify-center my-auto">
            <div className="relative w-44 h-44 mx-auto flex items-center justify-center">
              {/* Esquinas del visor */}
              <div
                className={`absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 rounded-tl-2xl transition-colors duration-300 ${
                  isVerifying ? 'border-[#ccff00]' : 'border-black'
                }`}
              />
              <div
                className={`absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 rounded-tr-2xl transition-colors duration-300 ${
                  isVerifying ? 'border-[#ccff00]' : 'border-black'
                }`}
              />
              <div
                className={`absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 rounded-bl-2xl transition-colors duration-300 ${
                  isVerifying ? 'border-[#ccff00]' : 'border-black'
                }`}
              />
              <div
                className={`absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 rounded-br-2xl transition-colors duration-300 ${
                  isVerifying ? 'border-[#ccff00]' : 'border-black'
                }`}
              />

              {/* Círculo central con el logo de la cara */}
              <div
                className={`w-36 h-36 rounded-full flex items-center justify-center text-black shadow-lg transition-all duration-300 ${
                  isVerifying ? 'bg-black text-[#ccff00] scale-105' : 'bg-white border-2 border-slate-100'
                }`}
              >
                <ScanFace
                  className={`w-16 h-16 stroke-[1.8] ${
                    isVerifying ? 'animate-pulse text-[#ccff00]' : 'text-black'
                  }`}
                />
              </div>
            </div>
          </div>

          {/*
              Fallo de la passkey: se ve acá, en esta pantalla, y no después.
              La salida es el correo, que es la segunda puerta.
           */}
          {passkeyError && (
            <div className="shrink-0 mb-3 rounded-2xl bg-rose-50 border border-rose-200 p-3.5">
              <p className="text-[12px] font-bold text-black leading-snug">
                {passkeyError === 'no disponible'
                  ? 'Este dispositivo no puede guardar tu huella. Podés entrar con tu correo, es igual de seguro.'
                  : 'No pudimos crear tu huella. Podés entrar con tu correo, es igual de seguro.'}
              </p>
              <button
                onClick={handleEnterByEmail}
                type="button"
                className="mt-2 text-[12px] font-extrabold text-black underline underline-offset-2 active:scale-95 transition-transform cursor-pointer"
              >
                Entrar con mi correo
              </button>
            </div>
          )}

          {/* Botón inferior: "Verificar cuenta" */}
          <div className="shrink-0 pt-2">
            <button
              onClick={handleVerifyAccount}
              disabled={isPasskeyBusy || passkeyError !== null || !privyReady}
              type="button"
              className="w-full min-h-[52px] rounded-2xl bg-black hover:bg-slate-900 text-white font-extrabold text-sm flex items-center justify-center gap-2.5 shadow-xl active:scale-[0.98] transition-all cursor-pointer disabled:opacity-70"
            >
              <ScanFace className="w-5 h-5 stroke-[2.2]" />
              <span>
                {!privyReady ? 'Cargando...' : isPasskeyBusy ? 'Verificando...' : 'Verificar cuenta'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          PUERTA 2: CORREO CON EL QUE SE REGISTRÓ
         ========================================================================= */}
      {step === 'correoRegistrado' && (
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in slide-in-from-right-4 duration-300">
          <div>
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => goToStep('bienvenida', EXISTING_STEPS)}
                type="button"
                aria-label="Volver"
                className="w-11 h-11 flex items-center justify-center text-black rounded-full bg-white border border-slate-200/80 shadow-2xs hover:bg-slate-50 active:scale-95 transition-transform cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5 stroke-[2.2]" />
              </button>

              <span className="text-[11px] font-extrabold text-black bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs">
                {stepCounter}
              </span>
            </div>

            <div className="space-y-1 mb-5">
              <h2 className="text-2xl font-black font-display text-black tracking-tight">
                ¿Con cuál te registraste?
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Te mandamos un código de 6 dígitos para entrar a tu cuenta.
              </p>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-[28px] p-5 shadow-xs">
              <label className="text-xs font-bold text-black flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>Correo Electrónico</span>
              </label>
              <input
                type="email"
                value={correo}
                onChange={(e) => {
                  setCorreo(e.target.value);
                  if (errors.correo) setErrors({ ...errors, correo: undefined });
                }}
                placeholder="tu.nombre@ejemplo.com"
                className="mt-1.5 w-full min-h-[46px] bg-slate-50 border border-slate-200 focus:border-black rounded-2xl px-4 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium"
              />
              {errors.correo && (
                <p className="mt-1.5 text-[11px] text-rose-500 font-bold">{errors.correo}</p>
              )}
            </div>
          </div>

          <div className="pt-3">
            <button
              onClick={handleValidateRegisteredEmail}
              disabled={isCheckingAccount || !privyReady}
              type="button"
              className="w-full min-h-[52px] rounded-2xl bg-black hover:bg-slate-900 text-[#ccff00] font-extrabold text-sm flex items-center justify-center gap-2 shadow-xl active:scale-[0.98] transition-all cursor-pointer disabled:opacity-70"
            >
              <span>
                {!privyReady
                  ? 'Cargando...'
                  : isCheckingAccount
                    ? 'Buscando tu cuenta...'
                    : 'Enviar código'}
              </span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ETAPA: CÓDIGO DE 6 DÍDIGITOS — hasta ponerlo no se ve nada de ReWALLET
         ========================================================================= */}
      {step === 'codigo' && (
        <div className="flex flex-col h-full min-h-0">
          {/* Cartel de error de ESTA etapa. Va arriba del componente de código y
              no adentro: `CodeVerification` no se toca y su propio mensaje ("No
              llegó el código. Probá de nuevo.") sigue siendo el suyo. */}
          {codeStageFailure && (
            <div className="shrink-0 mb-3 mx-5 rounded-2xl bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-[12px] font-bold text-black leading-snug">
                  {FAILURE_COPY[codeStageFailure].message}
                </p>
                <button
                  onClick={handleCodeFailureAction}
                  disabled={isCodeBusy}
                  type="button"
                  className="mt-2 text-[12px] font-extrabold text-black underline underline-offset-2 active:scale-95 transition-transform cursor-pointer disabled:opacity-70"
                >
                  {FAILURE_COPY[codeStageFailure].action}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <CodeVerification
              key={sendCount}
              email={correo.trim()}
              invalid={codeInvalid}
              errorMessage={
                codeStageFailure && codeStageFailure !== 'session'
                  ? FAILURE_COPY[codeStageFailure].message
                  : null
              }
              onSubmit={handleCodeSubmit}
              onResend={handleResendCode}
              resendAvailableInSeconds={RESEND_AVAILABLE_IN_SECONDS}
              onBack={() =>
                steps === EXISTING_STEPS ? handleValidateRegisteredEmail() : handleFixEmail()
              }
            />
          </div>
        </div>
      )}

      {/* =========================================================================
          ETAPA LISTA: CUENTA CONFIRMADA, AHORA SÍ SE INGRESA
         ========================================================================= */}
      {step === 'listo' && (
        <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="shrink-0">
            <div className="flex items-center justify-between mb-4">
              <div className="w-11" />

              <span className="text-[11px] font-extrabold text-black bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs ml-auto">
                {stepCounter}
              </span>
            </div>

            <div className="text-center space-y-1">
              <h2 className="text-2xl font-black font-display text-black tracking-tight">
                ¡Cuenta generada con éxito!
              </h2>
              <p className="text-xs text-slate-500 max-w-xs mx-auto font-medium">
                {nombre.split(' ')[0]
                  ? `¡Bienvenido, ${nombre.split(' ')[0]}! Tu cuenta en ReWALLET está lista para operar.`
                  : 'Tu cuenta en ReWALLET está lista para operar.'}
              </p>
            </div>
          </div>

          {/* Estado final: Cuenta Confirmada con Confeti */}
          <div className="flex-1 flex flex-col items-center justify-center my-auto">
            <div className="space-y-4 text-center animate-in zoom-in-95 duration-300">
              <div className="w-24 h-24 mx-auto rounded-full bg-[#ccff00] text-black flex items-center justify-center shadow-xl">
                <CheckCircle2 className="w-14 h-14 stroke-[2.2]" />
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-slate-200 text-xs font-extrabold text-black shadow-2xs">
                <Sparkles className="w-4 h-4 text-emerald-500" />
                <span>Cuenta generada correctamente</span>
              </div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Correo verificado</span>
              </div>
            </div>
          </div>

          <div className="shrink-0 pt-2">
            <button
              onClick={handleEnterApp}
              type="button"
              className="w-full min-h-[52px] rounded-2xl bg-black hover:bg-slate-900 text-[#ccff00] font-extrabold text-sm flex items-center justify-center gap-2 shadow-2xl active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Ingresar a la App</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};