import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Los tests del front. Sin DOM, sin red, sin reloj.
 *
 * ── Por qué su propio archivo y no el de `vite` ─────────────────────────────
 *
 * `vite.config.ts` es la cadena de **build**: plugins de React y Tailwind, alias
 * `@`, HMR. Este es otro: aca se corre lógica pura, que no necesita React ni
 * estilos. Mezclarlos significaría que un cambio de estilo de la app pueda
 * romper la corrida de los tests —y al revés—, que es la forma más lenta de
 * descubrir un problema.
 *
 * ── Por qué `environment: 'node'` ───────────────────────────────────────────
 *
 * Todo lo que se prueba acá son normalizadores y aritmética `bigint`: no
 * renderizan, no tocan `document` y no leen la red. Un entorno de navegador
 * sólo agregaría una superficie de mocking que escondería acoplamiento real.
 * El render se prueba en su propia tanda, con jsdom.
 *
 * ── Por qué `include` es explícito ──────────────────────────────────────────
 *
 * Para que un archivo nuevo no entre por accidente: `npm test` corre lo que está
 * en `test/`, y nada más.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});