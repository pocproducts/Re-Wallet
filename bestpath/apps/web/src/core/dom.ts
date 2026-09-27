/** Required element lookup: fail loudly at boot rather than mysteriously later. */
export function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[rewallet] missing required element #${id}`);
  return node;
}

/** Overlay host for toasts, banners, sheets and the biometric prompt. */
export const layer = el('layer');

/** Screen stack host the router renders into. */
export const screensEl = el('screens');
