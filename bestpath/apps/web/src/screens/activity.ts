import { BP } from '../core/bp';
import { Store } from '../core/store';
import { Router } from '../core/router';
import { Icons } from '../components/icons';
import { groupByDate, movementRow, tabbar } from '../components';

/* ---- screen: activity ---- */
/* ---------- Actividad ---------- */
Router.register('activity', {
  transition:'fade',
  render(){
    const s = Store.get();
    const filters = [
      { key:'all', label:'Todos' },
      { key:'send', label:'Envíos' },
      { key:'deposit', label:'Depósitos' },
      { key:'yield', label:'Rendimiento' }
    ];
    const groups = groupByDate(s.movements);
    const groupsHTML = groups.length
      ? groups.map(g => `<div class="date-group"><div class="date-group__label">${g.label}</div>${g.items.map(m => movementRow(m)).join('')}</div>`).join('')
      : `<div class="empty">
           <div class="illo" style="width:88px;height:88px;background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.05),transparent 70%);border-color:var(--rw-dark-700);color:var(--rw-text-tertiary)">${Icons.activity}</div>
           <div class="t-h3 mt-4">Sin movimientos</div>
           <div class="t-body-sm t-tertiary">Aquí verás toda tu actividad.</div>
         </div>`;

    return `
      <div class="screen-head">
        <span class="t-h2">Actividad</span>
        <button class="icon-btn icon-btn--sm" data-action="settings" aria-label="Perfil">${Icons.gear}</button>
      </div>
      <div class="filter-row" style="margin-top:12px;margin-bottom:20px">
        ${filters.map(f => `<button class="filter-chip ${f.key==='all'?'is-active':''}" data-filter="${f.key}">${f.label}</button>`).join('')}
      </div>
      <div data-activity-list style="flex:1;min-height:0">${groupsHTML}</div>
      ${tabbar('activity')}`;
  },
  onMount(root){
    root.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        const filter = chip.dataset.filter;
        const s = Store.get();
        const filtered = filter === 'all' ? s.movements : s.movements.filter(m => m.type === filter);
        const groups = groupByDate(filtered);
        const listEl = root.querySelector('[data-activity-list]');
        listEl.innerHTML = groups.length
          ? groups.map(g => `<div class="date-group"><div class="date-group__label">${g.label}</div>${g.items.map(m => movementRow(m)).join('')}</div>`).join('')
          : `<div class="empty" style="padding:40px 20px"><div class="t-h3">Sin movimientos</div><div class="t-body-sm t-tertiary mt-1">No hay nada en este filtro.</div></div>`;
      });
    });
    root.addEventListener('click', (e) => {
      const row = e.target.closest('[data-movement-id]');
      if (!row) return;
      BP.flow.openMovementDetail(row.dataset.movementId);
    });
  }
});

/* ---------- Procesamiento ---------- */
