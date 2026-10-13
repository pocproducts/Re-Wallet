/**
 * THE WORKER ENTRY POINT.
 *
 * A Cloudflare Worker has no port: it exposes a `fetch` and nothing else.
 *
 * ── Why `/api` is NOT stripped here ───────────────────────────────────────────
 *
 * `06. Backend` mounts the API at `/auth/session` and strips the `/api` prefix in
 * a middleware before the app sees the request. That indirection bought something
 * there: the API also served routes the SPA did not own.
 *
 * Here the routes **are** `/api/...`. One less transformation means one less
 * place where the same login can come back circular, and a route that reads its
 * own cookie cannot be made unauthenticated by a routing mistake. The
 * `not_found_handling: "single-page-application"` asset rule is what serves
 * everything that is not `/api`.
 *
 * ── Why the app is built lazily and cached ────────────────────────────────────
 *
 * Built once and reused: a new `PrivyClient` per request would drop its JWKS cache
 * and every login would pay a round trip to Privy.
 *
 * Built **inside** the function, not at module load, so importing this file in a
 * test without credentials does not explode at import time — and a configuration
 * error surfaces on the first request with a real message instead of a stack from
 * the top of a module graph.
 */
import { consoleLogger } from './domain/ports/logger';
import { buildApp, readConfig } from './container';
import type { Config } from './container';

type App = ReturnType<typeof buildApp>;

let cached: App | { readonly error: unknown } | null = null;

/**
 * `env` is Cloudflare's bindings object. Secrets set with `wrangler secret put`
 * land there, not in `process.env`, so it is merged over the latter rather than
 * replacing it.
 */
const app = (env: Record<string, unknown> | undefined): App => {
  if (cached === null || 'error' in cached) {
    try {
      cached = buildApp(readConfig({ ...(process.env as Record<string, unknown>), ...(env ?? {}) }), consoleLogger);
    } catch (error) {
      cached = { error };
    }
  }

  if ('error' in cached) throw cached.error;
  return cached;
};

/** Exposed for tests and local tooling that need to reset the cached app. */
export const resetApp = (): void => {
  cached = null;
};

/**
 * El binding de assets, tipeado a mano: el proyecto no incluye los tipos de
 * Workers (`types: ["node"]`) y no los necesita para esto; sólo la forma del
 * fetcher, no la firma completa.
 */
type AssetsFetcher = {
  readonly fetch: (request: Request) => Response | Promise<Response>;
};

/**
 * El acceso al binding, explícito.
 *
 * El binding existe sólo en entornos desplegados (dev y producción): en los
 * tests no hay `env` con assets y esta rama sin binding cae por debajo, así que
 * ninguna suite necesita que esté presente.
 */
const assetsOf = (env: Record<string, unknown> | undefined): AssetsFetcher | null => {
  const candidate = env?.ASSETS;
  return candidate !== null && typeof candidate === 'object' ? (candidate as AssetsFetcher) : null;
};

export default {
  fetch: (request: Request, env: Record<string, unknown> | undefined): Response | Promise<Response> => {
    /*
     * HTTPS se impone acá, no en la zona.
     *
     * El caso que lo demostró: `http://beta.rewallet.win` respondía 200 con la
     * app, y Privy —con razón— se niega a crear una wallet embebida sobre un
     * origen inseguro ("Embedded wallet is only available over https"). Con el
     * CDN de assets primero, hasta la raíz en http pasaba sin pisar este fetch;
     * con `run_worker_first` pasa todo, y la guarda es una línea.
     */
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 301);
    }

    /*
     * Lo que no es la API es la app, y la app la sirve el binding.
     *
     * Delegar acá —y no construir la app completa para responder HTML— es lo
     * que vuelve real el fallback de la SPA ya declarado en la config
     * (`not_found_handling` sólo se aplica cuando es el binding quien
     * responde), y deja `buildApp` para las rutas que de verdad lo necesitan:
     * hoy, sólo `/api`.
     */
    if (!url.pathname.startsWith('/api')) {
      const assets = assetsOf(env);
      if (assets !== null) return assets.fetch(request);
      // Sin binding no hay app estática servible: no disimulamos una pantalla
      // que no existe, el error de abajo es la respuesta honesta.
    }

    try {
      return app(env).fetch(request, env as never);
    } catch (error) {
      // A configuration failure must answer, not hang. It is a 500 because there
      // is genuinely nothing else this Worker can do.
      consoleLogger.error('worker bootstrap failed', error);
      return new Response(JSON.stringify({ error: { code: 'INTERNAL' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};

export type { Config };