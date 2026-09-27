import { BP } from '../core/bp';
import { U } from '../core/utils';
import { layer } from '../core/dom';

/* ---- ui ---- */
export const UI = BP.ui = {
  toast(message, variant = 'info', duration = 4000){
    let stack = layer.querySelector('.toast-stack');
    if (!stack){ stack = document.createElement('div'); stack.className = 'toast-stack'; layer.appendChild(stack); }
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role','status');
    el.innerHTML = `<span class="toast__dot toast__dot--${variant}"></span><span class="grow">${U.esc(message)}</span>`;
    stack.appendChild(el);
    const remove = () => { el.classList.add('closing'); setTimeout(() => { el.remove(); if (!stack.children.length) stack.remove(); }, 200); };
    const timer = setTimeout(remove, duration);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
    return remove;
  },
  _banner: null,
  banner(message, variant = 'warning', autoHide = 0){
    UI.clearBanner();
    const el = document.createElement('div');
    el.className = `banner banner--${variant}`; el.setAttribute('role','alert');
    el.innerHTML = `<span class="grow">${U.esc(message)}</span>`;
    layer.appendChild(el); UI._banner = el;
    if (autoHide) setTimeout(() => UI.clearBanner(), autoHide);
  },
  clearBanner(){
    if (!UI._banner) return;
    const el = UI._banner; UI._banner = null;
    el.classList.add('closing'); setTimeout(() => el.remove(), 250);
  },
  sheet({ title, content, onMount, dismissible = true }: any){
    return new Promise<any>(resolve => {
      const scrim = document.createElement('div'); scrim.className = 'scrim';
      const sheet = document.createElement('div');
      sheet.className = 'sheet'; sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-modal','true');
      sheet.innerHTML = `
        <div class="sheet__handle"></div>
        <div class="sheet__head">
          <h2 class="t-h2">${U.esc(title)}</h2>
          <button class="icon-btn icon-btn--sm" data-sheet-close aria-label="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="sheet__body">${content}</div>`;
      layer.appendChild(scrim); layer.appendChild(sheet);
      const screens = document.getElementById('screens');
      const prevOverflow = screens.style.overflow;
      screens.style.overflow = 'hidden';
      let closed = false;
      const close = (result) => {
        if (closed) return; closed = true;
        scrim.classList.add('closing'); sheet.classList.add('closing');
        screens.style.overflow = prevOverflow;
        setTimeout(() => { scrim.remove(); sheet.remove(); resolve(result); }, 260);
      };
      scrim.addEventListener('click', () => { if (dismissible) close(null); });
      sheet.querySelector('[data-sheet-close]').addEventListener('click', () => close(null));
      const handle = sheet.querySelector('.sheet__handle');
      let startY = 0, currentY = 0, dragging = false;
      const onStart = (e) => { if (!dismissible) return; dragging = true; startY = (e.touches ? e.touches[0].clientY : e.clientY); sheet.style.transition = 'none'; };
      const onMove = (e) => { if (!dragging) return; currentY = (e.touches ? e.touches[0].clientY : e.clientY) - startY; if (currentY > 0) sheet.style.transform = `translateY(${currentY}px)`; };
      const onEnd = () => { if (!dragging) return; dragging = false; sheet.style.transition = ''; if (currentY > 90) close(null); else sheet.style.transform = ''; currentY = 0; };
      handle.addEventListener('touchstart', onStart, {passive:true}); handle.addEventListener('touchmove', onMove, {passive:true}); handle.addEventListener('touchend', onEnd);
      handle.addEventListener('mousedown', onStart); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
      const focusable = sheet.querySelector('input,button');
      if (focusable) setTimeout(() => (focusable as HTMLElement).focus({preventScroll:true}), 320);
      if (onMount) onMount(sheet, close);
    });
  },
  /**
   * THE FAKE BIOMETRIC PROMPT IS GONE.
   *
   * It used to draw a Face ID sheet that resolved to `true` after a timeout, and the login
   * action used it as the fallback for builds with no Privy island: a tap on "Usar tu
   * huella" opened a convincing prompt, it went green, and the user was dropped on the home
   * screen signed in as whoever `DEFAULT_STATE` said they were. Nothing failed because
   * nothing had: the only real ceremony is WebAuthn, and this was a drawing of it.
   *
   * A missing island is now an error the user sees, not a login that succeeds.
   */
  async confirm({ title, message, confirmLabel = 'Sí', cancelLabel = 'No', danger = false }){
    return UI.sheet({
      title,
      content: `<p class="t-body t-secondary mb-6">${U.esc(message)}</p>
        <div class="dual">
          <button class="btn btn--secondary btn--lg" data-confirm="no">${U.esc(cancelLabel)}</button>
          <button class="btn btn--${danger?'danger':'primary'} btn--lg" data-confirm="yes">${U.esc(confirmLabel)}</button>
        </div>`,
      onMount(sheet, close){
        sheet.querySelectorAll('[data-confirm]').forEach(btn => {
          btn.addEventListener('click', () => close(btn.dataset.confirm === 'yes'));
        });
      }
    });
  },
  qrCode(text, size = 200){
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const cells = 25, cellSize = size / cells;
    let seed = Math.abs(hash) || 1;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let rects = '';
    const finder = (x, y) => {
      rects += `<rect x="${x*cellSize}" y="${y*cellSize}" width="${7*cellSize}" height="${7*cellSize}"/>`;
      rects += `<rect x="${(x+1)*cellSize}" y="${(y+1)*cellSize}" width="${5*cellSize}" height="${5*cellSize}" fill="#fff"/>`;
      rects += `<rect x="${(x+2)*cellSize}" y="${(y+2)*cellSize}" width="${3*cellSize}" height="${3*cellSize}"/>`;
    };
    finder(0,0); finder(cells-7,0); finder(0,cells-7);
    for (let y = 0; y < cells; y++){
      for (let x = 0; x < cells; x++){
        if (x < 8 && y < 8) continue;
        if (x >= cells-8 && y < 8) continue;
        if (x < 8 && y >= cells-8) continue;
        if (rand() > 0.5) rects += `<rect x="${x*cellSize}" y="${y*cellSize}" width="${cellSize}" height="${cellSize}"/>`;
      }
    }
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="currentColor">${rects}</svg>`;
  },
  haptic: U.haptic
};
