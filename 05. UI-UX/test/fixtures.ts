/**
 * Payloads de prueba que **parecen** lo que manda el backend.
 *
 * ── Por qué hay un archivo de armadores y no JSON pegado ────────────────────
 *
 * Los normalizadores leen cuerpos con forma de unión discriminada: cada pieza es
 * `ok` **o** `unreadable`, y cada brazo lleva campos distintos. Un literal JSON
 * repetido en cada test obliga a copiar el brazo completo cada vez que se
 * cambia una firma, y el copiado es donde aparecen los campos fantasma que el
 * test igual considera válidos.
 *
 * ── La regla de los armadores ──────────────────────────────────────────────
 *
 * Ningún armador lee el reloj, la red ni `Math.random()`. Todo lo que sale de
 * acá es determinista y explícito: el mismo armador da el mismo cuerpo, siempre.
 * Un test cuyo resultado depende de la hora no falla cuando el código está mal:
 * falla cuando cambia el día.
 */

import { expect } from 'vitest';

/**
 * Estrecha la rama `ok` de una pieza discriminada.
 *
 * Un `expect(part.status).toBe('ok')` **no** le dice nada a TypeScript: el
 * comprobador no estrecha tipos. Estos tests quieren leer `formatted`, `raw` e
 * `isZero`, que sólo existen en el brazo leído. Esta función es el puente: si la
 * pieza no está leída, el test falla con un mensaje que dice qué pasó, en vez de
 * compilar en falso y devolver `undefined` en silencio.
 */
export const asOk = <T extends { readonly status: string }>(part: T): T & { readonly status: 'ok' } => {
  expect(part.status).toBe('ok');
  return part as T & { readonly status: 'ok' };
};

/** Un importe del backend, en la unidad mínima, exacto. */
export const amount = (raw: string, decimals: number, unit = 'USD') => ({
  raw,
  amount: raw,
  decimals,
  unit,
});

/** Un precio de un activo: `usd` es texto decimal, nunca un número JSON. */
export const price = (
  usd: string,
  raw: string,
  decimals: number,
  source: 'peg' | 'chainlink' = 'peg',
) => ({
  usd,
  raw,
  decimals,
  source,
  pair: source === 'peg' ? null : 'MON_USD',
  updatedAt: source === 'peg' ? null : 1_700_000_000,
  crossChecked: null,
});

/** Un ratio exacto: las dos mitades enteras, como texto decimal. */
export const ratio = (numerator: string, denominator: string) => ({ numerator, denominator });

/** Una tasa propia de un venue, siempre fracción de uno. */
export const venueRate = (raw: string, decimals: number, text: string) => ({ raw, decimals, text });

/** Una pieza leída: cantidad, precio y valor. */
export const pieceOk = (overrides: Record<string, unknown> = {}) => ({
  key: 'crypto.monad.MON',
  label: 'MON en Monad',
  source: 'free_wallet',
  chain: 'monad',
  status: 'ok',
  reason: null,
  quantity: amount('1500000000000000000', 18, 'MON'),
  price: price('0.028642', '286420', 6, 'chainlink'),
  value: amount('42963000', 6),
  ...overrides,
});

/** Una pieza que no se pudo leer. Sin precio y sin valor, por contrato. */
export const pieceUnreadable = (overrides: Record<string, unknown> = {}) => ({
  key: 'crypto.monad.MON',
  label: 'MON en Monad',
  source: 'free_wallet',
  chain: 'monad',
  status: 'unreadable',
  reason: 'PRICE_UNAVAILABLE',
  quantity: amount('1500000000000000000', 18, 'MON'),
  price: null,
  value: null,
  ...overrides,
});

/** Un bucket del backend: `pieces` siempre es lista, incluso vacía. */
export const bucket = (overrides: Record<string, unknown> = {}) => ({
  unit: 'USD',
  complete: true,
  total: amount('0', 6),
  pieces: [],
  ...overrides,
});

/** Un cuerpo de `/wallet-balance` completo, con los tres buckets. */
export const walletBalanceBody = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2024-05-01T00:00:00.000Z',
  unit: 'USD',
  cryptoValue: bucket(),
  digitalDollarsValue: bucket(),
  investedValue: bucket({
    yield: { complete: true, rate: null, venues: [] },
  }),
  total: { unit: 'USD', complete: true, usd: amount('0', 6) },
  ...overrides,
});