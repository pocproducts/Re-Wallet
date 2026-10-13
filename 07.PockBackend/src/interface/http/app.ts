/**
 * THE APPLICATION.
 *
 * One object that lists everything a person can ask for, and wires the ports into
 * the routes. Every dependency arrives as an argument — that is what lets the
 * whole HTTP surface be tested with no network and no database.
 *
 * ── Why there is no session guard here ────────────────────────────────────────
 *
 * `06. Backend` guards every route by default and lists the public ones. This POC
 * has exactly one protected concern (`GET /api/auth/session`), and a global
 * middleware that strips `/api` would be a second place where the prefix has to be
 * right. A route that validates its own cookie cannot be made circular by a
 * routing mistake.
 */
import { Hono } from 'hono';

import type { MintSession } from '../../application/session/mintSession';
import type { ReadPortfolio } from '../../application/portfolio/readPortfolio';
import type { ReadDigitalDollars } from '../../application/portfolio/readDigitalDollars';
import type { ReadWalletBalance } from '../../application/portfolio/readWalletBalance';
import type { ReadPool } from '../../application/pool/readPool';
import type { PrepareDeposit } from '../../application/pool/prepareDeposit';
import type { ReadDepositInfo } from '../../application/deposit-info/readDepositInfo';
import type { PrepareSend } from '../../application/send/prepareSend';
import type { CreatePaymentRequest } from '../../application/payment-requests/createPaymentRequest';
import type { ReadPaymentRequest } from '../../application/payment-requests/readPaymentRequest';
import type { PayPaymentRequest } from '../../application/payment-requests/payPaymentRequest';
import type { ClaimWalletsFor } from '../../application/wallet-claim/claimWalletsFor';
import type { IngestPrivyWebhook } from '../../application/webhooks/ingestPrivyWebhook';
import type { ReadNotifications } from '../../application/webhooks/readNotifications';
import type { ReadPrivyMetrics } from '../../application/webhooks/readPrivyMetrics';
import type { ReadContacts } from '../../application/contacts/readContacts';
import { createContactsRoutes } from './routes/contacts';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';
import type { SessionCodec } from '../../domain/ports/session-codec';
import type { TokenVerifier } from '../../domain/ports/token-verifier';
import { SESSION_COOKIE_NAME } from './cookie';
import { createAuthRoutes } from './routes/auth';
import { createDepositInfoRoutes } from './routes/depositInfo';
import { createDigitalDollarsRoutes } from './routes/digitalDollars';
import { createDiagnosticsRoutes } from './routes/diagnostics';
import { createNotificationsRoutes } from './routes/notifications';
import { createTransactionsRoutes } from './routes/transactions';
import { createPortfolioRoutes } from './routes/portfolio';
import { createSendRoutes } from './routes/send';
import { createPaymentRequestsRoutes } from './routes/paymentRequests';
import { createPoolRoutes } from './routes/pool';
import { createWalletBalanceRoutes } from './routes/walletBalance';
import { createSwapRoutes } from './routes/swap';
import { createWalletsRoutes } from './routes/wallets';
import { createWebhookRoutes } from './routes/webhooks';
import { createMetricsRoutes } from './routes/metrics';
import { createFeedbackRoutes } from './routes/feedback';
import type { SubmitFeedback } from '../../application/feedback/submitFeedback';

export interface AppDeps {
  readonly mint: MintSession;
  readonly sessions: SessionCodec;
  /** Present in production; the wallets route needs the same verifier. */
  readonly verify?: TokenVerifier;
  readonly claim?: ClaimWalletsFor;
  /** Absent when no chain readers are wired: the route is then not there. */
  readonly readPortfolio?: ReadPortfolio;
  /**
   * Absent when the pool reader is not wired.
   *
   * `/api/pool` answers with the live reserve and the person's position, and
   * `/api/pool/deposit` with unsigned mainnet transactions. A pool screen with no
   * chain behind it is the screen that invents a rate, so the honest answer to
   * "this deployment cannot read the reserve" is that the route is not there.
   */
  readonly readPool?: ReadPool;
  readonly prepareDeposit?: PrepareDeposit;
  /**
   * Absent when the aggregation is not wired: the route is then not there.
   *
   * One number, and a statement of whether it is the whole truth. A screen that
   * cannot tell a complete total from a partial one is exactly the screen this
   * route exists to prevent, so the honest answer to "this deployment cannot
   * compose a total" is that the route does not exist.
   */
  readonly readDigitalDollars?: ReadDigitalDollars;
  /**
   * Absent when the composition is not wired: the route is then not there.
   *
   * `GET /api/wallet-balance` returns the **whole** balance as two buckets plus
   * a total computed on this side: free crypto at market price, and pool
   * positions. Same reasoning as the routes above, and sharper — this is the
   * number the person looks at first, so an endpoint that answered "not
   * configured", or that answered it as the sum of only the USDC pieces, would
   * be worse than no endpoint.
   */
  readonly readWalletBalance?: ReadWalletBalance;
  /**
   * Absent when the wallet store is not wired: the route is then not there.
   *
   * Same reasoning as the portfolio: a deposit screen without real addresses is
   * the screen that gets somebody's money sent to a place this app cannot claim
   * as theirs. The honest answer to "this deployment has no catalog wired" is
   * that the route does not exist.
   */
  readonly readDepositInfo?: ReadDepositInfo;
  /**
   * Absent when the send use case is not wired: the route is then not there.
   *
   * Same reasoning as the deposit, and sharper: this is the first route that
   * moves money. A send screen with no route behind it can be mistaken, from the
   * outside, for a send that failed — and a browser cannot tell the difference
   * between "this deployment cannot send" and "your send was refused".
   */
  readonly prepareSend?: PrepareSend;

  /**
   * Swap routes: quote, execute, and list supported pairs.
   *
   * Only mounted when the swap use case is wired. A swap screen without a route
   * behind it is a screen that promises conversions it cannot do.
   */
  readonly swapRoutes?: ReturnType<typeof import('./routes/swap').createSwapRoutes>;

  /**
   * La politica de gasto. Va en su propio grupo porque responde **antes** de
   * que la persona firme: la pantalla necesita el veredicto para no ofrecer un
   * botón que no va a llevar a la red.
   */
  readonly policyRoutes?: ReturnType<typeof import('./routes/policy').createPolicyRoutes>;
  /**
   * The charge surface: create, read by id, and pay.
   *
   * Absent when any of the three is not wired, and then the whole surface is
   * absent — the same rule as the pool pair. Creating a charge whose link cannot be
   * paid is the one half of this feature that costs something real: a person shares
   * a link, somebody opens it, and it leads to a 404. The honest answer to "this
   * deployment cannot settle a charge" is that the route is not there.
   */
  readonly createPaymentRequest?: CreatePaymentRequest;
  readonly readPaymentRequest?: ReadPaymentRequest;
  readonly payPaymentRequest?: PayPaymentRequest;
  /** Absent when no signing secret is wired: the intake is then not there. */
  readonly ingestWebhook?: IngestPrivyWebhook;
  readonly readNotifications?: ReadNotifications;
  /** Transactions route: get the person's financial movement history. */
  readonly getTransactions?: GetTransactions;
  /** Absent when the webhook store is not wired: the metrics route is then not there. */
  readonly readMetrics?: ReadPrivyMetrics;
  /** Absent when the contacts store is not wired: the route is then not there. */
  readonly readContacts?: ReadContacts;
  /**
   * Absent when no GitHub token is configured: the feedback route is then not
   * there — a report button that answered 500 would lie about having a tracker.
   */
  readonly submitFeedback?: SubmitFeedback;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createApp = (deps: AppDeps) => {
  const log = deps.log ?? noopLogger;
  const app = new Hono();

  /**
   * What nobody should ever see: a system error with its real message, the failed
   * query, the stack. That goes to telemetry. The person gets an actionable code
   * and nothing else.
   */
  app.onError((error, c) => {
    log.error('unhandled error', error);
    return c.json({ error: { code: 'INTERNAL' } }, 500);
  });

  app.route(
    '/api/auth/session',
    createAuthRoutes({
      mint: deps.mint,
      sessions: deps.sessions,
      cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
      now: deps.now,
      log,
    }),
  );

  /*
   * `/api/wallets/claim` is mounted only when both of its dependencies exist.
   * Not for tidiness: a route that answered "claim is not configured" to a browser
   * that genuinely created a wallet would be indistinguishable, from the outside,
   * from a rejection — and the honest answer to "this deployment cannot verify
   * ownership" is that the route is not there.
   */
  if (deps.verify && deps.claim) {
    app.route('/api/wallets', createWalletsRoutes({ verify: deps.verify, claim: deps.claim, log }));
  }

  /*
   * `/api/portfolio` is mounted when the chain readers are wired. Same reasoning
   * as the claim route: a portfolio route that answered "balances are not
   * configured" would be indistinguishable, from a screen, from a portfolio of
   * zeroes. The honest answer is that the route does not exist.
   */
  if (deps.readPortfolio) {
    app.route(
      '/api/portfolio',
      createPortfolioRoutes({
        sessions: deps.sessions,
        readPortfolio: deps.readPortfolio,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * The pool and its deposit are mounted as one pair, and only when both exist.
   * The deposit route hands out transactions for **mainnet**, real money, so it is
   * not mounted next to a read that cannot answer: a screen with a real rate and
   * no deposit is a smaller feature, while a screen with a deposit and no rate is
   * a deposit nobody priced.
   */
  if (deps.readPool && deps.prepareDeposit) {
    app.route(
      '/api/pool',
      createPoolRoutes({
        sessions: deps.sessions,
        readPool: deps.readPool,
        prepareDeposit: deps.prepareDeposit,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * `/api/digital-dollars` is the composition of the two reads above, and it is
   * mounted when the use case exists. Same reasoning as the portfolio: a total
   * that answered "not configured" would look, from a screen, exactly like a
   * confident zero.
   */
  if (deps.readDigitalDollars) {
    app.route(
      '/api/digital-dollars',
      createDigitalDollarsRoutes({
        sessions: deps.sessions,
        readDigitalDollars: deps.readDigitalDollars,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * `/api/wallet-balance` is **the** balance: two buckets and a total this
   * Worker adds up. Mounted when the use case exists.
   */
  if (deps.readWalletBalance) {
    app.route(
      '/api/wallet-balance',
      createWalletBalanceRoutes({
        sessions: deps.sessions,
        readWalletBalance: deps.readWalletBalance,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * `/api/deposit-info` is the catalog plus this person's real addresses, one per
   * network. Mounted when the use case exists, for the same reason as the
   * portfolio: an answer of "the catalog is not configured" would look, from a
   * deposit screen, exactly like "you have nowhere to receive".
   */
  if (deps.readDepositInfo) {
    app.route(
      '/api/deposit-info',
      createDepositInfoRoutes({
        sessions: deps.sessions,
        readDepositInfo: deps.readDepositInfo,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * `/api/send/prepare`. Mounted only when the use case exists, for the same
   * reason the claim route is mounted on its dependencies: the honest answer to
   * "this deployment cannot move money" is that the route does not exist.
   */
  if (deps.prepareSend) {
    app.route(
      '/api/send',
      createSendRoutes({
        sessions: deps.sessions,
        prepareSend: deps.prepareSend,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * `/api/wallet/swap`. Mounted only when the swap use case is wired.
   * A swap screen without a route is a screen that promises conversions it cannot do.
   */
  if (deps.swapRoutes) {
    app.route('/api/wallet/swap', deps.swapRoutes);
  }

  if (deps.policyRoutes) {
    app.route('/api/wallet/policy', deps.policyRoutes);
  }

  /*
   * `/api/payment-requests`. Mounted when all three use cases exist, for the same
   * reason the claim route is mounted on its dependencies: the honest answer to
   * "this deployment cannot charge" is that the route does not exist, not a 404
   * that looks like a bad link.
   */
  if (deps.createPaymentRequest && deps.readPaymentRequest && deps.payPaymentRequest) {
    app.route(
      '/api/payment-requests',
      createPaymentRequestsRoutes({
        sessions: deps.sessions,
        createPaymentRequest: deps.createPaymentRequest,
        readPaymentRequest: deps.readPaymentRequest,
        payPaymentRequest: deps.payPaymentRequest,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  /*
   * The webhook intake and the feed it feeds are mounted as one pair. The intake
   * exists only to have rows for the feed to read, so a deployment with one
   * without the other is half a feature rather than a smaller one.
   *
   * The intake has no cookie: its credential is the Svix signature. What is
   * *not* mounted without it is an endpoint that would accept anything anybody on
   * the internet sends.
   */
  if (deps.readMetrics) {
    // Counts over the whole table, nothing per person: a status-page fact, public by nature.
    app.route('/api/metrics/privy', createMetricsRoutes({ readMetrics: deps.readMetrics }));
  }

  if (deps.submitFeedback) {
    app.route(
      '/api/feedback',
      createFeedbackRoutes({
        sessions: deps.sessions,
        submit: deps.submitFeedback,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  if (deps.readContacts) {
    app.route(
      '/api/contacts',
      createContactsRoutes({
        sessions: deps.sessions,
        readContacts: deps.readContacts,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  if (deps.ingestWebhook) {
    app.route('/api/webhooks/privy', createWebhookRoutes({ ingest: deps.ingestWebhook, now: deps.now, log }));
  }

  if (deps.readNotifications) {
    app.route(
      '/api/notifications',
      createNotificationsRoutes({
        sessions: deps.sessions,
        readNotifications: deps.readNotifications,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }
  
  if (deps.getTransactions) {
    app.route(
      '/api/transactions',
      createTransactionsRoutes({
        sessions: deps.sessions,
        getTransactions: deps.getTransactions,
        cookieName: deps.cookieName ?? SESSION_COOKIE_NAME,
        now: deps.now,
        log,
      }),
    );
  }

  // TEMPORARY. Removed together with the browser-side Privy problem it explains.
  app.route('/api/diagnostics', createDiagnosticsRoutes({ log }));


  return app;
};