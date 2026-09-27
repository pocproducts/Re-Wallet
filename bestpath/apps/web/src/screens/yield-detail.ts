import { BP } from '../core/bp';
import { U } from '../core/utils';
import { Store } from '../core/store';
import { Router } from '../core/router';
import { Icons } from '../components/icons';

/* ---- screen: yield-detail ---- */
/* ---------- Yield Detail ---------- */
Router.register('yield-detail', {
  transition:'forward',
  render(){
    const s = Store.get();
    const totalYield = s.movements.filter(m => m.type === 'yield').reduce((sum, m) => sum + m.amount, 0);
    const rate = (BP.config.annualYieldRate * 100).toFixed(1);
    const projected = s.balance * BP.config.annualYieldRate;

    const history = [];
    let seed = Math.abs(Math.floor(s.balance * 100)) || 42;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 6; i >= 0; i--){
      const d = new Date(); d.setDate(d.getDate() - i);
      const label = i === 0 ? 'Hoy' : ['D','L','M','M','J','V','S'][d.getDay()];
      const base = s.balance * BP.config.annualYieldRate / 365;
      const value = Math.max(0.001, base * (0.6 + rand() * 0.8));
      history.push({ label, value, isToday: i === 0 });
    }
    const maxVal = Math.max(...history.map(h => h.value));
    const bars = history.map(h => {
      const heightPct = maxVal > 0 ? (h.value / maxVal) * 100 : 0;
      return `<div class="chart__bar ${h.isToday?'is-today':''}" style="height:${Math.max(6, heightPct)}%" title="${U.money(h.value)}"></div>`;
    }).join('');
    const labels = history.map(h => `<div class="chart__label ${h.isToday?'is-today':''}">${h.label}</div>`).join('');

    return `
      <div class="screen-head">
        <button class="icon-btn" data-action="back" aria-label="Volver">${Icons.back}</button>
        <span class="t-h2">Rendimiento</span>
        <span></span>
      </div>

      <div class="text-center mt-4 mb-6">
        <div class="t-caption t-tertiary">Ganado hasta hoy</div>
        <div class="t-display" style="font-size:36px;margin-top:6px;color:var(--rw-success)">+${U.money(totalYield)}</div>
        <div class="badge badge--success mt-3">${Icons.trendUpSm} ${rate}% anual</div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__label">Saldo actual</div>
          <div class="stat-card__value">${U.money(s.balance)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">Proyección 1 año</div>
          <div class="stat-card__value stat-card__value--accent">+${U.money(projected)}</div>
        </div>
      </div>

      <div class="section-label">Últimos 7 días</div>
      <div class="chart">${bars}</div>
      <div class="chart__labels">${labels}</div>

      <div class="divider mt-6"></div>

      <p class="t-body-sm t-secondary" style="line-height:22px">
        Tu dinero genera <b style="color:var(--rw-text-primary)">${rate}% anual</b> automáticamente.
        No tenés que hacer nada: se acredita todos los días y podés retirarlo cuando quieras.
      </p>

      <div class="mt-6" style="background:var(--rw-dark-800);border:1px solid var(--rw-dark-700);border-radius:var(--radius-lg);padding:var(--space-4)">
        <div class="row" style="gap:12px">
          <div class="list-item__icon" style="background:var(--rw-brand-soft);color:var(--rw-brand-500)">${Icons.chart}</div>
          <div class="grow">
            <div class="t-body-sm" style="font-weight:500">Sin locks, sin mínimos</div>
            <div class="t-caption t-tertiary mt-1">Retirá cuando quieras. No hay penalidades.</div>
          </div>
        </div>
      </div>`;
  }
});
