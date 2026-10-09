/**
 * El Worker sirve los estáticos y nada más.
 *
 * Existe solo porque `wrangler` pide un punto de entrada. **No hay lógica de
 * negocio acá**, y a propósito: la API la sirve `06. Backend/`, que corre en otro
 * lugar. Si algún día estaWorker empieza a responder requests de API, es el
 * momento de问我 de qué arquitectura estamos hablando.
 */
export default {
  fetch() {
    return new Response('La API no vive acá. Ver 06. Backend/.', { status: 404 });
  },
};
