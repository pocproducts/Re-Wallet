import { BP } from '../core/bp';
import { U } from '../core/utils';
import { Store } from '../core/store';
import { Router } from '../core/router';
import { Icons } from '../components/icons';
import { contactAvatar } from '../components';

/* ---- screen: settings ---- */
/* ---------- Perfil (Settings) — v0.5 ---------- */
Router.register('settings', {
  transition:'forward',
  render(){
    const s = Store.get();
    return `
      <div class="screen-head">
        <button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button>
        <span class="t-h2">Perfil</span>
        <span></span>
      </div>

      <!-- identidad: foto, nombre grande y tag con copiar -->
      <div class="profile-identity">
        <div class="profile-identity__photo">
          ${contactAvatar({ name:s.userName, color:'var(--rw-brand-500)', initials:U.initialsFrom(s.userName) }, 64)}
        </div>
        <div class="profile-identity__rows">
          <div class="profile-name" style="font-size:20px">${U.esc([s.firstName, s.lastName].filter(Boolean).join(' ') || s.userName)}</div>
          <div class="profile-identity__tag">
            <span class="t-mono" data-profile-tag>${U.esc(s.bpTag || '@—')}</span>
            <button class="icon-btn icon-btn--sm" data-action="copy-tag" aria-label="Copiar usuario">
              ${Icons.copy}
            </button>
          </div>
        </div>
      </div>

      <!--
        The wallet address, and it is a first-class row rather than a debug detail.

        The first question anyone asks about a custodial wallet is "where is my
        money", and the answer has to be one tap away and copyable. It is also the
        only way for a user to check us: the address is public, and anything we
        say about the balance can be verified against it on an explorer.
      -->
      <div class="section-label">Tu wallet</div>
      <div class="list-item" data-wallet-address>
        <div class="list-item__main">
          <div class="list-item__label">Dirección en Monad</div>
          <div class="list-item__sub t-mono" style="font-size:11px;word-break:break-all">
            ${s.walletAddress ? U.esc(`${s.walletAddress.slice(0, 8)}…${s.walletAddress.slice(-6)}`) : 'Se genera al crear tu cuenta'}
          </div>
        </div>
        ${
          s.walletAddress
            ? `<button class="icon-btn icon-btn--sm" data-action="copy-wallet" aria-label="Copiar dirección">${Icons.copy}</button>`
            : ''
        }
      </div>

      <div class="section-label">Contacto</div>
      <button class="list-item" data-action="edit-email">
        <div class="list-item__icon">${Icons.mail}</div>
        <div class="list-item__main">
          <div class="list-item__label">Correo</div>
          <div class="list-item__sub ${s.recoveryEmail ? '' : 't-tertiary'}">${s.recoveryEmail ? U.esc(s.recoveryEmail) : 'Sin configurar'}</div>
        </div>
        <div class="list-item__value"><span style="color:var(--rw-text-tertiary)">${Icons.chevronRight}</span></div>
      </button>
      <button class="list-item" data-action="edit-phone">
        <div class="list-item__icon">${Icons.phone}</div>
        <div class="list-item__main">
          <div class="list-item__label">Teléfono</div>
          <div class="list-item__sub ${s.recoveryPhone ? '' : 't-tertiary'}">${s.recoveryPhone ? U.esc(s.recoveryPhone) : 'Sin configurar'}</div>
        </div>
        <div class="list-item__value"><span style="color:var(--rw-text-tertiary)">${Icons.chevronRight}</span></div>
      </button>

      <div class="section-label">Contactos</div>
      <button class="list-item" data-action="go" data-screen="contacts">
        <div class="list-item__icon">${Icons.users}</div>
        <div class="list-item__main">
          <div class="list-item__label">Contactos guardados</div>
          <div class="list-item__sub">${s.contacts.length} de ${BP.config.maxContacts}</div>
        </div>
        <div class="list-item__value"><span style="color:var(--rw-text-tertiary)">${Icons.chevronRight}</span></div>
      </button>

      <div class="section-label">Seguridad</div>
      <div class="list-item" style="cursor:default">
        <div class="list-item__icon">${Icons.lock}</div>
        <div class="list-item__main">
          <div class="list-item__label">Face ID</div>
          <div class="list-item__sub">Confirmar operaciones</div>
        </div>
        <button class="toggle" role="switch" aria-checked="${s.settings.biometricEnabled}" data-action="toggle-biometric"></button>
      </div>

      <div class="section-label">Sesión</div>
      <button class="list-item" data-action="logout">
        <div class="list-item__icon" style="color:var(--rw-error)">${Icons.logout}</div>
        <div class="list-item__main">
          <div class="list-item__label" style="color:var(--rw-error)">Cerrar sesión</div>
          <div class="list-item__sub">Volver a la pantalla de inicio</div>
        </div>
      </button>

      <div class="mt-6 text-center">
        <p class="t-caption t-tertiary">ReWallet v${BP.config.version}</p>
        <p class="t-caption t-tertiary">Tu dinero, siempre creciendo.</p>
      </div>`;
  }
});
