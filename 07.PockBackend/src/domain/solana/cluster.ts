/**
 * EL CLÚSTER DE SOLANA DONDE ESTE DESPLIEGUE FIRMA.
 *
 * ── Por qué es un módulo propio ─────────────────────────────────────────────
 *
 * Porque tres módulos necesitan responder la misma pregunta —`transfer.ts` (la
 * identidad CAIP-2 de la cadena), `catalog.ts` (el mint del USDC) y el
 * preparador SPL— y una respuesta que se escribe tres veces es la manera en la
 * que un envío firma contra un ledger que no ve. Una sola respuesta, una sola
 * vez.
 *
 * ── Por qué el contenedor lo configura y no el env suelto ────────────────────
 *
 * En un Worker las variables llegan como *bindings*, no como `process.env`. Leer
 * el env acá sería leer de un canal que en producción puede estar vacío mientras
 * la binding está llena: la situación donde `wrangler dev` hace una cosa y el
 * deploy hace otra. El contenedor fusiona ambos (`readConfig`) y le pasa el
 * nombre resuelto a `configureSolanaCluster()` **antes** de armar las piezas: es
 * el único punto donde la decisión de despliegue toca al dominio, y es una vez.
 *
 * ── De dónde salieron los valores de devnet ─────────────────────────────────
 *
 * - Genesis hash: `getGenesisHash` contra `https://api.devnet.solana.com`, leído
 *   esta sesión. El valor que flota en documentos viejo es el de un ledger que
 *   devnet ya borró.
 * - Mint de USDC: `getAccountInfo` contra ese mismo RPC, y responde como mint
 *   del token program con 6 decimales. Es el mint del faucet de Circle para
 *   devnet.
 *
 * El default es y queda **mainnet**: el despliegue productivo no tiene que
 * configurar nada, y ninguna prueba necesita el env para apuntar a la red de
 * verdad.
 */
export type SolanaClusterName = 'mainnet' | 'devnet';

export interface SolanaClusterSpec {
  /** El clúster como lo nombra la wallet de Privy. No es CAIP-2. */
  readonly cluster: `solana:${SolanaClusterName}`;
  /** La cadena en CAIP-2: el prefijo del genesis hash del clúster. */
  readonly network: `solana:${string}`;
  /** El mint del USDC de este clúster, verificado contra el RPC. */
  readonly usdcMint: string;
  /** El RPC por defecto de este clúster si el despliegue no provee uno. */
  readonly defaultRpcUrl: string;
}

export const SOLANA_MAINNET_SPEC: SolanaClusterSpec = {
  cluster: 'solana:mainnet',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  defaultRpcUrl: 'https://solana-rpc.publicnode.com',
};

export const SOLANA_DEVNET_SPEC: SolanaClusterSpec = {
  cluster: 'solana:devnet',
  network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  defaultRpcUrl: 'https://api.devnet.solana.com',
};

/**
 * De texto del entorno a nombre: cualquier cosa que no sea `devnet` es mainnet.
 *
 * No se tira: una cadena desconocida como red de firma no es como pedir la
 * versión de un paquete, y un error de config que manda la plata a otra red no
 * es cuestión de limpieza. Se restringe a propósito y se escribe a propósito.
 */
export const solanaClusterNameOf = (value: unknown): SolanaClusterName =>
  value === 'devnet' ? 'devnet' : 'mainnet';

let active: SolanaClusterSpec = SOLANA_MAINNET_SPEC;

/** El contenedor el configura una vez por boot. Ningún otro lado puede. */
export const configureSolanaCluster = (name: SolanaClusterName): void => {
  active = name === 'devnet' ? SOLANA_DEVNET_SPEC : SOLANA_MAINNET_SPEC;
};

/** El clúster activo: mainnet hasta que el contenedor diga otra cosa. */
export const activeSolanaCluster = (): Readonly<SolanaClusterSpec> => active;
