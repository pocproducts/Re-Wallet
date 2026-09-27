import { U } from '../core/utils';
import { Store } from '../core/store';
import { UI } from '../ui';
import { Router } from '../core/router';
import { Icons } from '../components/icons';

/* ---- screen: receive ---- */
/* ---------- Recibir / Pedir ---------- */
Router.register('receive', {
  transition:'forward',
  render(){
    const s = Store.get();
    return `
      <div class="screen-head">
        <button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button>
        <span class="t-h2">Recibir</span>
        <span></span>
      </div>

      <div class="segmented" role="tablist">
        <button class="segmented__btn is-active" data-recv-tab="tag" role="tab">Mi tag</button>
        <button class="segmented__btn" data-recv-tab="request" role="tab">Pedir monto</button>
      </div>

      <div data-recv-pane="tag">
        <p class="t-body-sm t-secondary text-center mb-4">Compartí este código para que te envíen dinero.</p>
        <div class="qr-frame">${UI.qrCode(s.bpTag, 200)}</div>
        <div class="text-center mt-6 mb-6">
          <div class="t-h3">${U.esc(s.bpTag)}</div>
          <div class="t-caption t-tertiary mt-1">Tu identificador ReWallet</div>
        </div>
        <div class="dual mb-4">
          <button class="btn btn--secondary btn--lg" data-action="copy-tag">${Icons.copy} Copiar</button>
          <button class="btn btn--secondary btn--lg" data-action="share-tag">${Icons.share} Compartir</button>
        </div>
      </div>

      <div data-recv-pane="request" class="hidden">
        <p class="t-body-sm t-secondary text-center mb-6">Generá un link de cobro por un monto específico.</p>

        <div class="field">
          <input class="field__input" type="text" id="req-amount" placeholder=" " inputmode="decimal" value="50.00">
          <label class="field__label" for="req-amount">Monto a pedir</label>
        </div>

        <div class="row" style="gap:8px;margin-bottom:20px">
          <button class="chip" data-quick-amount="10">$10</button>
          <button class="chip" data-quick-amount="25">$25</button>
          <button class="chip" data-quick-amount="50">$50</button>
          <button class="chip" data-quick-amount="100">$100</button>
        </div>

        <button class="btn btn--primary btn--lg btn--block mt-4" data-action="create-request">Generar link</button>

        <div data-request-result class="mt-6 hidden">
          <div class="divider"></div>
          <p class="t-micro t-tertiary mb-2" style="letter-spacing:.06em">LINK DE COBRO</p>
          <div class="link-box">
            <span class="link-box__url" data-request-url>—</span>
          </div>
          <div class="dual">
            <button class="btn btn--secondary btn--lg" data-action="copy-request">${Icons.copy} Copiar</button>
            <button class="btn btn--primary btn--lg" data-action="share-request">${Icons.share} Compartir</button>
          </div>
        </div>
      </div>`;
  },
  onMount(root){
    const tabs = root.querySelectorAll('[data-recv-tab]');
    const panes = root.querySelectorAll('[data-recv-pane]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        panes.forEach(p => p.classList.toggle('hidden', p.dataset.recvPane !== tab.dataset.recvTab));
      });
    });

    root.querySelectorAll('[data-quick-amount]').forEach(chip => {
      chip.addEventListener('click', () => {
        root.querySelector('#req-amount').value = chip.dataset.quickAmount + '.00';
        chip.setAttribute('aria-pressed','true');
        setTimeout(() => chip.removeAttribute('aria-pressed'), 300);
      });
    });
  }
});
