/**
 * El importe del cobro, del teclado al backend.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * `chargeAmountToDecimal` validaba el importe contra `` `${whole}.${fraction}` ``,
 * una cadena que siempre lleva un punto. Cuando el importe no tenía decimales,
 * `fraction` venía vacío, la cadena evaluada terminaba en punto —`"1."`— y el
 * patrón `^\d{1,14}(?:\.\d{1,6})?$` la rechazaba porque exige de uno a seis
 * dígitos después del punto.
 *
 * El efecto en la app fue que **todo importe entero era imposible de cobrar**:
 * `1`, `10`, `100` devolvían "El importe no es un número válido", mientras que
 * `1,5` pasaba sin problema. El mensaje señalaba un problema de formato y el
 * bug era de una línea, así que nadie lo conectó con el cobro.
 *
 * Lo que把这些 tests fijan es la **forma del importe completo**, no un caso
 * suelto: si alguien vuelve a validar una reconstrucción distinta de la que
 * devuelve, el caso entero vuelve a fallar acá.
 */
import { describe, expect, it } from 'vitest';

import {
  chargeAmountToDecimal,
  chargeAssetOptions,
  chargeChainLabel,
  normalizePaymentRequest,
} from '../../src/services/paymentRequests';
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
  address: string | null = '0xabc',
): DepositNetworkView => ({
  chain,
  label,
  evmNetwork: chain === 'solana' ? null : 'eip155:1',
  hasWallet: address !== null,
  address,
  assets,
});

describe('chargeAmountToDecimal — los importes enteros', () => {
  it('acepta un importe sin decimales, que es el caso que estaba roto', () => {
    // El que fallaba en la beta: teclear `1` y que la app lo rechazara.
    expect(chargeAmountToDecimal('1')).toBe('1');
    expect(chargeAmountToDecimal('10')).toBe('10');
    expect(chargeAmountToDecimal('100')).toBe('100');
    expect(chargeAmountToDecimal('1')).not.toContain('.');
  });

  it('no le agrega un punto decimal que la persona no escribió', () => {
    // `1` es `1`, no `1.` ni `1.0`: el backend recibe lo que se tecleó.
    expect(chargeAmountToDecimal('7')).toBe('7');
    expect(chargeAmountToDecimal('250')).toBe('250');
  });

  it('sigue aceptando los importes con decimales que ya funcionaban', () => {
    expect(chargeAmountToDecimal('1,5')).toBe('1.5');
    expect(chargeAmountToDecimal('1,50')).toBe('1.50');
    expect(chargeAmountToDecimal('0,001')).toBe('0.001');
    expect(chargeAmountToDecimal('12,999999')).toBe('12.999999');
  });

  it('entiende el punto como separador de miles, como el resto de la app', () => {
    expect(chargeAmountToDecimal('1.234')).toBe('1234');
    expect(chargeAmountToDecimal('1.234,56')).toBe('1234.56');
  });
});

describe('chargeAmountToDecimal — lo que tiene que seguir rechazado', () => {
  it('rechaza el cero y los ceros con decimales de relleno', () => {
    // Un cobro de $0 no es un cobro, y mandarlo rompe el CHECK de la base
    // (`payment_requests_amount_positive`). El backend no tiene que ser el
    // que lo descubra.
    for (const text of ['0', '0,00', '0,000', '000']) {
      expect(() => chargeAmountToDecimal(text)).toThrow(RangeError);
    }
  });

  it('rechaza lo que no es un importe', () => {
    for (const text of ['', '   ', 'abc', '-1', '1,5,5']) {
      expect(() => chargeAmountToDecimal(text)).toThrow(RangeError);
    }
  });

  it('lee todos los puntos como separadores de miles, y eso es lo que dice', () => {
    // `1.2.3` son mil doscientos treinta y tres, no un importe mal formado: el
    // punto es separador de miles en el teclado argentino y se quitan todos.
    // Fijarlo acá evita que alguien "corrija" esto creyendo que es un error de
    // formato, y rompa `1.234` que sí es el caso real.
    expect(chargeAmountToDecimal('1.2.3')).toBe('123');
    expect(chargeAmountToDecimal('1.234.567')).toBe('1234567');
  });

  it('acepta el límite de enteros y rechaza el que lo pasa', () => {
    // Veinte enteros es lo que entra en `numeric(38,18)`: veintiuno ya es otro
    // cobro, y no uno recortado en silencio.
    expect(chargeAmountToDecimal('12345678901234567890')).toBe('12345678901234567890');
    expect(() => chargeAmountToDecimal('123456789012345678901')).toThrow(RangeError);
  });

  it('normaliza los ceros de adelante sin inventar decimales', () => {
    expect(chargeAmountToDecimal('0007')).toBe('7');
    expect(chargeAmountToDecimal('007,50')).toBe('7.50');
    // Una coma sin nada detrás es un importe entero, no un importe roto.
    expect(chargeAmountToDecimal('5,')).toBe('5');
  });

  it('recorta los decimales de más en vez de redondear', () => {
    // Mandar plata que no se escribió, y hacia arriba, es peor que recortarla.
    // Con el techo de 18, lo que se recorta es de más de 18 decimales: un
    // imposible de representar, no el caso normal de ETH o MON, que llegan
    // enteros a 18.
    expect(chargeAmountToDecimal(`0,${'1234567890123456789'}`)).toBe('0.123456789012345678');
    expect(chargeAmountToDecimal(`1,${'9999999999999999999'}`)).toBe('1.999999999999999999');
  });

  it('guarda los 18 decimales de un activo nativo sin perder ni el último', () => {
    // El caso que motivó subir el techo: con 6 decimales, teclear un wei de más
    // recortaba en silencio y se mandaba menos plata de la escrita.
    expect(chargeAmountToDecimal('0,000000000000000001')).toBe('0.000000000000000001');
    expect(chargeAmountToDecimal('1,000000000000000001')).toBe('1.000000000000000001');
    expect(chargeAmountToDecimal('0,1')).toBe('0.1');
  });
});

/*
 * Un cobro que no dice en qué se cobra no es un cobro: es un importe con una
 * pantalla alrededor. Por eso la lectura de un cobro sin cadena —o sin símbolo—
 * devuelve `null`, y la pantalla dice que no pudo leer el cobro en vez de
 * dibujar un importe que nadie podría pagar.
 */
describe('normalizePaymentRequest — el cobro tiene que decir cadena y activo', () => {
  const valid = {
    id: 'abc123',
    amount: '10',
    note: null,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2024-01-02T00:00:00.000Z',
    requesterTag: 'ana',
    chain: 'monad',
    asset: { symbol: 'USDC', decimals: 6 },
  };

  it('lee un cobro que declara cadena y símbolo', () => {
    const charge = normalizePaymentRequest(valid);
    expect(charge?.chain).toBe('monad');
    expect(charge?.asset.symbol).toBe('USDC');
    expect(charge?.asset.decimals).toBe(6);
  });

  it('no muestra un cobro al que le falta la cadena o el símbolo', () => {
    expect(normalizePaymentRequest({ ...valid, chain: undefined })).toBeNull();
    expect(normalizePaymentRequest({ ...valid, asset: undefined })).toBeNull();
    expect(normalizePaymentRequest({ ...valid, asset: { symbol: '' } })).toBeNull();
    expect(normalizePaymentRequest({ ...valid, chain: 'no-esta-cadena' })).toBeNull();
  });

  it('no inventa la escala del activo: sin decimales válidos, `null`', () => {
    // La escala la resuelve el servidor. Si no se pudo leer, queda `null` y la
    // pantalla no la usa para nada.
    expect(normalizePaymentRequest({ ...valid, asset: { symbol: 'USDC' } })?.asset.decimals).toBeNull();
    expect(normalizePaymentRequest({ ...valid, asset: { symbol: 'USDC', decimals: 2.5 } })?.asset.decimals).toBeNull();
  });
});

/*
 * La lista del selector sale del catálogo de depósito, que es el mismo que usan
 * depósito y envío. Estos casos fijan las tres reglas que la sostienen: sale de
 * ahí, cada red cuenta por separado, y un activo sin escala conocida no se
 * ofrece.
 */
describe('chargeAssetOptions — la lista sale del catálogo', () => {
  it('ofrece un par por activo y red, en el orden del catálogo', () => {
    const options = chargeAssetOptions([
      catalogNetwork('monad', 'Monad', [catalogAsset('USDC', 6), catalogAsset('MON', 18)]),
      catalogNetwork('solana', 'Solana', [catalogAsset('USDC', 6)]),
    ]);

    expect(options.map((option) => option.key)).toEqual(['monad:USDC', 'monad:MON', 'solana:USDC']);
    expect(options[0]?.chainLabel).toBe('Monad');
    expect(options[0]?.decimals).toBe(6);
  });

  it('no inventa la escala: la de cada activo es la que declara el catálogo', () => {
    // El backend manda la escala de cada activo en cada red. Un activo de 18
    // decimales no se acerca a uno de 6 porque las dos filas seArmen juntas.
    const options = chargeAssetOptions([
      catalogNetwork('monad', 'Monad', [catalogAsset('USDC', 6)]),
      catalogNetwork('solana', 'Solana', [catalogAsset('SOL', 9)]),
    ]);
    expect(options.find((option) => option.key === 'monad:USDC')?.decimals).toBe(6);
    expect(options.find((option) => option.key === 'solana:SOL')?.decimals).toBe(9);
  });

  it('devuelve una lista vacía cuando el catálogo no llegó, no una lista inventada', () => {
    expect(chargeAssetOptions([])).toEqual([]);
  });
});

describe('chargeChainLabel — el nombre de la cadena, en castellano', () => {
  it('usa el nombre que ya muestra el resto de la app', () => {
    expect(chargeChainLabel('monad')).toBe('Monad');
    expect(chargeChainLabel('solana')).toBe('Solana');
  });
});