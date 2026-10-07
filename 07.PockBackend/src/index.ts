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

export default {
  fetch: (request: Request, env: Record<string, unknown> | undefined): Response | Promise<Response> => {
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