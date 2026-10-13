/**
 * Lectura de `/api/pool` y preparación de `/api/pool/deposit`: el transporte, la
 * normalización y la aritmética decimal exacta.
 *
 * ── Por qué el front no trae ni una dirección de contrato ────────────────────
 *
 * El pool, el token y el aToken viven en el servidor (`07.PockBackend`). Acá no
 * hay ni una dirección de Aave: hay transacciones **sin firmar** que el backend
 * ya construyó, con su `to`, su `data`, su `value` y su `chainId`. Un front que
 * conoce el contrato puede ser movido a firmar contra otro contrato por quien
 * escriba la próxima pantalla; uno que sólo conoce transacciones no.
 *
 * ── Por qué el monto se arma con `bigint` ─────────────────────────────────────
 *
 * El monto viaja en la unidad mínima (`"1000000"` = 1 USDC) y la pantalla lo pide
 * con coma decimal (`1,00`). La conversión de ida y vuelta se hace con enteros y
 * corte de texto: `parseUnits` **lanza** cuando el texto tiene más decimales de los
 * declarados, y un saldo entero de más no debería derribar una pantalla que sólo
 * está mostrando un número. El redondeo a dos decimales ocurre una sola vez y
 * recién para pintar.
 */

import { getJson, postJson, ApiError } from './api';
import type {
  DepositPreparationResponse,
  PoolAmount,
  PoolApr,
  PoolField,
  PoolPercent,
  PoolPosition,
  PoolResponse,
  PoolTotals,
  UnsignedTransaction,
} from '../types/pool.types';

export type { PoolAmount, PoolField, PoolPercent, UnsignedTransaction };
export type { PoolResponse, DepositPreparationResponse };

/** Cuántos decimales se muestra en una tasa. El backend manda cuatro. */
export const APR_DISPLAY_DECIMALS = 2;

/** Cuántos decimales se muestra en un importe de dólares. */
export const AMOUNT_DISPLAY_DECIMALS = 2;

/* ── Aritmética decimal exacta ─────────────────────────────────────────────── */

/**
 * Un importe decimal a un entero escalado a `decimals`.
 *
 * Acepta coma o punto, tolera ceros de más en la parte entera y recorta —no
 * redondea— los decimales sobrantes: el dato se conserva tal como vino.
 */
/**
 * El **formato de un porcentaje** es un decimal de maquina: `"4.1196"`. No lleva
 * separador de miles.
 *
 * Por eso NO se parsea con `toScaled`, que existe para importes en formato
 * argentino (`"173.874.477,77"` = 173 millones) y **se come los puntos**:
 * `"4.1196"` ahi se convierte en `"41196"`, y el resultado es `41.196,00%` en
 * vez de `4,12%`. La ambiguedad es real e irresoluble — `"1.234"` son mil dos
 *cientos treinta y cuatro en un formato y uno con doscientos en el otro — asi
 * que son dos funciones distintas con dos formatos distintos, no una con
 * parametros.
 */
const percentToScaled = (text: string, decimals: number): bigint => {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError(`un porcentaje no puede ser "${text}"`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf('.');
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);
  if (fraction.length > decimals) {
    throw new RangeError(`más decimales de los declarados: ${text} con ${decimals}`);
  }
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return negative ? -value : value;
};

/** Importes en formato argentino: `"1.234.567,89"` son un millón doscientos. */
export const toScaled = (text: string, decimals: number): bigint => {
  const normalized = text.trim().replace(/\./g, '').replace(',', '.');
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const dot = unsigned.indexOf('.');

  const whole = (dot === -1 ? unsigned : unsigned.slice(0, dot)) || '0';
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);
  if (fraction.length > decimals) {
    throw new RangeError(`más decimales de los declarados: ${text} con ${decimals}`);
  }

  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return negative ? -value : value;
};

/**
 * Redondea a `displayDecimals`, mitad hacia arriba, en enteros.
 *
 * El redondeo ocurre **una** vez y acá. Mientras el número está en `bigint` no
 * pierde un dígito, que es exactamente lo que no se puede decir de un `number`.
 */
export const roundScaled = (value: bigint, decimals: number, displayDecimals: number): bigint => {
  if (displayDecimals >= decimals) return value;
  const factor = 10n ** BigInt(decimals - displayDecimals);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude + factor / 2n) / factor;
  return negative ? -rounded : rounded;
};

/** Entero con separador de miles argentino: `"1.234"`. */
const groupThousands = (digits: string): string => BigInt(digits).toLocaleString('es-AR');

/** Un entero escalado, pintado con separador de miles y coma decimal. */
export const formatScaled = (
  value: bigint,
  decimals: number,
  displayDecimals: number = decimals,
): string => {
  const rounded = roundScaled(value, decimals, displayDecimals);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;

  const factor = 10n ** BigInt(displayDecimals);
  const whole = magnitude / factor;
  const fraction = (magnitude % factor).toString().padStart(displayDecimals, '0');

  const body =
    displayDecimals > 0 ? `${groupThousands(whole.toString())},${fraction}` : groupThousands(whole.toString());
  return negative ? `-${body}` : body;
};

/** Un importe de un `raw` del backend, listo para pintar con su prefijo. */
export const formatAmount = (raw: bigint, decimals: number, prefix = ''): string =>
  `${prefix}${formatScaled(raw, decimals, AMOUNT_DISPLAY_DECIMALS)}`;

/**
 * Un porcentaje del backend —`"4.1196"`— pintado a dos decimales.
 *
 * `null` cuando no hay porcentaje: una tasa que no se pudo leer no se pinta como
 * `0,00%`, porque un `0,00%` de rendimiento es una afirmación sobre plata.
 */
export const formatPercent = (percent: PoolPercent | null): string | null => {
  if (percent === null) return null;

  const scaled = percentToScaled(percent, 4);
  const rounded = roundScaled(scaled, 4, APR_DISPLAY_DECIMALS);
  return `${formatScaled(rounded, APR_DISPLAY_DECIMALS, APR_DISPLAY_DECIMALS)}%`;
};

/**
 * Cuánto rendaría `raw` en un año al `percent` dado, en la misma unidad.
 *
 * Es una **proyección** al ritmo actual del pool, no una promesa: por eso la
 * llama la pantalla "estimación" y nunca "lo que vas a ganar". La aritmética es
 * entera de punta a punta —elAPR viene en 1e-4 de punto— y devuelve el importe
 * redondeado a dos decimales, que es una decisión de pantalla.
 */
export const projectYearlyGain = (
  raw: bigint,
  decimals: number,
  percent: PoolPercent | null,
): { readonly gain: bigint; readonly label: string } | null => {
  if (percent === null) return null;

  const aprScaled = percentToScaled(percent, 4); // 1e-4 de punto
  // gain = raw x apr% / 100, en enteros. El `aprScaled` ya lleva su 1e-4, así
  // que el divisor es 1e4 x 100 = 1e6 y no 1e6 x 100 = 1e8: con 1e8 la
  // proyección salía cien veces abajo —100 USDC al 100% se leían 1,00— y esa
  // cifra se pintaba como "estimación en un año" en dos pantallas de plata real.
  const gain = (raw * aprScaled) / (10_000n * 100n);

  return { gain, label: formatAmount(gain, decimals) };
};

/* ── Normalización ─────────────────────────────────────────────────────────── */

/** Un `PoolField` con estado, o `null` cuando lo que llegó no es interpretable. */
const normalizeField = <T>(raw: unknown, coerce: (value: unknown) => T | null): PoolField<T> | null => {
  const field = raw as { status?: unknown; value?: unknown; reason?: unknown } | null;
  if (field === null || typeof field !== 'object') return null;

  if (field.status === 'unreadable') {
    return {
      status: 'unreadable',
      // El enum acotado del backend viaja al log; la pantalla pone su propia frase.
      reason: typeof field.reason === 'string' ? field.reason : 'UNREADABLE',
    };
  }

  if (field.status !== 'ok') return null;
  const value = coerce(field.value);
  if (value === null) return null;

  return { status: 'ok', value };
};

/** Un importe del backend, si es interpretable. */
const toAmount = (value: unknown): PoolAmount | null => {
  const amount = value as PoolAmount | null;
  if (amount === null || typeof amount !== 'object') return null;
  if (typeof amount.raw !== 'string' || !/^[0-9]+$/.test(amount.raw)) return null;
  if (typeof amount.amount !== 'string') return null;
  if (!Number.isInteger(amount.decimals) || amount.decimals < 0) return null;
  if (typeof amount.unit !== 'string') return null;
  return { raw: amount.raw, amount: amount.amount, decimals: amount.decimals, unit: amount.unit };
};

/** Un porcentaje del backend: un texto decimal, nunca un número JSON. */
const toPercent = (value: unknown): PoolPercent | null => {
  if (typeof value !== 'string' || !/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return null;
  return value;
};

const UNREADABLE: PoolField<never> = { status: 'unreadable', reason: 'CONTRACT_MISMATCH' };

/** La lectura normalizada que la pantalla usa. */
export interface PoolView {
  readonly network: { readonly name: string; readonly chainId: number; readonly protocol: string };
  readonly asset: { readonly symbol: string; readonly unit: string; readonly decimals: number };
  /** `false` cuando la reserva no se pudo leer: ninguna tasa se muestra. */
  readonly reserveReadable: boolean;
  readonly apr: PoolApr;
  readonly totals: PoolTotals;
  readonly position: PoolPosition;
  /** Cuándo se actualizó la reserva por última vez, en texto legible. */
  readonly lastUpdate: string | null;
  /** `false` cuando la tasa de depósito no se pudo reproducir desde el pool. */
  readonly aprReconciles: boolean;
  /** El APR que se puede mostrar, o `null` cuando no se debe mostrar. */
  readonly displayableSupplyApr: PoolPercent | null;
}

/** La fecha de la última actualización de la reserva, en castellano corto. */
const formatLastUpdate = (iso: string): string => {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;

  return when.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Traduce el cuerpo a la forma que la pantalla usa.
 *
 * Se lee defensivo: un campo con una forma que no se reconoce **no se muestra**
 * como cero, se marca ilegible. Un `0` que el backend no mandó nunca se inventa.
 */
export const normalizePool = (body: unknown): PoolView | null => {
  const response = body as Partial<PoolResponse> | null;
  if (response === null || typeof response !== 'object') return null;
  if (response.network === undefined || response.asset === undefined) return null;

  const position = response.position as Partial<PoolPosition> | undefined;
  if (position === undefined || typeof position.address !== 'string') return null;

  const apr: PoolApr = {
    supply: normalizeField<PoolPercent>(response.apr?.supply, toPercent) ?? UNREADABLE,
    borrow: normalizeField<PoolPercent>(response.apr?.borrow, toPercent) ?? UNREADABLE,
  };

  const totals: PoolTotals = {
    supplied: normalizeField<PoolAmount>(response.totals?.supplied, toAmount) ?? UNREADABLE,
    borrowed: normalizeField<PoolAmount>(response.totals?.borrowed, toAmount) ?? UNREADABLE,
    available: normalizeField<PoolAmount>(response.totals?.available, toAmount) ?? UNREADABLE,
    utilisation: normalizeField<PoolPercent>(response.totals?.utilisation, toPercent) ?? UNREADABLE,
  };

  const normalizedPosition: PoolPosition = {
    address: position.address,
    aTokenBalance: normalizeField<PoolAmount>(position.aTokenBalance, toAmount) ?? UNREADABLE,
    availableUsdc: normalizeField<PoolAmount>(position.availableUsdc, toAmount) ?? UNREADABLE,
    gasBalance: normalizeField<PoolAmount>(position.gasBalance, toAmount) ?? UNREADABLE,
  };

  const reconciliation = normalizeField<{ percent: PoolPercent; agrees: boolean }>(
    response.reconciliation,
    (value) => {
      const entry = value as { percent?: unknown; agrees?: unknown } | null;
      if (entry === null || typeof entry !== 'object') return null;
      const percent = toPercent(entry.percent);
      if (percent === null || typeof entry.agrees !== 'boolean') return null;
      return { percent, agrees: entry.agrees };
    },
  );

  const lastUpdateField = normalizeField<{ readonly unix: number; readonly iso: string }>(
    response.lastUpdate,
    (value) => {
      const entry = value as { unix?: unknown; iso?: unknown } | null;
      if (entry === null || typeof entry !== 'object') return null;
      if (typeof entry.unix !== 'number' || typeof entry.iso !== 'string') return null;
      return { unix: entry.unix, iso: entry.iso };
    },
  );

  /*
   * Una tasa que no se pudo reproducir desde el resto de la reserva **no se
   * muestra** como un hecho. Se marca ilegible: es el número que un error de
   * decodificación habría producido, y una pantalla de dinero no lo publica.
   */
  const reconciles =
    reconciliation !== null && reconciliation !== undefined && reconciliation.status === 'ok'
      ? reconciliation.value?.agrees === true
      : false;
  const supplyApr = apr.supply.status === 'ok' ? (apr.supply.value ?? null) : null;

  return {
    network: response.network,
    asset: response.asset,
    reserveReadable: response.reserve?.status === 'ok',
    apr: {
      supply: reconciles && supplyApr !== null ? apr.supply : UNREADABLE,
      borrow: apr.borrow,
    },
    totals,
    position: normalizedPosition,
    lastUpdate:
      lastUpdateField !== null && lastUpdateField !== undefined && lastUpdateField.status === 'ok'
        ? formatLastUpdate(lastUpdateField.value?.iso ?? '')
        : null,
    aprReconciles: reconciles === true,
    displayableSupplyApr: reconciles ? supplyApr : null,
  };
};

/**
 * `GET /api/pool`.
 *
 * Mismo origen y misma cookie que el resto de la app. Las direcciones nunca
 * viajan en el pedido: la del response es la que el backend leyó de la base.
 *
 * @throws `ApiError` con el código del backend. El texto lo pone quien lo muestra.
 */
export const readRewalletPool = async (): Promise<PoolView | null> =>
  normalizePool(await getJson<PoolResponse>('/pool'));

/**
 * `POST /api/pool/deposit`: pide las transacciones sin firmar de un depósito.
 *
 * @param amountRaw El monto en la **unidad mínima**, como texto decimal.
 * @throws `ApiError` con un código por caso (`AMOUNT_EXCEEDS_BALANCE`,
 *          `BALANCE_UNREADABLE`, …). `null` cuando la respuesta no es interpretable.
 */
export const requestPoolDeposit = async (
  amountRaw: string,
): Promise<DepositPreparationResponse | null> => {
  try {
    const body = await postJson<DepositPreparationResponse>('/pool/deposit', { amount: amountRaw });
    if (body === null || typeof body !== 'object' || !Array.isArray(body.transactions)) return null;
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('DEPOSIT_PREPARATION_FAILED');
  }
};
