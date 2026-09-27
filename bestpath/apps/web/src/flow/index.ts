import { BP } from '../core/bp';
import { U } from '../core/utils';
import { Store } from '../core/store';
import { UI } from '../ui';
import { Router } from '../core/router';
import { contactAvatar, contactRow, movementRow } from '../components';
import { pickCountry, preselectFor } from '../components/countryPicker';
import { COUNTRIES, DEFAULT_COUNTRY, getCountry, toE164 } from '../components/countries';
import { shownBalance } from '../screens/shared';
import { hasPrivyIsland, requestPrivyLogout } from '../wire/privy';
import { isNotBuilt, refreshWallet, requestDepositIntent, requestSend } from '../wire/wallet';

/* ---- business flow ---- */
/**
 * How often the live balance re-reads itself.
 *
 * It is a constant here and not a config knob because the knob it replaces
 * (`yieldTickMs`, 9s) only existed to space out a random number. A network call
 * has a real cost and the number it returns is reconciled on a five-minute cron,
 * so polling faster would spend battery to re-read something that cannot have
 * changed.
 */
const LIVE_BALANCE_POLL_MS = 30_000;

export const Flow = BP.flow = {
  _yieldTimer: null,
  _timeTimer: null,

  async addMoney(amount, asset){
    Router.go('processing', { transition:'fade', params:{ type:'deposit' } });
    const root = Router.current;
    const subEl = root.querySelector('[data-processing-sub]');
    const actionsEl = root.querySelector('[data-processing-actions]');
    const progressEl = root.querySelector('[data-progress]');

    // THE MONEY DOES NOT MOVE HERE, AND THAT IS THE POINT.
    //
    // This used to await a mock that resolved `{ ok: true, amount }` after a
    // random delay, then add that amount to the balance and write a "deposit"
    // movement into the store. Pressing "Recibir" grew the number on screen. The
    // backend was asked nothing: `POST /wallet/deposit-intent` answered
    // `200 { ok: true, address: null }` and nobody branched on it.
    //
    // So the only thing left to do is ask, and believe the answer. A deposit
    // exists when the server says it exists — which today it does not, and says
    // so with a 501.
    try {
      await requestDepositIntent({ asset: asset || 'USDC' });
    } catch (err) {
      return Flow._moneyNotReady(subEl, progressEl, actionsEl, 'recibir', err);
    }

    // Reaching here means the server accepted a real intent, which it cannot do
    // yet. The balance is deliberately NOT touched: nothing arrived.
    if (subEl) subEl.innerHTML = 'Todo listo.';
    if (progressEl) progressEl.classList.add('paused');
    if (actionsEl) actionsEl.innerHTML = `
      <div class="dual" style="max-width:320px;margin:0 auto">
        <button class="btn btn--secondary btn--lg" data-action="back">Volver</button>
      </div>`;
  },

  /**
   * The one place a money flow is allowed to end in "not built yet".
   *
   * Every money button in the app has always shown a processing screen with a
   * progress bar that advanced on a timer, and then completed as if it had
   * worked. Now they all end here instead, with a sentence that says the truth,
   * and without touching a single number.
   */
  _moneyNotReady(subEl, progressEl, actionsEl, what, err){
    const notBuilt = isNotBuilt(err);
    console.warn(`[rewallet] ${what}: no se pudo iniciar`, err);
    if (subEl) {
      subEl.innerHTML = notBuilt
        ? 'Todavía no podemos hacer esto.<br>La cuenta y tu passkey ya funcionan.'
        : 'No pudimos iniciar la operación.<br>Podés intentarlo de nuevo.';
    }
    if (progressEl) progressEl.classList.add('paused');
    if (actionsEl) actionsEl.innerHTML = `
      <div class="dual" style="max-width:320px;margin:0 auto">
        <button class="btn btn--secondary btn--lg" data-action="back">Volver</button>
      </div>`;
  },

  async sendMoney(){
    const s = Store.get();
    if (s.balance <= 0){ UI.toast('Añade dinero primero para poder enviar.', 'info'); return; }

    const recipient = await Flow._pickRecipient();
    if (!recipient) return;

    const payload = await Flow._pickAmount(recipient);
    if (!payload) return;

    const confirmed = await UI.confirm({
      title:'¿Confirmás el envío?',
      message:`Vas a enviar ${U.money(payload.amount)} a ${recipient.name}${recipient.type==='address'?' ('+recipient.tag+')':''}.`,
      confirmLabel:'Enviar',
      cancelLabel:'Cancelar'
    });
    if (!confirmed) return;

    await Flow._processSend(recipient, payload.amount);
  },

  async _pickRecipient(){
    const s = Store.get();
    const recent = s.contacts.slice(0, 4);

    return UI.sheet({
      title:'Enviar dinero',
      content: `
        <div class="field">
          <input class="field__input" type="text" id="recipient-input" placeholder=" " autocomplete="off" data-recipient-input>
          <label class="field__label" for="recipient-input">Nombre, @usuario o correo</label>
        </div>
        <div class="field__helper" id="recipient-help">Escribí un @usuario, correo o teléfono.</div>
        <div class="divider"></div>
        <p class="t-micro t-tertiary" style="letter-spacing:.06em;margin-bottom:var(--space-2)">RECIENTES</p>
        <div class="stack stack-2" data-recent>${recent.map(c => contactRow(c)).join('')}</div>`,
      onMount(sheet, close){
        const input = sheet.querySelector('#recipient-input');
        const helpEl = sheet.querySelector('#recipient-help');
        const recentEl = sheet.querySelector('[data-recent]');

        recentEl.addEventListener('click', (e) => {
          const row = e.target.closest('[data-contact-id]');
          if (!row) return;
          const contact = s.contacts.find(c => c.id === row.dataset.contactId);
          if (contact){ U.haptic(8); close({ type:'contact', ...contact }); }
        });

        input.addEventListener('input', () => {
          const v = input.value.trim();
          if (!v){ helpEl.textContent = 'Escribí un @usuario, correo o teléfono.'; helpEl.style.color = ''; return; }
          const resolved = Flow._resolveRecipient(v);
          helpEl.textContent = `Enviar a ${resolved.name}`;
          helpEl.style.color = 'var(--rw-brand-500)';
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter'){
            const v = input.value.trim();
            if (v){ U.haptic(8); close(Flow._resolveRecipient(v)); }
          }
        });

        setTimeout(() => input.focus({preventScroll:true}), 400);
      }
    });
  },

  _resolveRecipient(value){
    const s = Store.get();
    const trimmed = String(value).trim();
    const lower = trimmed.toLowerCase();
    const clean = lower.startsWith('@') ? lower : '@' + lower;
    const match = s.contacts.find(c => c.tag.toLowerCase() === clean || c.name.toLowerCase().includes(lower));
    if (match) return { type:'contact', ...match };
    if (U.isEmail(trimmed)){
      return { type:'email', id:U.uid(), name:trimmed.split('@')[0], tag:trimmed, initials:trimmed[0].toUpperCase(), color:U.colorFrom(trimmed) };
    }
    const digits = trimmed.replace(/\D/g,'');
    if (digits.length >= 8){
      return { type:'phone', id:U.uid(), name:'Contacto ' + digits.slice(-4), tag:trimmed, initials:'#', color:'#A1A1A6' };
    }
    return { type:'tag', id:U.uid(), name:clean, tag:clean, initials:(clean[1] || '?').toUpperCase(), color:U.colorFrom(clean) };
  },

  async _pickAmount(recipient){
    let amount = 0;
    const s = Store.get();
    const max = s.balance;

    return UI.sheet({
      title:'Monto',
      content: `
        <div class="row" style="gap:12px;margin-bottom:20px">
          ${contactAvatar(recipient, 40)}
          <div class="grow" style="min-width:0">
            <div class="t-body-sm" style="font-weight:500">${U.esc(recipient.name)}</div>
            <div class="t-caption t-tertiary t-mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(recipient.tag)}</div>
          </div>
        </div>
        <div class="amount-display">
          <div class="amount-display__value"><span>$</span>
            <input class="amount-display__input" type="text" inputmode="decimal" value="0.00" data-amount-input aria-label="Monto a enviar">
          </div>
        </div>
        <p class="t-body-sm t-tertiary text-center mb-6" data-balance-hint>${U.money(max)} disponibles</p>
        <button class="btn btn--primary btn--lg btn--block" data-submit disabled>Continuar</button>`,
      onMount(sheet, close){
        const input = sheet.querySelector('[data-amount-input]');
        const submit = sheet.querySelector('[data-submit]');
        const hint = sheet.querySelector('[data-balance-hint]');
        const sync = () => {
          const val = parseFloat(String(input.value).replace(',','.')) || 0;
          amount = val;
          const valid = val > 0 && val <= max;
          submit.disabled = !valid;
          if (val > max){ hint.textContent = 'Saldo insuficiente'; hint.style.color = 'var(--rw-error)'; }
          else if (val > 0){ hint.textContent = `${U.money(max - val)} restantes`; hint.style.color = ''; }
          else { hint.textContent = `${U.money(max)} disponibles`; hint.style.color = ''; }
        };
        input.addEventListener('input', () => { input.value = input.value.replace(/[^\d.,]/g,''); sync(); });
        input.addEventListener('blur', () => { const v = parseFloat(String(input.value).replace(',','.')) || 0; input.value = v > 0 ? v.toFixed(2) : '0.00'; sync(); });
        input.addEventListener('focus', () => setTimeout(() => input.select(), 50));
        submit.addEventListener('click', () => { if (submit.disabled) return; U.haptic(10); close({ amount }); });
        setTimeout(() => { input.focus({preventScroll:true}); input.select(); }, 380);
        sync();
      }
    });
  },

  async _processSend(recipient, amount){
    Router.go('processing', { transition:'fade', params:{ type:'send', recipient, amount } });
    const root = Router.current;
    const subEl = root.querySelector('[data-processing-sub]');
    const actionsEl = root.querySelector('[data-processing-actions]');
    const progressEl = root.querySelector('[data-progress]');

    // Same rule as the deposit: the money does not move in the client. This used
    // to await a mock, subtract the amount from the balance and write a "send"
    // movement, so pressing "Enviar" made the balance go DOWN without anything
    // happening. A balance the user can change with a button is a fiction.
    try {
      await requestSend({ amount, recipient: recipient.tag });
    } catch (err) {
      return Flow._moneyNotReady(subEl, progressEl, actionsEl, 'enviar', err);
    }

    if (subEl) subEl.innerHTML = 'Todo listo.';
    if (progressEl) progressEl.classList.add('paused');
    if (actionsEl) actionsEl.innerHTML = `
      <div class="dual" style="max-width:320px;margin:0 auto">
        <button class="btn btn--secondary btn--lg" data-action="back">Volver</button>
      </div>`;
  },

  async openMovementDetail(id){
    const s = Store.get();
    const m = s.movements.find(x => x.id === id);
    if (!m) return;
    const typeLabels = { deposit:'Depósito', send:'Envío', yield:'Rendimiento' };
    await UI.sheet({
      title: typeLabels[m.type] || 'Movimiento',
      content: `
        <div class="text-center mb-6">
          <div class="t-display" style="font-size:36px;line-height:42px">
            ${m.amount >= 0 ? '+' : '−'}${U.money(Math.abs(m.amount))}
          </div>
          <div class="t-body-sm t-secondary mt-2">${U.esc(m.title)}</div>
        </div>
        <div class="stack stack-3">
          <div class="detail-row"><span class="t-body-sm t-secondary">Fecha</span><span class="t-body-sm">${new Date(m.at).toLocaleString('es-AR',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}</span></div>
          <div class="detail-row"><span class="t-body-sm t-secondary">Estado</span><span class="badge badge--success" style="height:22px;font-size:12px">Completado</span></div>
          ${m.meta?.recipient ? `<div class="detail-row"><span class="t-body-sm t-secondary">Destinatario</span><span class="t-body-sm t-mono" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;max-width:60%">${U.esc(m.meta.recipient)}</span></div>` : ''}
          <div class="detail-row"><span class="t-body-sm t-secondary">ID</span><span class="t-caption t-tertiary t-mono">${m.id}</span></div>
        </div>
        <div class="divider" style="margin-top:20px"></div>
        <button class="btn btn--ghost btn--lg btn--block" data-action="toast" data-message="Comprobante listo para compartir.">Compartir comprobante</button>`
    });
  },

  /**
   * Keep the balance fresh by RE-READING it. It used to grow it.
   *
   * This timer used to add `U.rand(0.008, 0.024)` to the balance every 9
   * seconds, write a "Rendimiento" movement into the store, and redraw the
   * number. It never asked the chain or the API for anything: the number on
   * screen was a random draw between 1% and 3% of the balance, every nine
   * seconds, for as long as the app was open. On a balance of 0.83 the figure
   * multiplied. In a wallet app that is the worst thing the code in this repo
   * can do, and it was not a mock behind a flag: it was the only balance the
   * user ever saw.
   *
   * What replaces it is the same timer asking the question it should have been
   * asking all along: what does the server think the balance is. `refreshWallet`
   * is a real `GET /wallet` plus `GET /wallet/movements`, and the number it
   * writes came from `wallets.balance`, which the cron reconciles against USDC
   * on chain. So the balance on screen now moves when the money moves, and stops
   * when it does not.
   *
   * Thirty seconds, not nine: this is a network call, and the balance it returns
   * is reconciled on a five-minute cron, so a faster poll would spend the user's
   * battery to re-read a number that cannot have changed.
   */
  startYieldTicker(){
    Flow.stopYieldTicker();
    const s = Store.get();
    if (s.balance <= 0 || !s.session) return;
    Flow._yieldTimer = setInterval(async () => {
      const st = Store.get();
      if (st.balance <= 0 || !st.session || !navigator.onLine || document.hidden) return;
      try {
        await refreshWallet();
      } catch (err) {
        // A failed poll keeps the last known balance. It does NOT zero it, and it
        // does not invent a new one: showing `$0` for a wallet that holds money
        // is the one outcome this file exists to prevent.
        console.warn('[rewallet] no pudimos refrescar el saldo', err);
      }
    }, LIVE_BALANCE_POLL_MS);
  },
  stopYieldTicker(){ if (Flow._yieldTimer){ clearInterval(Flow._yieldTimer); Flow._yieldTimer = null; } },
  refreshMovements(){
    const container = document.querySelector('[data-movements]');
    if (!container) return;
    const s = Store.get();
    container.innerHTML = s.movements.slice(0,6).map(m => movementRow(m)).join('');
  },
  startTimeRefresher(){
    if (Flow._timeTimer) return;
    Flow._timeTimer = setInterval(() => {
      document.querySelectorAll<HTMLElement>('[data-time]').forEach(el => { el.textContent = U.timeAgo(Number(el.dataset.time)); });
    }, 30000);
  },

  async openAddMoney(){
    if (!navigator.onLine){ UI.toast('Revisa tu conexión para continuar.','warning'); return; }
    let selectedAsset = 'USDC';
    let amount = BP.config.defaultAmount;
    const result = await UI.sheet({
      title:'Añadir dinero',
      content: `
        <div class="amount-display">
          <div class="amount-display__value"><span>$</span>
            <input class="amount-display__input" type="text" inputmode="decimal" value="${amount.toFixed(2)}" data-amount-input aria-label="Monto a añadir">
          </div>
        </div>
        <div class="row" style="gap:var(--space-2);justify-content:center;margin-bottom:var(--space-5)" data-chips role="group">
          <button class="chip" aria-pressed="true" data-chip="USDC">USDC</button>
          <button class="chip" aria-pressed="false" data-chip="USDT">USDT</button>
          <button class="chip" aria-pressed="false" data-chip="Otro">Otro</button>
        </div>
        <div class="text-center mb-6">
          <p class="t-body-sm t-secondary">Llegará al instante.</p>
          <p class="t-body-sm t-secondary">Empezará a crecer solo.</p>
        </div>
        <button class="btn btn--primary btn--lg btn--block" data-submit>Añadir</button>`,
      onMount(sheet, close){
        const input = sheet.querySelector('[data-amount-input]');
        const chips = sheet.querySelectorAll('[data-chip]');
        const submit = sheet.querySelector('[data-submit]');
        const sync = () => {
          const val = parseFloat(String(input.value).replace(',','.')) || 0;
          amount = val;
          const valid = val >= BP.config.minAmount;
          submit.disabled = !valid;
          submit.textContent = valid ? 'Añadir' : `Añade al menos $${BP.config.minAmount}`;
        };
        input.addEventListener('input', () => { input.value = input.value.replace(/[^\d.,]/g,''); sync(); });
        input.addEventListener('blur', () => { const v = parseFloat(String(input.value).replace(',','.')) || 0; input.value = v.toFixed(2); sync(); });
        input.addEventListener('focus', () => setTimeout(() => input.select(), 50));
        chips.forEach(chip => {
          chip.addEventListener('click', () => {
            chips.forEach(c => c.setAttribute('aria-pressed','false'));
            chip.setAttribute('aria-pressed','true');
            selectedAsset = chip.dataset.chip;
            U.haptic(6);
          });
        });
        submit.addEventListener('click', () => { if (submit.disabled) return; U.haptic(10); close({ amount, asset:selectedAsset }); });
        setTimeout(() => { input.focus({preventScroll:true}); input.select(); }, 380);
        sync();
      }
    });
    if (result && result.amount >= BP.config.minAmount) Flow.addMoney(result.amount, result.asset);
  },

  /** Edit the email from the profile. */
  async editEmail(){
    const s = Store.get();
    const result = await UI.sheet({
      title: 'Tu correo',
      content: `
        <div class="field" data-field="email">
          <input class="field__input" type="email" id="inp-edit-email" placeholder=" "
                 autocomplete="email" inputmode="email" value="${U.esc(s.recoveryEmail || '')}">
          <label class="field__label" for="inp-edit-email">tu@correo.com</label>
        </div>`,
      onMount(el, close){
        const input = el.querySelector('#inp-edit-email');
        setTimeout(() => input?.focus({ preventScroll: true }), 300);
        input?.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') close({ email: (input as HTMLInputElement).value });
        });
      },
    });

    if (!result) return;
    const email = String(result.email || '').trim();
    if (!U.isEmail(email)){ UI.toast('Revisá el correo.','warning'); return; }
    Store.set({ recoveryEmail: email });
    UI.toast('Correo actualizado.','success');
  },

  /** Edit the phone from the profile: country picker + E.164 number. */
  async editPhone(){
    const s = Store.get();
    const guess = preselectFor(s.recoveryPhone || '');
    let countryCode = s.recoveryPhoneCountry || guess.country?.code || DEFAULT_COUNTRY;

    const chosen = await pickCountry(countryCode);
    // Dismissed: fall back to the existing value, do not clear the field.
    if (!chosen) return;
    countryCode = chosen.code;

    const result = await UI.sheet({
      title: 'Tu teléfono',
      content: `
        <div class="field" data-field="phone">
          <input class="field__input" type="tel" id="inp-edit-phone" placeholder=" " inputmode="tel"
                 value="${U.esc(guess.national || '')}">
          <label class="field__label" for="inp-edit-phone">Número · +${chosen.dial}</label>
        </div>`,
      onMount(el, close){
        const input = el.querySelector('#inp-edit-phone');
        setTimeout(() => input?.focus({ preventScroll: true }), 300);
        input?.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') close({ national: (input as HTMLInputElement).value });
        });
      },
    });

    if (!result) return;
    const national = String(result.national || '').replace(/\D/g, '');
    if (national.length < 7){
      UI.toast('Revisá el número.','warning');
      return;
    }
    const country = getCountry(countryCode) ?? getCountry(DEFAULT_COUNTRY);
    Store.set({ recoveryPhone: toE164(country, national), recoveryPhoneCountry: countryCode });
    UI.toast('Teléfono actualizado.','success');
  },

  async editName(){
    const s = Store.get();
    const result = await UI.sheet({
      title:'Tu nombre',
      content: `
        <div class="field">
          <input class="field__input" type="text" id="edit-name-input" placeholder=" " value="${U.esc(s.userName)}" maxlength="30" autocomplete="name">
          <label class="field__label" for="edit-name-input">Nombre</label>
        </div>
        <button class="btn btn--primary btn--lg btn--block mt-4" data-save>Guardar</button>`,
      onMount(sheet, close){
        const input = sheet.querySelector('#edit-name-input');
        const save = sheet.querySelector('[data-save]');
        save.addEventListener('click', () => {
          const v = input.value.trim();
          if (v.length < 2){ UI.toast('El nombre es muy corto.','warning'); return; }
          close(v);
        });
        setTimeout(() => { input.focus({preventScroll:true}); input.select(); }, 380);
      }
    });
    if (result){ Store.set({ userName:result }); UI.toast('Nombre actualizado.','success'); Router.replace('settings',{transition:'fade'}); }
  },

  async editRecovery(){
    const s = Store.get();
    const result = await UI.sheet({
      title:'Recuperación',
      content: `
        <p class="t-body-sm t-secondary mb-4">Si perdés tu teléfono, usamos esto para recuperar tu cuenta.</p>
        <div class="field">
          <input class="field__input" type="email" id="edit-email" placeholder=" " value="${U.esc(s.recoveryEmail)}" autocomplete="email">
          <label class="field__label" for="edit-email">tu@correo.com</label>
        </div>
        <button class="btn btn--primary btn--lg btn--block mt-4" data-save>Guardar</button>`,
      onMount(sheet, close){
        const input = sheet.querySelector('#edit-email');
        const save = sheet.querySelector('[data-save]');
        save.addEventListener('click', () => {
          const v = input.value.trim();
          if (!U.isEmail(v)){ UI.toast('Revisá este correo.','warning'); return; }
          close(v);
        });
        setTimeout(() => { input.focus({preventScroll:true}); input.select(); }, 380);
      }
    });
    if (result){ Store.set({ recoveryEmail:result }); UI.toast('Correo actualizado.','success'); Router.replace('settings',{transition:'fade'}); }
  },

  async addContact(){
    const s = Store.get();
    if (s.contacts.length >= BP.config.maxContacts){ UI.toast('Llegaste al límite de contactos.','warning'); return; }
    const result = await UI.sheet({
      title:'Nuevo contacto',
      content: `
        <div class="field">
          <input class="field__input" type="text" id="new-name" placeholder=" " autocomplete="off" maxlength="40">
          <label class="field__label" for="new-name">Nombre</label>
        </div>
        <div class="field">
          <input class="field__input t-mono" type="text" id="new-tag" placeholder=" " autocomplete="off" maxlength="30">
          <label class="field__label" for="new-tag" style="font-family:inherit">@usuario, correo o teléfono</label>
        </div>
        <button class="btn btn--primary btn--lg btn--block mt-4" data-save>Guardar</button>`,
      onMount(sheet, close){
        const nameInput = sheet.querySelector('#new-name');
        const tagInput = sheet.querySelector('#new-tag');
        const save = sheet.querySelector('[data-save]');
        save.addEventListener('click', () => {
          const name = nameInput.value.trim();
          let tag = tagInput.value.trim();
          if (name.length < 2){ UI.toast('El nombre es muy corto.','warning'); return; }
          if (!tag){ UI.toast('Agregá un tag o correo.','warning'); return; }
          if (!tag.startsWith('@') && !U.isEmail(tag) && !/^\+?\d{8,}$/.test(tag.replace(/\s/g,''))) tag = '@' + tag;
          close({ name, tag });
        });
        setTimeout(() => nameInput.focus({preventScroll:true}), 380);
      }
    });
    if (result){
      const newContact = {
        id: U.uid(),
        name: result.name,
        tag: result.tag,
        initials: U.initialsFrom(result.name),
        color: U.colorFrom(result.tag)
      };
      Store.set({ contacts: [...s.contacts, newContact] });
      UI.toast('Contacto guardado.','success');
      Router.replace('contacts',{transition:'fade'});
    }
  },

  async removeContact(id){
    const s = Store.get();
    const contact = s.contacts.find(c => c.id === id);
    if (!contact) return;
    const ok = await UI.confirm({
      title:'¿Eliminar contacto?',
      message:`Se eliminará a ${contact.name} de tu lista.`,
      confirmLabel:'Eliminar',
      cancelLabel:'Cancelar',
      danger:true
    });
    if (ok){
      Store.set({ contacts: s.contacts.filter(c => c.id !== id) });
      UI.toast('Contacto eliminado.','success');
      Router.replace('contacts',{transition:'fade'});
    }
  },

  async logout(){
    const ok = await UI.confirm({
      title:'¿Cerrar sesión?',
      message:'Vas a salir de tu cuenta. Tus datos quedan guardados y podés volver a entrar cuando quieras.',
      confirmLabel:'Cerrar sesión',
      cancelLabel:'Cancelar',
      danger:true
    });
    if (!ok) return;

    // End the real session BEFORE wiping local state, while the passkey is
    // still usable and the island is still mounted. Best-effort on purpose: a
    // logout that never reached the server must still tear down the local UI and
    // land the user back on the passkey screen — stranding them in a UI that
    // claims to be signed in is strictly worse than a stale server session, and
    // the backend session expires on its own.
    if (hasPrivyIsland()){
      try {
        await requestPrivyLogout();
      } catch (err) {
        console.warn('[rewallet] logout: el backend no confirmó el cierre de sesión', err);
      }
    }

    Flow.stopYieldTicker();
    shownBalance.value = 0;

    Store.set({ session:false });

    Router.stack = [];

    // ALWAYS to the passkey screen in LOGIN mode, and the reason it stopped
    // asking is the whole point: this branch used to depend on
    // `s.onboardingComplete`, a flag that lives in the browser and is false for
    // anyone whose profile save failed or never happened. `false` sent them to
    // `welcome` — the "you are new here" screen — whose main button starts a
    // REGISTRATION ceremony, and Privy refuses to register a passkey that already
    // exists. The user had an account, a working passkey, and no way in except
    // finding the small "Ya tengo una cuenta" link.
    //
    // Logging out means there IS an account: the passkey is what logged them in.
    // "Am I new?" is not a question the logout path can answer, and the only
    // screen that asks for nothing is the login one.
    Router.go('passkey', { transition:'fade', params:{ mode:'login' } });

    UI.toast('Sesión cerrada.','success');
  },

  /**
   * Closes onboarding. The individual steps (profile, email, phone) already
   * wrote their own fields to the store; this only latches the flags and
   * navigates. Optional args are accepted for the legacy recovery screen.
   */
  completeOnboarding(details?: { email?: string; phone?: string }){
    const patch: Partial<ReturnType<typeof Store.get>> = { onboardingComplete:true, session:true };
    if (details?.email) patch.recoveryEmail = details.email;
    if (details?.phone) patch.recoveryPhone = details.phone;
    Store.set(patch);
    Router.stack = [];
    Router.replace('home', { transition:'fade' });
  }
};
