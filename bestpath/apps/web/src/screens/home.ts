import { BP } from '../core/bp';
import { U } from '../core/utils';
import { Store } from '../core/store';
import { Router } from '../core/router';
import { Icons } from '../components/icons';
import { movementRow, tabbar } from '../components';
import { shownBalance } from './shared';
import { refreshPositionAndMovements } from '../wire/wallet';

/* ---- screen: home ---- */
/* ---------- Home ---------- */
Router.register('home', {
  transition:'fade',
  render(){
    const s = Store.get();
    /**
     * THE HEADLINE COMES FROM THE CHAIN, NOT FROM THE LEDGER.
     *
     * `s.position` is what Monad says the wallet holds. `s.balance` is what we
     * believe happened. When they disagree, the money is on the chain and our
     * ledger is the thing that is wrong — so the number a user sees has to be the
     * one that can be verified on an explorer.
     *
     * `null` means "we could not read the chain", which is NOT zero. Rendering a
     * failed read as "$0" tells someone their money is gone.
     */
    const position = s.position;
    // Only an `ok` read can drive the headline. `unknown` is the first paint and
    // `error` is a failed read, and in both cases the ledger number is the best
    // thing we can honestly show.
    const chainTotal = s.positionStatus === 'ok' && position ? position.total : null;
    const headline = chainTotal !== null ? chainTotal : s.balance;
    const hasBalance = headline > 0;
    const isNewUser = !s.hasReceivedFunds && !hasBalance;
    const header = `<div class="screen-head">
      <span class="screen-head__title">Hola, ${U.esc(s.userName)}</span>
      <button class="icon-btn icon-btn--sm" data-action="settings" aria-label="Perfil">${Icons.gear}</button>
    </div>`;

    // ── fila 1: saldo ────────────────────────────────────────────────────
    const balanceRow = `
      <div class="grow" style="flex:.3"></div>
      <div class="text-center">
        <div class="t-display" style="font-size:40px" data-balance>${hasBalance ? U.money(headline) : '$0.00'}</div>
        ${
          chainTotal !== null
            ? `<div class="mt-3" data-badge>
                 <button class="badge badge--success" data-action="go" data-screen="yield-detail" style="border:none;cursor:pointer">
                   ${Icons.trendUpSm} ${
                     position.earning > 0
                       ? `${U.money(position.earning)} ganando`
                       : 'Activá el rendimiento'
                   }
                 </button>
               </div>
               ${
                 // Idle money is shown, not hidden. One number would imply the
                 // whole balance is working for the user when it is not.
                 position.available > 0
                   ? `<p class="t-caption t-tertiary mt-2">${U.money(position.available)} disponible sin rendimiento</p>`
                   : ''
               }`
            : `<p class="t-body-sm t-secondary mt-2">${
                s.positionStatus === 'error' && s.balance > 0
                  ? 'No pudimos verificar tu saldo en la red.'
                  : 'Tu dinero aparecerá aquí.'
              }</p>`
        }
      </div>
      <div class="grow" style="flex:.35"></div>
      ${
        isNewUser
          ? `<!-- first run: the one thing a new user needs to do is get paid -->
             <button class="btn btn--primary btn--lg btn--block" data-action="receive">
               Recibir dinero
             </button>
             <p class="t-caption t-tertiary text-center mt-3">Tu primer ingreso activa el rendimiento automático.</p>`
          : `<div class="dual">
               <button class="btn btn--primary btn--lg" data-action="send">Enviar</button>
               <button class="btn btn--secondary btn--lg" data-action="receive">Recibir</button>
             </div>`
      }`;

    // ── fila 2: movimientos ──────────────────────────────────────────────
    const recent = s.movements.slice(0, 6);
    const recentHTML = recent.length
      ? recent.map(m => movementRow(m)).join('')
      : `<div class="text-center t-body-sm t-tertiary" style="padding:var(--space-8) 0">
           ${isNewUser ? 'Compartí tu link para recibir tu primer pago.' : 'Aquí verás tus movimientos.'}
         </div>`;

    const movementsRow = `
      <div class="row-between" style="margin:var(--space-6) 0 var(--space-1)">
        <div class="t-body-sm" style="font-weight:600">Movimientos recientes</div>
        <button class="link" style="font-size:13px" data-action="tab" data-tab="activity">Ver todo</button>
      </div>
      <div data-movements>${recentHTML}</div>`;

    return `${header}
      <div class="grow" style="flex:.4"></div>
      ${balanceRow}
      <div class="grow" style="flex:.3"></div>
      ${movementsRow}
      ${tabbar('home')}`;
  },
  onMount(root){
    const s = Store.get();
    const total = s.position ? s.position.total : s.balance;
    const balanceEl = root.querySelector('[data-balance]');
    if (balanceEl && total > 0) U.countUp(balanceEl, total, 600, shownBalance.value);
    shownBalance.value = total;

    // Re-read the chain every time home is shown, not only at boot. This is a
    // wallet: the number on screen has to be the one that is true NOW, and the
    // chain is the only thing that can say so.
    void refreshPositionAndMovements()
      .then(() => {
        // Re-render only the parts that changed. Repainting the whole screen on
        // every refresh would restart the count-up animation and lose scroll.
        const fresh = Store.get();
        const freshTotal = fresh.position ? fresh.position.total : fresh.balance;
        const el = document.querySelector('[data-balance]');
        if (el) el.textContent = U.money(freshTotal);
        shownBalance.value = freshTotal;
        const badge = document.querySelector('[data-badge]');
        if (badge && fresh.position) {
          const list = document.querySelector('[data-movements]');
          if (list) list.innerHTML = fresh.movements.slice(0, 6).map((m) => movementRow(m)).join('');
        }
      })
      .catch(() => {
        // Keep what is on screen. A failed read is not a reason to show zero.
      });
  }
});
