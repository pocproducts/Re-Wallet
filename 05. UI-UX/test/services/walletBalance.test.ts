/**
 * `src/services/walletBalance.ts`: el corazón de la regla del owner.
 *
 * > "Si no se pudo leer que no lo muestres, y cuando haya para leer sí lo
 * > puedas mostrar."
 *
 * Cada caso dice **qué mentira evita**. La deuda es explícita: los normalizadores
 * no exportan sus internos, así que todo lo que no es `normalizeWalletBalance`
 * se maneja por lo que devuelve la vista, que es lo que la pantalla realmente
 * ve.
 */

import { describe, expect, it } from 'vitest';
import {
  BALANCE_UNREADABLE_NOTE,
  buildIncompletenessNote,
  buildYieldIncompletenessNote,
  byUsdValueDesc,
  formatUnitPrice,
  formatVenueRate,
  formatYieldRate,
  normalizeWalletBalance,
  pieceFailureReason,
  RATE_DISPLAY_DECIMALS,
  YIELD_UNREADABLE_NOTE,
  YIELD_ZERO_VENUE_NOTE,
  type WalletBalancePart,
  type WalletBalanceYieldView,
} from '../../src/services/walletBalance';
import { amount, bucket, pieceOk, pieceUnreadable, price, ratio, venueRate, walletBalanceBody } from '../fixtures';

/* ── La pieza: `ok` no es lo mismo que "cero" ──────────────────────────────── */

describe('normalizeWalletBalance — una pieza ilegible pierde su valor aunque venga pegado', () => {
  it('deja la pieza sin precio y sin valor cuando el backend la marcó ilegible', () => {
    // El caso más caro de la app: una pieza con `status: 'unreadable'` que
    // igual trae `value` con plata adentro. Si el normalizador la aceptara,
    // la fila pintaría un saldo que nadie verificó. La unión lo prohíbe en
    // tipos; esto lo prohíbe en ejecución.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({
          total: amount('42963000', 6),
          pieces: [pieceUnreadable({ value: amount('42963000', 6) })],
        }),
      }),
    );
    const part = view!.cryptoValue.parts[0];
    expect(part.status).toBe('unreadable');
    expect(part.value).toBeNull();
    expect(part.price).toBeNull();
    expect(part.reason).toBe('PRICE_UNAVAILABLE');
    // La cantidad sí se conserva: es cierta y no es plata.
    expect(part.quantity?.raw).toBe(1500000000000000000n);
  });

  it('degrada a ilegible una pieza que dice "ok" pero no se puede reproducir', () => {
    // `status: 'ok'` no alcanza: si el precio no tiene forma de precio, la
    // pieza no fue leída. Degradar a cero sería afirmar que no tenés MON.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({
          total: amount('0', 6),
          pieces: [pieceOk({ price: { usd: 'mucho', raw: 'x', decimals: -1, source: 'oracle' } })],
        }),
      }),
    );
    const part = view!.cryptoValue.parts[0];
    expect(part.status).toBe('unreadable');
    expect(part.value).toBeNull();
  });

  it('trata un cero leído como cero y no como "no lo sé"', () => {
    // Una billetera vacía tiene que poder parecer vacía. Si un `raw: "0"`
    // leyó como ilegible, la app diría "no pudimos leer" sobre una billetera
    // que sí se leyó y estaba vacía.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({
          total: amount('0', 6),
          pieces: [pieceOk({ quantity: amount('0', 18, 'MON'), value: amount('0', 6) })],
        }),
      }),
    );
    const part = view!.cryptoValue.parts[0];
    expect(part.status).toBe('ok');
    expect(part.value?.isZero).toBe(true);
    expect(part.value?.formatted).toBe('0,00');
  });

  it('trata un `status` desconocido como ilegible y no como legible', () => {
    // Un enum nuevo que el front todavía no conoce no es un OK: es algo que no
    // supimos interpretar. Aceptarlo como `ok` mostraría un valor sin haberlo
    // validado.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({ pieces: [pieceOk({ status: 'casi_ok' })] }),
      }),
    );
    expect(view!.cryptoValue.parts[0].status).toBe('unreadable');
  });

  it('nombra la pieza sin nombre en vez de tirarla', () => {
    // Descartar no es neutral: es afirmar que ahí no había nada. Una pieza sin
    // `key` es un hueco, y el hueco tiene que poder decirlo en pantalla.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({ pieces: [{ ...pieceOk(), key: '', label: '' }] }),
      }),
    );
    const part = view!.cryptoValue.parts[0];
    expect(part.key).toBe('desconocido');
    expect(part.label).toBe('Una parte de tu saldo');
    expect(part.status).toBe('ok');
  });

  it('degrada a ilegible una entrada que no es un objeto', () => {
    const view = normalizeWalletBalance(
      walletBalanceBody({ cryptoValue: bucket({ pieces: ['nonsense'] }) }),
    );
    expect(view!.cryptoValue.parts[0].status).toBe('unreadable');
    expect(view!.cryptoValue.complete).toBe(false);
  });

  it('pinta la cantidad de una pieza leída con seis decimales, sin ceros de más', () => {
    // `1500000000000000000` a 18 decimales es 1,5 MON: la pantalla muestra
    // 1,5 y no 1,500000. Un cero de más es ruido; un decimal de más es
    // mentira.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({
          total: amount('42963000', 6),
          pieces: [pieceOk({ quantity: amount('1500000000000000000', 18, 'MON') })],
        }),
      }),
    );
    expect(view!.cryptoValue.parts[0].quantity?.formatted).toBe('1,5');
  });
});

/* ── El bucket: la conjunción de completitud ──────────────────────────────── */

describe('normalizeWalletBalance — `complete` es una conjunción, no una copia', () => {
  it('no copia el `true` del backend cuando una pieza quedó ilegible', () => {
    // El backend dice "completo" y el front no pudo leer una pieza. La
    // conjunción dice que no: mostrar el total como entero es mostrar un
    // número parcial como si fuera la plata entera de la persona.
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({
          complete: true,
          total: amount('42963000', 6),
          pieces: [pieceOk(), pieceUnreadable({ label: 'SOL en Solana' })],
        }),
      }),
    );
    expect(view!.cryptoValue.complete).toBe(false);
    expect(view!.cryptoValue.unreadableParts).toHaveLength(1);
    expect(view!.cryptoValue.incompletenessNote).toContain('SOL en Solana');
  });

  it('no declara completo un bucket sin total legible', () => {
    const view = normalizeWalletBalance(
      walletBalanceBody({
        cryptoValue: bucket({ complete: true, total: { raw: 'nope' }, pieces: [] }),
      }),
    );
    expect(view!.cryptoValue.complete).toBe(false);
    expect(view!.cryptoValue.total).toBeNull();
  });

  it('degrada el bucket entero cuando `pieces` no es una lista', () => {
    // `pieces` ausente o con otra forma: no se sabe qué hay adentro, así que el
    // total es `null` y no cero. Un `U$0,00` acá dice que no tenés nada.
    const view = normalizeWalletBalance(
      walletBalanceBody({ cryptoValue: { unit: 'USD', complete: true, total: amount('100', 6) } }),
    );
    expect(view!.cryptoValue.total).toBeNull();
    expect(view!.cryptoValue.parts).toHaveLength(0);
    expect(view!.cryptoValue.incompletenessNote).not.toBeNull();
  });

  it('deja el total sin lectura en null y el headline sin leer', () => {
    // El total es del backend y el front no lo recalcula: si no se puede leer,
    // no hay número. Cero sería inventar plata.
    expect(normalizeWalletBalance(null)).toBeNull();
    expect(normalizeWalletBalance('nope')).toBeNull();
    const view = normalizeWalletBalance(walletBalanceBody({ total: { complete: true } }));
    expect(view!.total.usd).toBeNull();
    expect(view!.total.complete).toBe(false);
  });

  it('retira `investedValue` del total: son los mismos dólares contados dos veces', () => {
    // El `total` es `cryptoValue + digitalDollarsValue`. `investedValue` es una
    // vista dentro del segundo. Sumarlo sería la plata depositada contada dos
    // veces, que es exactamente el defecto que la ruta existe para quitar.
    const usdc = pieceOk({
      key: 'dd.monad.USDC',
      label: 'USDC en Monad',
      source: 'pool_position',
      quantity: amount('100000000', 6, 'USDC'),
      price: price('1.0000', '10000', 4),
      value: amount('100000000', 6),
    });
    const view = normalizeWalletBalance(
      walletBalanceBody({
        digitalDollarsValue: bucket({ total: amount('100000000', 6), pieces: [usdc] }),
        investedValue: bucket({ total: amount('100000000', 6), pieces: [usdc] }),
        total: { unit: 'USD', complete: true, usd: amount('100000000', 6) },
      }),
    );
    expect(view!.total.usd?.raw).toBe(100000000n);
  });
});

/* ── El yield combinado ────────────────────────────────────────────────────── */

const yieldView = (over: Partial<WalletBalanceYieldView>): WalletBalanceYieldView => ({
  complete: false,
  rate: null,
  venues: [],
  unreadableVenues: [],
  incompletenessNote: null,
  ...over,
});

const investedWithYield = (yieldPayload: unknown) =>
  normalizeWalletBalance(
    walletBalanceBody({ investedValue: bucket({ yield: yieldPayload }) }),
  )!.investedValue.yield!;

describe('normalizeYield — `complete` es una conjunción de tres', () => {
  it('acepta un yield completo sólo si el backend dice, nadie falló y el ratio existe', () => {
    const y = investedWithYield({
      complete: true,
      rate: ratio('41200', '1000000'),
      venues: [
        {
          key: 'aave',
          label: 'Aave',
          status: 'ok',
          exclusion: null,
          balance: amount('100000000', 6),
          rate: venueRate('41200', 4, '0.0412'),
        },
      ],
    });
    expect(y.complete).toBe(true);
    expect(y.rate).toEqual({ numerator: 41200n, denominator: 1000000n });
    expect(y.incompletenessNote).toBeNull();
    expect(formatYieldRate(y)).toBe('4,12%');
  });

  it('no copia el `true` del backend cuando un venue quedó ilegible', () => {
    // El backend envía `complete: true` con un `venues` que el front no puede
    // leer entero. La tasa combinada sería una media ponderada sobre datos
    // faltantes: un número confiado construido con datos que faltan.
    const y = investedWithYield({
      complete: true,
      rate: ratio('41200', '1000000'),
      venues: [
        {
          key: 'aave',
          label: 'Aave',
          status: 'ok',
          exclusion: null,
          balance: amount('100000000', 6),
          rate: venueRate('41200', 4, '0.0412'),
        },
        { key: 'kamino', label: 'Kamino', status: 'unreadable', reason: 'KAMINO_UNAVAILABLE' },
      ],
    });
    expect(y.complete).toBe(false);
    expect(y.rate).toBeNull();
    expect(y.unreadableVenues).toHaveLength(1);
    expect(y.incompletenessNote).toContain('Kamino');
    expect(y.incompletenessNote).not.toBe(YIELD_UNREADABLE_NOTE);
  });

  it('no divide por un denominador cero: es un rechazo, no una tasa infinita', () => {
    // Un denominador en cero devuelto como número sería `Infinity` en pantalla.
    // Devuelto como `null`, degrada a "no se pudo leer", que es la verdad.
    const y = investedWithYield({ complete: true, rate: ratio('41200', '0'), venues: [] });
    expect(y.complete).toBe(false);
    expect(y.rate).toBeNull();
    expect(formatYieldRate(y)).toBeNull();
  });

  it('rechaza un ratio con un número de floats en vez de texto decimal', () => {
    // El contrato manda texto decimal justamente para no perder dígitos antes
    // de que lleguen al `BigInt`. Un número JSON ya viene redondeado.
    const y = investedWithYield({ complete: true, rate: { numerator: 41200, denominator: 1000000 }, venues: [] });
    expect(y.complete).toBe(false);
    expect(y.rate).toBeNull();
  });

  it('trata un yield ausente como una lectura que no llegó, no como un 0%', () => {
    // Un bucket sin `yield` no es "el pool no rinde": es que no lo supimos
    // leer. La frase lo dice y el número no existe.
    const view = normalizeWalletBalance(walletBalanceBody({ investedValue: bucket() }));
    const y = view!.investedValue.yield!;
    expect(y.complete).toBe(false);
    expect(y.rate).toBeNull();
    expect(y.venues).toHaveLength(0);
    expect(y.incompletenessNote).toBe(YIELD_UNREADABLE_NOTE);
  });

  it('nombra el venue que falta, para que nadie sospeche una tasa más baja', () => {
    const y = investedWithYield({
      complete: true,
      rate: ratio('41200', '1000000'),
      venues: [
        { key: 'kamino', label: 'Kamino', status: 'ok', exclusion: null, balance: amount('0', 6), rate: null },
        { key: 'aave', label: 'Aave', status: 'unreadable', reason: 'APY_NON_POSITIVE' },
      ],
    });
    expect(y.incompletenessNote).toBe(
      buildYieldIncompletenessNote(['Aave']),
    );
    expect(y.incompletenessNote).toContain('Aave');
  });

  it('separa el venue que no tiene nada del venue que no se pudo leer', () => {
    // `zero_balance` es un hecho, no una falla: ese venue Pesaba cero en la
    // media y por eso no tiene tasa que se le deba. Si se lo degradara a ilegible,
    // un yield completo se volvería incompleto por una billetera vacía.
    const y = investedWithYield({
      complete: true,
      rate: ratio('41200', '1000000'),
      venues: [
        {
          key: 'kamino',
          label: 'Kamino',
          status: 'ok',
          exclusion: 'zero_balance',
          balance: amount('0', 6),
          rate: null,
        },
        {
          key: 'aave',
          label: 'Aave',
          status: 'ok',
          exclusion: null,
          balance: amount('100000000', 6),
          rate: venueRate('41200', 4, '0.0412'),
        },
      ],
    });
    expect(y.complete).toBe(true);
    expect(y.unreadableVenues).toHaveLength(0);
    expect(y.venues[0].status).toBe('ok');
    expect(YIELD_ZERO_VENUE_NOTE).toContain('No tenés nada depositado');
  });

  it('degrada a ilegible un venue "ok" cuyo balance no se puede leer', () => {
    // Un balance ilegible no es un balance cero. Bajarlo a `zero_balance`
    // sacaría al venue de la media ponderada y publicaría una tasa Wrong con
    // más confianza, no menos.
    const y = investedWithYield({
      complete: true,
      rate: ratio('41200', '1000000'),
      venues: [
        { key: 'aave', label: 'Aave', status: 'ok', exclusion: null, balance: { raw: '-1' }, rate: venueRate('41200', 4, '0.0412') },
      ],
    });
    expect(y.complete).toBe(false);
    expect(y.venues[0].status).toBe('unreadable');
    expect(y.venues[0].balance).toBeNull();
    expect(y.venues[0].rate).toBeNull();
  });

  it('nombra el venue que llegó sin nombre en vez de descartarlo', () => {
    const y = investedWithYield({ complete: true, rate: null, venues: [{}] });
    expect(y.venues).toHaveLength(1);
    expect(y.venues[0].status).toBe('unreadable');
    expect(y.venues[0].label).toBe('Un lugar de tu plata');
  });
});

/* ── El único redondeo, en la pintura ─────────────────────────────────────── */

describe('formatYieldRate / formatVenueRate — un solo redondeo, en bigint', () => {
  it('devuelve null en vez de "0,00%" cuando el yield no se pudo leer', () => {
    // Un "0,00%" pintado arriba de un yield incompleto afirma "tu plata no
    // rinde nada". Es la frase más cara que puede decir esta pantalla.
    expect(formatYieldRate(yieldView({ complete: false }))).toBeNull();
    expect(formatYieldRate(yieldView({ complete: true, rate: null }))).toBeNull();
    expect(formatVenueRate(null)).toBeNull();
  });

  it('redondea 12,345% hacia arriba, que es exactamente la mitad', () => {
    // El único redondeo del módulo, en la mitad exacta. `Math.round(12.345*100)/100`
    // en `double` da 12.34 o 12.35 según la Platforma; en entero no hay duda.
    expect(formatYieldRate(yieldView({ complete: true, rate: { numerator: 12345n, denominator: 100000n } }))).toBe('12,35%');
  });

  it('lee un ratio de 34 dígitos sin perder ninguno', () => {
    // Numerador y denominador llegan muy pasado `Number.MAX_SAFE_INTEGER`: un
    // `double` los redondea antes de dividir y el resultado "exacto" sería
    // exacto hasta quince dígitos. Acá el último dígito decide el centavo.
    const y = yieldView({ complete: true, rate: { numerator: 12345678901234567890n, denominator: 100000000000000000000n } });
    expect(formatYieldRate(y)).toBe('12,35%');
  });

  it('aplica el mismo redondeo a la tasa propia de un venue', () => {
    // Si el combinado y el de un venue usaran redondeos distintos, la media
    // ponderada de abajo no podría ser la media de los números de arriba.
    // 0,12345 son 12,345%: sube a 12,35.
    expect(formatVenueRate({ raw: 12345n, decimals: 5, text: '0.12345' })).toBe('12,35%');
    expect(formatVenueRate({ raw: 4125n, decimals: 5, text: '0.04125' })).toBe('4,13%');
  });

  it('redondea la tasa de un venue en la mitad exacta, con la misma regla', () => {
    expect(formatVenueRate({ raw: 5n, decimals: 5, text: '0.00005' })).toBe('0,01%');
  });

  it('se niega a pintar una tasa con decimales negativos', () => {
    expect(formatVenueRate({ raw: 4125n, decimals: 5, text: '0.04125' }, -1)).toBeNull();
  });

  it('lanza si a la tasa combinada le piden decimales negativos', () => {
    // Distinto del venue a propósito: acá la figura es obligatoria si existe,
    // y un `places` negativo es un error de programación, no una lectura mala.
    expect(() =>
      formatYieldRate(yieldView({ complete: true, rate: { numerator: 1n, denominator: 100n } }), -1),
    ).toThrow(RangeError);
  });

  it('pinta con los dos decimales que la pantalla decidió', () => {
    expect(RATE_DISPLAY_DECIMALS).toBe(2);
  });
});

/* ── El precio de una pieza ────────────────────────────────────────────────── */

describe('formatUnitPrice — el precio que se usó', () => {
  it('pinta el decimal de máquina con coma y sin comas de miles', () => {
    // "0.028642" no es mil veintiocho: un formateador argentino lo leería como
    // 28642 y mostraría un precio 1000 veces más caro.
    expect(formatUnitPrice(price('0.028642', '286420', 6, 'chainlink'))).toBe('0,028642');
    // Un precio pegado a uno conserva los decimales que publiés el feed: el
    // formateador no redondea, sólo cambia el separador.
    expect(formatUnitPrice(price('1.0000', '10000', 4))).toBe('1,0000');
  });

  it('devuelve null cuando no hay precio, en vez de 0', () => {
    expect(formatUnitPrice(null)).toBeNull();
  });

  it('pinta el precio de un feed con signo negativo', () => {
    expect(formatUnitPrice(price('-2.5000', '-25000', 4))).toBe('-2,5000');
  });
});

/* ── Las frases ────────────────────────────────────────────────────────────── */

describe('buildIncompletenessNote — la frase que nombra la pieza', () => {
  it('no inventa una frase cuando no falta nada', () => {
    expect(buildIncompletenessNote([])).toBeNull();
  });

  it('une los nombres con "y" y con coma antes del último', () => {
    // "A, B y C" y "A y B": una lista de dos leída como lista de tres (o al
    // revés) hace sospechar que falta algo que no falta.
    expect(buildIncompletenessNote(['A'])).toContain('no pudimos leer A.');
    expect(buildIncompletenessNote(['A', 'B'])).toContain('no pudimos leer A y B.');
    expect(buildIncompletenessNote(['A', 'B', 'C'])).toContain('no pudimos leer A, B y C.');
  });

  it('aclara que el número de arriba sólo cuenta lo que se pudo leer', () => {
    const note = buildIncompletenessNote(['A'])!;
    expect(note).toContain('sólo cuenta lo que sí pudimos leer');
  });

  it('separa "no lo supimos leer" de "no tenés"', () => {
    expect(BALANCE_UNREADABLE_NOTE).toContain('No es que no tengas: es que no lo supimos leer');
    expect(YIELD_UNREADABLE_NOTE).toContain('No es que no rindan');
  });
});

describe('pieceFailureReason — el enum acotado, en castellano', () => {
  it('traduce un motivo conocido', () => {
    expect(pieceFailureReason('PRICE_UNAVAILABLE')).toBe('no tenemos un precio para este activo');
  });

  it('cae en la frase honesta cuando el enum es nuevo', () => {
    // Un enum que el front todavía no conoce va al log, no a la pantalla. En
    // pantalla sale la frase que siempre es cierta: no lo supimos leer.
    expect(pieceFailureReason('MOTOR_DE_DINERO_NUEVO')).toBe('no lo supimos leer');
    expect(pieceFailureReason('UNREADABLE')).toBe('no lo supimos leer');
  });

  it('no filtra un enum crudo a la pantalla', () => {
    expect(pieceFailureReason('RPC_MALFORMED_RESPONSE')).not.toContain('RPC');
  });
});

/* ── El orden por valor ────────────────────────────────────────────────────── */

describe('byUsdValueDesc — comparar importes con escalas distintas no es comparar plata', () => {
  const partWithValue = (raw: string, decimals: number): WalletBalancePart =>
    ({
      key: 'k',
      label: 'l',
      source: 'free_wallet',
      chain: null,
      status: 'ok',
      reason: null,
      quantity: { raw: 1n, decimals, unit: 'X', formatted: '1', isZero: false },
      price: price('1', '1', 0),
      value: { raw: BigInt(raw), decimals, unit: 'USD', formatted: 'x', isZero: false },
    }) as WalletBalancePart;

  it('pone arriba la pieza cara aunque su entero sea más chico', () => {
    // 0,0000001 USD a 26 decimales es el entero 100; 90000 USD a 16 decimales es
    // el entero 9000000000000000. Comparar los enteros crudos —que es lo que
    // haría un `sort` ingenuo— pone la pieza de un centavo arriba de la de
    // noventa mil dólares.
    const cheap = partWithValue('100', 26);
    const rich = partWithValue('9000000000000000', 16);
    expect(byUsdValueDesc(rich, cheap)).toBeLessThan(0);
    expect(byUsdValueDesc(cheap, rich)).toBeGreaterThan(0);
  });

  it('manda al final la pieza sin valor, porque no sabemos cuánto vale', () => {
    // Una pieza ilegible no vale cero: no sabemos cuánto vale. Rankearla como
    // la más chica pone un hueco arriba de un número.
    const unreadable: WalletBalancePart = {
      key: 'k',
      label: 'l',
      source: 'free_wallet',
      chain: null,
      status: 'unreadable',
      reason: 'UNREADABLE',
      quantity: null,
      price: null,
      value: null,
    };
    expect(byUsdValueDesc(partWithValue('1', 6), unreadable)).toBeLessThan(0);
    expect(byUsdValueDesc(unreadable, partWithValue('1', 6))).toBeGreaterThan(0);
  });

  it('trata dos piezas sin valor como iguales, sin fingir un orden', () => {
    const unreadable: WalletBalancePart = {
      key: 'k', label: 'l', source: 'free_wallet', chain: null, status: 'unreadable',
      reason: 'UNREADABLE', quantity: null, price: null, value: null,
    };
    expect(byUsdValueDesc(unreadable, null)).toBe(0);
    expect(byUsdValueDesc(null, null)).toBe(0);
  });

  it('iguala dos piezas con el mismo valor a escalas distintas', () => {
    // 1 USD a 6 decimales (1000000) y 1 USD a 8 decimales (100000000) son el
    // mismo dinero. Devolver 0 acá es lo que evita que el orden "resuelva" solo.
    expect(byUsdValueDesc(partWithValue('1000000', 6), partWithValue('100000000', 8))).toBe(0);
  });
});