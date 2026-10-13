/**
 * LA ENTRADA DEL WORKER: HTTPS Y QUIÉN SIRVE LA APP.
 *
 * ── Las dos fallas que estas pruebas existen para que no vuelvan ────────────
 *
 * 1. `http://beta.rewallet.win` servía la app con 200, sin redirect. Un móvil
 *    que abría el dominio sin la `s` llegaba a la app por un origen inseguro,
 *    y Privy —con razón— reventaba: "Embedded wallet is only available over
 *    https". La pantalla quedaba negra con un "script error" opaco. La zona de
 *    Cloudflare no podía resolverlo esta vez: el permiso de escritura en la
 *    zona vive en el panel de la cuenta, no en este repo; el redirect es y
 *    debe ser parte del código, porque si no, nadie recuerda que hace falta.
 *
 * 2. `not_found_handling: "single-page-application"` con un Worker al frente
 *    pero sin binding: los deep links de la SPA (`/cobrar/<id>`) devolvían el
 *    404 de texto plano de Hono. Quien abría un link de cobro no podía pagar.
 *
 * Ambas se prueban contra el entry point, porque es ahí donde vive la regla y
 * ningún test de ruta la puede ver.
 */
import { describe, expect, it } from 'vitest';

import worker from '../../src/index';

describe('la entrada del Worker', () => {
  it('manda http a https antes de cualquier otra cosa', async () => {
    const response = await worker.fetch(new Request('http://beta.rewallet.win/cobrar/abc?r=1'), {
      // Sin binding, a propósito: la guarda corre antes que todo el resto.
      ASSETS: undefined,
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://beta.rewallet.win/cobrar/abc?r=1');
  });

  it('lo que no es /api lo sirve el binding, y no el router de la API', async () => {
    const recibidas: string[] = [];
    const response = await worker.fetch(new Request('https://beta.rewallet.win/cobrar/pago-de-prueba'), {
      ASSETS: {
        fetch: (request: Request) => {
          recibidas.push(request.url);
          return new Response('index.html', { status: 200 });
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('index.html');
    expect(recibidas).toEqual(['https://beta.rewallet.win/cobrar/pago-de-prueba']);
  });
});
