import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    /**
     * `@privy-io/react-auth` is a React library and we are not migrating to
     * React. Preact's compat layer is a drop-in for the React 18 surface the
     * SDK targets, so aliasing the module specifiers is enough to run the whole
     * Privy tree on Preact without touching a single line of the vanilla UI.
     *
     * ORDER IS LOAD-BEARING: an alias key also matches everything below it with
     * a `/`, so `react/jsx-runtime` must be declared before `react`. With the
     * opposite order the JSX runtime would resolve to `preact/compat/jsx-runtime`
     * instead of `preact/jsx-runtime`.
     *
     * These three entries must stay identical to the `paths` block in
     * tsconfig.json. Runtime and typecheck disagreeing here is the classic way
     * to ship a build that typechecks and then fails in the browser.
     */
    alias: {
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  server: {
    /**
     * `localhost`, NOT `127.0.0.1`, AND THE DIFFERENCE IS THE LOGIN.
     *
     * Privy validates the browser's ORIGIN against its allowlist and rejects a
     * literal IP: opening the app at `http://127.0.0.1:5173` fails the passkey
     * ceremony with `SecurityError: 127.0.0.1 is an invalid domain`, thrown
     * before WebAuthn is ever reached. The same code on `http://localhost:5173`
     * gets as far as the fingerprint prompt.
     *
     * This is also why the open command and every doc that mentions a URL has to
     * say `localhost`. The two resolve to the same socket; only the string the
     * browser puts in `window.location.origin` differs, and that string is what
     * Privy reads.
     */
    host: 'localhost',
    port: 5173,
    /**
     * SAME-ORIGIN, AND THAT IS NOT A CONVENIENCE.
     *
     * The session is an httpOnly cookie. A cross-origin call from :5173 to :3000
     * would need `SameSite=None; Secure` plus CORS with credentials, and neither
     * works on plain http://localhost — the exact place a developer and a demo
     * run. Proxying keeps the browser on one origin, so `SameSite=Lax` is enough
     * and the cookie is attached without the JS ever seeing it.
     *
     * The prefix is `/api` and it REWRITES to the API root (`/api/wallet` →
     * `/wallet`) rather than proxying a list of paths. The API answers at the
     * root, and the master prompt adds ~24 endpoints: a list would rot silently
     * the day a route is added and someone wonders why it 404s in dev only.
     *
     * In production both live behind one reverse proxy, so the same `/api`
     * prefix keeps working with no rebuild. `VITE_API_BASE_URL` overrides it for
     * a genuinely split deployment.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['scripts/**/*.test.ts'],
  },
});
