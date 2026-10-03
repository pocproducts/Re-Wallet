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
/**
 * Le cuenta al backend qué código de Privy nos rechazó.
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
