import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    /*
     * Los assets de la bienvenida viven en `src/public/` a propósito
     * (imágenes de onboarding y el favicon), no en el `public/` por defecto.
     * Este `publicDir` los publica en la raíz del deploy, sin mover los
     * archivos de dónde el equipo los bajó: `/onbarding1.jpg`,
     * `/onbarding2.jpg`, `/favicon.png`.
     */
    publicDir: 'src/public',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
