/**
 * El transporte contra el backend de ReWALLET.
 *
 * ── Un solo origen (contrato HTTP, regla 1.7) ─────────────────────────────────
 *
 * La base sale de **una** variable de entorno y de **un** lugar. Ninguna función
 * de este proyecto arma una URL a mano ni le pone headers a un endpoint
 * distinto: CORS, cookies y prefijo los define el servidor.
 *
 * ── El front es dueño del texto; el back es dueño del código (regla 1.4) ─────
 *
 * Un error viene como `{ error: { code, traceId } }`, **sin prosa**. Por eso lo
 * que sale de acá es un `ApiError` con el **código**, y la frase la pone quien
 * lo muestra: nadie tiene que traducir `UNAUTHENTICATED` acá, y nadie puede
 * recibir una frase del servidor sin querer.
 */

/** Base del backend. Sin barra al final, siempre. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * La URL final de una llamada, con el prefijo `/api` **una sola vez**.
 *
 * ── El bug que esta función existe para que no vuelva ───────────────────────
 *
 * La base y la ruta pueden traer las dos el prefijo: en un despliegue de un solo
 * origen la base vale `/api`, y `policy.ts` y `swap.ts` escriben rutas que ya lo
 * incluyen porque así las lee el contrato del backend. El resultado era
 * `POST /api/api/wallet/policy/evaluate` — un 404 que la pantalla mostraba como
 * "no pudimos revisar la política de seguridad" y que dejaba cualquier envío sin
 * poder firmarse, en cualquier red.
 *
 * ── Por qué se colapsa acá y no en cada llamador ────────────────────────────
 *
 * Porque este es el único lugar del front que arma una URL. Veinte servicios
 * pasan rutas sin el prefijo y dos lo pasan: la regla va donde se junta, no
 * repartida en veintidós lugares donde la próxima ruta rota vuelve a fallar en
 * silencio.
 *
 * No toca una ruta que no esté duplicada: con base vacía y ruta `/api/…` queda
 * igual, y con base `/api` y ruta `/wallet/…` también.
 */
export const apiUrlWith = (base: string, path: string): string =>
  `${base}${path}`.replace(/\/api\/api(?=\/|$)/, '/api');

/**
 * Error del backend con su **código**, nunca con su texto.
 *
 * Se crea con `new ApiError(code)`, y el mensaje de la clase es técnico a
 * propósito: va a la consola, nunca a la pantalla.
 */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`API error: ${code}`);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** Lee el código de un body de error. `null` cuando no es un body de error. */
const readErrorCode = (body: unknown): string | null => {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : null;
};

/**
 * `POST` con JSON y **cookie**.
 *
 * `credentials: 'include'` no es un detalle: la sesión de ReWALLET es una cookie
 * httpOnly y sin esto el navegador no la manda nunca. Va en todas, sin
 * excepción, porque después de `POST /auth/session` TODAS las llamadas la
 * necesitan.
 */
/**
 * El núcleo del transporte: **una** forma de hablar con el backend.
 *
 * Antes esto vivía entero dentro de `postJson`. Se abrió porque la puerta de
 * ingreso ya no es solo un `POST`: para decidir si la sesión sigue viva hay que
 * hacer un `GET` (que devuelve `{ authenticated }`) y para cerrar la sesión hay
 * que hacer un `DELETE` (que devuelve `204` y cuerpo vacío). Tres verbos, una
 * sola regla de parseo y una sola regla de error.
 */
const request = async (path: string, init: RequestInit): Promise<unknown> => {
  let response: Response;

  const url = apiUrlWith(API_BASE_URL, path);

  try {
    response = await fetch(url, init);
  } catch {
    // La red no llegó. No hay código del servidor, así que el error es de este
    // lado y el que lo muestra decide qué mensaje pone.
    throw new ApiError('NETWORK_UNAVAILABLE');
  }

  /*
   * Un `204` viene **sin cuerpo**, y `response.json()` sobre eso tira. Por eso
   * se lee texto primero: cuerpo vacío es `null`, no un error de sintaxis.
   */
  const raw = await response.text();
  let parsed: unknown = null;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(readErrorCode(parsed) ?? `HTTP_${response.status}`);
  }

  return parsed;
};

/**
 * `POST` con JSON y **cookie**. Ver `request` para el `credentials: 'include'`.
 */
const postJson = async <T>(path: string, body: unknown): Promise<T> =>
  (await request(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })) as T;

/** `GET` con cookie. El cuerpo puede ser `null` si el server respondió `204`. */
const getJson = async <T>(path: string): Promise<T> =>
  (await request(path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })) as T;

/** `DELETE` con cookie. Se usa para cerrar la sesión. */
const deleteJson = async (path: string): Promise<void> => {
  await request(path, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
};

/** El body de error que devuelve el backend, para cuando haga falta tiparlo. */
export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly traceId?: string };
}

export { postJson, getJson, deleteJson };