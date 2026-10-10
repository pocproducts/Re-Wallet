/**
 * Smoke: la fila MON del catálogo real llega a la lista de "Enviar crypto".
 *
 * Reproduce el recorrido del front end-to-end sin pantalla: catálogo del
 * dominio → respuesta del use case → `assetsBySymbol` del front → filtro
 * `sendChainByKey` del front. Si MON desaparece en alguna estación, el bug
 * del reporte vuelve a existir.
 */
import { describe, expect, it } from 'vitest';

import { readDepositInfo } from '../src/application/deposit-info/readDepositInfo';
import { assetsBySymbol } from '../../05. UI-UX/src/services/depositInfo';
import { sendChainByKey } from '../../05. UI-UX/src/config/send';

describe('MON llega a la lista de envío', () => {
  it('MON pasa el aplanado del front y el filtro de redes firmables', async () => {
    const read = readDepositInfo({
      wallets: {
        findByUserId: async () => [{ chain: 'ethereum', address: '0x0000000000000000000000000000000000000001' }],
      } as never,
    });
    const info = await read('user');

    const assets = assetsBySymbol(info.networks as never);
    const mon = assets.find((asset) => asset.symbol === 'MON');
    expect(mon).toBeDefined();
    expect(mon!.kind).toBe('crypto');
    expect(mon!.networks.some((network) => sendChainByKey(network.chain) !== null)).toBe(true);
  });
});
