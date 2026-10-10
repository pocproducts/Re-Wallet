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
 * Todo lo que se prueba en `test/` son normalizadores y aritmética `bigint`: no
 * renderizan, no tocan `document` y no leen la red. Un entorno de navegador
 * sólo agregaría una superficie de mocking que escondería acoplamiento real.
 * El render se prueba en su propio proyecto, con jsdom.
 *
 * ── Por qué dos proyectos y no un `environment` solo ────────────────────────
 *
 * Porque los dos grupos necesitan cosas opuestas: `test/` es aritmética pura y
 * los tests que viven al lado del código, en `__tests__`, montan hooks de React
 * con `renderHook`. Poner `jsdom` global obligaría a los 165 tests de servicio
 * a arrancar un DOM que no tocan, y poner `node` global dejaría al primer test
 * de hook sin renderizador posible.
 *
 * El ambiente va por proyecto y no por archivo porque es una propiedad del tipo
 * de prueba: la que renderiza necesita DOM, la que no, no.
 *
 * ── Por qué `include` es explícito en cada proyecto ─────────────────────────
 *
 * Para que un archivo nuevo no entre por accidente: `npm test` corre lo que está
 * en `test/` y lo que está junto al código que prueba, y nada más.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'servicios',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'hooks',
          include: ['src/**/__tests__/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
  },
});