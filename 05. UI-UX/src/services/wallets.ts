/**
 * Reclamar las wallets: el navegador las creó, el backend las verifica.
 *
 * ── Por qué existe esta llamada ───────────────────────────────────────────────
 *
 * Antes, este backend creaba las wallets desde el servidor. Producción respondió
 * con dos datos que no dejan lugar a dudas:
 *
 * ```
 * GET /v1/wallets/o2oxert46wgndsi2x2gcu7ze → owner: null, owner_id: "is5plzb8spdqrv6n590y31jf"
 * GET /v1/users/did:privy:cmussgc9y00f80cjvv8gcmbqs → wallets: []
 * ```
 *
 * Las wallets eran de un **quórum de claves de la app**, y la persona ni siquiera
 * las tenía en su usuario. Una llamada REST cruda con nuestro request exacto
 * demuestra que no era un bug nuestro: `POST /v1/wallets` ignora `owner`.
 *
 * Entonces la dirección se invierte: **el navegador crea la wallet** (Privy le da
 * un dueño usuario a las que se crean desde el cliente) y **el backend la
 * verifica** contra el registro de Privy de esa misma persona.
 *
 * ── Lo que este archivo NO hace ───────────────────────────────────────────────
 *
 * No inventa un `walletId` ni una `address`. Los dos valores traveled desde el
 * SDK de Privy y punto: si el SDK no reporta una wallet, no se manda ninguna, y
 * el backend responde 403.
 *
 * ── El `credentials: 'include'` no es negociable ──────────────────────────────
 *
 * Está en `postJson` (`services/api.ts`) para todas las llamadas, y acá también:
 * la cookie httpOnly de ReWALLET es lo que prueba que hay sesión, y sin esto el
 * navegador no la manda nunca.
 */
import { postJson } from './api';

/** Las dos cadenas de esta etapa. El orden es el del producto, no el del azar. */
export type ClaimChain = 'ethereum' | 'solana';

export interface ClaimedWallet {
  readonly chain: ClaimChain;
  /** Id de la wallet tal como lo reporta Privy. Nunca se construye a mano. */
  readonly walletId: string;
  readonly address: string;
}

export interface ClaimWalletsInput {
  /** Access token de Privy: es lo que el backend verifica para obtener el DID. */
  readonly accessToken: string;
  readonly wallets: readonly ClaimedWallet[];
}

/**
 * `POST /api/wallets/claim`.
 *
 * No devuelve nada: el backend contesta `204` sin cuerpo cuando las wallets están
 * verificadas y anotadas. Que no devuelva nada **es** la confirmación.
 *
 * @throws `ApiError` con el código del backend. Los dos que importan acá:
 *         `WALLET_CLAIM_REJECTED` (la persona no es dueña de lo que reclamó, o
 *         la dirección no es la que Privy reporta) y `WALLET_OWNERSHIP_UNAVAILABLE`
 *         (no se pudo verificar). El que llega primero **no** se arregla
 *         reintentando igual; el segundo sí, más tarde.
 */
export const claimRewalletWallets = async (input: ClaimWalletsInput): Promise<void> => {
  await postJson<null>('/wallets/claim', {
    accessToken: input.accessToken,
    wallets: input.wallets.map((wallet) => ({
      chain: wallet.chain,
      walletId: wallet.walletId,
      address: wallet.address,
    })),
  });
};
