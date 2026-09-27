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

/* ---- business flow ---- */
export const Flow = BP.flow = {
  _yieldTimer: null,
  _timeTimer: null,

  async addMoney(amount, asset){
    Router.go('processing', { transition:'fade', params:{ type:'deposit' } });
    const root = Router.current;
    const subEl = root.querySelector('[data-processing-sub]');
    const actionsEl = root.querySelector('[data-processing-actions]');
    const progressEl = root.querySelector('[data-progress]');
    const t1 = setTimeout(() => { if (subEl) subEl.innerHTML = 'Casi listo...'; }, 3000);
    const t2 = setTimeout(() => { if (subEl) subEl.innerHTML = 'Esto puede tardar un poco más de lo normal.<br>Puedes dejar la app abierta.'; }, 10000);
    const [result] = await Promise.all([
      BP.api.addMoney(amount, asset),
      U.wait(U.rand(BP.config.processingMinMs, BP.config.processingMaxMs))
    ]);
    clearTimeout(t1); clearTimeout(t2);
    if (!result.ok){
      if (subEl) subEl.innerHTML = 'Algo no salió como esperábamos.<br>Puedes reintentar.';
      if (progressEl) progressEl.classList.add('paused');
      if (actionsEl) actionsEl.innerHTML = `
        <div class="dual" style="max-width:320px;margin:0 auto">
          <button class="btn btn--secondary btn--lg" data-action="back">Volver</button>
          <button class="btn btn--primary btn--lg" data-action="retry-add" data-amount="${amount}" data-asset="${U.esc(asset)}">Reintentar</button>
        </div>`;
      return;
    }
    const s = Store.get();
    const newBalance = Number((s.balance + result.amount).toFixed(4));
    Store.set({
      balance: newBalance,
      // Latches on the first credit and never resets, even if the user later
      // spends the balance back down to zero.
      hasReceivedFunds: true,
      movements: [{ id:U.uid(), type:'deposit', title:`Añadiste ${U.money(result.amount)}`, amount:result.amount, at:Date.now(), status:'completed', meta:{} }, ...s.movements],
      lastYieldAt: Date.now()
    });
    U.haptic(12);
    Router.replace('home', { transition:'fade' });
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
    const t1 = setTimeout(() => { if (subEl) subEl.innerHTML = 'Casi listo...'; }, 2500);
    const [result] = await Promise.all([
      BP.api.sendMoney(amount, recipient),
      U.wait(U.rand(BP.config.sendMinMs, BP.config.sendMaxMs))
    ]);
    clearTimeout(t1);
    if (!result.ok){
      if (subEl) subEl.innerHTML = 'Algo no salió como esperábamos.<br>Podés reintentar.';
      if (progressEl) progressEl.classList.add('paused');
      if (actionsEl) actionsEl.innerHTML = `
        <div class="dual" style="max-width:320px;margin:0 auto">
          <button class="btn btn--secondary btn--lg" data-action="back">Volver</button>
          <button class="btn btn--primary btn--lg" data-action="retry-send">Reintentar</button>
        </div>`;
      return;
    }
    const s = Store.get();
    const newBalance = Number((s.balance - amount).toFixed(4));
    Store.set({
      balance: newBalance,
      movements: [{
        id:U.uid(), type:'send',
        title:`Enviaste a ${recipient.name}`,
        amount:-amount, at:Date.now(), status:'completed',
        meta:{ recipient: recipient.tag, type: recipient.type }
      }, ...s.movements]
    });
    U.haptic(14);
    Router.replace('home', { transition:'fade' });
    setTimeout(() => UI.toast(`Enviaste ${U.money(amount)} a ${recipient.name}.`, 'success'), 500);
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

  startYieldTicker(){
    Flow.stopYieldTicker();
    const s = Store.get();
    if (s.balance <= 0) return;
    Flow._yieldTimer = setInterval(async () => {
      const st = Store.get();
      if (st.balance <= 0 || !navigator.onLine) return;
      const gain = await BP.api.accrueYield();
      const newBalance = Number((st.balance + gain).toFixed(4));
      const balanceEl = document.querySelector('[data-balance]');
      if (balanceEl) balanceEl.textContent = U.money(newBalance);
      const last = st.movements[0];
      let movements;
      if (last && last.type === 'yield' && Date.now() - last.at < 30000){
        const merged = Object.assign({}, last, { amount:Number((last.amount + gain).toFixed(4)), at:Date.now() });
        movements = [merged, ...st.movements.slice(1)];
      } else {
        movements = [{ id:U.uid(), type:'yield', title:'Rendimiento', amount:gain, at:Date.now() }, ...st.movements];
      }
      Store.set({ balance:newBalance, movements, lastYieldAt:Date.now() });
      Flow.refreshMovements();
    }, BP.config.yieldTickMs);
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

    const s = Store.get();
    Store.set({ session:false });

    Router.stack = [];

    if (s.onboardingComplete){
      Router.go('passkey', { transition:'fade', params:{ mode:'login' } });
    } else {
      Router.go('welcome', { transition:'fade' });
    }

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
