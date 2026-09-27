import { U } from '../core/utils';
import { Router } from '../core/router';
import { Store } from '../core/store';
import { BP } from '../core/bp';
import { Icons } from '../components/icons';
import { pickCountry } from '../components/countryPicker';
import { COUNTRIES, DEFAULT_COUNTRY, getCountry, toE164 } from '../components/countries';
import { normalizeTag, suggestTag, isValidTag, toDisplayTag } from '@bestpath/shared/tag';

/* ---- screen: onboarding ---- */
/**
 * First-run screen. Fields carry their label as a PLACEHOLDER rather than a
 * floating caption, so the form reads as four short rows instead of a stack of
 * captioned inputs. The only field with a real title is the tag, because it is
 * generated rather than typed and needs explaining.
 *
 *   fila 1  nombre + apellido        (placeholders, no titles)
 *   fila 2  tu correo                (placeholder)
 *   fila 3  tu usuario               (the one titled row: generated, not typed)
 *   fila 4  país + código + número
 *   fila 5  continuar
 *
 * The tag is derived from the name as it is typed and checked for availability.
 * The user never picks one: on the server the sequence plus the UNIQUE index own
 * that decision, and a client-side guess could disagree with what they get.
 */
Router.register('onboarding', {
  transition:'forward',
  render(){
    const s = Store.get();
    const country = getCountry(s.recoveryPhoneCountry) ?? getCountry(DEFAULT_COUNTRY)!;
    const generated = suggestTag([s.firstName, s.lastName].filter(Boolean).join(' '));

    return `
      <div class="screen-head">
        <button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button>
        <span class="screen-head__title">Tu perfil</span>
      </div>

      <div class="mt-4">
        <h1 class="t-h1" style="font-size:26px">Completá tu perfil</h1>
        <p class="t-body t-secondary mt-2">Solo lo justo para que tus contactos te reconozcan y recuperes tu cuenta.</p>
      </div>

      <!-- fila 1: nombre y apellido, dos columnas, placeholder como título -->
      <div class="grid-2 mt-6">
        <input class="field-plain" type="text" id="inp-first" placeholder="Nombre"
               autocomplete="given-name" autocapitalize="words" value="${U.esc(s.firstName || '')}">
        <input class="field-plain" type="text" id="inp-last" placeholder="Apellido"
               autocomplete="family-name" autocapitalize="words" value="${U.esc(s.lastName || '')}">
      </div>

      <!-- fila 2: correo -->
      <input class="field-plain mt-3" type="email" id="inp-email" placeholder="Tu correo"
             autocomplete="email" inputmode="email" value="${U.esc(s.recoveryEmail || '')}">

      <!-- fila 3: tag generado — la única fila con título, porque no se escribe -->
      <div class="tag-readonly mt-5">
        <div class="field-plain__label">Tu usuario</div>
        <div class="tag-readonly__row" data-tag-row>
          <span class="tag-readonly__handle t-mono" data-tag-value>${U.esc(toDisplayTag(generated) || '@…')}</span>
          <span class="tag-readonly__state" data-tag-state></span>
        </div>
        <p class="t-caption t-tertiary mt-2" data-tag-help>Lo creamos a partir de tu nombre.</p>
      </div>

      <!-- fila 4: país + código de área + número -->
      <div class="phone-row mt-4">
        <button class="phone-row__country" data-action="pick-country" aria-label="Elegir país">
          <span data-country-flag>${country.flag}</span>
          <span class="phone-row__dial">+${country.dial}</span>
          <span class="phone-row__chevron">${Icons.chevronDown}</span>
        </button>
        <input class="field-plain phone-row__number" type="tel" id="inp-phone"
               placeholder="Número" autocomplete="tel-national" inputmode="tel">
      </div>
      <p class="t-caption t-tertiary mt-2" data-e164-preview></p>

      <div class="grow"></div>
      <div class="stack stack-3">
        <button class="btn btn--primary btn--lg btn--block" data-action="save-profile" disabled>Continuar</button>
        <p class="t-caption t-tertiary text-center">Podés cambiar todo esto después en tu perfil.</p>
      </div>`;
  },

  onMount(root){
    const first = root.querySelector('#inp-first') as HTMLInputElement;
    const last  = root.querySelector('#inp-last')  as HTMLInputElement;
    const email = root.querySelector('#inp-email') as HTMLInputElement;
    const phone = root.querySelector('#inp-phone') as HTMLInputElement;
    const submit = root.querySelector('[data-action="save-profile"]') as HTMLButtonElement;

    const tagValue  = root.querySelector('[data-tag-value]') as HTMLElement;
    const tagState  = root.querySelector('[data-tag-state]')  as HTMLElement;
    const tagRow    = root.querySelector('[data-tag-row]')    as HTMLElement;
    const tagHelp   = root.querySelector('[data-tag-help]')   as HTMLElement;
    const e164El    = root.querySelector('[data-e164-preview]') as HTMLElement;

    const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' -]{0,49}$/u;
    let countryCode = Store.get().recoveryPhoneCountry || DEFAULT_COUNTRY;
    let tagAvailable: boolean | null = null;
    let checkedTag = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const national = () => phone.value.replace(/\D/g, '');
    const phoneOk  = () => { const n = national(); return n.length >= 7 && n.length <= 15; };
    const tagOf    = () => suggestTag([first.value, last.value].filter(Boolean).join(' '));

    // ── tag: derived from the name, availability asked of the server ────
    const checkTag = () => {
      const value = tagOf();
      if (!value || value === checkedTag) { paint(); return; }
      if (!isValidTag(value)) { tagAvailable = false; paint(); return; }
      void BP.api.checkTag(value).then((res: any) => {
        if (!res || res.ok !== true) return;
        checkedTag = value;
        tagAvailable = res.available === true;
        // If the derived handle is taken, show what the server would hand out.
        if (!res.available && res.suggestion) {
          tagValue.textContent = toDisplayTag(res.suggestion);
        } else {
          tagValue.textContent = toDisplayTag(value);
        }
        paint();
      });
    };

    const scheduleCheck = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(checkTag, 320);
    };

    // ── paint ────────────────────────────────────────────────────────────
    const paint = () => {
      const f = first.value.trim();
      const l = last.value.trim();
      const e = email.value.trim();
      const n = national();
      const t = tagOf();

      const fOk = f.length > 0 && NAME_RE.test(f);
      const lOk = l.length > 0 && NAME_RE.test(l);
      const eOk = U.isEmail(e);
      const pOk = phoneOk();
      const tOk = isValidTag(t) && tagAvailable !== false;

      first.classList.toggle('is-error', f.length > 0 && !fOk);
      last.classList.toggle('is-error', l.length > 0 && !lOk);
      email.classList.toggle('is-error', e.length > 0 && !eOk);
      phone.classList.toggle('is-error', n.length > 0 && !pOk);

      if (t && t !== checkedTag) {
        tagValue.textContent = toDisplayTag(t);
        tagAvailable = null;
      }
      tagRow.classList.toggle('is-error', t.length > 0 && !tOk);
      if (!t){
        tagState.textContent = '';
        tagHelp.textContent = 'Lo creamos a partir de tu nombre.';
      } else if (tagAvailable === true){
        tagState.textContent = '✓';
        tagState.className = 'tag-readonly__state is-ok';
        tagHelp.textContent = 'Ese usuario está libre.';
      } else if (tagAvailable === false){
        tagState.textContent = '!';
        tagState.className = 'tag-readonly__state is-taken';
        tagHelp.textContent = 'Ese nombre ya está en uso, probá con el apellido.';
      } else {
        tagState.textContent = '';
        tagState.className = 'tag-readonly__state';
        tagHelp.textContent = 'Lo creamos a partir de tu nombre.';
      }

      if (e164El) {
        const country = getCountry(countryCode) ?? COUNTRIES[0]!;
        e164El.textContent = pOk ? `Se guardará como ${toE164(country, n)}` : '';
      }

      submit.disabled = !(fOk && lOk && eOk && pOk && tOk) || !navigator.onLine;
      submit.textContent = !navigator.onLine ? 'Sin conexión' : 'Continuar';
    };

    // ── wiring ───────────────────────────────────────────────────────────
    const onName = () => { tagValue.textContent = toDisplayTag(tagOf() || '') || '@…'; scheduleCheck(); paint(); };
    first.addEventListener('input', onName);
    last.addEventListener('input', onName);
    email.addEventListener('input', paint);
    phone.addEventListener('input', paint);

    (root.querySelector('[data-action="pick-country"]') as HTMLElement)
      .addEventListener('click', async () => {
        const chosen = await pickCountry(countryCode);
        if (!chosen) return;                       // dismissed
        countryCode = chosen.code;
        (root.querySelector('[data-country-flag]') as HTMLElement).textContent = chosen.flag;
        (root.querySelector('.phone-row__dial') as HTMLElement).textContent = `+${chosen.dial}`;
        U.haptic(8);
        paint();
      });

    paint();
    if (isValidTag(tagOf())) checkTag();
    setTimeout(() => first.focus({ preventScroll: true }), 420);
  }
});
