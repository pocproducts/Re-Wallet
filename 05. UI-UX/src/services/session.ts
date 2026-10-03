/**
 * La sesión de ReWALLET: se abre, se consulta y se cierra.
 *
 * ── El contrato cambió: la respuesta del `POST` ya no trae nada ──────────────
 *
 * Antes `POST /auth/session` contestaba `{ userId, expiresAt }` y esta función
 * devolvía eso. **Hoy contesta `204` con el cuerpo vacío** y pone la sesión en
 * la cookie httpOnly `__Host-`. Por eso acá no se parsea nada: leer un cuerpo
 * que no existe no devuelve un dato viejo, devuelve `null` y hace creer que la
 * sesión se abrió cuando capaz nunca se abrió.
 *
 * ── Por qué el front no guarda ningún token ──────────────────────────────────
 *
 * Lo que se guarda en el navegador no es la sesión: es la sesión la que viaja
 * sola en cada request, en la cookie httpOnly. Un `localStorage` con un token
 * sería además un token accesible desde JavaScript, que es exactamente lo que
 * `httpOnly` existe para evitar.
 *
 * ── El `credentials: 'include'` es obligatorio ─────────────────────────────────
 *
 * Sin él el navegador nunca manda la cookie, la sesión muere en el mismo POST
 * que la creó, y el síntoma es "entro y al siguiente request me echan". Está en
 * `services/api.ts`, en todas las llamadas, no solamente en esta.
 */
import { postJson, getJson, deleteJson, ApiError } from './api';

/**
 * El servidor no pudo leer un correo real de la identidad de Privy.
 *
 * Es el único error de esta ruta que **no se arregla reintentando**: el backend
 * es el que no encontró el dato. Decirle a la persona "no pudimos leer tu
 * cuenta, no se creó nada" es la verdad; cualquier otra frase promete algo que
 * no se puede saber.
 */
export const SESSION_ERROR_IDENTITY_UNAVAILABLE = 'IDENTITY_UNAVAILABLE';

export interface OpenSessionInput {
  /** Access token de Privy, el que devuelve `usePrivy().getAccessToken()`. */
  readonly accessToken: string;
  /**
   * Los tres campos de abajo **no los necesita el backend para una cuenta que
   * ya existe** (los ignora) y el backend los saca del token, no del body.
   *
   * Quedan opcionales y se mandan solo si vienen, para que la puerta nueva —que
   * nunca pregunta nombre ni teléfono— no invente datos que nadie escribió.
   */
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string | null;
}

/**
 * Abre la sesión de ReWALLET con el token de Privy.
 *
 * No devuelve nada: la respuesta es un `204` sin cuerpo. Que no devuelva nada
 * **es** la confirmación de que el servidor aceptó el token, porque si lo
 * hubiera rechazado esta función habría tirado `ApiError`.
 *
 * @throws `ApiError` con el código del backend (`HTTP_400`, `HTTP_401`,
 *         `IDENTITY_UNAVAILABLE`, `NETWORK_UNAVAILABLE`).
 */
export const openRewalletSession = async (input: OpenSessionInput): Promise<void> => {
  const body: Record<string, unknown> = { accessToken: input.accessToken };

  if (input.name !== undefined) body.name = input.name;
  if (input.email !== undefined) body.email = input.email;
  if (input.phone !== undefined) body.phone = input.phone;

  await postJson<null>('/auth/session', body);
};

interface SessionStateResponse {
  readonly authenticated: boolean;
}

/**
 * ¿La cookie de sesión sigue sirviendo?
 *
 * Un `401` **no es un error de esta consulta**: es la respuesta esperada de
 * alguien que todavía no entró, y por eso devuelve `false` en vez de tirar.
 * Cualquier otra falla (red caída, `5xx`) también es `false`, porque desde el
 * navegador no hay forma honesta de distinguir "no tenés sesión" de "no pude
 * preguntar".
 */
export const isRewalletSessionActive = async (): Promise<boolean> => {
  try {
    const response = await getJson<SessionStateResponse>('/auth/session');
    return response?.authenticated === true;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'HTTP_401') return false;
    return false;
  }
};

/**
 * Cierra la sesión de ReWALLET y borra la cookie.
 *
 * No tira si falla: cerrar sesión tiene que funcionar **aunque** el backend no
 * responda, porque si tira, la persona queda con una cookie viva que no puede
 * cerrar desde la pantalla.
 */
export const closeRewalletSession = async (): Promise<void> => {
  try {
    await deleteJson('/auth/session');
  } catch {
    // La sesión de Privy se cierra igual: es la que manda sobre la app.
  }
};