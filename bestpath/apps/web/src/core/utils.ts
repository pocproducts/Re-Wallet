import { BP } from './bp';

/* ---- utils ---- */
export const U = BP.utils = {
  money(n){ return new Intl.NumberFormat(BP.config.locale,{style:'currency',currency:BP.config.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0); },
  moneyPlain(n){ return new Intl.NumberFormat(BP.config.locale,{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(Number(n)||0)); },
  timeAgo(ts){
    const s = Math.max(1, Math.floor((Date.now() - ts)/1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.floor(s/60); if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m/60); if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h/24); return `hace ${d} d`;
  },
  uid(){ return Math.random().toString(36).slice(2,10); },
  reducedMotion(){ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; },
  esc(str){ return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); },
  isEmail(v){ return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v).trim()); },
  isEthAddress(v){ return /^0x[a-fA-F0-9]{40}$/.test(String(v).trim()); },
  isSolAddress(v){ return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v).trim()); },
  isAddress(v){ return U.isEthAddress(v) || U.isSolAddress(v); },
  haptic(ms = 8){ if (navigator.vibrate){ try{ navigator.vibrate(ms); }catch(e){} } },
  countUp(el, to, duration = 600, from = 0){
    if (!el) return;
    if (U.reducedMotion()){ el.textContent = U.money(to); return; }
    const start = performance.now(); const delta = to - from;
    (function frame(now){
      const t = Math.min(1, (now - start)/duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = U.money(from + delta*eased);
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = U.money(to);
    })(start);
  },
  wait(ms){ return new Promise(r => setTimeout(r, ms)); },
  rand(min,max){ return Math.random()*(max-min)+min; },
  initialsFrom(name){ return String(name||'?').split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); },
  colorFrom(seed){
    // Avatar hues. Deliberately NOT brand green: an avatar should never read as an
    // action, and a sea of green circles would fight the CTA.
    const colors = ['#1DB981','#FF4D5A','#3D8BFF','#FFC857','#FF6BAE','#35C994','#2E7DFF','#FF8F6B'];
    let h = 0; for (const c of String(seed)) h = (h*31 + c.charCodeAt(0)) | 0;
    return colors[Math.abs(h) % colors.length];
  }
};

