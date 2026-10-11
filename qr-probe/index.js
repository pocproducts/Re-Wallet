/**
 * El Worker de diagnóstico, mínimo a propósito.
 *
 * Lo que importa en este Worker es lo que **sirve**, no lo que responde: la
 * página de `qr-probe/index.html` es el instrumento, y se publica como asset
 * estático. Este módulo existe porque Wrangler pide un `main`, y porque un
 * Worker que responde `text/plain` es fácil de distinguir de uno que sirve la
 * app real cuando se mira un dominio sin saber qué tiene arriba.
 */
export default {
  async fetch() {
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  },
};
