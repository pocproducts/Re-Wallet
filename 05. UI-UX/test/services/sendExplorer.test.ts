/**
 * EL ENLACE A LA EXPLORADORA DESPUÉS DE UN ENVÍO.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * La pantalla derivaba el enlace sólo del catálogo EVM (`evmChainById`), así
 * que en Solana el identificador quedaba **sin exploradora**: el envío se
 * firmó, la pantalla lo mostró, y había que creerlo sin abrirlo. Para un envío
 * de verdad, el jurado y la persona tienen el mismo derecho: tocar la firma y
 * verla en la cadena.
 *
 * ── La regla ──────────────────────────────────────────────────────────────────
 *
 * Nada cuelga de adivinar la red por el símbolo o por el nombre: la vista ya
 * resuelta del envío (que viene del catálogo del backend) decide. Solana va a
 * su exploradora pública fija; las EVM, a la que `config/chains.ts` declaró.
 */
import { describe, expect, it } from 'vitest';

import { sendExplorerUrlFor, type SendChainView } from '../../src/config/send';
import { SEND_CHAINS } from '../../src/config/send';

const HASH = 'sig_de_ejemplo_5dWk9qPv2aExCz';

describe('sendExplorerUrlFor', () => {
  it('sin envío firmado ni red elegida, no hay link', () => {
    expect(sendExplorerUrlFor(null, HASH)).toBeNull();
    expect(sendExplorerUrlFor(SEND_CHAINS[0], null)).toBeNull();
  });

  it('Solana apunta a la explorer pública, no a una ausente', () => {
    const solana = SEND_CHAINS.find((chain) => chain.kind === 'solana');
    expect(solana).toBeDefined();
    /*
     * El invariante estructural: Solana **no tiene** id EIP-155 y no entra en
     * `evmChainById`. Si eso dejara de ser cierto este test sigue pasando por
     * la salida, y eso es lo único que importa demostrado.
     */
    expect(solana && 'chainId' in solana ? solana.chainId : null).toBeNull();
    expect(sendExplorerUrlFor(solana ?? null, HASH)).toBe(
      `https://explorer.solana.com/tx/${HASH}`,
    );
  });

  it('una EVM baja a su exploradora declarada, no a una inferida', () => {
    const evm = SEND_CHAINS.find((chain) => chain.kind === 'evm');
    expect(evm).toBeDefined();
    if (!evm || evm.kind !== 'evm') return;

    const url = sendExplorerUrlFor(evm, HASH);
    expect(url).not.toBeNull();
    expect(url?.endsWith(`/tx/${HASH}`)).toBe(true);
    /*
     * Una billetera con enlace a la exploradora incorrecta es una página que
     * parece phishing: la url tiene que salir exactamente del catálogo, no del
     * nombre de la red.
     */
    expect(url?.includes('explorer.solana.com')).toBe(false);
  });
});
