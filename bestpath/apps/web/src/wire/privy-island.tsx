/**
 * The Preact island.
 *
 * WHY PREACT AT ALL
 *
 * `@privy-io/react-auth` is a React library. Rewriting 139 passing tests of
 * vanilla TypeScript into React to use a login SDK would be a terrible trade,
 * so instead the SDK is aliased onto Preact's compat layer (see
 * `resolve.alias` in vite.config.ts) and mounted into ONE container div.
 *
 * This is the only `.tsx` file in the app. The rest of the UI does not know
 * this file exists.
 *
 * ── Where the container goes ───────────────────────────────────────────────
 *
 * A dedicated div, created at runtime, kept in a module-level variable, and
 * appended to the app shell — never to `document.body` reused by force, and
 * never inside a `section.screen`. The router REPLACES the children of
 * `#screens` on every navigation and removes the old screen 420ms later, so an
 * island parented there would be unmounted by the first `Router.go`, taking the
 * Privy context and the in-flight WebAuthn ceremony with it. The island has to
 * outlive navigation to be worth anything; that is the whole design constraint.
 *
 * `index.html` is out of scope for this change, so the container is created
 * here at mount time rather than declared in the markup. See the report: the
 * one-line call that mounts it belongs in `boot.ts`, which was not editable.
 *
 * ── What this file does NOT do ─────────────────────────────────────────────
 *
 * It does not touch the Store, does not call the Router, and does not know what
 * a session is. It asks Privy for a token, hands the token to `wire/privy.ts`,
 * and reports outcomes as `CustomEvent`s on `window`. Everything that touches
 * persistent state lives on the other side of that boundary, in the only
 * language the rest of the app speaks.
 */

import { PrivyProvider, useLoginWithPasskey, useLogout, usePrivy } from '@privy-io/react-auth';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import {
  emitPrivyError,
  emitPrivyReady,
  endPrivySession,
  exchangePrivyToken,
  formatPrivyError,
  setPrivyIslandHandle,
  type PrivyIslandHandle,
} from './privy';

/**
 * Privy App ID. Blank in a build without the env var, which is why
 * `mountPrivyIsland` refuses to mount rather than throwing inside a React
 * render: a login island that is present but inert is invisible, one that
 * crashes the boot is not.
 */
const rawAppId = import.meta.env.VITE_PRIVY_APP_ID;
const APP_ID: string = typeof rawAppId === 'string' ? rawAppId.trim() : '';

/**
 * Privy client config.
 *
 * `embeddedWallets.createOnLogin: 'off'` IS A SECURITY DECISION, not a default
 * (decision D1: the backend is the custodian). An embedded wallet would put a
 * signing key in the browser under Privy's management, for an app that never
 * signs anything client-side — pure attack surface, zero utility. 'off' is
 * also what makes the SDK's `onComplete` fire at WebAuthn success instead of
 * after a wallet-creation prompt the user does not need.
 */
const PRIVY_CONFIG = {
  loginMethods: ['passkey' as const],
  embeddedWallets: {
    ethereum: { createOnLogin: 'off' as const },
    solana: { createOnLogin: 'off' as const },
  },
};

/**
 * The one component in the app.
 *
 * Renders NOTHING. It exists to hold the Privy context and to turn SDK
 * callbacks into the four `bp:privy:*` events. No passkey UI is drawn here:
 * the passkey screen is existing vanilla markup with an existing
 * `data-action`, and replacing it with a React tree is the migration this task
 * explicitly is not.
 */
function PrivyBridge(): null {
  const { ready, error, getAccessToken } = usePrivy();
  const { loginWithPasskey } = useLoginWithPasskey({
    /**
     * WebAuthn succeeded. That is NOT yet a session.
     *
     * The SDK's `onComplete` hands over `{ user, isNewUser, loginMethod }` and
     * no token at all — the access token is a separate `getAccessToken()` call.
     * Anyone who assumed `onComplete` carried an `idToken` would send
     * `undefined` to the backend and get a 401 they cannot debug.
     *
     * `isNewUser` is deliberately NOT forwarded as truth: the backend owns the
     * user table and decides register-vs-login itself. The SDK's opinion is
     * only used for logging.
     */
    onComplete: ({ user, isNewUser }) => {
      void (async () => {
        try {
          const accessToken = await getAccessToken();
          if (typeof accessToken !== 'string' || accessToken.length === 0) {
            throw new Error('privy returned no access token');
          }
          // The token goes into `wire/privy.ts` and does not come back out.
          // That function hydrates the store from the BACKEND's response and
          // emits `bp:privy:authenticated` only once the store is whole.
          await exchangePrivyToken(accessToken);
        } catch (err) {
          // Stage 'token', not 'login': WebAuthn already passed. Telling the
          // user to "revisa tu passkey" when the passkey was fine sends them
          // to retry the thing that is not broken.
          console.info('[rewallet] privy: passkey ok, token exchange failed', { isNewUser, userId: user?.id });
          emitPrivyError('token', formatPrivyError(err, 'token'));
        }
      })();
    },
    onError: (err) => {
      // A rejected assertion, a cancelled prompt, a missing platform
      // authenticator — all of them are "login failed" to the user.
      emitPrivyError('login', formatPrivyError(err, 'login'));
    },
  });

  const { logout } = useLogout();

  useEffect(() => {
    // `ready` is Privy's own "the client has finished initialising" flag. It is
    // NOT "the user is authenticated": emitting `ready` there would be a lie
    // the rest of the app would act on.
    if (ready) emitPrivyReady(APP_ID);
  }, [ready]);

  useEffect(() => {
    if (error) emitPrivyError('init', formatPrivyError(error, 'init'));
  }, [error]);

  /**
   * Publish the imperative handle.
   *
   * Direction matters: events flow island → vanilla, and COMMANDS flow back
   * vanilla → island. The vanilla code calls `requestPrivyLogin()` /
   * `requestPrivyLogout()` from `wire/privy.ts` and never imports this file,
   * which keeps Preact out of the import graph of every screen.
   */
  useEffect(() => {
    const handle: PrivyIslandHandle = {
      login: () => loginWithPasskey(),
      logout: async () => {
        // End the Privy session FIRST. If this throws, the local ceremony is
        // still alive and the honest thing to do is leave the user signed in
        // rather than navigate away from a passkey that still works.
        await logout();
        await endPrivySession();
      },
    };
    return setPrivyIslandHandle(handle);
  }, [loginWithPasskey, logout]);

  return null;
}

const ISLAND_ID = 'bp-privy-island';

/**
 * The single mount point. Returns `null` when there is no App ID, so a build
 * without Privy configured still boots — it just has no login.
 */
export function mountPrivyIsland(host?: HTMLElement): (() => void) | null {
  if (APP_ID.length === 0) {
    console.info('[rewallet] privy: sin VITE_PRIVY_APP_ID, la isla de passkey no se monta.');
    return null;
  }

  // `null` means mount nowhere, and that is the point of the variable: a
  // container that is looked up again on every render is a container that can
  // be re-created behind Preact's back and silently orphan the previous tree.
  let container: HTMLDivElement | null = null;

  const resolveHost = (): HTMLElement => {
    if (host) return host;
    // The app shell, so the island is a sibling of the screens rather than a
    // child of one. `.app` is the shell in index.html; `#device` is the
    // fallback for a host page that only has the outer frame.
    const shell = document.querySelector<HTMLElement>('.app') ?? document.getElementById('device');
    return shell ?? document.body;
  };

  const target = resolveHost();

  // Guard the invariant rather than trusting it: the router owns the subtree
  // under `#screens` and destroys it on every navigation, so a container
  // parented there is a bug that only shows up as "the passkey screen stopped
  // working after I logged in".
  if (target.closest('section.screen') || target.id === 'screens') {
    throw new Error('[rewallet] privy: el contenedor no puede montarse dentro de un screen');
  }

  container = document.createElement('div');
  container.id = ISLAND_ID;
  container.dataset.privyIsland = '1';
  // Not `display:none`: Privy renders modal layers and the hCaptcha/Turnstile
  // iframes that must be able to lay out and receive pointer events.
  target.appendChild(container);

  const root = createRoot(container);
  root.render(
    <PrivyProvider appId={APP_ID} config={PRIVY_CONFIG}>
      <PrivyBridge />
    </PrivyProvider>,
  );

  return () => {
    root.unmount();
    container?.remove();
    container = null;
  };
}
