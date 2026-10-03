/**
 * `POST /me/lookup` — ¿esta persona ya tiene cuenta?
 *
 * ── Por qué esta función existe y por qué no decide más que eso ───────────────
 *
 * Antes la contestaba una lista de correos escrita a mano en el navegador. Ahora
 * la contesta **el backend**, que es el único que sabe. El front pregunta y usa
 * la respuesta para decidir **a dónde llevar a la persona**.
 *
 * ── LA REGLA DE ORO DE ESTA PANTALLA ──────────────────────────────────────────
 *
 * El backend contesta `start_signup`, y eso **jamás se muestra como "ese correo
 * no está registrado"**. Decírselo convierte la puerta de ingreso en un oráculo
 * de qué correos están dados de alta, que es información de otra persona. Quien
 * llama a esta función lleva a "Comenzar" con el correo ya escrito y no dice
 * absolutamente nada. Ese silencio es el contrato, no una cortesía.
 *
 * ── Lo que NO hace esta función ───────────────────────────────────────────────
 *
 * No adivina. Si la respuesta del backend no es una de las dos acciones
 * conocidas, es un error: inventar una tercera a partir de un body raro sería
 * exactamente "ser más listo que él", y esa es la forma de crear una pantalla
 * que dice cosas que el servidor no dijo.
 */
import { postJson, ApiError } from './api';

/** Lo que el backend manda. Es una **indicación**, no un dato consultable. */
export type MeAction = 'verify_email' | 'start_signup';

interface LookupResponse {
  readonly action: string;
}

const isMeAction = (value: string): value is MeAction =>
  value === 'verify_email' || value === 'start_signup';

/**
 * Le pregunta al backend qué hacer con este correo.
 *
 * @param email Correo tal como lo escribió la persona.
 * @returns `verify_email` si hay que mandarle un código, `start_signup` si hay
 *          que llevarla a crear la cuenta.
 * @throws `ApiError` si la red falla o si la respuesta no es una acción conocida.
 */
export const lookupAccountAction = async (email: string): Promise<MeAction> => {
  const response = await postJson<LookupResponse>('/me/lookup', { email: email.trim() });

  if (!isMeAction(response?.action)) {
    throw new ApiError('UNEXPECTED_LOOKUP_RESPONSE');
  }

  return response.action;
};