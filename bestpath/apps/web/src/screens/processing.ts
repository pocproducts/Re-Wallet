import { Router } from '../core/router';

/* ---- screen: processing ---- */
/* ---------- Procesamiento ---------- */
Router.register('processing', {
  transition:'fade', replaceable:true,
  render(params: any = {}){
    const type = params.type || 'deposit';
    const config = {
      deposit: { title:'Añadiendo tu dinero...', sub:'Estamos encontrando la<br>mejor forma de hacerlo crecer.' },
      send:    { title:'Enviando...',             sub:'Estamos confirmando la<br>operación de forma segura.' }
    }[type] || { title:'Procesando...', sub:'Un momento.' };
    return `
      <div class="grow"></div>
      <div class="text-center">
        <div class="pulse" style="margin:0 auto">
          <span class="pulse__ring"></span><span class="pulse__ring"></span><span class="pulse__ring"></span>
          <span class="pulse__core"></span>
        </div>
        <h2 class="t-h2 mt-6" style="font-size:18px">${config.title}</h2>
        <p class="t-body-sm t-secondary mt-3" data-processing-sub>${config.sub}</p>
        <div class="progress mt-6" style="margin-left:auto;margin-right:auto" data-progress></div>
        <div class="mt-6" data-processing-actions></div>
      </div>
      <div class="grow"></div>`;
  }
});
