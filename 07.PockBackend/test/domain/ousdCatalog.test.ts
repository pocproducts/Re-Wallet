/**
 * OUSD, Y DÓNDE NO ESTÁ.
 *
 * ── Por qué este archivo es un test y no una fila en el catálogo ─────────────
 *
 * Porque la tentación con un activo que "viene de Visa y Stripe" es declararlo
 * en todas las redes que tenemos. Eso sería la forma más cara de mentir: la app
 * affirmaría "podés tener OUSD acá" sobre redes donde el contrato no existe, y
 * alguien confiaría en ese texto.
 *
 * ── Lo que los checks fijan ─────────────────────────────────────────────────
 *
 * Que OUSD se declare en Ethereum —y sólo en Ethereum—, con sus 18 decimales, y
 * que su ausencia en las otras redes quede escrita acá. Si mañana Origin lo
 * despliega en Monad, el cambio en el catálogo va a romper **este** test, que es
 * exactamente lo que se quiere: que aparezca en pantalla y en el pull request
 * alguien leyera que es nuevo.
 */
import { describe, expect, it } from 'vitest';

import { DEPOSIT_NETWORKS } from '../../src/domain/deposit/catalog';

/** Dónde está declarado OUSD, y dónde no. */
const redesConOUSD = (): string[] =>
  DEPOSIT_NETWORKS.filter((network) =>
    network.assets.some((asset) => asset.symbol === 'OUSD'),
  ).map((network) => network.chain);

const ousdDe = (chain: string) => {
  const red = DEPOSIT_NETWORKS.find((network) => network.chain === chain);
  return red?.assets.find((asset) => asset.symbol === 'OUSD') ?? null;
};

describe('OUSD en el catálogo', () => {
  it('está en Ethereum, que es donde vive', () => {
    expect(redesConOUSD()).toEqual(['ethereum']);
  });

  it('tiene 18 decimales, no 6', () => {
    // Verificado por `decimals()` contra la RPC de Ethereum. Declarar 6 haría
    // que el saldo leído fuera mil millones de veces más chico que el real, y
    // eso no se ve como un error de escala: se ve como una persona con muy poco.
    expect(ousdDe('ethereum')?.decimals).toBe(18);
  });

  it('es un dólar digital, no una cripto', () => {
    // Va por el camino "Depositar → Dólares digitales". Su diferencia con USDC
    // no es la categoría sino que el saldo crece.
    expect(ousdDe('ethereum')?.kind).toBe('dollar');
  });

  it('no está en Monad, ni en Base, ni en Solana, ni en las demás', () => {
    // El registry de Origin tiene una sola sección de token, Ethereum. Lo que
    // aparece como "Cross-Chain Strategy (Base)" es una estrategia de
    // rendimiento con contrato en las dos redes, no el token.
    expect(redesConOUSD()).not.toContain('monad');
    expect(redesConOUSD()).not.toContain('base');
    expect(redesConOUSD()).not.toContain('solana');
    expect(redesConOUSD()).not.toContain('polygon');
  });

  it('su contrato es el del registry oficial de Origin', () => {
    // https://docs.originprotocol.com/registry/contracts/ousd-registry
    expect(ousdDe('ethereum')?.token).toBe('0x2A8e1E676Ec238d8A992307B495b45B3fEAa5e86');
  });

  it('se puede leer su saldo, porque el contrato existe', () => {
    expect(ousdDe('ethereum')?.balanceReadable).toBe(true);
  });
});
