import { BP } from './bp';
import { screensEl } from './dom';

/* ---- router ---- */
export const Router = BP.router = {
  routes: {}, stack: [], current: null, busy: false,
  register(name, config){ Router.routes[name] = Object.assign({ render: () => '', transition: 'forward', replaceable: false }, config); return Router; },
  go(name, opts: any = {}){
    const route = Router.routes[name];
    if (!route){ console.warn('[BP] Ruta desconocida:', name); return; }
    if (Router.busy) return;
    const transition = opts.transition || route.transition;
    const replace = opts.replace || route.replaceable;
    Router.busy = true;
    const next = document.createElement('section');
    next.className = 'screen'; next.dataset.screen = name;
    next.innerHTML = `<div class="screen__inner">${route.render(opts.params || {})}</div>`;
    const prev = Router.current;
    if (prev){
      prev.classList.add(transition === 'forward' ? 'leave-forward' : transition === 'back' ? 'leave-back' : 'leave-fade');
      const prevEl = prev; setTimeout(() => prevEl.remove(), 420);
    }
    next.classList.add(transition === 'forward' ? 'enter-forward' : transition === 'back' ? 'enter-back' : 'enter-fade');
    screensEl.appendChild(next);
    if (replace && Router.stack.length) Router.stack[Router.stack.length - 1] = name;
    else Router.stack.push(name);
    Router.current = next;
    next.scrollTop = 0;
    if (location.hash !== '#/' + name) history.pushState({ screen:name }, '', '#/' + name);
    if (route.onMount) requestAnimationFrame(() => route.onMount(next, opts.params || {}));
    setTimeout(() => { Router.busy = false; }, 420);
    return next;
  },
  back(){
    if (Router.stack.length <= 1) return;
    Router.stack.pop();
    const target = Router.stack[Router.stack.length - 1];
    Router.stack.pop();
    Router.go(target, { transition:'back' });
  },
  replace(name, opts: any = {}){ Router.go(name, Object.assign({}, opts, { replace:true })); },
  init(fallback){
    const fromHash = (location.hash || '').replace('#/','');
    const start = Router.routes[fromHash] ? fromHash : fallback;
    Router.go(start, { transition:'fade' });
    window.addEventListener('popstate', () => {
      const name = (location.hash || '').replace('#/','');
      if (!Router.routes[name]) return;
      if (name === Router.current?.dataset.screen) return;
      Router.stack.pop(); Router.stack.pop();
      Router.go(name, { transition:'back' });
    });
  }
};
