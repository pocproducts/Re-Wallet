import { BP } from './core/bp';
import { Store } from './core/store';
import { UI } from './ui';
import { Router } from './core/router';
import { Flow } from './flow';
import { shouldResetOnBoot } from './config';
import { hydrateFromSession, refreshPositionAndMovements, WalletApiError } from './wire/wallet';
import { PRIVY_EVENTS } from './wire/privy';
import type { ApiSession } from './wire/mapper';

/* ---- who is logged in ---- */

/**
 * How long the app is willing to stare at an empty screen before it renders.
 *
 * The session is an httpOnly cookie, so there is exactly one way to find out
 * whether anybody is logged in: ask the server. That is not a workaround, it is
 * the only source of truth — the alternative the prototype used, a `session`
 * flag in localStorage, is a claim the browser is not in a position to back and
 * that `wire/privy.ts` deliberately refuses to write.
 *
 * Asking costs a round trip, and a round trip with no ceiling is a blank app
 * forever when the API is down. So the probe is BOUNDED: past this we render
 * from whatever the local state says and report the miss. A slow API costs a
 * beat of blank screen; a dead one costs the same beat, not the whole session.
 */
const SESSION_PROBE_TIMEOUT_MS = 1500;

/**
 * The outcome of asking the server who is logged in.
 *
 * THREE states, not two, and the third is the reason this is a type instead of
 * a boolean: "the server says nobody" and "I could not reach the server" lead to
 * OPPOSITE routes. Collapsing them into `session | null` means an API that is
 * merely down logs every user out of their own wallet — the single worst thing
 * a wallet app can do on a flaky network.
 */
type SessionProbe =
  | { status: 'session'; session: ApiSession }
  | { status: 'anonymous' }
  | { status: 'unknown' };

/**
 * `GET /auth/session`, bounded.
 *
 * `anonymous` is reserved for a 401 — an actual answer. Everything else is
 * `unknown`: offline, the API not running, a timeout, a malformed payload, a
 * 500. The distinction is deliberate and the caller has one decision to make per
 * state; an error here must never be the reason a user cannot open a wallet.
 */
async function probeSession(): Promise<SessionProbe> {
  try {
    const session = await Promise.race<ApiSession | null>([
      hydrateFromSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_PROBE_TIMEOUT_MS)),
    ]);
    return session ? { status: 'session', session } : { status: 'anonymous' };
  } catch (err) {
    if (err instanceof WalletApiError && err.isUnauthorized) return { status: 'anonymous' };
    // Logged, never surfaced: the app stays fully usable in local mode.
    console.warn('[rewallet] session probe failed', err);
    return { status: 'unknown' };
  }
}

/* ---- reacting to auth from the vanilla side ---- */

/**
 * A successful login hydrates the store with `{ user, wallet }` and routes, but
 * that envelope carries NO movements — the list is its own endpoint. Without
 * this, a first login lands on home with a real balance and the prototype's
 * movements, which is the worst kind of mixed truth: the number on screen is
 * real and the history under it is fiction.
 *
 * It lives HERE, on the vanilla side, listening to the event the bridge already
 * emits, rather than as a call inside `wire/privy.ts`. That is the same seam
 * rule the island follows: events carry state outward, and the module that
 * owns the store reacts to it. A failure is logged, never surfaced: the balance
 * is already correct, and an empty activity list is honest where a wrong one is
 * not.
 */
window.addEventListener(PRIVY_EVENTS.authenticated, () => {
  void refreshPositionAndMovements().catch((err) => {
    console.warn('[rewallet] no se pudieron cargar los movimientos', err);
  });
});

/* ---- the Privy island ---- */

/**
 * The Preact island that hosts `@privy-io/react-auth`, or `null` while it is
 * not mounted (no `VITE_PRIVY_APP_ID`, or the mount is still in flight).
 *
 * Held at module level so the mount happens exactly once per boot and so the
 * unmount function is reachable: re-mounting per navigation would orphan the
 * previous tree and take a live WebAuthn ceremony with it.
 */
let unmountPrivyIsland: (() => void) | null = null;

/**
 * Mount the Privy island, if there is one to mount.
 *
 * THE IMPORT IS DYNAMIC, AND THAT IS THE POINT. The island is the only `.tsx`
 * file in the app and it drags in Preact plus the whole Privy SDK. A static
 * import would put all of that in the boot graph of a build that has no Privy
 * App ID configured — a login nobody can use, billed as startup cost. The
 * dynamic import keeps the SDK out of the module graph until something actually
 * needs it, and `mountPrivyIsland` itself returns `null` when the App ID is
 * blank.
 *
 * It is mounted ONCE, here, and deliberately NOT inside a screen render: the
 * router replaces the children of `#screens` on every navigation, so an island
 * parented there would be destroyed by the first `Router.go`, taking the Privy
 * context and the in-flight WebAuthn ceremony with it. `.app` is the shell, a
 * SIBLING of `#screens`, so navigation cannot reach it.
 *
 * A failure here must never stop the app from booting: an app with no login is
 * strictly better than an app that does not start. Both boot paths call this,
 * because a mount missing from the dev path is login that is silently dead in
 * exactly the flow a developer exercises.
 */
async function mountPrivyIslandOnce(): Promise<void> {
  if (unmountPrivyIsland) return;
  try {
    const island = await import('./wire/privy-island');
    const host = document.querySelector<HTMLElement>('.app') ?? document.getElementById('device');
    if (!host) {
      console.warn('[rewallet] privy: no hay contenedor para la isla de passkey');
      return;
    }
    unmountPrivyIsland = island.mountPrivyIsland(host);
  } catch (err) {
    console.warn('[rewallet] privy: la isla de passkey no se montó', err);
  }
}

/* ---- boot ---- */

/** Console helpers, available in dev for poking at the running app. */
function attachDebug(){
  (window as any).BP.debug = {
    state: () => Store.get(),
    reset: () => { Flow.stopYieldTicker(); Store.reset(); location.reload(); },
    addFunds: (n) => Flow.addMoney(n || 500, 'USDC'),
    send: (n) => Flow.sendMoney()
  };
}

export function boot(){
  // Dev convenience: start every `pnpm dev` from zero. Guarded in config so a
  // production build can never wipe real state.
  if (shouldResetOnBoot()) {
    Store.reset();
    console.info('[rewallet] dev: estado reiniciado, arrancás desde welcome.');
  }

  const state = Store.load();

  const syncConnection = () => {
    if (!navigator.onLine) UI.banner('Revisa tu conexión para continuar.','warning');
    else UI.clearBanner();
    document.querySelectorAll<HTMLButtonElement>('[data-action="open-add"]').forEach(btn => { btn.disabled = !navigator.onLine; });
  };
  window.addEventListener('online', syncConnection);
  window.addEventListener('offline', syncConnection);

  // Onboarding is multi-step now (passkey -> profile -> email -> phone), so a
  // user who abandoned halfway resumes on the step they reached instead of
  // being sent back to the welcome screen.
  const resume = (): string => {
    // Single screen now, so the only thing worth resuming is a profile that
    // was partially filled before.
    return 'onboarding';
  };

  // Both boot paths below start the island. It is fire-and-forget: login becomes
  // available a tick later, and nothing in the first render depends on it.
  void mountPrivyIslandOnce();

  if (shouldResetOnBoot()){
    // Dev: the full first-run flow is exercised on every restart, so always begin
    // at welcome rather than wherever the previous session happened to stop.
    // The session probe is deliberately SKIPPED for ROUTING here: a developer
    // with a real cookie would otherwise be routed into the app they came to
    // reset.
    Router.go('welcome', { transition:'fade' });
    setTimeout(syncConnection, 600);
    if (state.balance > 0 && state.session) Flow.startYieldTicker();
    Flow.startTimeRefresher();
    attachDebug();
    // It still runs, though, for HYDRATION only. A reload in dev wipes the
    // store, and without this the app comes back holding zeros while the
    // server holds a real balance: the number the developer is staring at is
    // wrong, and nothing says so.
    void probeSession().then((probe) => {
      if (probe.status === 'session') {
        console.info('[rewallet] dev: sesión real detectada, el store se rehidrató (la pantalla sigue siendo welcome).');
        void refreshPositionAndMovements().catch((err) => {
          console.warn('[rewallet] dev: no se pudieron cargar los movimientos', err);
        });
      }
    });
    return;
  }

  // From here the SERVER decides who is logged in, because the cookie is
  // httpOnly and the local `state.session` flag is a claim the browser cannot
  // back. Rendering first and correcting afterwards would flash the welcome
  // screen at a signed-in user — which reads as "you have been logged out" —
  // so the probe is awaited, bounded by SESSION_PROBE_TIMEOUT_MS.
  void probeSession().then((probe) => {
    if (probe.status === 'session'){
      // The store was already hydrated by the probe, atomically.
      const hydrated = Store.get();
      Router.init(hydrated.onboardingComplete ? 'home' : resume());
      setTimeout(syncConnection, 600);
      Flow.startTimeRefresher();
      attachDebug();
      // Movements are a separate call and deliberately NOT awaited: the balance
      // is already real, and the activity list filling in a beat later is
      // invisible next to a correct balance.
      void refreshPositionAndMovements().catch((err) => {
        console.warn('[rewallet] no se pudo refrescar la wallet', err);
      });
      // NO YIELD TICKER. With the backend owning the balance, a local ticker
      // invents money the server does not have and shows it growing: the exact
      // lie a wallet app must never tell. The prototype's ticker is decoration
      // for mock balances, and mock balances are the only place it is honest.
      return;
    }

    if (probe.status === 'anonymous'){
      // A real answer: nobody is logged in. Welcome is the truth, and the local
      // `state.session` flag — which the prototype ships as `true` — is ignored.
      Router.init('welcome');
      setTimeout(syncConnection, 600);
      Flow.startTimeRefresher();
      attachDebug();
      return;
    }

    // The API could not be reached. Fall back to the local routing rather than
    // declaring the user logged out: an unreachable server is not evidence of
    // anything, and the mock mode still works.
    console.info('[rewallet] session probe sin respuesta: se usa el estado local.');
    startFromLocalState(state, resume, syncConnection);
  });
}

/**
 * The pre-API routing, kept as-is for the case where the API cannot be reached.
 *
 * This is the only place that still believes `state.session`, and that is the
 * point: it is the degradation path, not the happy one.
 */
function startFromLocalState(state: ReturnType<typeof Store.load>, resume: () => string, syncConnection: () => void){
  let startName = 'welcome';
  let startOpts = { transition:'fade' };

  if (state.onboardingComplete && state.session){
    startName = 'home';
  } else if (state.onboardingComplete && !state.session){
    startName = 'passkey';
    startOpts = { transition:'fade', params:{ mode:'login' } } as any;
  } else if (state.session){
    // signed in but never finished onboarding
    startName = resume();
  }

  attachDebug();

  if (startName === 'passkey'){
    Router.go('passkey', startOpts);
  } else {
    Router.init(startName);
  }

  setTimeout(syncConnection, 600);
  if (state.balance > 0 && state.session) Flow.startYieldTicker();
  Flow.startTimeRefresher();

  console.info(`%cReWallet v${BP.config.version}`,
    'color:#3BAC28;font-weight:600;font-size:12px',
    '\nFase 3 + fix de navegación.');
}
