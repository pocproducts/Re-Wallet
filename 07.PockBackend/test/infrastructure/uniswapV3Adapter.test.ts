/**
 * EL ADAPTADOR DE UNISWAP V3 RESPONDE, Y SI NO SABE RESPONDER LO DICE.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * `findPool` llamaba a un `POOL_MAP` que no existía en ningún módulo alcanzable
 * desde el adaptador. En runtime eso no era una cotización incorrecta: era un
 * `ReferenceError` la primera vez que alguien pedía un swap. El camino entero
 * de cotización estaba sin backing, y todo lo demás —la pantalla, el precio, el
 * botón— depended de él.
 *
 * Peor: el TypeScript lo había delatado con un `TS2304` desde el día que se
 * escribió, y el check estaba en rojo. Un tipo que no compila es un bug que ya
 * se estaba announceando; lo que faltaba era que alguien lo leyera.
 *
 * ── Por qué el arreglo es el índice de la configuración ────────────────────
 *
 * `config.supportedPairs` es lo que el factory arma desde `dexRegistry`, con el
 * símbolo, su fee tier y **los tokens ya resueltos a dirección**. Un par
 * configurado es un pool; un par que no está configurado no lo es. No hay un
 * segundo registro que mantener同步 con el primero.
 *
 * ── El caso de "no hay pool" no es un error ─────────────────────────────────
 *
 * Es `PAIR_NOT_SUPPORTED`, una respuesta que el caso de uso ya sabe dar. Un par
 * que el producto no ofrece tiene que decir que no se ofrece, no romper: son
 * dos hechos distintos y confundirlos convierte una limitación declarada en
 * una falla.
 */
import { describe, expect, it } from 'vitest';

import { createUniswapV3Adapter, type UniswapV3ChainConfig } from '../../src/infrastructure/swap/adapters/uniswapV3Adapter';

const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const USDT0 = '0x000000000000000000000000000000000000dEaD';

const configDe = (pares: UniswapV3ChainConfig['supportedPairs']): UniswapV3ChainConfig => ({
  chain: 'monad',
  routerAddress: '0x0000000000000000000000000000000000000002',
  factoryAddress: '0x0000000000000000000000000000000000000003',
  rpcUrl: 'https://rpc.monad.xyz',
  feeTiers: [100],
  supportedPairs: pares,
});

const par = (origen: string, destino: string, feeTier = 100) => ({
  sourceSymbol: origen,
  destinationSymbol: destino,
  feeTier,
  tokenIn: origen === 'USDC' ? USDC : USDT0,
  tokenOut: destino === 'USDC' ? USDC : USDT0,
});

describe('el adaptador de Uniswap V3 no revienta al no saber un par', () => {
  it('un par que no está configurado se dice que no se soporta, no se rompe', async () => {
    // Este es el bug: con el `POOL_MAP` inexistente, acá tiraba ReferenceError.
    const adapter = createUniswapV3Adapter({ config: configDe([]) });

    const quote = await adapter.getQuote(
      'USDC',
      'USDT0',
      'monad',
      1_000_000n,
      50,
    );

    expect(quote).toEqual({ status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' });
  });

  it('otra cadena que no sea la configurada también se dice que no se soporta', async () => {
    const adapter = createUniswapV3Adapter({ config: configDe([par('USDC', 'USDT0')]) });

    const quote = await adapter.getQuote('USDC', 'USDT0', 'ethereum', 1_000_000n, 50);

    expect(quote).toEqual({ status: 'unreadable', reason: 'PAIR_NOT_SUPPORTED' });
  });

  it('el par configurado se anuncia como soportado, sin tocar la red', async () => {
    const adapter = createUniswapV3Adapter({ config: configDe([par('USDC', 'USDT0')]) });

    const pares = await adapter.getSupportedPairs();

    expect(pares).toHaveLength(1);
    expect(pares[0]?.sourceSymbol).toBe('USDC');
    expect(pares[0]?.destinationSymbol).toBe('USDT0');
  });

  it('la lista de pares sale de la configuración, no de una constante', async () => {
    // Si alguna vez `getSupportedPairs` vuelve a hardcodear pares, esto falla: la
    // pantalla ofrecería algo que la configuración no tiene detrás.
    const conDos = createUniswapV3Adapter({
      config: configDe([par('USDC', 'USDT0'), par('USDT0', 'USDC')]),
    });
    const conNinguno = createUniswapV3Adapter({ config: configDe([]) });

    expect(await conDos.getSupportedPairs()).toHaveLength(2);
    expect(await conNinguno.getSupportedPairs()).toHaveLength(0);
  });
});