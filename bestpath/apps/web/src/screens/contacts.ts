import { BP } from '../core/bp';
import { U } from '../core/utils';
import { Store } from '../core/store';
import { Router } from '../core/router';
import { Icons } from '../components/icons';
import { contactAvatar } from '../components';

/* ---- screen: contacts ---- */
/* ---------- Contactos ---------- */
Router.register('contacts', {
  transition:'forward',
  render(){
    const s = Store.get();
    const canAdd = s.contacts.length < BP.config.maxContacts;
    const list = s.contacts.length
      ? s.contacts.map(c => `
          <div class="row-between" style="border-bottom:1px solid var(--rw-dark-700);padding:6px 0">
            <div class="contact-row" style="flex:1" data-contact-id="${c.id}">
              ${contactAvatar(c, 40)}
              <div class="grow" style="min-width:0">
                <div class="t-body-sm" style="font-weight:500">${U.esc(c.name)}</div>
                <div class="t-caption t-tertiary">${U.esc(c.tag)}</div>
              </div>
            </div>
            <button class="icon-btn icon-btn--sm" data-action="remove-contact" data-contact-id="${c.id}" aria-label="Eliminar" style="color:var(--rw-text-tertiary)">
              ${Icons.trash}
            </button>
          </div>`).join('')
      : `<div class="empty" style="padding:40px 20px">
           <div class="t-h3">Sin contactos</div>
           <div class="t-body-sm t-tertiary mt-1">Agregá uno para enviarle dinero.</div>
         </div>`;

    return `
      <div class="screen-head">
        <button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button>
        <span class="t-h2">Contactos</span>
        <button class="icon-btn icon-btn--sm" data-action="add-contact" ${canAdd?'':'disabled'} aria-label="Agregar">${Icons.plus}</button>
      </div>

      <p class="t-body-sm t-secondary mt-2 mb-6">Guardá a las personas a las que les enviás dinero seguido.</p>

      <div>${list}</div>

      ${!canAdd ? `<p class="t-caption t-tertiary text-center mt-6">Llegaste al límite de ${BP.config.maxContacts} contactos.</p>` : ''}`;
  }
});
