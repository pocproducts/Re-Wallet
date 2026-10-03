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
 *   (`dist/dts/types-BOEI6Njl.d.ts:847`) declara `id?: string | null` — *"the
 *   server wallet ID. Null if the wallet is not delegated"*. Esta versión del hook
 *   crea la wallet **EVM** (el runtime pasa `chainType:"ethereum"`).
 *
 * `@privy-io/react-auth/solana`:
 *
 * - `useCreateWallet()` → `{ createWallet(options?) }` que devuelve
 *   `Promise<{ wallet: Wallet }>` (`dist/dts/solana.d.ts:200`), y ahí sí es la de
 *   Solana.
 * - `useWallets()` → las wallets que exponen la interfaz standard de Solana
 *   (`dist/dts/solana.d.ts:167`), que traen `address` pero **no** `id`.
 *
 * ── Por qué el `id` NO sale del `createWallet()` ─────────────────────────────
 *
 * Producción creó la wallet de Ethereum y no hubo nada que reclamar:
 *
 * ```
 * DIAGNOSTIC {"etapa":"wallets_crear_ethereum","detalle":"walletidmissing_ethereum"}
 * ```
 *
 * No fue un fallo de red ni un rechazo del backend: el objeto que devuelve
 * `createWallet()` tiene `id` **opcional y anulable por tipo**, y en una wallet no
 * delegada viene `null`. Leer el `id` de ahí es leer un campo que el SDK está
 * autorizado a withhold. Por eso acá `createWallet()` se usa **sólo para crear**:
 * su valor de retorno ni se mira.
 *
 * ── De dónde sale el `id`, entonces ──────────────────────────────────────────
 *
 * Del **objeto `user` del usuario autenticado**, que lista las wallets embebidas de
 * esa persona con su `id`. Cada entrada es una `WalletWithMetadata`
 * (`dist/dts/types-BOEI6Njl.d.ts:1228`) y trae `id`, `address`, `chainType`,
 * `walletClientType`, `connectorType` y `walletIndex`.
 *
 * **El filtro es el de los helpers de `@privy-io/js-sdk-core`, pero no son los
 * helpers.**
 *
 * ```
 * declare const getAllUserEmbeddedEthereumWallets: (user: User | null) => LinkedAccountEthereumEmbeddedWallet[];
 * declare const getAllUserEmbeddedSolanaWallets:   (user: User | null) => LinkedAccountSolanaEmbeddedWallet[];
 * ```
 *
 * (`@privy-io/js-sdk-core/dist/dts/index.d.ts:2368-2392`). Existen, están
 * exportados y son la lectura canónica —pero leen `user.linked_accounts` y el `User`
 * que quieren es el de `@privy-io/api-types`, no el de `usePrivy()`:
 *
 * ```
 * src/hooks/useUserWallets.ts(310,41): error TS2769:
 *   Argument of type 'User | null' is not assignable to parameter of type 'User | null | undefined'.
 *   Type react-auth/dist/dts/types-BOEI6Njl".U is missing the following properties from type
 *   api-types/resources/users".User: created_at, has_accepted_terms, is_guest, linked_accounts, mfa_methods
 * ```
 *
 * El `user` de `usePrivy()` (`types-BOEI6Njl.d.ts:1329`) expone `linkedAccounts` en
 * camelCase y con metadata. El mismo criterio se aplica a mano sobre esa lista —el
 * de esos helpers en runtime: `type === 'wallet' && wallet_client_type === 'privy'
 * && connector_type === 'embedded'`, ordenado por `wallet_index`— y por eso el dato
 * es el mismo que leerían los helpers, no una aproximación.
 *
 * El tipo de la entrada sigue declarando `id?: string | null` —*"null if the wallet
 * is not delegated"*—, así que la validación del id **no se afloja**: se acepta sólo
 * un string no vacío, y si no viene, esa cadena no se reclama. (Que exista la forma
 * `LinkedAccountEmbeddedWalletWithID` con `id: string` y `recovery_method:
 * 'privy-v2'` en `api-types/resources/users.d.mts:299` no cambia que el campo en
 * esta forma siga siendo opcional: el compilador obliga a mirarlo, y "mirarlo" es
 * comprobar que hay.) Jamás se construye un id ni se usa una dirección como id: un
 * id inventado no es un dato, es una suposición con forma de dato — y el backend la
 * rechazaría igual.
 *
 * ── Por qué hay que re-leer el `user` ─────────────────────────────────────────
 *
 * El objeto `user` se refresca **después** de que la wallet se crea. En el
 * instante en que `createWallet()` resuelve, el `user` que tenemos en la mano es el
 * de antes y todavía no lista la wallet. Reportar `walletidmissing` en ese momento
 * era el error del log de producción. Por eso, tras crear, se relee el `user` desde
 * un `ref` (siempre el último) con algunos intentos cortos: si al final la wallet
 * sigue sin id, el reporte dice cuántos intentos hizo y si el `user` la listó
 * alguna vez.
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
import { claimRewalletWallets, type ClaimChain, type ClaimedWallet } from '../services/wallets';

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
 * Que el objeto `user` no devuelva un `id` **no** es un fallo de red ni un rechazo
 * del backend: es un dato que no vino. Con una etapa y un `unknown_error` no se
 * diferenciaba de cualquier otra cosa. Se reporta con su propia nota, y la nota
 * lleva la cantidad de intentos y si el `user` listó la wallet: con eso, "no vino"
 * y "no lo buscamos" son dos cosas distintas en el log.
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
 * El tipo de `user` de `usePrivy()`, derivado de la firma del hook.
 *
 * Se deriva en vez de importarse porque `@privy-io/react-auth` no exporta `User`
 * con nombre: importarlo traería el `User` de `@privy-io/api-types`, que **no** es
 * el mismo objeto (ver la nota de `embeddedAccounts`).
 */
type PrivyUser = NonNullable<ReturnType<typeof usePrivy>['user']>;

/**
 * Cuántas veces se relee el objeto `user` esperando a que Privy liste la wallet
 * recién creada. Son lecturas a un objeto que el propio SDK refresca: si después
 * de esto no listó la wallet, no va a listarla por esperar más.
 */
const USER_WALLET_ATTEMPTS = 5;

/** Espera entre lecturas. Corta a propósito: esto es integración, no una espera de UI. */
const USER_WALLET_RETRY_MS = 750;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Una entrada de `user.linkedAccounts` que es una wallet (`type: 'wallet'`). */
type PrivyWalletAccount = Extract<PrivyUser['linkedAccounts'][number], { type: 'wallet' }>;

/**
 * Las wallets embebidas de esa persona para una cadena, tal como las lista Privy.
 *
 * El filtro es el mismo de los helpers de `@privy-io/js-sdk-core`
 * (`getAllUserEmbeddedEthereumWallets` / `getAllUserEmbeddedSolanaWallets`), y por
 * qué no se usan esos helpers directamente está escrito arriba: leen
 * `user.linked_accounts`, que es la forma del `User` de `@privy-io/api-types`, y
 * estos son el `User` de `usePrivy()` (`dist/dts/types-BOEI6Njl.d.ts:1329`), que
 * expone `linkedAccounts` en camelCase. `tsc` lo rechaza: el `user` del hook no
 * tiene `linked_accounts`.
 *
 * El orden también es el de esos helpers: por `walletIndex`, así que la primera es
 * la principal. Una lista vacía no es un error: es "todavía no", y el ciclo de
 * intentos decide si eso era transitorio.
 */
const embeddedAccounts = (
  user: PrivyUser | null,
  chain: ClaimChain,
): readonly PrivyWalletAccount[] => {
  if (user === null) return [];

  return user.linkedAccounts
    .filter(
      (account): account is PrivyWalletAccount =>
        account.type === 'wallet' &&
        account.walletClientType === 'privy' &&
        account.connectorType === 'embedded' &&
        account.chainType === chain,
    )
    .sort((a, b) => (a.walletIndex ?? 0) - (b.walletIndex ?? 0));
};

/**
 * El `id` de una entrada del `user`, o `null` si no lo trae.
 *
 * El chequeo es deliberado y no se afloja: el tipo declara `id?: string | null`
 * ("null if the wallet is not delegated"). Un id ausente **no** se reemplaza por la
 * dirección ni por el índice. Se devuelve `null` y esa cadena simplemente no se
 * reclama.
 */
const privyWalletId = (account: PrivyWalletAccount | null): string | null => {
  const id = account?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * El resultado de buscar la wallet de una cadena en el `user`, con lo que hay que
 * saber para poder reportar el fallo.
 */
export interface WalletLookup {
  /** La wallet reclamable, o `null` si nunca apareció un id. */
  readonly wallet: ClaimedWallet | null;
  /** Cuántas veces se leyó el `user`. Va al detalle del reporte. */
  readonly attempts: number;
  /** Si el `user` llegó a listar alguna wallet de esa cadena. Va al detalle. */
  readonly listed: boolean;
}

/**
 * La wallet de una cadena, leída del `user` y sólo del `user`.
 *
 * El `id` y la `address` salen de la misma entrada: jamás se mezclan el id de una
 * con la dirección de otra. Si el `user` todavía no lista la wallet —que es lo que
 * pasa apenas la creamos— se espera un poco y se vuelve a leer, porque el objeto
 * `user` se refresca después de la creación. Sólo después de los intentos se
 * devuelve `null`, y el reporte dice cuántos fueron y si la listó alguna vez.
 */
const resolveEmbeddedWallet = async (
  chain: ClaimChain,
  getUser: () => PrivyUser | null,
  sigueVigente: () => boolean,
): Promise<WalletLookup> => {
  let attempts = 0;
  let listed = false;

  while (attempts < USER_WALLET_ATTEMPTS) {
    if (!sigueVigente()) break;

    attempts += 1;
    const accounts = embeddedAccounts(getUser(), chain);
    // Se prefiere la primera entrada **con id** antes que la primera sin él: una
    // entrada sin id no se reclama, pero no tapa a una que sí lo tiene.
    const account = accounts.find((entry) => privyWalletId(entry) !== null) ?? accounts[0] ?? null;

    if (account !== null) {
      listed = true;
      const walletId = privyWalletId(account);
      if (walletId !== null) {
        return {
          wallet: { chain, walletId, address: account.address },
          attempts,
          listed,
        };
      }
    }

    if (attempts < USER_WALLET_ATTEMPTS) await delay(USER_WALLET_RETRY_MS);
  }

  return { wallet: null, attempts, listed };
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
   * El `user` de **este** render, siempre. El ciclo corre en un `async` que
   * sobrevive varias lecturas: la variable `user` del closure queda vieja apenas
   * el SDK refresca el usuario tras crear una wallet, que es justo cuando hace
   * falta el nuevo. Un `ref` es lo que convierte "el usuario que tengo" en "el
   * usuario de ahora" sin volver a disparar el efecto.
   */
  const currentUser = useRef<PrivyUser | null>(user);
  useEffect(() => {
    currentUser.current = user;
  }, [user]);

  const getUser = useCallback((): PrivyUser | null => currentUser.current, []);

  /*
   * Ethereum primero, SIEMPRE. El orden no es decorativo: es el orden en que el
   * producto usa las wallets (EVM es la primera etapa) y el orden en que el
   * backend las escribe.
   */
  const ethereumWallet = useCallback(
    async (sigueVigente: () => boolean): Promise<WalletLookup> => {
      /*
       * Crear es el último recurso. Si el `user` ya lista una wallet embebida de
       * esta persona, esa es la suya y se reclama. Y si `useWallets` reporta
       * alguna, tampoco se crea otra: crear de más es una wallet huérfana, que es
       * exactamente el problema que este hook está corrigiendo.
       */
      const yaExiste =
        embeddedAccounts(getUser(), 'ethereum').length > 0 || ethWallets.length > 0;

      if (!yaExiste) {
        // El valor de retorno se ignora a propósito: su `id` es opcional y
        // anulable por tipo. Crear sí; sacar el id de ahí, no.
        await createEvmWallet();
      }

      return resolveEmbeddedWallet('ethereum', getUser, sigueVigente);
    },
    [ethWallets, createEvmWallet, getUser],
  );

  const solanaWallet = useCallback(
    async (sigueVigente: () => boolean): Promise<WalletLookup> => {
      /*
       * Mismo criterio que en Ethereum. Las wallets standard de Solana que expone
       * `useWallets` traen `address` pero no `id`: sirven para no crear una
       * segunda, nunca para reclamar.
       */
      const yaExiste =
        embeddedAccounts(getUser(), 'solana').length > 0 || solWallets.length > 0;

      if (!yaExiste) {
        await createSolana();
      }

      return resolveEmbeddedWallet('solana', getUser, sigueVigente);
    },
    [solWallets, createSolana, getUser],
  );

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
          const lookup =
            chain === 'ethereum'
              ? await ethereumWallet(() => vigente)
              : await solanaWallet(() => vigente);

          if (lookup.wallet === null) {
            /*
             * No se reclamó esta cadena. El detalle dice cuántas veces se leyó el
             * `user` y si llegó a listar la wallet: así el log distingue "no vino
             * el dato" de "no lo encontramos" sin inventar nada.
             */
            void reportPrivyErrorWithDetail(
              etapa,
              null,
              `walletidmissing_${chain}_attempts_${lookup.attempts}_listed_${lookup.listed ? 'yes' : 'no'}`,
              API_BASE_URL,
            );
          } else {
            claimed.push(lookup.wallet);
          }
        } catch (error) {
          // La etapa va en la nota para que el `detalle` nunca sea un `code_unknown`
          // a secas: con la etapa y el nombre del error, el código desconocido se
          // puede buscar en el log en vez de adivinarse.
          void reportPrivyErrorWithDetail(etapa, error, `create_${chain}`, API_BASE_URL);
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
