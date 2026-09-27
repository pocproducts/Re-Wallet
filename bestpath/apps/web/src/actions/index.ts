import { BP } from '../core/bp';
import { U } from '../core/utils';
import { Store } from '../core/store';
import { UI } from '../ui';
import { Router } from '../core/router';
import { Flow } from '../flow';
import { DEFAULT_COUNTRY, getCountry, toE164 } from '../components/countries';
import { hasPrivyIsland, requestPrivyLogin, requestPrivyRegister } from '../wire/privy';
import { saveProfileName, saveRecovery } from '../wire/profile';
import { isNotBuilt, requestPaymentRequest } from '../wire/wallet';

/** Copy without the async clipboard API, for insecure origins. */
function fallbackCopy(text, done){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch(e){ console.warn('[BP] no se pudo copiar', e); }
  finally { document.body.removeChild(ta); }
}

/* ---- event delegation ---- */
export const Actions = BP.actions = {

  'go'(el){
    const target = el.dataset.screen;
    if (!target) return;
    const params = el.dataset.mode ? { mode: el.dataset.mode } : {};
    Router.go(target, { transition: el.dataset.transition || 'forward', params });
  },

  'back'(){ Router.back(); },

  'toast'(el){ UI.toast(el.dataset.message || 'Próximamente.', el.dataset.variant || 'info'); },

  async 'biometric'(el){
    const label = el.dataset.label || 'Face ID';
    const mode  = el.dataset.mode  || 'onboarding';

    // `mode` CHOOSES THE CEREMONY, and it has to. Sign-in asserts a passkey
    // that already exists; sign-up creates one. Calling sign-in for a person
    // arriving from onboarding is a WebAuthn request for a credential nothing
    // has produced yet, and it fails as `passkey_not_allowed` — which reads
    // like a broken biometric reader and is actually a sign-in asked where only
    // a sign-up is true. `mode` is read here and used in BOTH worlds below.
    //
    // ── THERE IS NO LOCAL LOGIN ANYMORE ─────────────────────────────────────
    //
    // This used to fall through to a simulated ceremony: a fake modal, then
    // `Store.set({ session: true })` and a jump to home. That path existed for
    // builds with no Privy App ID, and it was the worst thing in the app — not
    // because it was a mock, but because it was a mock that SUCCEEDED. A person
    // with a real passkey who signed in through it got home, with somebody
    // else's name on the profile, and no error anywhere: from the app's point of
    // view the login had worked.
    //
    // So a missing island is now an error the user can see. There is no code
    // path that reports "logged in" without a token from the backend behind it.
    if (!hasPrivyIsland()){
      console.error('[rewallet] login: la isla de passkey no está montada, no hay acceso seguro');
      UI.toast('No pudimos iniciar el acceso seguro. Recargá la página e intentá de nuevo.', 'warning');
      return;
    }

    U.haptic(10);
    try {
      if (mode === 'login') await requestPrivyLogin();
      else await requestPrivyRegister();
    } catch (err) {
      // The bridge already emitted `bp:privy:error` with stage-specific copy
      // and logged the real cause. This toast exists only so the tap visibly
      // did something when no listener is mounted; it must not restate the
      // failure or blame the user's passkey.
      console.warn('[rewallet] login de passkey falló', err);
      // The copy follows the CEREMONY. Telling someone who pressed "Empezar" to
      // "iniciá sesión" is a sentence about the wrong action, and the one case
      // where it really matters is a person who already HAS an account pressing
      // the register button — which is what the logout routing used to do to
      // them, and it is indistinguishable from a broken fingerprint reader.
      UI.toast(
        mode === 'login'
          ? 'No pudimos verificar tu passkey. Intentá de nuevo.'
          : 'No pudimos crear tu cuenta. Si ya tenías una, entrá con tu passkey.',
        'warning',
      );
    }
  },

  'login'(){
    Router.go('passkey', { transition:'forward', params:{ mode:'login' } });
  },

  'switch-account'(){
    Router.stack = [];
    Router.go('welcome', { transition:'fade' });
  },

  'submit-recovery'(el, root){
    const email = root.querySelector('#inp-email').value.trim();
    const phone = root.querySelector('#inp-phone').value.trim();
    if (!U.isEmail(email)){
      root.querySelector('[data-field="email"]').classList.add('is-error');
      root.querySelector('#help-email').textContent = 'Revisa este correo.';
      return;
    }
    if (!navigator.onLine){ UI.toast('Revisa tu conexión para continuar.','warning'); return; }
    el.classList.add('is-loading');
    setTimeout(() => Flow.completeOnboarding({ email, phone }), 700);
  },

  // ── onboarding-v2: single screen saves the whole profile at once ───
  //
  // IT GOES TO THE API NOW. It used to `Store.set(...)` the four fields and call
  // it done, which meant the name and the tag existed only in this browser: the
  // database kept `name = 'ReWallet'` and the provisional `@u…` handle while the
  // phone showed a real identity, and clearing the browser data took it away.
  //
  // The tag in particular cannot be decided here. The screen PREDICTS it with
  // `suggestTag` to show the user what they are about to get, but only the
  // server knows whether that handle is already taken, and `PATCH /me/profile`
  // allocates a unique one. So the value that ends up in the store is the one
  // that came BACK, never the one that was guessed — a client that keeps its own
  // guess ends up showing a handle that belongs to somebody else.
  async 'save-profile'(el, root){
    const first  = root.querySelector('#inp-first').value.trim();
    const last   = root.querySelector('#inp-last').value.trim();
    const email  = root.querySelector('#inp-email').value.trim();
    const nat    = root.querySelector('#inp-phone').value.replace(/\D/g, '');
    const cc     = Store.get().recoveryPhoneCountry || DEFAULT_COUNTRY;
    if (!first || !last || !U.isEmail(email) || nat.length < 7) return;

    if (!navigator.onLine){ UI.toast('Revisa tu conexión para continuar.','warning'); return; }

    const country = getCountry(cc);
    if (!country) return;

    el.classList.add('is-loading');
    try {
      // Name first: it is what allocates the tag, and a tag the recovery step
      // could change would mean two handles for one account.
      const namePatch = await saveProfileName({ firstName: first, lastName: last });
      // Then the recovery contacts, in their own call. A failure HERE must not
      // undo the name: the user would be sent back to a form for an account that
      // is already named, and the tag would be allocated a second time.
      const recoveryPatch = await saveRecovery({
        email,
        phone: toE164(country, nat),
        country: cc,
      });

      Store.set({ ...namePatch, ...recoveryPatch });
      Flow.completeOnboarding();
    } catch (err) {
      // `onboardingComplete` is deliberately NOT latched: it is the flag the
      // logout routing trusts, and setting it on a failed save is how a user ends
      // up told they finished onboarding for a profile the server never saw.
      console.warn('[rewallet] onboarding: no se pudo guardar el perfil', err);
      UI.toast('No pudimos guardar tus datos. Revisá tu conexión e intentá de nuevo.', 'warning');
    } finally {
      el.classList.remove('is-loading');
    }
  },

  'open-add'(){ Flow.openAddMoney(); },
  'retry-add'(el){ Flow.addMoney(parseFloat(el.dataset.amount) || BP.config.defaultAmount, el.dataset.asset || 'USDC'); },
  'retry-send'(){ Flow.sendMoney(); },
  'send'(){ Flow.sendMoney(); },
  'receive'(){ Router.go('receive', { transition:'forward' }); },
  'settings'(){ Router.go('settings', { transition:'forward' }); },

  'copy-tag'(){
    const tag = Store.get().bpTag;
    if (!tag){ UI.toast('Todavía no tenés usuario.','warning'); return; }
    const done = () => { U.haptic(10); UI.toast(`Usuario ${tag} copiado.`, 'success'); };
    // clipboard is unavailable on insecure origins; fall back rather than fail silently
    if (navigator.clipboard && window.isSecureContext){
      navigator.clipboard.writeText(tag).then(done, () => fallbackCopy(tag, done));
    } else {
      fallbackCopy(tag, done);
    }
  },

  'edit-email'(){ Flow.editEmail(); },
  'edit-phone'(){ Flow.editPhone(); },
  'edit-name'(){ Flow.editName(); },
  'edit-recovery'(){ Flow.editRecovery(); },

  'add-contact'(){ Flow.addContact(); },
  'remove-contact'(el){ Flow.removeContact(el.dataset.contactId); },

  'logout'(){ Flow.logout(); },

  'toggle-biometric'(el){
    const s = Store.get();
    const next = !s.settings.biometricEnabled;
    el.setAttribute('aria-checked', String(next));
    Store.setSetting('biometricEnabled', next);
    U.haptic(8);
  },

  async 'share-tag'(){
    const s = Store.get();
    if (navigator.share){
      try { await navigator.share({ title:'Mi ReWallet', text:`Enviame dinero a ${s.bpTag} en ReWallet.` }); } catch(e){}
    } else UI.toast('Compartir no está disponible.','info');
  },

  async 'create-request'(el, root){
    const amountInput = root.querySelector('#req-amount');
    const amount = parseFloat(String(amountInput.value).replace(',','.')) || 0;
    if (amount <= 0){ UI.toast('Ingresá un monto válido.','warning'); return; }
    const s = Store.get();
    el.classList.add('is-loading');
    // A real call, and a real failure. This used to await a mock that returned a
    // URL built from `rewallet.app` — a domain that is not ours, for a route that
    // does not exist — and then showed it in a box the user could copy and share.
    // A shareable payment link that goes nowhere is worse than no link.
    let result: { url?: string };
    try {
      result = await requestPaymentRequest({ amount, tag: s.bpTag });
    } catch (err) {
      el.classList.remove('is-loading');
      UI.toast(
        isNotBuilt(err)
          ? 'Todavía no podemos generar links de pago.'
          : 'No se pudo generar el link.',
        'warning',
      );
      return;
    }
    el.classList.remove('is-loading');
    if (!result?.url){ UI.toast('No se pudo generar el link.','error'); return; }
    const resultBox = root.querySelector('[data-request-result]');
    const urlEl = root.querySelector('[data-request-url]');
    urlEl.textContent = result.url;
    resultBox.classList.remove('hidden');
    U.haptic(10);
  },
  async 'copy-request'(el, root){
    const url = root.querySelector('[data-request-url]').textContent;
    try { await navigator.clipboard.writeText(url); UI.toast('Link copiado.','success'); }
    catch(e){ UI.toast('No se pudo copiar.','error'); }
  },
  async 'share-request'(el, root){
    const url = root.querySelector('[data-request-url]').textContent;
    const amount = parseFloat(String(root.querySelector('#req-amount').value).replace(',','.')) || 0;
    if (navigator.share){
      try { await navigator.share({ title:'Pedido de pago', text:`Te pido ${U.money(amount)} por ReWallet: ${url}` }); } catch(e){}
    } else UI.toast('Compartir no está disponible.','info');
  },

  'tab'(el){
    const tab = el.dataset.tab;
    const current = Router.current?.dataset.screen;
    if (tab === 'home'){
      if (current !== 'home') Router.replace('home', { transition:'fade' });
      return;
    }
    if (tab === 'activity'){
      if (current !== 'activity') Router.replace('activity', { transition:'fade' });
      return;
    }
    if (tab === 'account'){
      if (current !== 'settings') Router.go('settings', { transition:'forward' });
    }
  }
};

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const handler = Actions[action];
  if (!handler) return;
  e.preventDefault();
  const root = el.closest('.screen') || document;
  handler(el, root);
});
