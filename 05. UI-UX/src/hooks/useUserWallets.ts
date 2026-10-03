/**
 * Que la persona sea la dueña de su wallet, desde el navegador.
 *
 * ── El problema que esto arregla ──────────────────────────────────────────────
 *
 * El backend creaba las wallets desde el servidor, y producción respondió que esas
 * wallets eran de un **quórum de claves de la app** (`owner: null`) y que el
 * usuario de Privy ni las tenía listadas. Una request REST cruda con el mismo body
 * demuestra que el endpoint ignora `owner`: no era un bug del backend, era el
 * endpoint.
 *
 * La decisión fue: **el navegador crea la wallet, el backend la verifica.** Y es
 * la documentación de Privy la que dice que las wallets creadas desde un SDK de
 * cliente nacen con dueño usuario.
 *
 * ── Qué hooks existen, según los tipos instalados ─────────────────────────────
 *
 * `@privy-io/react-auth@3.47.0`:
 *
 * - `useWallets()` → `{ wallets: ConnectedWallet[], ready }`
 *   (`dist/dts/index.d.ts:1358`, interfaz en `:1346-1357`). Es la lista de wallets
 *   que el SDK reporta **para el usuario autenticado**.
 * - `useCreateWallet()` → `{ createWallet(options?) }`
 *   (`dist/dts/index.d.ts:3004`). Devuelve `Promise<Wallet>`, y `Wallet`
 *   (`dist/dts/types-BOEI6Njl.d.ts:847`) trae `id`, `address` y `chainType`. Esta
 *   versión del hook crea la wallet **EVM** (el runtime pasa `chainType:"ethereum"`).
 *
 * `@privy-io/react-auth/solana`:
 *
 * - `useCreateWallet()` → `{ createWallet(options?) }` que devuelve
 *   `Promise<{ wallet: Wallet }>` (`dist/dts/solana.d.ts:200`), y ahí sí es la de
 *   Solana.
 * - `useWallets()` → las wallets que exponen la interfaz standard de Solana
 *   (`dist/dts/solana.d.ts:167`), que traen `address` pero **no** `id`.
 *
 * ── Por qué el `id` se lee y no se escribe ────────────────────────────────────
 *
 * `ConnectedWallet` (el tipo público de `useWallets`) no declara `id`, aunque el
 * objeto que el SDK entrega lo trae. Por eso `privyWalletId` **lee** el campo y
 * valida que sea un string no vacío; si no está, esa wallet no se reclama. Jamás se
 * construye un id: un id inventado no es un dato, es una suposición con forma de
 * dato — y el backend la rechazaría igual.
 *
 * ── Un fallo acá NO es una puerta ─────────────────────────────────────────────
 *
 * La persona ya está autenticada en Privy y ya tiene sesión de ReWALLET. Un
 * problema con las wallets es un problema que hay que **mostrar**, no un muro que
 * impide entrar. Por eso este hook no lanza ni cambia el estado de la sesión: deja
 * entrar, avisa por el helper de diagnóstico que ya existe, y expone un estado
 * para que la app muestre un aviso.
 *
 * ── Una sola vez por usuario autenticado ──────────────────────────────────────
 *
 * Nunca en un render, nunca en un bucle. Un `ref` con el id del usuario es lo que
 * corta la repetición, igual que en `useSessionGate`: sin él, un fallo del backend
 * reintentaría solo y para siempre.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import {
  useCreateWallet as useCreateSolanaWallet,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';

import { API_BASE_URL, ApiError } from '../services/api';
import { reportPrivyErrorWithDetail, readPrivyErrorCode, toDiagnosticCode } from '../services/privy';
import { claimRewalletWallets, type ClaimedWallet } from '../services/wallets';

export type WalletClaimStatus =
  /** Todavía no corrió, o esta persona no tiene sesión. */
  | 'idle'
  /** Buscando o creando las wallets en Privy. No bloquea nada. */
  | 'preparing'
  /** Verificadas y anotadas en el backend. */
  | 'claimed'
  /** No se pudo. La persona entra igual y se le muestra el aviso. */
  | 'failed';

/** Etapas del circuito, para que el log del Worker diga dónde se cortó. */
const ETAPA_WALLETS_ETHEREUM = 'wallets_crear_ethereum';
const ETAPA_WALLETS_SOLANA = 'wallets_crear_solana';
const ETAPA_WALLETS_CLAIM = 'wallets_reclamar';

/**
 * ── Por qué se reporta en TODAS las etapas ─────────────────────────────────────
 *
 * Antes sólo se reportaba el fallo del reclamo, con `unknown_error` al lado de la
 * etapa, y en el log de producción no había ni un `POST /api/wallets/claim`:
 * cinco causas distintas —crear la wallet de Ethereum, la de Solana, armar el
 * payload, el token, el post— se veían **exactamente igual**.
 *
 * Ahora cada etapa que puede fallar reporta con `detalle`, que es el campo que el
 * Worker acepta justamente para esto: el código real, el status HTTP y el nombre
 * del error. Es diagnóstico de integración, no producto: no bloquea, no muestra.
 *
 * ── Por qué el `id` ausente se reporta por su nombre ───────────────────────────
 *
 * Que el SDK devuelva una wallet sin `id` **no** es un fallo de red ni un rechazo
 * del backend: es un dato que no vino. Con una etapa y un `unknown_error` no se
 * diferenciaba de cualquier otra cosa, y es un caso real de la wallet de Solana,
 * cuyo tipo expone `address` pero no `id`. Se reporta con su propia nota.
 */

export interface UserWallets {
  readonly status: WalletClaimStatus;
  /**
   * Traducción al código que el backend registra, para que el diagnóstico diga
   * algo útil y no "algo falló". `null` mientras no hubo fallo.
   */
  readonly failureCode: string | null;
}

/**
 * El `id` de la wallet, tal como lo trae el SDK — o `null` si no lo trae.
 *
 * El chequeo es deliberado: un `id` ausente no se reemplaza por la dirección ni por
 * el índice del array. Se devuelve `null` y esa cadena simplemente no se reclama.
 */
const privyWalletId = (wallet: unknown): string | null => {
  const id = (wallet as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/** Traduce cualquier fallo al vocabulario cerrado que acepta el diagnóstico. */
const diagnosticCodeFor = (error: unknown): string | null => {
  const privyCode = readPrivyErrorCode(error);
  if (privyCode) return toDiagnosticCode(privyCode);

  // `NETWORK_UNAVAILABLE` es el único código propio que vale la pena distinguir:
  // se arregla reintentando, y el log tiene que poder decirlo.
  if (error instanceof ApiError && error.code === 'NETWORK_UNAVAILABLE') {
    return toDiagnosticCode('NETWORK_UNAVAILABLE');
  }

  // Incluye `WALLET_CLAIM_REJECTED`: se registra, pero no se muestra como si
  // reintentar fuera a arreglarlo.
  return null;
};

/**
 * @param enabled `true` sólo cuando la sesión de ReWALLET ya está abierta. Es lo
 * que ordena el circuito: primero entra la persona, después se preparan sus
 * wallets — y nunca al revés.
 */
export const useUserWallets = (enabled: boolean): UserWallets => {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { wallets: ethWallets, ready: ethReady } = useWallets();
  const { createWallet: createEvmWallet } = useCreateWallet();
  const { wallets: solWallets } = useSolanaWallets();
  const { createWallet: createSolana } = useCreateSolanaWallet();

  const [status, setStatus] = useState<WalletClaimStatus>('idle');
  const [failureCode, setFailureCode] = useState<string | null>(null);

  /*
   * El corte del bucle: una pasada por persona autenticada. Sin esto, un fallo
   * Volvería a disparar el efecto en cada cambio de estado.
   */
  const startedFor = useRef<string | null>(null);

  /*
   * Ethereum primero, SIEMPRE. El orden no es decorativo: es el orden en que el
   * producto usa las wallets (EVM es la primera etapa) y el orden en que el
   * backend las escribe.
   */
  const ethereumWallet = useCallback(async (): Promise<ClaimedWallet | null> => {
    const existing = ethWallets[0];
    if (existing) {
      // Ya existe una para esta persona: no se crea otra (crear de más es una
      // wallet huérfana), sólo se reclama si el SDK nos dio su id.
      const walletId = privyWalletId(existing);
      return walletId === null ? null : { chain: 'ethereum', walletId, address: existing.address };
    }

    // No hay ninguna: se crea desde el navegador, que es lo que la deja con dueño
    // usuario. El `Wallet` que devuelve el SDK trae `id`, `address` y `chainType`.
    const created = await createEvmWallet();
    const walletId = privyWalletId(created);
    return walletId === null ? null : { chain: 'ethereum', walletId, address: created.address };
  }, [ethWallets, createEvmWallet]);

  const solanaWallet = useCallback(async (): Promise<ClaimedWallet | null> => {
    const existing = solWallets[0];
    if (existing) {
      /*
       * Las wallets standard de Solana exponen `address` pero no `id`, así que
       * normalmente acá no hay nada reclamable. Y **no** se crea una segunda: si
       * esta persona ya tiene una, crear otra es exactamente el problema que se
       * está corrigiendo.
       */
      const walletId = privyWalletId(existing);
      return walletId === null ? null : { chain: 'solana', walletId, address: existing.address };
    }

    const { wallet } = await createSolana();
    const walletId = privyWalletId(wallet);
    return walletId === null ? null : { chain: 'solana', walletId, address: wallet.address };
  }, [solWallets, createSolana]);

  useEffect(() => {
    if (!enabled || !ready || !authenticated) return;

    /*
     * Se espera a que el SDK haya reportado las wallets del usuario. Sin esto, la
     * primera pasada vería una lista vacía y crearía una wallet para alguien que
     * ya tenía una.
     */
    if (!ethReady) return;

    const id = user?.id ?? 'sin_id_de_usuario';
    if (startedFor.current === id) return;
    startedFor.current = id;

    let vigente = true;
    setStatus('preparing');

    void (async () => {
      const claimed: ClaimedWallet[] = [];

      /*
       * Una cadena que falla no tira abajo la otra. Una persona con la wallet de
       * Ethereum y sin la de Solana está mejor que una sin ninguna, y el backend
       * acepta una cadena sola.
       */
      for (const chain of ['ethereum', 'solana'] as const) {
        const etapa = chain === 'ethereum' ? ETAPA_WALLETS_ETHEREUM : ETAPA_WALLETS_SOLANA;
        try {
          const wallet = chain === 'ethereum' ? await ethereumWallet() : await solanaWallet();
          if (wallet === null) {
            // El SDK no trajo un id reclamable: ni falla niclaims, pero hay que
            // poder decirlo en el log en vez de dejarlo como otro `unknown_error`.
            void reportPrivyErrorWithDetail(etapa, null, `walletidmissing_${chain}`, API_BASE_URL);
          } else {
            claimed.push(wallet);
          }
        } catch (error) {
          void reportPrivyErrorWithDetail(etapa, error, undefined, API_BASE_URL);
        }
      }

      if (!vigente) return;

      if (claimed.length === 0) {
        setFailureCode('unknown_error');
        setStatus('failed');
        // Ninguna cadena produjo una wallet reclamable: es el armado del payload
        // lo que falló, no el post.
        void reportPrivyErrorWithDetail(ETAPA_WALLETS_CLAIM, null, 'payload_vacio', API_BASE_URL);
        return;
      }

      try {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error('must_be_authenticated');

        // El backend verifica cada id contra el registro de Privy de esta persona.
        await claimRewalletWallets({ accessToken, wallets: claimed });

        if (!vigente) return;
        setFailureCode(null);
        setStatus('claimed');
      } catch (error) {
        if (!vigente) return;
        // Falla el reclamo: la persona entra igual y se le muestra el aviso.
        setFailureCode(diagnosticCodeFor(error) ?? 'unknown_error');
        setStatus('failed');
        // El token viaja en el header, nunca en el detalle: lo que se manda es
        // que faltó, si es que eso fue lo que pasó.
        const note =
          error instanceof Error && error.message === 'must_be_authenticated'
            ? 'access_token_missing'
            : undefined;
        void reportPrivyErrorWithDetail(ETAPA_WALLETS_CLAIM, error, note, API_BASE_URL);
      }
    })();

    return () => {
      vigente = false;
    };
  }, [enabled, ready, authenticated, ethReady, user?.id, getAccessToken, ethereumWallet, solanaWallet]);

  return { status, failureCode };
};
