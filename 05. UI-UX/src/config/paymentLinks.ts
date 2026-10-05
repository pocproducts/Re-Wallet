/**
 * EL LINK DE COBRO: la ruta que la app tiene que entender al arrancar.
 *
 * ── Por qué esta archivo es infraestructura nueva ───────────────────────────
 *
 * Porque hasta ahora la app **no leía su propia URL**: no había un solo `location`
 * ni un `URLSearchParams` en `src/`. La navegación era estado de React —pestañas
 * y banderas de "tercer nivel" en `App.tsx`— y una ruta desconocida no significaba
 * nada. Con un link de cobro, una ruta desconocida **significa algo**: si alguien
 * abre `/cobrar/abc…` y la app arranca igual en la billetera, el cobro se perdió
 * en silencio y no hay ningún error visible que lo diga.
 *
 * El Worker sirve la SPA con `not_found_handling: "single-page-application"`, así
 * que cualquier ruta desconocida devuelve la app y **no** un 404: el servidor no
 * puede ayudar a distinguirla. Reconocer el link es del cliente, y por eso vive
 * acá.
 *
 * ── Por qué una sola función pura y ninguna librería de ruteo ────────────────
 *
 * Porque la navegación que ya existe **sí puede expresar esto**: es un estado más.
 * Un router se justifica cuando hay URLs de ida y vuelta, historial, anidamiento
 * y transiciones entre rutas; acá hay una pregunta única —"¿la ruta con la que
 * arrancó es un cobro?"— que se responde una vez y después la persona navega
 * normal. Meter un router para eso sería cambiar cómo se mueve toda la app por
 * una función de una línea.
 *
 * Y `paymentRequestIdFromPath` es ** pura**: recibe un `string` y devuelve un id o
 * `null`. No toca `window`, no lee `location`, no usa `URLSearchParams` y no
 * lanza. La lectura del navegador vive entera en `hooks/useIncomingPaymentRequest.ts`,
 * que es el único lugar del proyecto que se entera de dónde vino la persona.
 *
 * ── Por qué `/cobrar/` y no `/api/payment-requests/` ────────────────────────
 *
 * Porque el prefijo `/api` es del backend, y una ruta de la SPA debajo de él
 * sería ambigua: hoy es la API, y el día que deje de serlo habría que mover todos
 * los links ya compartidos. `/cobrar` es de la persona, no del servidor, y se lee
 * en el mensaje de un chat.
 *
 * ── Por qué el id se valida acá, y no sólo en el backend ────────────────────
 *
 * Porque una ruta es texto que llega de afuera, y una app que abre una pantalla
 * con lo que le puso cualquiera en la barra de direcciones es una app que va a
 * abrir pantallas raras. El patrón es **la misma expresión** que
 * `payment_requests_id_format` acepta en el servidor, y el backend vuelve a
 * validarlo: si un link viniera de una versión vieja con otro formato, la respuesta
 * es `REQUEST_NOT_FOUND` y no una pantalla rota.
 */
import { API_BASE_URL } from '../services/api';

/** El prefijo del link de cobro. Es de la app, no del backend. */
export const PAYMENT_REQUEST_PATH = '/cobrar';

/**
 * El mismo patrón que `payment_requests_id_format` acepta en la base.
 *
 * `[A-Za-z0-9_-]{10,32}`, que es donde viven los 32 caracteres de base64url que
 * genera el servidor. Se copia acá para que el cliente pueda decir "esto no es un
 * link de cobro" sin ir a la red, y para que el link siga siendo el mismo en los
 * dos lados.
 */
export const PAYMENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{10,32}$/;

/** La ruta de un cobro: la que va dentro del link que se comparte. */
export const paymentRequestPath = (id: string): string => `${PAYMENT_REQUEST_PATH}/${id}`;

/**
 * El link completo y compartible.
 *
 * El origen sale del navegador —`location.origin`— y no de una constante escrita a
 * mano: la app se sirve en un dominio propio en producción y en `localhost` en
 * desarrollo, y un link con el origen equivocado es un link que no abre la app.
 */
export const paymentRequestShareUrl = (id: string, origin: string): string =>
  `${origin.replace(/\/+$/, '')}${paymentRequestPath(id)}`;

/**
 * El id de cobro de una ruta, o `null`.
 *
 * Acepta sólo la forma exacta —`/cobrar/<id>`—, con o sin barra final. Cualquier
 * otra cosa devuelve `null`, que la app lee como "no hay link": es preferible
 * abrir la billetera de siempre que abrir una pantalla de cobro con un id que
 * nadie pidió.
 *
 * La comparación es sobre el `pathname`, no sobre la URL entera, así que un
 * `?utm=…` agregado por un servicio para compartir no rompe el link ni se cuela
 * dentro del id.
 */
export const paymentRequestIdFromPath = (pathname: string): string | null => {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;

  // Una barra al final es la misma ruta: `/cobrar/abc/` es lo que algunos
  // navegadores y algunos chat escriben.
  const trimmed = pathname.replace(/\/+$/, '');
  const segments = trimmed.split('/');

  // `['', 'cobrar', id]`: exactamente tres, sin más.
  if (segments.length !== 3) return null;
  if (segments[0] !== '' || segments[1] !== PAYMENT_REQUEST_PATH.slice(1)) return null;

  const id = segments[2] ?? '';
  return PAYMENT_REQUEST_ID_PATTERN.test(id) ? id : null;
};

/**
 * El mismo origen donde está la API, para el caso de que la app se sirva desde
 * un origen distinto al de la API durante el desarrollo.
 *
 * No se usa para armar el link: el link es del **navegador** y lo arma quien lo
 * comparte. Acá sólo sirve para dejar escrito en un lugar por qué el frontend y el
 * backend comparten origen, que es lo que hace posible la cookie de sesión.
 */
export const isSingleOrigin = (): boolean => API_BASE_URL === '';
