import { U } from '../core/utils';
import { Icons } from './icons';

/* ---- shared render helpers ---- */
export function tabbar(active = 'home'){
  const item = (key, label, icon) => `<button class="tabbar__item" ${active===key?'aria-current="page"':''} data-action="tab" data-tab="${key}">${icon}<span>${label}</span></button>`;
  return `<nav class="tabbar" aria-label="Navegación principal">
    ${item('home','Inicio',Icons.home)}
    ${item('activity','Actividad',Icons.activity)}
    ${item('account','Cuenta',Icons.user)}
  </nav>`;
}

export function contactAvatar(contact, size = 40){
  const c = contact.color || U.colorFrom(contact.tag || contact.name || 'x');
  const initials = contact.initials || U.initialsFrom(contact.name) || '?';
  return `<div class="contact-avatar" style="width:${size}px;height:${size}px;background:${c};font-size:${Math.round(size*0.35)}px">${U.esc(initials)}</div>`;
}

export function contactRow(contact, withChevron = true){
  return `<div class="contact-row" data-contact-id="${contact.id}" role="button" tabindex="0">
    ${contactAvatar(contact, 40)}
    <div class="grow" style="min-width:0">
      <div class="t-body-sm" style="font-weight:500">${U.esc(contact.name)}</div>
      <div class="t-caption t-tertiary">${U.esc(contact.tag)}</div>
    </div>
    ${withChevron ? `<span style="color:var(--rw-text-tertiary)">${Icons.chevronRight}</span>` : ''}
  </div>`;
}

export function movementRow(m){
  const iconMap = {
    deposit: { cls:'deposit', svg:Icons.arrowDown },
    send:    { cls:'send',    svg:Icons.arrowUp },
    yield:   { cls:'yield',   svg:Icons.trend }
  };
  const ic = iconMap[m.type] || iconMap.deposit;
  const sign = m.amount >= 0 ? '+' : '−';
  return `<div class="movement" data-movement-id="${m.id}">
    <div class="movement__icon movement__icon--${ic.cls}">${ic.svg}</div>
    <div class="movement__main">
      <div class="movement__title">${U.esc(m.title)}</div>
      <div class="movement__time" data-time="${m.at}">${U.timeAgo(m.at)}</div>
    </div>
    <div class="movement__amount ${m.amount >= 0 ? 'movement__amount--pos' : ''}">
      ${sign}$${U.moneyPlain(m.amount)}
    </div>
  </div>`;
}

export function groupByDate(movements){
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 7 * 86400000;
  const buckets = { today: [], yesterday: [], week: [], older: [] };
  movements.forEach(m => {
    if (m.at >= startOfToday) buckets.today.push(m);
    else if (m.at >= startOfYesterday) buckets.yesterday.push(m);
    else if (m.at >= startOfWeek) buckets.week.push(m);
    else buckets.older.push(m);
  });
  const labels = { today:'Hoy', yesterday:'Ayer', week:'Esta semana', older:'Anteriores' };
  return Object.keys(buckets).filter(k => buckets[k].length).map(k => ({ label:labels[k], items:buckets[k] }));
}
