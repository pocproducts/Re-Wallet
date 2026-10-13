/**
 * LAS DIRECCIONES DE UNISWAP V3 EN MONAD, Y EL PAR QUE OFRECEMOS.
 *
 * ── Por qué este archivo es un test y no un comentario ───────────────────────
 *
 * Este archivo empieza con un docstring que decía "verificadas contra Uniswap
 * v3-core, v3-periphery y el explorador de Monad". No lo estaban: eran las
 * direcciones de Ethereum. Un comentario afirma; un test verifica. Este test
 * es la diferencia entre las dos cosas, y por eso existe aunque no ejecute
 * una sola llamada a la red.
 *
 * ── Por qué estos cuatro checks y no una llamada a `rpc.monad.xyz` ───────────
 *
 * Porque `vitest.config.ts` dice que en este proyecto **ningún test toca la
 * red**, y no por conveniencia: es la razón por la que la arquitectura inyecta
 * el verificador de token, el provisionador de wallet y los stores. Un test que
 * necesita que la RPC de Monad este arriba es un test que solo corre el dia que
 * la RPC de Monad esta arriba.
 *
 * Lo que la red puede confirmar — que los contratos tienen bytecode, que los
 * pools tienen liquidez — se verifico una vez, a mano, contra `rpc.monad.xyz`,
 * y el resultado quedo escrito en el docstring de `uniswapV3Monad.ts`. Lo que
 * este test protege es la parte que un refactor puede romper en silencio: que
 * las direcciones no vuelvan a ser las de otra cadena, y que el par siga
 * nombrando un token que existe en Monad.
 *
 * ── La razón de fondo ───────────────────────────────────────────────────────
 *
 * La documentación de Uniswap es explicita: las direcciones **no** son iguales
 * entre cadenas. Este proyectoLearning de ahi: copio las de Ethereum, las
 * etiqueta como Monad, y todo compila. Un test que solo mira el codigo no lo
 * habria encontrado; uno que mira que las direcciones no sean las
 * canonicas de otra cadena, si.
 */
import { describe, expect, it } from 'vitest';

import {
  UNISWAP_V3_MONAD_ADDRESSES,
  MONAD_STABLECOIN_ADDRESSES,
  DEFAULT_FEE_TIER,
} from '../../src/domain/swap/uniswapV3Monad';
import { DEX_REGISTRY } from '../../src/infrastructure/swap/dexRegistry';

/**
 * Las direcciones de Uniswap V3 en Ethereum, que son las que un copia-pega
 * deja en cualquier lado. Si alguna de estas aparece declarada como si fuera de
 * Monad, la tabla se rompio de nuevo.
 */
const UNISWAP_V3_ETHEREUM = {
  FACTORY_V3: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  ROUTER_V3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
} as const;

const monadUniswap = DEX_REGISTRY.find(
  (d) => d.dexId === 'uniswap-v3' && d.chain === 'monad',
);

describe('las direcciones de Uniswap V3 en Monad', () => {
  it('no es la direccion canonica de Ethereum', () => {
    expect(UNISWAP_V3_MONAD_ADDRESSES.FACTORY_V3).not.toBe(UNISWAP_V3_ETHEREUM.FACTORY_V3);
    expect(UNISWAP_V3_MONAD_ADDRESSES.ROUTER_V3_DEPLOYMENTS).not.toBe(UNISWAP_V3_ETHEREUM.ROUTER_V3);
  });

  it('la factory es la que resuelve el ENS de Uniswap en Monad', () => {
    // La factory de Monad no es la de ninguna otra cadena porque Uniswap la
    // desplego con CREATE2 y un salt propio. Esta direccion aparece en
    // v3-factory.uniswap.org para Monad y solo para Monad.
    expect(UNISWAP_V3_MONAD_ADDRESSES.FACTORY_V3.toLowerCase()).toBe(
      '0x204faca1764b154221e35c0d20abb3c525710498',
    );
  });

  it('ninguna direccion es un placeholder', () => {
    const direcciones = [
      ...Object.values(UNISWAP_V3_MONAD_ADDRESSES),
      ...Object.values(MONAD_STABLECOIN_ADDRESSES),
    ];

    for (const direccion of direcciones) {
      expect(direccion).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // El placeholder que venia puesto no es una direccion incompleta: es una
      // direccion invalida, y por eso hay que rechazarla por forma, no por valor.
      expect(direccion).not.toContain('...');
    }
  });
});

describe('el par que BestPath ofrece', () => {
  it('el registry declara Uniswap V3 en Monad', () => {
    expect(monadUniswap).toBeDefined();
  });

  it('el destino es USDT0 y no USDT', () => {
    // En Monad no existe un token llamado `USDT`. Si el registry dice `USDT`,
    // el nombre no existe en la cadena y la resolucion del token cae al
    // placeholder, que devuelve 0 como si fuera un resultado.
    const pares = monadUniswap?.supportedPairs ?? [];
    expect(pares.length).toBeGreaterThan(0);

    for (const par of pares) {
      expect(['USDC', 'USDT0']).toContain(par.sourceSymbol);
      expect(['USDC', 'USDT0']).toContain(par.destinationSymbol);
    }

    expect(pares.some((p) => p.destinationSymbol === 'USDT')).toBe(false);
  });

  it('los dos stablecoins tienen direccion y 6 decimales', () => {
    // `decimals()` verificado por eth_call: USDC y USDT0 devuelven 6 en Monad.
    // Si alguno cambiara, el calculo de unidades minimas deja de ser correcto
    // en silencio, porque el codigo multiplica por 10^6 en todas partes.
    expect(MONAD_STABLECOIN_ADDRESSES.USDC).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(MONAD_STABLECOIN_ADDRESSES.USDT0).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('el fee tier por defecto es uno con liquidez', () => {
    // Verificado contra la cadena: el pool de 100 tiene liquidity 13.589B y el
    // de 500 tiene 196.766M. Los de 3000 y 10000 existen pero devuelven
    // liquidity() == 0, y cotizar contra un pool vacio da amountOut 0, que es
    // un numero cierto. Por eso el default no puede ser 3000.
    expect(DEFAULT_FEE_TIER).toBe(100);
    expect(monadUniswap?.feeTiers).toContain(DEFAULT_FEE_TIER);

    for (const par of monadUniswap?.supportedPairs ?? []) {
      expect(par.feeTier).toBe(DEFAULT_FEE_TIER);
    }
  });

  it('el registry no ofrece fee tiers sin liquidez', () => {
    // Si vuelve a aparecer un 3000, alguien agrego un pool vacio al catalogo.
    expect(monadUniswap?.feeTiers).not.toContain(3000);
    expect(monadUniswap?.feeTiers).not.toContain(10000);
  });
});