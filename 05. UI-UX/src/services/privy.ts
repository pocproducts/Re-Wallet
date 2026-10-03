/**
 * Lo que hay que saber del SDK de Privy sin abrir la documentación otra vez.
 *
 * Todo lo de acá sale de las definiciones de tipos de `@privy-io/react-auth` de
 * este proyecto, no de memoria: los nombres de los códigos de error y el valor
 * del plazo de reenvío son cosas que cambian entre versiones.
 */

/**
 * Segundos que la pantalla espera antes de ofrecer pedir otro código.
 *
 * **Este número NO es el límite de Privy.** Es el freno local de la pantalla, y
 * existe para que el botón no sea un martillo sobre el servicio: 60 s es un
 * número elegido acá, no un dato del proveedor.
 *
 * El límite real lo impone Privy, en el servidor, y no se conoce desde el
 * cliente. Cuando se pida antes de tiempo, la respuesta vuelve con el código de
 * error de reenvío y eso se traduce a un mensaje accionable ("esperá un
 * momento"), nunca a un error (Hoja 4, 3.3).
 *
 * Cuando el límite real esté conocido y configurado, esta constante tiene que
 * seguirlo. Mientras tanto es un freno, no una regla.
 */
export const CODE_RESEND_AVAILABLE_IN_SECONDS = 60;

/**
 * Lee el código de error de Privy de cualquier error.
 *
 * El SDK lo cuelga en `privyErrorCode` (clase `PrivyError`); los errores de la
 * API nativa del navegador no lo traen. Por eso devuelve `null` en vez de
 * adivinar: un error sin código es un error que la pantalla trata como genérico.
 *
 * @param error Lo que tiró un hook de Privy.
 * @returns El código, o `null` si no es un error con código.
 */
export const readPrivyErrorCode = (error: unknown): string | null => {
  const code = (error as { privyErrorCode?: unknown } | null)?.privyErrorCode;
  return typeof code === 'string' ? code : null;
};

/** El correo ya pertenece a otra cuenta (Hoja 4, 3.5). */
export const PRIVY_ERROR_EMAIL_TAKEN = 'linked_to_another_user';

/** Se pidió un código demasiado rápido: el límite de reenvío de Privy. */
export const PRIVY_ERROR_TOO_MANY_REQUESTS = 'too_many_requests';

/**
 * El código se recibió pero no corresponde a ninguna cuenta.
 *
 * **Este NO es un código que no llegó.** Es un código que llegó y no sirvió, y
 * la diferencia importa: mandar a alguien a revisar su correo cuando el código
 * ya está ahí lo hace dudar de algo que sí funcionó.
 */
export const PRIVY_ERROR_USER_DOES_NOT_EXIST = 'user_does_not_exist';

/**
 * La app de Privy tiene el método deshabilitado (Hoja 4, 0.1 y este caso:
 * passkey apagado en el panel).
 *
 * No es un error de la persona: el dedo funcionó y a la app no le dejaba. Por eso
 * se registra aparte en vez de caer en el mensaje genérico de passkey, que
 * diría "no pudimos crear tu huella" sobre algo que nunca se intentó.
 */
export const PRIVY_ERROR_PASSKEY_NOT_ALLOWED = 'passkey_not_allowed';

/** Un método de ingreso está deshabilitado en la app. */
export const PRIVY_ERROR_DISALLOWED_LOGIN_METHOD = 'disallowed_login_method';

/* Códigos de `POST /api/diagnostics` que puede aceptar el Worker. */
const DIAGNOSTIC_CODE_UNAUTHORIZED = 'unauthorized';
const DIAGNOSTIC_CODE_NETWORK_ERROR = 'network_error';
const DIAGNOSTIC_CODE_UNKNOWN_ERROR = 'unknown_error';

/** El token de Privy no llegó o no era válido: en el log es `unauthorized`. */
const SESSION_DIAGNOSTIC_UNAUTHORIZED = 'must_be_authenticated';
const SESSION_DIAGNOSTIC_NETWORK = 'NETWORK_UNAVAILABLE';
const SESSION_DIAGNOSTIC_IDENTITY_UNAVAILABLE = 'IDENTITY_UNAVAILABLE';
/**
 * Traduce cualquier código (de Privy o de nuestro backend) al **vocabulario
 * cerrado** que `POST /api/diagnostics` acepta.
 *
 * El Worker tiene una lista corta de códigos permitidos y loguea cualquier otro
 * como `rejected`. Mandar `IDENTITY_UNAVAILABLE` crudo se puede: el log lo
 * muestra igual. Pero el punto de esta ruta es **leer el log de una prueba hecha
 * desde el celu**, y un `unknown_error` al lado de una etapa (`login_intercambio_sesion`)
 * dice mucho más que un código rechazado que hay que ir a buscar.
 *
 * Nunca inventa un código que no sea: lo desconocido es `unknown_error`.
 */
export const toDiagnosticCode = (code: string | null | undefined): string => {
  switch (code) {
    case SESSION_DIAGNOSTIC_UNAUTHORIZED:
      return DIAGNOSTIC_CODE_UNAUTHORIZED;
    case SESSION_DIAGNOSTIC_NETWORK:
      return DIAGNOSTIC_CODE_NETWORK_ERROR;
    case SESSION_DIAGNOSTIC_IDENTITY_UNAVAILABLE:
      // El backend no pudo leer la identidad: es el fallo más importante de esta
      // etapa, así que viaja como código conocido y no diluido en "desconocido".
      return DIAGNOSTIC_CODE_UNKNOWN_ERROR;
    case null:
    case undefined:
      return DIAGNOSTIC_CODE_UNKNOWN_ERROR;
    default:
      return code;
  }
};

/** Le cuenta al backend qué código de Privy nos rechazó.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * El rechazo de `sendCode()` ocurre **en el navegador**, dentro del SDK de
 * Privy, y no pasa por nuestro backend. Por eso el log del Worker no lo ve, y la
 * prueba se está haciendo desde un celular donde no hay consola.
 *
 * Es una herramienta de integración, no parte del producto: no bloquea el flujo,
 * nunca muestra nada, y si el backend no está la llamada falla sola y sin
 * consecuencia.
 *
 * **El código viaja crudo y el backend lo valida.** La ruta acepta una lista
 * cerrada de códigos, así que mandar cualquier otra cosa no escribe nada
 * inyectable en el log.
 */
export const reportPrivyError = async (
  etapa: string,
  codigo: string | null,
  baseUrl = '',
): Promise<void> => {
  try {
    await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ etapa, codigo: codigo ?? 'sin_codigo' }),
      keepalive: true,
    });
  } catch {
    // Es una diagnóstico. Si no se puede reportar, no pasa nada.
  }
};

/* ── El reporter con detalle ─────────────────────────────────────────────────
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * `reportPrivyError` manda un `codigo`, y el allowlist del Worker obliga a que
 * todo lo desconocido viaje como `unknown_error`. El log de producción terminó
 * diciendo `{"etapa":"wallets_reclamar","codigo":"unknown_error"}` sin ningún
 * `POST /api/wallets/claim`: cinco lecturas posibles, ninguna distinguible.
 *
 * `detalle` es el campo opcional que acepta `POST /api/diagnostics` para eso.
 *
 * ── Qué entra y qué NO entra ──────────────────────────────────────────────────
 *
 * Entra **sólo** lo que el front compone pieza por pieza: el código real, el
 * status HTTP cuando la respuesta existe, el nombre del error y una nota corta
 * de la etapa. El `message` del error **no** entra nunca: es texto libre de un
 * SDK y es exactamente donde un correo o un token terminarían filtrados.
 *
 * Se compone de una lista cerrada de piezas leídas por nombre, no del objeto del
 * error entero, así que la exclusión de correos y tokens es estructural y no una
 *regexp que hay que confiar. Aparte, el backend lo vuelve a sanear igual.
 */

/** El mismo tope que aplica el backend: 200 caracteres es una línea de log. */
export const MAX_DIAGNOSTIC_DETAIL_LENGTH = 200;

/** Lleva cualquier valor a `[a-z0-9_]`, que es lo único que el Worker conserva. */
const detailToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_]+/g, '_');

/** El código real: el de Privy si lo hay, y si no el propio del `ApiError`. */
const readRealErrorCode = (error: unknown): string | null =>
  readPrivyErrorCode(error) ??
  (typeof (error as { code?: unknown } | null)?.code === 'string'
    ? (error as { code: string }).code
    : null);

/**
 * El status HTTP, si el error lo trae. `ApiError` no lo guarda hoy, pero muchos
 * errores de red y de SDK sí, y no cuesta mirarlo.
 */
const readErrorStatus = (error: unknown): string | null => {
  const source = error as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof source?.status === 'number' ? source.status : source?.statusCode;
  return typeof status === 'number' ? String(status) : null;
};

/** `TypeError`, `ApiError`, `PrivyError`: sirve para distinguir familias. */
const readErrorName = (error: unknown): string | null => {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
};

/**
 * Arma el `detalle`: piezas conocidas, unidas por `_`, cortadas en 200.
 *
 * @param note Etapa o causa corta de este reporte (`walletidmissing_solana`).
 * @returns `code_..._status_..._name_...`, o `code_unknown` si no hay nada.
 */
export const buildPrivyErrorDetail = (error: unknown, note?: string): string => {
  const parts: string[] = [];

  if (note) parts.push(detailToken(note));

  const code = readRealErrorCode(error);
  if (code) parts.push(`code_${detailToken(code)}`);

  const status = readErrorStatus(error);
  if (status) parts.push(`status_${detailToken(status)}`);

  const name = readErrorName(error);
  if (name && (code || status)) parts.push(`name_${detailToken(name)}`);

  if (parts.length === 0) return 'code_unknown';

  return parts.join('_').slice(0, MAX_DIAGNOSTIC_DETAIL_LENGTH);
};

/**
 * Le cuenta al backend qué código de Privy nos rechazó, **y por qué exactamente**.
 *
 * Mismo criterio que `reportPrivyError` —nunca bloquea, nunca muestra nada— pero
 * con `detalle`, que es lo que hoy falta para leer un fallo real del navegador.
 *
 * @param etapa Dónde se cortó.
 * @param error Lo que tiró el hook, o `null` si no hubo excepción.
 * @param note Causa corta de la etapa, sin datos de nadie.
 * @param baseUrl Base del backend.
 */
export const reportPrivyErrorWithDetail = async (
  etapa: string,
  error: unknown,
  note?: string,
  baseUrl = '',
): Promise<void> => {
  try {
    await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        etapa,
        codigo: toDiagnosticCode(readPrivyErrorCode(error)),
        detalle: buildPrivyErrorDetail(error, note),
      }),
      keepalive: true,
    });
  } catch {
    // Es un diagnóstico. Si no se puede reportar, no pasa nada.
  }
};
