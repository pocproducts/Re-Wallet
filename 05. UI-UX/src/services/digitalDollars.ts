/**
 * Lectura de `GET /api/digital-dollars`: **un solo número** y la explicación de
 * cómo está armado.
 *
 * ── Por qué el front no suma nada ────────────────────────────────────────────
 *
 * El total ya viene compuesto del backend, con aritmética `bigint` y en la
 * unidad del contrato. Recalcularlo acá exigiría que el front conociera las
 * piezas, que supiera cuántas son, y que redondeara exactamente igual que el
 * servidor: tres lugares donde el mismo número puede dejar de coincidir con la
 * cadena. El front trae el número, lo **normaliza** y lo pinta. Nada más.
 *
 * ── Por qué no hay ningún precio acá ─────────────────────────────────────────
 *
 * Todo lo que se suma son dólares digitales: USDC libre y el aToken de Aave, que
 * es USDC porque rebasa. No hay una tasa, un precio ni un tipo de cambio en este
 * archivo, y no se puede agregar uno: sin feed de precios, un total en dólares
 * sería una cifra inventada. `MON`, `ETH` y `SOL` no entran al total, y la
 * ausencia es la respuesta honesta.
 *
 * ── Por qué lo que no se pudo leer no se convierte en cero ───────────────────
 *
 * Es la misma regla de `services/pool.ts`: un `0` de rendimiento afirma "el pool
 * no paga" y un `0` de saldo afirma "no tenés nada". Cuando lo que pasó es que
 * no supimos leer, las dos frases son mentira. Por eso la normalización es
 * defensiva en una sola dirección: un campo con una forma que no se reconoce
 * **degrada a ilegible**, nunca a cero. Y un componente que llega `unreadable`
 * conserva su `reason` y **pierde** cualquier `value` que venga pegado: un
 * valor en un componente ilegible es exactamente el dato que se painting como
 * saldo.
 *
 * Y al revés también: un componente que llega `ok` con `raw: "0"` es un cero
 * real y se muestra como cero. Una billetera vacía tiene que poder parecer
 * vacía.
 */

import { getJson } from './api';
import { formatScaled, AMOUNT_DISPLAY_DECIMALS } from './pool';
import type {
  DigitalDollarComponent,
  DigitalDollarsResponse,
  DigitalDollarSource,
} from '../types/digitalDollars.types';
import type { PoolAmount } from '../types/pool.types';

export type {
  DigitalDollarComponent,
  DigitalDollarsResponse,
  DigitalDollarSource,
};

/** Cuántos decimales se muestra un importe de dólares. Los mesmos que el pool. */
export { AMOUNT_DISPLAY_DECIMALS };

/* ── Normalización ─────────────────────────────────────────────────────────── */

/** Un importe del backend, si es interpretable. Mismo criterio que `pool.ts`. */
const toAmount = (value: unknown): PoolAmount | null => {
  const amount = value as PoolAmount | null;
  if (amount === null || typeof amount !== 'object') return null;
  if (typeof amount.raw !== 'string' || !/^[0-9]+$/.test(amount.raw)) return null;
  if (typeof amount.amount !== 'string') return null;
  if (!Number.isInteger(amount.decimals) || amount.decimals < 0) return null;
  if (typeof amount.unit !== 'string') return null;
  return { raw: amount.raw, amount: amount.amount, decimals: amount.decimals, unit: amount.unit };
};

const toSource = (value: unknown): DigitalDollarSource | null =>
  value === 'free_wallet' || value === 'yield' ? value : null;

/**
 * Un componente ya normalizado, con la misma unión del backend.
 *
 * El `bigint` del importe vive acá, no en la vista: la aritmética de este
 * proyecto es entera de punta a punta y el único redondeo es el de pintura.
 */
export type DigitalDollarPart =
  | {
      readonly key: string;
      readonly label: string;
      readonly source: DigitalDollarSource;
      readonly status: 'ok';
      /** El entero exacto en la unidad mínima. `0n` es un cero real. */
      readonly raw: bigint;
      readonly decimals: number;
      /** Listo para pintar: `"1.234,56"`. */
      readonly formatted: string;
      /** `true` cuando el importe es exactamente cero y **sí** se leyó. */
      readonly isZero: boolean;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly source: DigitalDollarSource;
      readonly status: 'unreadable';
      /** Enum acotado del backend. Acá se guarda; nunca se pinta. */
      readonly reason: string;
    };

/**
 * Un componente con forma desconocida **degrada a ilegible**.
 *
 * Es la única dirección en que se degrada. Un componente que no se sabe
 * interpretar no es un cero: es una lectura que no pudimos hacer, y la
 * pantalla tiene que poder decirlo.
 */
const normalizeComponent = (raw: unknown): DigitalDollarPart | null => {
  const entry = raw as Partial<DigitalDollarComponent> | null;
  if (entry === null || typeof entry !== 'object') return null;
  if (typeof entry.key !== 'string' || entry.key.length === 0) return null;
  if (typeof entry.label !== 'string' || entry.label.length === 0) return null;

  const source = toSource(entry.source);
  if (source === null) return null;

  if (entry.status === 'unreadable') {
    return {
      key: entry.key,
      label: entry.label,
      source,
      status: 'unreadable',
      // Sin `value`, pase lo que pase: el valor de un componente ilegible no se
      // muestra, y por lo tanto no puede guardarse.
      reason: typeof entry.reason === 'string' ? entry.reason : 'UNREADABLE',
    };
  }

  if (entry.status !== 'ok') {
    return { key: entry.key, label: entry.label, source, status: 'unreadable', reason: 'UNREADABLE' };
  }

  const value = toAmount(entry.value);
  if (value === null) {
    return { key: entry.key, label: entry.label, source, status: 'unreadable', reason: 'UNREADABLE' };
  }

  const rawValue = BigInt(value.raw);
  return {
    key: entry.key,
    label: entry.label,
    source,
    status: 'ok',
    raw: rawValue,
    decimals: value.decimals,
    formatted: formatScaled(rawValue, value.decimals, AMOUNT_DISPLAY_DECIMALS),
    isZero: rawValue === 0n,
  };
};

/** La lectura normalizada que la pantalla usa. */
export interface DigitalDollarsView {
  readonly generatedAt: string | null;
  /** La unidad de todo lo que hay abajo: `"USDC"`. */
  readonly unit: string;
  /**
   * El total pintado, o `null` cuando no se pudo leer siquiera el número.
   *
   * **No dice si es completo.** Eso es `complete`, y consultarlo es obligatorio:
   * un total parcial con `complete: true` es una mentira, y ningún consumidor de
   * esta vista debería poder mostrar el número sin haberlo mirado.
   */
  readonly total: string | null;
  /** El entero exacto del total, para quien necesite comparar contra la cadena. */
  readonly totalRaw: bigint | null;
  readonly totalDecimals: number;
  /** `false` cuando alguna pieza no se pudo leer: el total es parcial. */
  readonly complete: boolean;
  /** Las piezas, en el orden del backend: la explicación del número. */
  readonly parts: readonly DigitalDollarPart[];
  /** Las piezas que no se pudieron leer, en el orden del backend. */
  readonly unreadableParts: readonly DigitalDollarPart[];
  /** La frase para cuando el total **no** es toda la verdad. `null` si lo es. */
  readonly incompletenessNote: string | null;
}

/**
 * Junta nombres con "y": `"Monad"`, `"Monad y Ethereum"`, `"A, B y C"`.
 *
 * Los nombres son los que ya mandó el backend (`"USDC en Monad"`), así que no
 * hay un mapa de redes escrito a mano que se pueda quedar viejo.
 */
const joinLabels = (labels: readonly string[]): string => {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
};

/**
 * La frase de un total parcial, en castellano y sin jerga.
 *
 * Dice **qué** falta, no sólo que algo falta: un cartel que dice "algo no se pudo
 * leer" deja a la persona sospechar de un saldo que sí es real. Y aclara que el
 * número es la parte que sí se pudo leer, para que el total parcial nunca se lea
 * como el total entero.
 */
export const buildIncompletenessNote = (missingLabels: readonly string[]): string | null => {
  if (missingLabels.length === 0) return null;

  return `Este total está incompleto: no pudimos leer ${joinLabels(
    missingLabels,
  )}. El número de arriba sólo cuenta lo que sí pudimos leer.`;
};

/**
 * La frase de un total que no se pudo leer **entero**.
 *
 * Distingue los dos hechos que se ven iguales desde afuera: una billetera sin
 * dólares y una lectura que no llegó. "No tenés nada" sería una afirmación
 * sobre plata que nadie verificó.
 */
export const TOTAL_UNREADABLE_NOTE =
  'No pudimos leer tu total de dólares. No es que no tengas: es que no lo supimos leer. Probá de nuevo en un rato.';

/**
 * Traduce el cuerpo a la forma que la pantalla usa.
 *
 * `complete` se **deriva** de las piezas y se cruza con el `complete` del
 * backend: si el backend dice que está completo y una pieza normalizada no lo
 * está, el total no se muestra como completo. La regla es la misma en los dos
 * sentidos —un total parcial jamás se presenta como entero—, y por eso no
 * alcanza con copiar el booleano que llegó.
 */
export const normalizeDigitalDollars = (body: unknown): DigitalDollarsView | null => {
  const response = body as Partial<DigitalDollarsResponse> | null;
  if (response === null || typeof response !== 'object') return null;
  if (typeof response.complete !== 'boolean') return null;
  if (!Array.isArray(response.components)) return null;

  const parts: DigitalDollarPart[] = [];
  for (const entry of response.components) {
    const part = normalizeComponent(entry);
    // Un componente que no se puede ni identificar no se descarta en silencio:
    // se vuelve ilegible, que es información, y entra en el total parcial.
    parts.push(
      part ?? {
        key: 'desconocido',
        label: 'Una parte de tu saldo',
        source: 'free_wallet',
        status: 'unreadable',
        reason: 'UNREADABLE',
      },
    );
  }

  const total = toAmount(response.total);
  const unreadableParts = parts.filter((part) => part.status === 'unreadable');

  /*
   * `complete` es una conjunción, no una copia: tiene que ser cierto lo que dice
   * el backend **y** que ninguna pieza haya quedado ilegible al normalizar. El
   * total sin número legible tampoco puede ser completo.
   */
  const complete =
    response.complete && unreadableParts.length === 0 && total !== null && parts.length > 0;

  const missingLabels = unreadableParts.map((part) => part.label);

  return {
    generatedAt: typeof response.generatedAt === 'string' ? response.generatedAt : null,
    unit: total === null || typeof response.unit !== 'string' ? 'USDC' : response.unit,
    total: total === null ? null : formatScaled(BigInt(total.raw), total.decimals, AMOUNT_DISPLAY_DECIMALS),
    totalRaw: total === null ? null : BigInt(total.raw),
    totalDecimals: total === null ? 6 : total.decimals,
    complete,
    parts,
    unreadableParts,
    incompletenessNote: complete ? null : buildIncompletenessNote(missingLabels),
  };
};

/**
 * `GET /api/digital-dollars`.
 *
 * Mismo origen y misma cookie que el resto de la app. Esta ruta **no acepta**
 * ningún parámetro: todo lo que suma sale de las billeteras de esta persona,
 * según la cookie.
 *
 * @throws `ApiError` con el código del backend. El texto lo pone quien lo muestra.
 */
export const readRewalletDigitalDollars = async (): Promise<DigitalDollarsView | null> =>
  normalizeDigitalDollars(await getJson<DigitalDollarsResponse>('/digital-dollars'));