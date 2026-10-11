/**
 * THE CONTAINER.
 *
 * Reads the configuration, builds the adapters, and hands the HTTP layer a
 * fully-wired application. Everything the routes need arrives as an argument:
 * no module reaches for `process.env` on its own, and no route constructs an
 * adapter. That is what makes the entire session flow testable offline.
 *
 * ── Why it fails closed ───────────────────────────────────────────────────────
 *
 * A missing `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `DATABASE_URL` or `SESSION_SECRET`
 * throws here, before the first request. A Worker that boots without knowing which
 * Privy app or which database it belongs to would look healthy and then reject
 * everybody, or write to the wrong place.
 *
 * ── Note what is NOT wired here any more ──────────────────────────────────────
 *
 * There is no wallet creation. This container used to hand `mintSession` a
 * provisioner that asked Privy for a wallet from the server side, and every
 * wallet it made belonged to an app key quorum instead of to the person. What is
 * wired now is the **verification** side: the browser creates the wallet, and
 * `claimWalletsFor` checks the claim against Privy's own record before writing.
 */
import { PrivyClient } from '@privy-io/node';

import { mintSession } from './application/session/mintSession';
import { readPortfolio } from './application/portfolio/readPortfolio';
import { readDigitalDollars } from './application/portfolio/readDigitalDollars';
import { readWalletBalance } from './application/portfolio/readWalletBalance';
import { readKaminoEarnPosition } from './application/portfolio/readKaminoEarnPosition';
import { readPool } from './application/pool/readPool';
import { prepareDeposit } from './application/pool/prepareDeposit';
import { prepareDepositKamino } from './application/pool/prepareDepositKamino';
import { prepareSend } from './application/send/prepareSend';
import { createPaymentRequest } from './application/payment-requests/createPaymentRequest';
import { readPaymentRequest } from './application/payment-requests/readPaymentRequest';
import { payPaymentRequest } from './application/payment-requests/payPaymentRequest';
import { readDepositInfo } from './application/deposit-info/readDepositInfo';
import { claimWalletsFor } from './application/wallet-claim/claimWalletsFor';
import { ingestPrivyWebhook } from './application/webhooks/ingestPrivyWebhook';
import { readNotifications } from './application/webhooks/readNotifications';
import { readPrivyMetrics } from './application/webhooks/readPrivyMetrics';
import { createDatabase, readEnv } from './infrastructure/db/client';
import { createPostgresUserStore } from './infrastructure/db/userStore.pg';
import { createPostgresWalletStore } from './infrastructure/db/walletStore.pg';
import { createPostgresWebhookEventStore } from './infrastructure/db/webhookEventStore.pg';
import { createPostgresMovementStore } from './infrastructure/db/movementStore.pg';
import { createPostgresPaymentRequestStore } from './infrastructure/db/paymentRequestStore.pg';
import { createPostgresIdempotencyStore } from './infrastructure/db/idempotencyStore.pg';
import { createPrivyTokenVerifier } from './infrastructure/privy/privyTokenVerifier';
import { createPrivyUserDirectory } from './infrastructure/privy/privyUserDirectory';
import { createPrivyWalletOwnershipVerifier } from './infrastructure/privy/privyWalletOwnershipVerifier';
import { createJsonRpcEvmBalanceReader, DEFAULT_EVM_ENDPOINTS } from './infrastructure/rpc/jsonRpcEvmBalanceReader';
import {
  createJsonRpcAavePoolReader,
  DEFAULT_POOL_ENDPOINTS,
} from './infrastructure/rpc/jsonRpcAavePoolReader';
import {
  createHttpSolanaBalanceReader,
  DEFAULT_SOLANA_RPC_URL,
} from './infrastructure/rpc/solanaBalanceReader.http';
import { createChainlinkPriceFeed } from './infrastructure/rpc/chainlinkPriceFeed';
import { createHttpKaminoEarnVaultReader } from './infrastructure/rpc/kaminoEarnVaultReader.http';
import { createHttpKaminoDepositPreparer } from './infrastructure/rpc/kaminoDepositPreparer.http';
import {
  createHttpKaminoSharePriceFeed,
  DEFAULT_KAMINO_API_URL,
} from './infrastructure/rpc/kaminoSharePriceFeed.http';
import { createHttpSolanaTransferPreparer } from './infrastructure/rpc/solanaTransferPreparer.http';
import { createSwapUseCase } from './application/swap/swapUseCase';
import { createSwapRoutes } from './interface/http/routes/swap';
import { createPolicyRoutes } from './interface/http/routes/policy';
import { createEvaluateSendPolicy } from './application/policy/evaluateSendPolicyUseCase';
import { createPostgresPolicyStore } from './infrastructure/db/policyStore.pg';
import { createUniswapTradingApiAdapter } from './infrastructure/swap/adapters/uniswapTradingApiAdapter';
import type { SwapProviderFactory } from './infrastructure/swap/swapProviderFactory';
import { createJwtSessionCodec } from './infrastructure/session/jwtSessionCodec';
import { createApp } from './interface/http/app';
import { readContacts } from './application/contacts/readContacts';
import { createPostgresContactsStore } from './infrastructure/db/contactsStore.pg';
import { submitFeedback } from './application/feedback/submitFeedback';
import { createGitHubIssueReporter } from './infrastructure/github/githubIssueReporter';
import type { Logger } from './domain/ports/logger';

export interface Config {
  readonly privyAppId: string;
  readonly privyAppSecret: string;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  /**
   * The Privy webhook signing secret. Required, and it fails closed with the
   * other identities: without it the intake cannot tell a delivery from an
   * anonymous write, and a Worker that accepts both is worse than a Worker with
   * no intake at all.
   */
  readonly privyWebhookSigningSecret: string;
  /**
   * Optional: the endpoints the balance reads use. They have defaults that were
   * verified by hand, so a missing variable is **not** a startup failure here —
   * unlike a missing Privy app id or database URL. A public endpoint is a
   * deployment detail, not an identity, and failing closed on it would make the
   * whole Worker refuse to boot for a route that has a working default.
   */
  readonly monadRpcUrl: string;
  readonly ethereumRpcUrl: string;
  readonly baseRpcUrl: string;
  readonly arbitrumRpcUrl: string;
  readonly optimismRpcUrl: string;
  readonly polygonRpcUrl: string;
  readonly solanaRpcUrl: string;
  /**
   * Optional: the endpoint the **pool** reads go through.
   *
   * Same reasoning as `monadRpcUrl`: a public endpoint is a deployment detail with
   * a verified default, not an identity. Failing closed on it would stop the whole
   * Worker from booting for a route that has a working default.
   */
  readonly monadPoolRpcUrl: string;
  /**
   * Optional: the base URL of Kamino's public API, where the **share price** of a
   * Kamino Earn vault is read.
   *
   * Same reasoning as every other endpoint here: a deployment detail with a
   * verified default, not an identity. Nothing else about Kamino is read from it —
   * the shares are read on chain, and the position is never written anywhere.
   */
  readonly kaminoApiUrl?: string;
  /**
   * La API key del Trading API de Uniswap. Sin ella el swap no puede cotizar:
   * el endpoint responde 401 a cualquier pedido sin `x-api-key`.
   *
   * Opcional a propósito — para que `readConfig` no rompa el arranque de un
   * despliegue que todavia no la tiene — pero sin ella el provider devuelve
   * `RPC_UNAVAILABLE`, que es "no pude preguntar" y no "no hay mercado".
   */
  readonly uniswapApiKey?: string;
  /**
   * Token de GitHub con `issues:write` sobre el repo, para que el reporte de
   * beta se convierta en una issue real. Sin el token la ruta `/api/feedback`
   * no se monta: la honestidad es que sin tracker no hay reporte, no un 500.
   */
  readonly githubFeedbackToken?: string;
  /** `owner/repo`; por defecto el repo de este proyecto. */
  readonly githubFeedbackRepo?: string;
}

/** The one place that knows which environment variables exist. */
/** El primer endpoint configurado de una lista, o el nombre de una variable sin valor. */
const firstCandidate = (candidates: readonly string[]): string => candidates[0] ?? '';

export const readConfig = (env: Record<string, unknown> = process.env as Record<string, unknown>): Config => {
  const required = {
    privyAppId: readEnv(env, 'PRIVY_APP_ID'),
    privyAppSecret: readEnv(env, 'PRIVY_APP_SECRET'),
    databaseUrl: readEnv(env, 'DATABASE_URL'),
    sessionSecret: readEnv(env, 'SESSION_SECRET'),
    privyWebhookSigningSecret: readEnv(env, 'PRIVY_WEBHOOK_SIGNING_SECRET'),
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(', ')}.`);
  }

  return {
    ...required,
    monadRpcUrl: readEnv(env, 'MONAD_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.monad),
    ethereumRpcUrl: readEnv(env, 'ETHEREUM_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.ethereum),
    baseRpcUrl: readEnv(env, 'BASE_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.base),
    arbitrumRpcUrl: readEnv(env, 'ARBITRUM_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.arbitrum),
    optimismRpcUrl: readEnv(env, 'OPTIMISM_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.optimism),
    polygonRpcUrl: readEnv(env, 'POLYGON_RPC_URL') || firstCandidate(DEFAULT_EVM_ENDPOINTS.polygon),
    // The escape hatch, and it wins: set `SOLANA_RPC_URL` and this line never
    // reaches the default. The default is the official public Solana RPC
    // (`api.mainnet-beta.solana.com`), free and aggressively rate-limited, which
    // answers the indexed account reads the SPL balances are made of — the
    // previous default answered those with HTTP 403 and no balances at all.
    solanaRpcUrl: readEnv(env, 'SOLANA_RPC_URL') || DEFAULT_SOLANA_RPC_URL,
    monadPoolRpcUrl: readEnv(env, 'MONAD_POOL_RPC_URL') || firstCandidate(DEFAULT_POOL_ENDPOINTS),
    kaminoApiUrl: readEnv(env, 'KAMINO_API_URL') || DEFAULT_KAMINO_API_URL,
    uniswapApiKey: readEnv(env, 'UNISWAP_API_KEY'),
    githubFeedbackToken: readEnv(env, 'GITHUB_FEEDBACK_TOKEN'),
    githubFeedbackRepo: readEnv(env, 'GITHUB_FEEDBACK_REPO') || 'pocproducts/ReWALLET',
  };
};

export const buildApp = (config: Config, log: Logger) => {
  const db = createDatabase(config.databaseUrl);
  const privy = new PrivyClient({ appId: config.privyAppId, appSecret: config.privyAppSecret });

  const verify = createPrivyTokenVerifier({ appId: config.privyAppId, appSecret: config.privyAppSecret });
  // The same directory lookup serves both facts: the mailbox for the session, the
  // wallets for the claim. One client, one record, one place that knows Privy's
  // user shape.
  const directory = createPrivyUserDirectory(privy);
  const ownership = createPrivyWalletOwnershipVerifier(privy);
  const walletStore = createPostgresWalletStore(db);
  const webhookEvents = createPostgresWebhookEventStore(db);
  // La agenda sale de los propios envíos con tag: ninguna otra fuente sabe a quién le mandaste.
  const contacts = createPostgresContactsStore(db);
  const sessions = createJwtSessionCodec({ secret: config.sessionSecret });

  /*
   * The balance readers. Both URLs are overridable so the deployment can point at
   * a provider of its own — a public RPC rate-limits, and a rate limit must show
   * up as a per-chain error rather than as a Worker that cannot boot.
   */
  const evm = createJsonRpcEvmBalanceReader({
    // Una variable de entorno **agrega** un endpoint ahead of the defaults, no
    // los reemplaza: un override no debería dejar la cadena con una sola URL.
    endpoints: {
      monad: [...(config.monadRpcUrl !== DEFAULT_EVM_ENDPOINTS.monad[0] ? [config.monadRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.monad],
      ethereum: [...(config.ethereumRpcUrl !== DEFAULT_EVM_ENDPOINTS.ethereum[0] ? [config.ethereumRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.ethereum],
      base: [...(config.baseRpcUrl !== DEFAULT_EVM_ENDPOINTS.base[0] ? [config.baseRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.base],
      arbitrum: [...(config.arbitrumRpcUrl !== DEFAULT_EVM_ENDPOINTS.arbitrum[0] ? [config.arbitrumRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.arbitrum],
      optimism: [...(config.optimismRpcUrl !== DEFAULT_EVM_ENDPOINTS.optimism[0] ? [config.optimismRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.optimism],
      polygon: [...(config.polygonRpcUrl !== DEFAULT_EVM_ENDPOINTS.polygon[0] ? [config.polygonRpcUrl] : []), ...DEFAULT_EVM_ENDPOINTS.polygon],
    },
  });
  const solana = createHttpSolanaBalanceReader({ url: config.solanaRpcUrl });
  /*
   * The Solana **message builder**, over the same endpoint and the same cluster:
   * reading a lamport balance and compiling a transaction are different jobs, but
   * they are one conversation with one RPC. A message built for a different
   * cluster than the catalog names is refused by the use case, not by this file.
   */
  const solanaTransfers = createHttpSolanaTransferPreparer({ url: config.solanaRpcUrl });

  /*
   * The Aave V3 pool on Monad. It reads the same network as the Monad balances but
   * through its own adapter, because `getReserveData` answers with a struct and a
   * `bigint` port would be the wrong shape for it.
   */
  const aavePool = createJsonRpcAavePoolReader({
    endpoints:
      config.monadPoolRpcUrl === DEFAULT_POOL_ENDPOINTS[0]
        ? DEFAULT_POOL_ENDPOINTS
        : [config.monadPoolRpcUrl, ...DEFAULT_POOL_ENDPOINTS],
  });

  /*
   * La politica de gasto.
   *
   * Tres reglas sobre un store propio. El caso de uso vive aparte del de `send`
   * a proposito: **evaluar** no es lo mismo que **exigir**, y por eso hay una
   * puerta HTTP aparte —la pantalla pregunta para pintar el motivo— y una
   * aplicacion adentro del caso de uso que mueve plata. Las dos comparten este
   * mismo objeto: un motor, una historia y un solo lugar donde la decision queda
   * escrita.
   *
   * Se construye antes que el envio porque el envio **la usa**: `prepareSend`
   * corta un `deny` y frenan un `confirm` sin gesto, y un pago de cobro queda
   * cubierto por la misma puerta.
   */
  const policyStore = createPostgresPolicyStore(db);
  const evaluateSendPolicy = createEvaluateSendPolicy({ policy: policyStore, log });

  /*
   * One send flow, shared.
   *
   * It is built here, once, and handed to both `prepareSend` and the charge
   * payment: a payment of a charge **is** a send, with the destination resolved on
   * this side instead of in the body. Two instances would mean two movement stores
   * and two idempotency stores over the same tables, and the second one would be a
   * place where the two could disagree about what was already prepared.
   *
   * The spending rules go in as a dependency, not as a call the route makes: the
   * policy is enforced inside, where the money is about to move, so the door that
   * skips it does not exist.
   */
  const movements = createPostgresMovementStore(db);
  const idempotency = createPostgresIdempotencyStore(db);
  const sendFlow = prepareSend({
    wallets: walletStore,
    evm,
    solana,
    solanaTransfers,
    movements,
    idempotency,
    policy: evaluateSendPolicy,
    log,
  });

  /* The charges, in a table that already existed. No table is created here. */
  const paymentRequests = createPostgresPaymentRequestStore(db);

  /*
   * The two reads the total is composed from, built **once** and handed to both
   * the portfolio and the total: one wallet store, one source of addresses, and
   * a total whose parts are by construction the same numbers the other screens
   * already show.
   */
  const portfolioRead = readPortfolio({ wallets: walletStore, evm, solana, log });
  const poolRead = readPool({ wallets: walletStore, pool: aavePool, log });

  /*
   * The **second venue**: Kamino Earn on Solana.
   *
   * The hybrid, in two collaborators. The shares come off the chain, through the
   * **same** SPL reader the portfolio already uses (`mintBalance`, filtered by the
   * vault's shares mint) and through the vault account itself, which is read over
   * the same Solana endpoint. The share price comes from Kamino's public API
   * through an injected port, because it cannot be computed here — ~99.5 % of this
   * vault's assets sit in klend cTokens rather than in the vault's own account.
   *
   * Nothing is persisted: the position is read live, exactly as the Aave position
   * is, and `sql/` is not touched by this feature at all.
   */
  const kaminoVaults = createHttpKaminoEarnVaultReader({ url: config.solanaRpcUrl });
  const kaminoSharePrices = createHttpKaminoSharePriceFeed({ baseUrl: config.kaminoApiUrl });
  const readKaminoEarnOf = readKaminoEarnPosition({
    wallets: walletStore,
    vaults: kaminoVaults,
    solana,
    prices: kaminoSharePrices,
    log,
  });

  /*
   * El **depósito** en Kamino Earn. Otro adaptador sobre el mismo endpoint y el
   * mismo cluster que la lectura: leer una cuenta y compilar un mensaje son
   * trabajos distintos, pero es una conversación con un RPC. Se anotan dos cosas
   * que no son obvias y por eso están acá y no dentro del caso de uso:
   *
   *  - el mensaje va **sin firmar**, como todo lo demás de Solana;
   *  - sólo lleva las dos instrucciones verificadas (la ATA de USDC, la ATA de
   *    shares y el depósito en el KVault). Las dos del programa Farms **no**
   *    existen todavía porque su layout no tiene fuente autoritativa, y el caso de
   *    uso lo dice con palabras en `completion.executes: false` en vez de devolver
   *    un mensaje que parece completo y falla en mainnet.
   *
   * Y se pega a la función de Aave porque `AppDeps` declara un solo
   * `prepareDeposit` (ver `PoolDepositUseCases`): cuando ese objeto crezca, esta
   * línea pasa a ser un campo más.
   */
  const kaminoDeposits = prepareDepositKamino({
    wallets: walletStore,
    solana,
    preparer: createHttpKaminoDepositPreparer({ url: config.solanaRpcUrl }),
    log,
  });
  const deposits = Object.assign(prepareDeposit({ wallets: walletStore, pool: aavePool, log }), {
    kamino: kaminoDeposits,
  });

  /*
   * Swap: cotización y ejecución de conversiones entre activos.
   *
   * El provider que responde es el **Trading API de Uniswap**, no el Quoter
   * on-chain: Monad no tiene QuoterV2 desplegado, y `quoteExactInputSingle`
   * devuelve `0x` a cualquier monto. El API corre el mismo ruteo que el web app
   * y devuelve la transacción ya armada para que la firme la persona.
   *
   * Sin `UNISWAP_API_KEY` el provider no dice "no hay mercado": dice "no pude
   * preguntar", y el caso de uso lo traduce a `RPC_UNAVAILABLE`.
   *
   * Se construye **una sola vez** y se comparte entre el caso de uso y las
   * rutas. Antes se armaban tres instancias distintas, y las rutas usaban un
   * provider que el caso de uso nunca veía.
   */
  const swapProvider = createUniswapTradingApiAdapter({
    // `readEnv` devuelve `string` y nunca `undefined`: una variable ausente
    // llega como `''`. El adaptador usa `null` para "no hay key" y ya trata
    // `''` igual (`apiKey === null || apiKey.trim() === ''`), asi que el `||`
    // traduce el "ausente" del env al "no configurado" del adaptador. Es la
    // misma convencion que el resto del archivo: `readEnv(...) || default`.
    apiKey: config.uniswapApiKey || null,
  });

  const swapProviderFactory: SwapProviderFactory = {
    getProviderForPair: async () => swapProvider,
    getSupportedPairs: async () => swapProvider.getSupportedPairs(),
    getProvider: () => swapProvider,
  };

  const swapUseCase = createSwapUseCase({ swapProviderFactory, log });

  const swapRoutes = createSwapRoutes({ sessions, swapUseCase, log });

  /*
   * Las rutas de politica: la consulta de la pantalla, sobre el **mismo** caso de
   * uso que exige el envio. No se saca: es la cortesia que le permite al front
   * mostrar el motivo antes de que la persona decida.
   */
  const policyRoutes = createPolicyRoutes({ sessions, evaluateSendPolicy, log });

  return createApp({
    mint: mintSession({
      verify,
      directory,
      users: createPostgresUserStore(db),
      sessions,
      log,
    }),
    verify,
    claim: claimWalletsFor({
      directory,
      users: createPostgresUserStore(db),
      ownership,
      store: walletStore,
      log,
    }),
    sessions,
    // The same wallet store the claim writes through, read through.
    readPortfolio: portfolioRead,
    /*
     * The pool read and the deposit, over the same store the portfolio reads: one
     * source of addresses, so the position shown on the pool screen belongs to the
     * wallet the portfolio shows and the deposit signs for.
     */
    readPool: poolRead,
    prepareDeposit: deposits,
    /*
     * The one number. It adds up what those two reads answer and states whether
     * every part of it could be read; it opens no connection of its own, so
     * nothing here can disagree with the portfolio or the pool screen.
     */
    readDigitalDollars: readDigitalDollars({ readPortfolio: portfolioRead, readPool: poolRead, log }),
    /*
     * **The** number, and the price that makes it possible.
     *
     * The Chainlink feeds live on Monad, so the price adapter talks to the same
     * network as the Monad balances, through the same "an override adds a
     * candidate endpoint ahead of the defaults" rule: a deployment can point at a
     * provider of its own without leaving itself with a single URL.
     *
     * Both channels of a pair are read at **one block**, so the cross-check
     * compares one instant of the world rather than two reads seconds apart —
     * which is what made the two MON channels look 0.76% apart when they were
     * both reading the same $0.028642.
     */
    readWalletBalance: readWalletBalance({
      readPortfolio: portfolioRead,
      readPool: poolRead,
      // The second venue. It adds one piece to `investedValue` and to the sum
      // over it; no bucket and no term of the total is added with it.
      readKaminoEarn: readKaminoEarnOf,
      prices: createChainlinkPriceFeed({
        endpoints:
          config.monadRpcUrl === DEFAULT_EVM_ENDPOINTS.monad[0]
            ? DEFAULT_EVM_ENDPOINTS.monad
            : [config.monadRpcUrl, ...DEFAULT_EVM_ENDPOINTS.monad],
      }),
      log,
    }),
    /*
     * El envío. Mismos lectores de saldo que el portfolio —una sola fuente de
     * saldos— y el mismo catálogo como fuente de verdad de qué activo existe en
     * qué red. El store de movimientos y el de idempotencia son nuevas filas en
     * tablas que ya existen; no se crea nada acá.
     */
    prepareSend: sendFlow,
    // El caso de uso no va acá: `AppDeps` no lo declara y nadie lo lee. Llega
    // al HTTP dentro de `swapRoutes`, que es quien lo recibe de
    // `createSwapRoutes`. Pasarlo tambien como dep era una segunda puerta al
    // mismo objeto que nadie abria.
    swapRoutes,
    policyRoutes,
    /*
     * The deposit catalog and the addresses that go with it, read through the
     * **same** store. One store, una sola fuente de dirección: si esta ruta
     * leyera las carteras por otro lado, la dirección que la pantalla muestra
     * para recibir podría no ser la misma que la que el portfolio lee.
     */
    readDepositInfo: readDepositInfo({ wallets: walletStore, log }),

    /*
     * El link de cobro. Una tabla que ya estaba completa; acá no se crea nada.
     *
     * El pago de un cobro llama al **mismo** `sendFlow` de arriba: la única
     * diferencia es que el destinatario se resuelve adentro del caso de uso, desde
     * `rewallet.wallets`, y nunca viaja en un cuerpo ni vuelve en una respuesta.
     */
    createPaymentRequest: createPaymentRequest({ requests: paymentRequests, log }),
    readPaymentRequest: readPaymentRequest({ requests: paymentRequests, log }),
    payPaymentRequest: payPaymentRequest({
      requests: paymentRequests,
      // The **same** wallet store the portfolio reads and the send resolves its
      // sender from: one source of addresses, so the address a charge resolves to
      // is an address this project already owns.
      wallets: walletStore,
      prepareSend: sendFlow,
      log,
    }),
    // Intake and feed share one store: one write path and one read path over the
    // same rows, so "the feed shows what arrived" is a property of the wiring.
    ingestWebhook: ingestPrivyWebhook({
      store: webhookEvents,
      signingSecret: config.privyWebhookSigningSecret,
      log,
    }),
    readNotifications: readNotifications({ store: webhookEvents, log }),
    // Same store, aggregate-only read: the landing's numbers come from the rows
    // the intake already wrote.
    readMetrics: readPrivyMetrics({ store: webhookEvents }),
    readContacts: readContacts({ store: contacts, log }),
    // Sin token no hay issue que crear: la ruta `/api/feedback` no se monta.
    ...(config.githubFeedbackToken
      ? {
          submitFeedback: submitFeedback({
            reporter: createGitHubIssueReporter({
              token: config.githubFeedbackToken,
              repo: config.githubFeedbackRepo ?? 'pocproducts/ReWALLET',
            }),
          }),
        }
      : {}),
    log,
  });
};