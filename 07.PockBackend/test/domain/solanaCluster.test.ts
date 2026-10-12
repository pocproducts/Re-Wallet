/**
 * EL CLÚSTER DE SOLANA DEL DESPLIEGUE.
 *
 * ── Por qué tiene test ──────────────────────────────────────────────────────
 *
 * Porque el clúster ahora es una decisión de configuración: un env lo cambia y
 * los tres lugares que leen la respuesta (la identidad de la cadena, el mint
 * del USDC y el preparador SPL) tienen que cambiar juntos. Si mañana alguien
 * agrega un cuarto módulo que esa relación no cobre, este archivo es el que
 * lo agarra.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  activeSolanaCluster,
  configureSolanaCluster,
  solanaClusterNameOf,
  SOLANA_DEVNET_SPEC,
  SOLANA_MAINNET_SPEC,
} from '../../src/domain/solana/cluster';
import { chainIdentityFor } from '../../src/domain/send/transfer';

describe('el clúster de Solana del despliegue', () => {
  afterEach(() => {
    // El estado es global al proceso: ningún test puede dejar al siguiente
    // firmando en devnet sin haberlo pedido.
    configureSolanaCluster('mainnet');
  });

  it('el default es mainnet y nada lo mueve sin la configuración', () => {
    expect(activeSolanaCluster()).toEqual(SOLANA_MAINNET_SPEC);
    expect(solanaClusterNameOf(undefined)).toBe('mainnet');
    expect(solanaClusterNameOf('')).toBe('mainnet');
    expect(solanaClusterNameOf('dev')).toBe('mainnet');
  });

  it('devnet sólo con el valor exacto', () => {
    expect(solanaClusterNameOf('devnet')).toBe('devnet');
    expect(solanaClusterNameOf('DEVNET')).toBe('mainnet');
  });

  it('con devnet configurado, la identidad de la cadena responde el CAIP-2 de devnet', () => {
    configureSolanaCluster('devnet');
    expect(chainIdentityFor('solana')).toEqual({ network: SOLANA_DEVNET_SPEC.network });
  });

  it('con mainnet volvemos a mainnet', () => {
    configureSolanaCluster('devnet');
    configureSolanaCluster('mainnet');
    expect(chainIdentityFor('solana')).toEqual({ network: SOLANA_MAINNET_SPEC.network });
  });
});
