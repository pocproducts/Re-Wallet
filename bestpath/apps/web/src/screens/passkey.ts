import { Router } from '../core/router';
import { Icons } from '../components/icons';
import { detectBiometricLabel } from './shared';

/* ---- screen: passkey ---- */
Router.register('passkey', {
  transition:'forward',
  render(params: any = {}){
    // THE DEFAULT IS 'login', and it used to be 'onboarding'. That single word
    // is what locked a real user out: any navigation to this screen that forgot
    // to say which ceremony it wanted got a REGISTER button, `signupWithPasskey`
    // refuses a credential that already exists, and the user is told their
    // fingerprint reader is broken. The two ceremonies are not
    // interchangeable — one asserts an existing credential, the other creates
    // one — and the harmless default is the one that can only ever fail.
    const mode = params.mode === 'onboarding' ? 'onboarding' : 'login';
    const isLogin = mode === 'login';
    const platform = detectBiometricLabel();

    if (isLogin){
      return `
        <div class="screen-head"><span></span><span></span></div>
        <div class="grow" style="flex:.6"></div>
        <div class="text-center">
          <div class="illo" style="width:110px;height:110px;margin:0 auto">
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--rw-brand-500)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2"/>
              <path d="M9 10v1.5M15 10v1.5M9.5 15a3.5 3.5 0 0 0 5 0"/>
            </svg>
          </div>
          <h1 class="t-h1 mt-6" style="font-size:26px">Hola de nuevo.</h1>
          <p class="t-body t-secondary mt-3">Verificá tu identidad<br>para volver a entrar.</p>
        </div>
        <div class="grow" style="flex:1.4"></div>
        <div class="stack stack-4">
          <button class="btn btn--primary btn--lg btn--block" data-action="biometric" data-label="${platform}" data-mode="login">Usar ${platform}</button>
          <div class="text-center"><button class="link" data-action="biometric" data-label="PIN" data-mode="login">Usar PIN en su lugar</button></div>
          <div class="text-center mt-2"><button class="link" style="font-size:13px;color:var(--rw-text-tertiary)" data-action="switch-account">Usar otra cuenta</button></div>
        </div>`;
    }

    return `
      <div class="screen-head"><button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button><span></span></div>
      <div class="grow" style="flex:.6"></div>
      <div class="text-center">
        <div class="illo" style="width:110px;height:110px;margin:0 auto">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--rw-brand-500)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2"/>
            <path d="M9 10v1.5M15 10v1.5M9.5 15a3.5 3.5 0 0 0 5 0"/>
          </svg>
        </div>
        <h1 class="t-h1 mt-6" style="font-size:26px">Entra con tu cara<br>o tu huella.</h1>
        <p class="t-body t-secondary mt-3">Tu dispositivo guarda tu<br>llave. Nosotros no la vemos.</p>
      </div>
      <div class="grow" style="flex:1.4"></div>
      <div class="stack stack-4">
        <button class="btn btn--primary btn--lg btn--block" data-action="biometric" data-label="${platform}" data-mode="onboarding">Usar ${platform}</button>
        <div class="text-center"><button class="link" data-action="biometric" data-label="PIN" data-mode="onboarding">Usar PIN en su lugar</button></div>
      </div>`;
  }
});

