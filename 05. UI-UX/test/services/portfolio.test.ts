/**
 * `src/services/portfolio.ts`: la aritmética de saldos por cadena y la pregunta
 * "¿está vacía o no lo sé?".
 *
 * La segunda es la que importa: un `—` es "no lo sé" y un `0,00` es "lo sé", y
 * confundirlas hace que la app anuncie una billetera con plata como vacía.
 */

import { describe, expect, it } from 'vitest';
import {
  allBalancesAreZero,
  chainLabel,
  CRYPTO_DISPLAY_DECIMALS,
  formatAssetAmount,
  formatScaled,
  formatScaledTrimmed,
  normalizePortfolio,
  splitUsdDisplay,
  sumAssetAmounts,
  toScaled,
  unreadableChainMessage,
  WALLET_DISPLAY_DECIMALS,
  type PortfolioChainOutcome,
} from '../../src/services/portfolio';

describe('toScaled — el importe textual del backend a entero exacto', () => {
  it('rellena los decimales que faltan y recorta los que sobran, sin lanzar', () => {
    // El backend manda texto, no entero. Un saldo con un decimal de más no
    // debería derribar una pantalla que sólo está pintando un número.
    expect(toScaled('1', 6, 6)).toBe(1000000n);
    expect(toScaled('1.5', 6, 6)).toBe(1500000n);
    expect(toScaled('1.5555555', 6, 6)).toBe(1555555n);
  });

  it('lee un saldo de 18 decimales sin que un double se coma un dígito', () => {
    // `Number('0.1') + Number('0.2')` da 0.30000000000000004. Con `bigint` el
    // mismo saldo da exactamente 300000000000000000.
    expect(toScaled('0.1', 18, 18) + toScaled('0.2', 18, 18)).toBe(300000000000000000n);
  });

  it('escala al orden de magnitud pedido sin redondear', () => {
    // 1,5 a 6 decimales escalado a 18 son 1,5e18 wei. Escalar a la izquierda
    // es la operación que hace `sumAssetAmounts` antes de sumar cadenas con
    // escalas distintas: si acá se perdiera un orden de magnitud, la suma
    // multiplicaría o dividiría la plata por un billón en silencio.
    expect(toScaled('1.5', 6, 18)).toBe(1500000000000000000n);
  });
});

describe('formatScaled — el único redondeo, en enteros', () => {
  it('sube la mitad exacta y deja el número justo debajo', () => {
    expect(formatScaled(5n, 1, 0)).toBe('1');
    expect(formatScaled(4n, 1, 0)).toBe('0');
    expect(formatScaled(-5n, 1, 0)).toBe('-1');
  });

  it('nunca imprime un "-0" para una pérdida de centavos que no ocurrió', () => {
    // -0,004 redondeado a cero es cero. Un "-0,00" en pantalla parece una
    // pérdida real de plata.
    expect(formatScaled(-4n, 3, 0)).toBe('0');
    expect(formatScaled(0n, 2, 2)).toBe('0,00');
  });

  it('pinta los centavos siempre, porque son parte del número', () => {
    expect(WALLET_DISPLAY_DECIMALS).toBe(2);
    expect(formatScaled(5n, 3, 2)).toBe('0,01');
    expect(formatScaled(1n, 6, 2)).toBe('0,00');
  });
});

describe('formatScaledTrimmed — la cantidad de cripto, sin ceros de relleno', () => {
  it('muestra un cero como "0" y no como "0,000000"', () => {
    // Una billetera leída y vacía tiene que parecer vacía. "0,000000" parece
    // un número que se pudo calcular hasta el sexto decimal.
    expect(CRYPTO_DISPLAY_DECIMALS).toBe(6);
    expect(formatScaledTrimmed(0n, 6)).toBe('0');
    expect(formatScaledTrimmed(1000000n, 6)).toBe('1');
    expect(formatScaledTrimmed(1500000n, 6)).toBe('1,5');
  });

  it('agrupa los miles sin Miles en la parte entera', () => {
    expect(formatScaledTrimmed(1234567890123456n, 6)).toBe('1.234.567.890,123456');
  });
});

describe('sumAssetAmounts — sumar saldos de escalas distintas, exacto', () => {
  it('devuelve null, y no "0,00", cuando no hay ninguna cadena que leer', () => {
    // Una lista vacía no es un cero leído: no se leyó nada. "0,00" sería
    // afirmar que la billetera está vacía sin haber preguntado.
    expect(sumAssetAmounts([])).toBeNull();
  });

  it('devuelve "0,00" para un cero que sí se leyó', () => {
    // acá sí: un `raw: "0"` es un hecho, y una billetera vacía vale cero.
    expect(sumAssetAmounts([{ amount: '0', decimals: 6 }])).toBe('0,00');
  });

  it('suma 6 decimales con 18 sin perder ni inventar un dígito', () => {
    // Sumar en `number` haría que 0,1 + 0,2 dé 0,30000000000000004. Acá el
    // total es exactamente 0,30. Y el 6 con el 18 obliga a reescalar antes de
    // sumar, que es donde un orden de magnitud se pierde sin que salte ningún
    // tipo.
    expect(
      sumAssetAmounts([
        { amount: '0.1', decimals: 18 },
        { amount: '0.2', decimals: 18 },
      ]),
    ).toBe('0,30');
    expect(
      sumAssetAmounts([
        { amount: '1', decimals: 6 },
        { amount: '0.000000000000000001', decimals: 18 },
      ]),
    ).toBe('1,00');
  });

  it('pierde el centavo con un double en una magnitud donde el error se ve', () => {
    // 999.999.999.999.999,49 + 0,02 = ...999,51 exacto. En `number` el primer
    // operando ya no se representa y la suma da ...999,50: un centavo de
    // diferencia en una billetera de un billón de pesos.
    expect(
      sumAssetAmounts([
        { amount: '999999999999999.49', decimals: 18 },
        { amount: '0.02', decimals: 18 },
      ]),
    ).toBe('999.999.999.999.999,51');
  });

  it('no reescala el número que ya viene en texto decimal a 18 decimales', () => {
    // Un saldo de aUSDC llega a 18 decimales. Tratar ese texto como si fuera el
    // entero escalado multiplicaría la plata por 10^18: 0,12 dólares pintado
    // como 123.456.789.012.345.678.
    expect(sumAssetAmounts([{ amount: '0.123456789012345678', decimals: 18 }])).toBe('0,12');
  });
});

describe('formatAssetAmount — un activo ilegible no formatea un saldo', () => {
  it('devuelve vacío para un activo que no se pudo leer, en vez de "0"', () => {
    // Quien lo pide lo muestra como "no lo sé". Un "0" sería decir que la
    // persona no tiene ese activo.
    expect(formatAssetAmount({ symbol: 'USDC', unit: 'USDC', decimals: 6, status: 'unreadable', raw: null, amount: null, reason: 'RPC_UNAVAILABLE' })).toBe('');
    expect(formatAssetAmount({ symbol: 'USDC', unit: 'USDC', decimals: 6, status: 'ok', raw: '1', amount: null, reason: null })).toBe('');
  });

  it('formatea un activo leído sin recortar el dato', () => {
    expect(formatAssetAmount({ symbol: 'MON', unit: 'MON', decimals: 18, status: 'ok', raw: '1500000000000000000', amount: '1.5', reason: null })).toBe('1,5');
  });
});

describe('splitUsdDisplay — un total ilegible no se parte en u$0,00', () => {
  it('devuelve null cuando no hay total legible', () => {
    // El caso caro: una cadena caída se convierte en "u$0,00" y la persona
    // cree que no tiene nada.
    expect(splitUsdDisplay(null)).toBeNull();
  });

  it('parte el número y rellena los centavos que falten', () => {
    expect(splitUsdDisplay('1.234,5')).toEqual({ whole: 'u$1.234', cents: ',50' });
    expect(splitUsdDisplay('1234')).toEqual({ whole: 'u$1234', cents: ',00' });
    expect(splitUsdDisplay('0,00', 'U$')).toEqual({ whole: 'U$0', cents: ',00' });
  });
});

/* ── La pregunta del millón: ¿vacía o no lo sé? ────────────────────────────── */

describe('allBalancesAreZero — un guion es "no lo sé" y un 0,00 es "lo sé"', () => {
  const okChain = (assets: unknown[]): PortfolioChainOutcome => ({
    chain: 'monad',
    status: 'ok',
    address: '0xabc',
    assets,
  } as PortfolioChainOutcome);

  const asset = (amountText: string | null, decimals = 6, status: 'ok' | 'unreadable' = 'ok') => ({
    symbol: 'USDC',
    unit: 'USDC',
    decimals,
    status,
    raw: amountText,
    amount: amountText,
    reason: null,
  });

  it('dice que no cuando no se leyó ninguna cadena', () => {
    // Una lista vacía no es un cero: nadie preguntó. El guion es la respuesta
    // honesta.
    expect(allBalancesAreZero([])).toBe(false);
  });

  it('bloquea el cero cuando una cadena se cayó', () => {
    // Una caída no es un saldo cero. Con caída, el total no existe y pintar
    // cero es afirmar sobre plata que nadie verificó.
    expect(
      allBalancesAreZero([
        okChain([asset('0')]),
        { chain: 'solana', status: 'error', reason: 'RPC_UNAVAILABLE' },
      ]),
    ).toBe(false);
  });

  it('bloquea el cero cuando un activo se leyó a medias', () => {
    // Éste es el defecto que el comentario del módulo describe: antes el
    // activo ilegible se botaba y la suma de lo que quedaba daba cero, así que
    // una billetera con USDC de Solana sin leer se anunciaba como vacía.
    expect(allBalancesAreZero([okChain([asset('0'), asset(null, 6, 'unreadable')])])).toBe(false);
  });

  it('confirma el cero cuando todo se leyó y todo era cero', () => {
    expect(
      allBalancesAreZero([
        okChain([asset('0')]),
        { chain: 'solana', status: 'no_wallet' },
        okChain([asset('0', 18)]),
      ]),
    ).toBe(true);
  });

  it('dice que no cuando un solo satoshi está ahí', () => {
    expect(allBalancesAreZero([okChain([asset('0'), asset('1', 18)])])).toBe(false);
  });

  it('filtra por símbolo cuando la pregunta es sólo sobre una parte', () => {
    // "Están vacíos mis dólares digitales" no se responde con el saldo de MON.
    // Si el filtro no existiera, un MON de un peso declararía vacía la billetera
    // de dólares: la respuesta sería `false` donde la verdad es `true`.
    expect(
      allBalancesAreZero(
        [okChain([asset('0'), { ...asset('1500000000000000000', 18), symbol: 'MON' }])],
        (symbol) => symbol === 'USDC',
      ),
    ).toBe(true);
    // Y al revés: un USDC de un peso no vuelve "vacía" la pregunta del MON.
    expect(
      allBalancesAreZero(
        [okChain([asset('1'), { ...asset('0', 18), symbol: 'MON' }])],
        (symbol) => symbol === 'MON',
      ),
    ).toBe(true);
    expect(allBalancesAreZero([okChain([asset('1')])], (symbol) => symbol === 'USDC')).toBe(false);
  });

  it('no confunde un activo con decimales distintos al sumar', () => {
    // 1 wei de MON a 18 decimales es un número real, no un cero.
    expect(allBalancesAreZero([okChain([asset('0'), asset('1', 18)])])).toBe(false);
  });
});

/* ── El normalizador ───────────────────────────────────────────────────────── */

describe('normalizePortfolio — lo que no se puede interpretar no se muestra', () => {
  it('conserva el activo ilegible en vez de botarlo de la lista', () => {
    // Descartar no es neutral: es afirmar que ahí no había nada. Y como
    // `allBalancesAreZero` suma lo que sobrevive, lo descartado cuenta como
    // cero.
    const portfolio = normalizePortfolio({
      generatedAt: '2024-05-01T00:00:00.000Z',
      chains: [
        {
          chain: 'monad',
          status: 'ok',
          address: '0xabc',
          assets: [
            { symbol: 'USDC', unit: 'USDC', decimals: 6, status: 'ok', raw: '0', amount: '0' },
            { symbol: 'MON', unit: 'MON', decimals: 18, status: 'unreadable', raw: null, amount: null, reason: 'RPC_UNAVAILABLE' },
          ],
        },
      ],
    });
    expect(portfolio.chains[0].status).toBe('ok');
    const assets = (portfolio.chains[0] as { assets: readonly { status: string; amount: string | null }[] }).assets;
    expect(assets).toHaveLength(2);
    expect(assets[1].status).toBe('unreadable');
    expect(assets[1].amount).toBeNull();
    expect(allBalancesAreZero(portfolio.chains)).toBe(false);
  });

  it('deja una cadena con error como error, sin una lista de activos que la disfracen', () => {
    const portfolio = normalizePortfolio({
      chains: [{ chain: 'solana', status: 'error', error: { reason: 'RPC_UNAVAILABLE' } }],
    });
    expect(portfolio.chains[0]).toEqual({ chain: 'solana', status: 'error', reason: 'RPC_UNAVAILABLE' });
    expect(allBalancesAreZero(portfolio.chains)).toBe(false);
  });

  it('deja `no_wallet` como un cero conocido y no como un dato faltante', () => {
    const portfolio = normalizePortfolio({ chains: [{ chain: 'solana', status: 'no_wallet' }] });
    expect(portfolio.chains[0].status).toBe('no_wallet');
    expect(allBalancesAreZero(portfolio.chains)).toBe(true);
  });

  it('tira una cadena que el backend no soporta, sin inventarle nombre', () => {
    // Un chain id desconocido no es una cadena sin plata: es una cadena que no
    // sabemos leer, y el nombre de la red tampoco se sabe.
    const portfolio = normalizePortfolio({ chains: [{ chain: 'bitcoin', status: 'ok', assets: [] }] });
    expect(portfolio.chains).toHaveLength(0);
    expect(allBalancesAreZero(portfolio.chains)).toBe(false);
  });

  it('devuelve un portfolio vacío, y no un error, cuando el cuerpo no es una lista', () => {
    const portfolio = normalizePortfolio({ chains: 'nope' });
    expect(portfolio).toEqual({ generatedAt: null, chains: [] });
  });
});

describe('las frases de una cadena que no se pudo leer', () => {
  it('no dice "no tenés nada" sobre una lectura que no ocurrió', () => {
    expect(unreadableChainMessage({ chain: 'monad', label: 'Monad', status: 'error', reason: 'RPC_UNAVAILABLE' })).toBe('No pudimos leer tu saldo en Monad.');
    expect(unreadableChainMessage({ chain: 'monad', label: 'Monad', status: 'no_wallet', reason: null })).toBe('No tenés una billetera en Monad.');
  });

  it('no filtra el enum interno a la pantalla', () => {
    const message = unreadableChainMessage({ chain: 'monad', label: 'Monad', status: 'error', reason: 'RPC_UNAVAILABLE' });
    expect(message).not.toContain('RPC');
    expect(message).not.toContain('UNAVAILABLE');
  });

  it('escribe el nombre de cada cadena que el backend puede leer', () => {
    expect(chainLabel('monad')).toBe('Monad');
    expect(chainLabel('ethereum')).toBe('Ethereum');
    expect(chainLabel('solana')).toBe('Solana');
  });
});