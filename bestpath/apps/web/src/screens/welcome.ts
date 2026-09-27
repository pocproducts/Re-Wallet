import { Router } from '../core/router';
import { Icons } from '../components/icons';

/* ---- screen: welcome ---- */
/* ---------- Pantalla 1: Bienvenida ---------- */
Router.register('welcome', {
  transition:'fade',
  render(){
    return `
      <div class="grow"></div>
      <div class="text-center" style="animation:fadeUp var(--duration-slow) var(--easing-decelerate) both">
        <div class="illo" style="width:78px;height:78px;margin:0 auto var(--space-4);border-radius:22px;background:rgba(59,172,40,.10)">${Icons.logo}</div>
        <div class="wordmark"><span class="wordmark__re">RE</span><span class="wordmark__wallet">WALLET</span></div>
      </div>
      <div style="height:var(--space-12)"></div>
      <div class="text-center" style="animation:fadeUp var(--duration-slow) var(--easing-decelerate) 80ms both">
        <h1 class="t-h1">Tu dinero,<br>siempre creciendo.</h1>
        <p class="t-body t-secondary mt-4">Sin frases semilla.<br>Sin comisiones ocultas.</p>
      </div>
      <div class="grow" style="flex:1.3"></div>
      <div class="stack stack-4" style="animation:fadeUp var(--duration-slow) var(--easing-decelerate) 160ms both">
        <button class="btn btn--primary btn--lg btn--block" data-action="go" data-screen="passkey" data-mode="onboarding">Empezar</button>
        <div class="text-center">
          <button class="link" data-action="login">Ya tengo una cuenta</button>
        </div>
      </div>`;
  }
});
