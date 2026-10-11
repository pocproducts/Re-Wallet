/**
 * EN QUÉ SE COBRA, antes de cuánto: las tres preguntas de la pantalla [1].
 *
 * ── El flujo que estos tests sostienen ──────────────────────────────────────
 *
 * ```
 * Cobrar -> [1] elegir en qué se cobra -> Confirmar -> [2] importe -> QR
 * ```
 *
 * Lo que se está fijando acá no es el color de la pantalla ni el texto del
 * botón. Es la regla que hace que el flujo valga:
 *
 * 1. **La lista sale del catálogo.** Monad, USDC y Solana no son tres strings
 *    escritos a mano; son lo que `/api/deposit-info` dice que se puede cobrar.
 * 2. **Una elección sin opción concreta no es una elección.** La familia sola no
 *    basta: hace falta la red, y para USDC eso son varias.
 * 3. **No se avanza sin elección.** El importe sin moneda es un cobro que nadie
 *    puede pagar, así que la pantalla [2] siempre tiene símbolo. Esta es la
 *    garantía que el `disabled` del botón no puede dar por sí solo.
 *
 * Si alguien vuelve a meter el selector de moneda en la pantalla del importe,
 * la regla 3 sigue pasando acá —y por eso estos tests existen en el servicio y
 * no en el componente—: la mezcla de pantallas es un problema de JSX, pero la
 * Elección es una regla de datos.
 */
import { describe, expect, it } from 'vitest';

import {
  canConfirmCharge,
  chargeChoiceLabel,
  chargeFamilies,
  resolveChargeChoice,
} from '../../src/services/chargeAssetChoice';
import { chargeAssetOptions, type ChargeAssetOption } from '../../src/services/paymentRequests';
import type { DepositNetworkView } from '../../src/services/depositInfo';
import type { DepositAsset } from '../../src/types/deposit.types';

/** Un activo del catálogo, con la escala que declara el backend. */
const catalogAsset = (symbol: string, decimals: number): DepositAsset => ({
  symbol,
  name: symbol,
  kind: 'dollar',
  decimals,
  native: false,
  token: null,
  balanceReadable: true,
});

/** Una red del catálogo, con lo que el backend declaró de ella. */
const catalogNetwork = (
  chain: DepositNetworkView['chain'],
  label: string,
  assets: readonly DepositAsset[],
): DepositNetworkView => ({
  chain,
  label,
  evmNetwork: chain === 'solana' ? null : 'eip155:1',
  hasWallet: true,
  address: '0xabc',
  assets,
});

/** El catálogo de un día normal: las tres familias, USDC en varias redes. */
const fullCatalog = (): readonly ChargeAssetOption[] =>
  chargeAssetOptions([
    catalogNetwork('monad', 'Monad', [catalogAsset('USDC', 6), catalogAsset('MON', 18)]),
    catalogNetwork('solana', 'Solana', [catalogAsset('SOL', 9), catalogAsset('USDC', 6)]),
    catalogNetwork('base', 'Base', [catalogAsset('USDC', 6)]),
    catalogNetwork('ethereum', 'Ethereum', [catalogAsset('USDC', 6)]),
  ]);

describe('chargeFamilies — la fila sale del catálogo, en el orden del producto', () => {
  it('ofrece las tres familias: Monad, USDC, Solana', () => {
    expect(chargeFamilies(fullCatalog()).map((family) => family.id)).toEqual(['MON', 'USDC', 'SOL']);
  });

  it('USDC trae todas sus redes; las otras dos traen una sola', () => {
    // La diferencia que después decide si hay que preguntar la red: USDC vive
    // en varias, y Monad y Solana no.
    const families = chargeFamilies(fullCatalog());
    expect(families.find((family) => family.id === 'USDC')?.options.length).toBeGreaterThan(1);
    expect(families.find((family) => family.id === 'MON')?.options).toHaveLength(1);
    expect(families.find((family) => family.id === 'SOL')?.options).toHaveLength(1);
  });

  it('cada red cuenta por separado dentro de USDC', () => {
    const usdc = chargeFamilies(fullCatalog()).find((family) => family.id === 'USDC');
    expect(usdc?.options.map((option) => option.chain).sort()).toEqual([
      'base',
      'ethereum',
      'monad',
      'solana',
    ]);
  });

  it('no ofrece lo que el catálogo no tiene: sin SOL, no hay chip de Solana', () => {
    const options = chargeAssetOptions([
      catalogNetwork('monad', 'Monad', [catalogAsset('USDC', 6), catalogAsset('MON', 18)]),
    ]);
    expect(chargeFamilies(options).map((family) => family.id)).toEqual(['MON', 'USDC']);
  });

  it('sin catálogo no hay nada que elegir, no una lista inventada', () => {
    expect(chargeFamilies([])).toEqual([]);
  });
});

describe('resolveChargeChoice — la elección concreta, símbolo y red', () => {
  it('sin tocar nada no hay elección, y sin elección no se avanza', () => {
    // El estado inicial de la pantalla [1]: nada elegido. Devolver la primera
    // opción "por las dudas" haría que el botón Confirmar quedara habilitado con
    // una moneda que nadie eligió.
    expect(resolveChargeChoice(chargeFamilies(fullCatalog()), null, null)).toBeNull();
    expect(canConfirmCharge(null)).toBe(false);
  });

  it('elegir Monad da MON en Monad, sin preguntar red', () => {
    const choice = resolveChargeChoice(chargeFamilies(fullCatalog()), 'MON', null);
    expect(choice?.symbol).toBe('MON');
    expect(choice?.chain).toBe('monad');
    expect(canConfirmCharge(choice)).toBe(true);
  });

  it('elegir Solana da SOL en Solana', () => {
    const choice = resolveChargeChoice(chargeFamilies(fullCatalog()), 'SOL', null);
    expect(choice?.symbol).toBe('SOL');
    expect(choice?.chain).toBe('solana');
  });

  it('elegir USDC sin tocar red usa la primera del catálogo, y se puede avanzar', () => {
    // Derivar la red en vez de esperar un toque es lo que evita que el botón
    // quede colgado pidiendo algo que la persona no tiene que saber.
    const choice = resolveChargeChoice(chargeFamilies(fullCatalog()), 'USDC', null);
    expect(choice?.symbol).toBe('USDC');
    expect(choice?.chain).toBe('monad');
    expect(canConfirmCharge(choice)).toBe(true);
  });

  it('la red tocada manda: USDC en USDC, en Solana, no en la primera', () => {
    const choice = resolveChargeChoice(chargeFamilies(fullCatalog()), 'USDC', 'solana');
    expect(choice?.symbol).toBe('USDC');
    expect(choice?.chain).toBe('solana');
    expect(choice?.chainLabel).toBe('Solana');
  });

  it('una familia que ya no está en el catálogo no avanza a ninguna parte', () => {
    // El catálogo se recarga entre la elección y el toque siguiente. Un chip que
    // ya no existe no puede dejar avanzar a una pantalla del importe.
    expect(resolveChargeChoice(chargeFamilies(fullCatalog()), 'AVAX', null)).toBeNull();
    expect(resolveChargeChoice([], 'MON', null)).toBeNull();
  });
});

describe('chargeChoiceLabel — lo que la pantalla del importe dice de la elección', () => {
  it('nombra el activo y la cadena, que es lo que ve quien paga', () => {
    const choice = resolveChargeChoice(chargeFamilies(fullCatalog()), 'USDC', 'solana');
    expect(chargeChoiceLabel(choice!)).toBe('Te van a pagar en USDC, en Solana');
  });
});