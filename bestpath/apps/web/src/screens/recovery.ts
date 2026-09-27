import { U } from '../core/utils';
import { Router } from '../core/router';
import { Icons } from '../components/icons';

/* ---- screen: recovery ---- */
Router.register('recovery', {
  transition:'forward',
  render(){
    return `
      <div class="screen-head"><button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button><span></span></div>
      <div class="mt-4">
        <h1 class="t-h1" style="font-size:26px">Protege tu cuenta</h1>
        <p class="t-body t-secondary mt-3">Si pierdes tu teléfono, podemos ayudarte a recuperar tu cuenta con esto.</p>
      </div>
      <div class="mt-6">
        <div class="field" data-field="email">
          <input class="field__input" type="email" id="inp-email" placeholder=" " autocomplete="email" inputmode="email" aria-describedby="help-email">
          <label class="field__label" for="inp-email">tu@correo.com</label>
        </div>
        <div class="field__helper" id="help-email"></div>
        <div class="field" data-field="phone" style="margin-top:var(--space-4)">
          <input class="field__input" type="tel" id="inp-phone" placeholder=" " autocomplete="tel" inputmode="tel">
          <label class="field__label" for="inp-phone">+54 11 0000 0000 · opcional</label>
        </div>
        <div class="field__helper"></div>
      </div>
      <div class="grow"></div>
      <div class="stack stack-3">
        <button class="btn btn--primary btn--lg btn--block" data-action="submit-recovery" disabled>Continuar</button>
        <p class="t-caption t-tertiary text-center">Puedes cambiarlo después.</p>
      </div>`;
  },
  onMount(root){
    const emailField = root.querySelector('[data-field="email"]');
    const emailInput = root.querySelector('#inp-email');
    const emailHelp  = root.querySelector('#help-email');
    const submit     = root.querySelector('[data-action="submit-recovery"]');
    const validate = () => {
      const email = emailInput.value.trim();
      const valid = U.isEmail(email);
      emailField.classList.toggle('is-error', email.length > 0 && !valid);
      emailHelp.textContent = email.length === 0 ? '' : valid ? '' : 'Revisa este correo.';
      submit.disabled = !valid || !navigator.onLine;
      submit.textContent = !navigator.onLine ? 'Sin conexión' : 'Continuar';
    };
    emailInput.addEventListener('input', validate);
    emailInput.addEventListener('blur', validate);
    validate();
    setTimeout(() => emailInput.focus({preventScroll:true}), 420);
  }
});
