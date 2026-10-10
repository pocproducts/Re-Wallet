import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';

import App from './App.tsx';
import './index.css';
import { DEFAULT_EVM_CHAIN, SUPPORTED_EVM_CHAINS } from './config/chains';

/**
 * Las redes EVM las declara `src/config/chains.ts`, no este archivo. Ahí está
 * escrito por qué **una sola** wallet EVM sirve en todas ellas, y por qué
 * Ethereum sigue siendo la red por defecto: Monad se suma, no reemplaza.
 *
 * En `@privy-io/react-auth@3.47` las cadenas van dentro de `config`
 * (`PrivyClientConfig`), no como props sueltas del provider. Son los mismos dos
 * campos —`defaultChain` y `supportedChains`— leídos de las definiciones de tipo
 * del paquete instalado, no de memoria.
 */
const privyConfig = {
  defaultChain: DEFAULT_EVM_CHAIN,
  // A mutable array, no `as const`: `PrivyClientConfig.supportedChains` is
  // `Chain[]`, y un `readonly` no se le puede asignar.
  supportedChains: [...SUPPORTED_EVM_CHAINS],
};

/**
 * El app id **va al navegador**, y no es un descuido: es público por diseño.
 * La seguridad de un app id de Privy no está en ocultarlo, sino en los
 * **dominios permitidos** del panel. En local no hacen falta —la propia
 * documentación de Privy lo dice—; en producción, `app.rewallet.win` ya está.
 */
const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

/**
 * Sin app id **no se renderiza la app**: no hay un modo degradado.
 *
 * Un proveedor de identidad ausente tiene que ser un error visible de una vez.
 * Si la app arranca y después falla al pedir un código, el síntoma es "la
 * pantalla queda cargando" y el diagnóstico cuesta una hora.
 */
if (!appId) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML =
      '<div style="font-family:system-ui;padding:2rem;max-width:34rem">' +
      '<h1 style="font-size:1.1rem">Falta VITE_PRIVY_APP_ID</h1>' +
      '<p>Copiá <code>.env.example</code> a <code>.env</code> y poné el app id ' +
      'de Privy. Sin él la app no arranca, a propósito.</p></div>';
  }
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PrivyProvider appId={appId} config={privyConfig}>
        <App />
      </PrivyProvider>
    </StrictMode>,
  );
}
