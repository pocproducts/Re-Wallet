/**
 * DATA BOUNDARY — the only module that knows where data comes from.
 *
 * The next phase replaces this file wholesale with a real client. Nothing
 * outside it may reach past it, and it must not leak mock data upward.
 */
import { BP } from './bp';
import { U } from './utils';
import { Store } from './store';
import { normalizeTag, isValidTag } from '@bestpath/shared/tag';

/* ---- api ---- */
export const Api = BP.api = {
  async addMoney(amount, asset){
    await U.wait(200);
    if (!navigator.onLine) return { ok:false, error:'offline' };
    if (!(amount >= BP.config.minAmount)) return { ok:false, error:'amount' };
    return { ok:true, amount:Number(amount), asset: asset || 'USDC' };
  },
  async sendMoney(amount, recipient){
    await U.wait(200);
    if (!navigator.onLine) return { ok:false, error:'offline' };
    const s = Store.get();
    if (amount > s.balance) return { ok:false, error:'insufficient' };
    return { ok:true, amount, recipient };
  },
  async createPaymentRequest(amount, tag){
    await U.wait(300);
    const url = `https://rewallet.app/pay/${tag.replace('@','')}/${amount.toFixed(2)}`;
    return { ok:true, url, id:U.uid(), amount, tag };
  },

  /**
   * Is this handle free, and what would the server suggest instead?
   *
   * The client sanitises; the SERVER owns availability. The mock pretends to be
   * the server so the UI can be built and tested before wiring, and so the
   * wiring phase only has to replace this file.
   *
   * TODO(feature: passkey) — back this with GET /tags/check?tag=…
   */
  async checkTag(tag){
    await U.wait(180);
    if (!navigator.onLine) return { ok:false, error:'offline' };
    const clean = normalizeTag(tag);
    if (!isValidTag(clean)) return { ok:false, error:'invalid' };
    // Stand-ins already "taken" so the flow can be exercised in the demo.
    const TAKEN = new Set(['ana','admin','rewallet','soporte','test']);
    const available = !TAKEN.has(clean);
    return {
      ok:true,
      available,
      tag: clean,
      // What the server would allocate if this one is taken.
      suggestion: available ? clean : `${clean}`.slice(0, 22) + '2',
    };
  }
};

