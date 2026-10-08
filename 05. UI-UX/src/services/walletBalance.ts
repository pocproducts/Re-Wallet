/**
 * Reading of `GET /api/wallet-balance`: the transport, the normalization and the
 * exact display arithmetic for the one number this product is about.
 *
 * ── Why the front adds nothing ───────────────────────────────────────────────
 *
 * The backend composes the balance: `cryptoValue + digitalDollarsValue` = `total`,
 * summed in `bigint` at the widest scale of all of them, with no rounding. The
 * browser is handed that total and prints it.
 *
 * There is deliberately **no arithmetic operator over two server numbers in this
 * file**, and there is deliberately **no filter over the pieces either**. Adding
 * the buckets here would re-create the defect the route exists to remove — two
 * figures on one screen that the person has to add in their head — and filtering
 * them here would put a second copy of the peg table in the browser, where it
 * could disagree with the server's. The only operations here are per-amount
 * **formatting** (one rounding, at paint time, never before it).
 *
 * ── Why there are three buckets and which one paints which card ─────────────
 *
 * | bucket                | card / screen                    | contents                        |
 * |-----------------------|----------------------------------|---------------------------------|
 * | `cryptoValue`         | "Bitcoin & Crypto"                | free, **non-pegged**: MON, ETH, SOL, BTC |
 * | `digitalDollarsValue` | "Dólares digitales"               | every pegged piece, free or deposited |
 * | `investedValue`       | the "de dónde sale" drill-down    | pool positions alone            |
 *
 * `cryptoValue` and `digitalDollarsValue` are disjoint and exhaustive of the
 * wallet, and `investedValue` is a **view inside** the second of them — the same
 * pool piece seen from another question — not a third term. That is why the two
 * cards can never show the same money twice and why the total counts each
 * dollar once.
 *
 * ── Why an unreadable piece loses its value, even if one shows up ────────────
 *
 * Normalization degrades in exactly one direction: an unknown shape becomes
 * `unreadable`, never zero. A piece that arrives `unreadable` is normalized to
 * `value: null` **whatever the body carried**, because a value printed on an
 * unreadable piece is precisely the datum that gets painted as a balance. Zero
 * is not unreadable, and that distinction survives here: a piece that arrives
 * `ok` with `raw: "0"` stays `ok` with `isZero: true`, so an empty wallet is
 * still allowed to look empty.
 *
 * ── `depositReady` y `depositable`: SI Y CUÁNTO, DICHO POR EL SERVIDOR ────
 *
 * El botón de depósito vive en la fila del venue, y la fila no puede decidir si
 * ese botón existe: el destino de un depósito dejó de estar compilado en el
 * cliente, y escribir acá una lista de venues con botón sería devolver el
 * problema con otro nombre. Por eso la fila **pregunta** —`depositReady` si el
 * venue puede recibir un depósito, `depositable` cuánto hay para mandarle— y esta
 * archivo sólo traduce las dos respuestas a la forma que la pantalla pinta.
 *
 * Y la decisión de qué hacer con ellas vive en `venueRowActionOf`, que es lógica
 * pura y no JSX: la fila que dibuja botón y la que no se pueden leer en una
 * prueba, sin DOM y sin renderizar nada.
 */

import { getJson } from './api';
import { formatScaled, AMOUNT_DISPLAY_DECIMALS } from './pool';
import { formatScaledTrimmed } from './portfolio';
import type {
  WalletBalanceAmount,
  WalletBalanceBucketPayload,
  WalletBalanceChain,
  WalletBalanceInvestedBucketPayload,
  WalletBalancePiece,
  WalletBalancePrice,
  WalletBalanceRatioPayload,
  WalletBalanceResponse,
  WalletBalanceTotalPayload,
  WalletBalanceVenueRatePayload,
  WalletBalanceVenuePayload,
  WalletBalanceYieldPayload,
} from '../types/walletBalance.types';

/** Display decimals for a coin quantity. The same the crypto list uses. */
const QUANTITY_DISPLAY_DECIMALS = 6;

export type { WalletBalanceChain, WalletBalancePiece };

/* ── Normalization ─────────────────────────────────────────────────────────── */

/**
 * An exact amount the screen can paint, or `null` when the body is not one.
 *
 * `raw` is kept as a `bigint` because this project's arithmetic is integral end
 * to end; the only rounding happens when `formatted` is produced, and it happens
 * once.
 */
export interface AmountView {
  readonly raw: bigint;
  readonly decimals: number;
  readonly unit: string;
  /** `"1.234,56"` for a dollar, `"1,5"` for a coin quantity. */
  readonly formatted: string;
  /** `true` when the amount is exactly zero **and was read**. */
  readonly isZero: boolean;
}

/** A coin quantity: trimmed, so a whole number does not show trailing zeros. */
const toQuantityView = (value: unknown): AmountView | null => {
  const amount = toAmount(value);
  if (amount === null) return null;

  const raw = BigInt(amount.raw);
  return {
    raw,
    decimals: amount.decimals,
    unit: amount.unit,
    formatted: formatScaledTrimmed(raw, amount.decimals, QUANTITY_DISPLAY_DECIMALS),
    isZero: raw === 0n,
  };
};

/** A dollar figure: always two decimals, because cents are part of the number. */
const toUsdView = (value: unknown): AmountView | null => {
  const amount = toAmount(value);
  if (amount === null) return null;

  const raw = BigInt(amount.raw);
  return {
    raw,
    decimals: amount.decimals,
    unit: amount.unit,
    formatted: formatScaled(raw, amount.decimals, AMOUNT_DISPLAY_DECIMALS),
    isZero: raw === 0n,
  };
};

/** An amount from the backend, if it is interpretable. Same bar as `pool.ts`. */
const toAmount = (value: unknown): WalletBalanceAmount | null => {
  const amount = value as WalletBalanceAmount | null;
  if (amount === null || typeof amount !== 'object') return null;
  if (typeof amount.raw !== 'string' || !/^[0-9]+$/.test(amount.raw)) return null;
  if (typeof amount.amount !== 'string') return null;
  if (!Number.isInteger(amount.decimals) || amount.decimals < 0) return null;
  if (typeof amount.unit !== 'string') return null;
  return { raw: amount.raw, amount: amount.amount, decimals: amount.decimals, unit: amount.unit };
};

/** The price that was used, if it is one. An unparseable price is no price. */
const toPrice = (value: unknown): WalletBalancePrice | null => {
  const price = value as WalletBalancePrice | null;
  if (price === null || typeof price !== 'object') return null;
  if (typeof price.usd !== 'string' || !/^-?[0-9]+(\.[0-9]+)?$/.test(price.usd)) return null;
  if (typeof price.raw !== 'string' || !/^-?[0-9]+$/.test(price.raw)) return null;
  if (!Number.isInteger(price.decimals) || price.decimals < 0) return null;
  if (price.source !== 'peg' && price.source !== 'chainlink') return null;
  if (price.pair !== null && typeof price.pair !== 'string') return null;
  if (price.updatedAt !== null && typeof price.updatedAt !== 'number') return null;
  if (price.crossChecked !== null && typeof price.crossChecked !== 'boolean') return null;

  return {
    usd: price.usd,
    raw: price.raw,
    decimals: price.decimals,
    source: price.source,
    pair: price.pair,
    updatedAt: price.updatedAt,
    crossChecked: price.crossChecked,
  };
};

/** The unit price, painted the way a price reads: `"0,028642"`. */
export const formatUnitPrice = (price: WalletBalancePrice | null): string | null => {
  if (price === null) return null;

  return formatPriceText(price.usd);
};

/** A decimal text price (`"0.028642"`) as an Argentine decimal (`"0,028642"`). */
const formatPriceText = (usd: string): string => {
  const negative = usd.startsWith('-');
  const unsigned = negative ? usd.slice(1) : usd;
  const dot = unsigned.indexOf('.');
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);
  const grouped = BigInt(whole === '' ? '0' : whole).toLocaleString('es-AR');
  const body = fraction.length === 0 ? grouped : `${grouped},${fraction}`;
  return negative ? `-${body}` : body;
};

const toChain = (value: unknown): WalletBalanceChain | null =>
  value === 'monad' || value === 'ethereum' || value === 'solana' ? value : null;

const toSource = (value: unknown): 'free_wallet' | 'pool_position' =>
  value === 'pool_position' ? 'pool_position' : 'free_wallet';

/* ── The pieces ────────────────────────────────────────────────────────────── */

/** One piece, already normalized and already honest about its own state. */
export type WalletBalancePart =
  | {
      readonly key: string;
      readonly label: string;
      readonly source: 'free_wallet' | 'pool_position';
      readonly chain: WalletBalanceChain | null;
      readonly status: 'ok';
      readonly reason: null;
      /** What is held, at the asset's own decimals. */
      readonly quantity: AmountView;
      /** How it was valued. Never `null` on a readable piece. */
      readonly price: WalletBalancePrice;
      /** The USD value. `isZero` is a real zero, not a missing value. */
      readonly value: AmountView;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly source: 'free_wallet' | 'pool_position';
      readonly chain: WalletBalanceChain | null;
      readonly status: 'unreadable';
      /** Bounded enum from the backend. The sentence is this file's job. */
      readonly reason: string;
      /**
       * Kept because it is true, and never summed: a quantity without a price
       * has no dollar value. No screen paints it — the owner's rule for an
       * unreadable piece is its reason and no number at all.
       */
      readonly quantity: AmountView | null;
      readonly price: null;
      readonly value: null;
    };

const UNREADABLE_IDENTITY = {
  key: 'desconocido',
  label: 'Una parte de tu saldo',
  source: 'free_wallet',
  chain: null,
} as const;

/** A venue the body arrived without a name for: named here, never dropped. */
const UNKNOWN_VENUE_LABEL = 'Un lugar de tu plata';

/**
 * A piece with an unrecognized shape degrades to `unreadable`, in one direction
 * only. It is never dropped either: an unnamed gap is still a gap, and the
 * bucket has to say so.
 */
const normalizePart = (raw: unknown): WalletBalancePart => {
  const entry = raw as Record<string, unknown> | null;
  if (entry === null || typeof entry !== 'object') {
    return { ...UNREADABLE_IDENTITY, status: 'unreadable', reason: 'UNREADABLE', quantity: null, price: null, value: null };
  }

  const key = typeof entry.key === 'string' && entry.key.length > 0 ? entry.key : UNREADABLE_IDENTITY.key;
  const label =
    typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : UNREADABLE_IDENTITY.label;
  const source = toSource(entry.source);
  const chain = toChain(entry.chain);

  const unreadable = (reason: string, quantity: AmountView | null): WalletBalancePart => ({
    key,
    label,
    source,
    chain,
    status: 'unreadable',
    reason,
    quantity,
    price: null,
    value: null,
  });

  /*
   * The union is checked before anything is read: a piece that says
   * `unreadable` never reaches the price/value branches below, whatever else the
   * body carries. That is the rule that makes "a value and a failure at the same
   * time" unrepresentable here too, and not only in the type.
   */
  if (entry.status !== 'ok') {
    return unreadable(typeof entry.reason === 'string' ? entry.reason : 'UNREADABLE', toQuantityView(entry.quantity));
  }

  const quantity = toQuantityView(entry.quantity);
  const price = toPrice(entry.price);
  const value = toUsdView(entry.value);

  // A readable piece that cannot be reproduced is not readable. Degrade, never zero.
  if (quantity === null || price === null || value === null) {
    return unreadable(typeof entry.reason === 'string' ? entry.reason : 'UNREADABLE', quantity);
  }

  return { key, label, source, chain, status: 'ok', reason: null, quantity, price, value };
};

/* ── The combined yield ────────────────────────────────────────────────────── */

/** How many decimal places a rate is painted with. A **screen** decision. */
export const RATE_DISPLAY_DECIMALS = 2;

/**
 * A venue's own rate, exact, plus the text the venue published.
 *
 * `raw` and `decimals` are the same number as `text`; keeping the integer means
 * the painter can round it **once**, in `bigint`, instead of re-parsing a decimal
 * string that a floating point parser might have already spoiled.
 */
export interface YieldVenueRateView {
  readonly raw: bigint;
  readonly decimals: number;
  /** Always a **fraction** of one, e.g. `"0.0412"`. Never a percentage. */
  readonly text: string;
}

/** An exact ratio, both halves whole. The backend's `numerator / denominator`. */
export interface YieldRatioView {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** El saldo de origen de un venue: el USDC libre de su cadena, exacto. */
export type VenueDepositableView =
  | { readonly status: 'ok'; readonly amount: AmountView }
  | { readonly status: 'unreadable'; readonly reason: string };

/**
 * Si un venue puede recibir un depósito, y — cuando no— **por qué**.
 *
 * No es un `boolean` y no es una lista del front: es lo que respondió el
 * servidor, que es el único que sabe si armó el mensaje o no. `not_ready` trae un
 * motivo acotado y **la frase para pintar tal cual**: un `false` pelado dejaría
 * que la pantalla inventara la explicación, y una explicación inventada es como
 * alguien firma una transacción que va a fallar.
 */
export type VenueDepositReadinessView =
  | { readonly status: 'ready' }
  | {
      readonly status: 'not_ready';
      readonly reason: string;
      readonly missingSteps: number;
      readonly message: string;
    };

/** `not_ready` sin motivo ni frase no es un motivo: es el estado más vago posible. */
const NOT_READY: VenueDepositReadinessView = {
  status: 'not_ready',
  reason: 'DEPOSIT_INSTRUCTIONS_UNVERIFIED',
  missingSteps: 1,
  message: 'Este lugar todavía no puede recibir depósitos.',
};

/**
 * Lo que el servidor dice sobre el origen del depósito, leído sin confiar.
 *
 * Misma regla que en el resto del archivo: una forma que no se reconoce **degrada
 * a `unreadable`**, nunca a `ok` con cero. Un `ok` con `raw: '0'` viene del
 * servidor y es un cero verdadero; un `ok` que arma este normalizador porque no
 * entendió el cuerpo sería un cero inventado, que es exactamente la cifra sobre la
 * que alguien firmaría.
 */
const toDepositable = (value: unknown): VenueDepositableView => {
  const field = value as { readonly status?: unknown; readonly amount?: unknown; readonly reason?: unknown } | null;
  if (field === null || typeof field !== 'object' || field.status !== 'ok') {
    return {
      status: 'unreadable',
      reason: typeof field?.reason === 'string' ? field.reason : 'UNREADABLE',
    };
  }

  const amount = toQuantityView(field.amount);
  if (amount === null) return { status: 'unreadable', reason: 'UNREADABLE' };
  return { status: 'ok', amount };
};

/**
 * `depositReady` del backend, o el refus más cercano que se puede pintar.
 *
 * Un `not_ready` bien formado viaja **entero**, con su motivo y su frase: la
 * escribió quien sabe qué falta, y una pantalla que la reescribe termina
 * explicando mal la plata. Lo que no se preserva es un cuerpo que no se entiende,
 * y en ese caso el estado es `not_ready` y no `ready` —ausente es ilegible, y un
 * ilegible no habilita una acción que mueve plata.
 */
const toDepositReady = (value: unknown): VenueDepositReadinessView => {
  const ready = value as {
    readonly status?: unknown;
    readonly reason?: unknown;
    readonly missingSteps?: unknown;
    readonly message?: unknown;
  } | null;
  if (ready === null || typeof ready !== 'object') return NOT_READY;
  if (ready.status === 'ready') return { status: 'ready' };

  return {
    status: 'not_ready',
    reason: typeof ready.reason === 'string' && ready.reason.length > 0 ? ready.reason : NOT_READY.reason,
    missingSteps:
      Number.isInteger(ready.missingSteps) && (ready.missingSteps as number) > 0
        ? (ready.missingSteps as number)
        : NOT_READY.missingSteps,
    message: typeof ready.message === 'string' && ready.message.trim().length > 0 ? ready.message : NOT_READY.message,
  };
};

/**
 * One venue of the combined figure. A union, because "holds nothing" and
 * "could not be read" are different facts and a screen must not have to guess
 * which one it is painting: `status` decides, and an unreadable venue is
 * **typed** as carrying neither a balance nor a rate.
 *
 * `chain`, `depositable` y `depositReady` viajan en **los dos** brazos, y no por
 * comodidad: si un `unreadable` los trajera ausentes, la fila tendría que
 * inventar si el botón existe. Un venue cuya posición no se pudo leer igual puede
 * tener plata libre y puede, o no, aceptar depósitos.
 */
export type YieldVenueView =
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'ok';
      /** The network this venue lives on. The screen never infers it from a label. */
      readonly chain: WalletBalanceChain | null;
      /** `'zero_balance'` only: the venue holds nothing and carries no weight. */
      readonly exclusion: 'zero_balance' | null;
      readonly balance: AmountView;
      /** `null` only for a zero-balance venue: no rate is owed there. */
      readonly rate: YieldVenueRateView | null;
      /** How much free USDC of **this venue's chain** could be deposited here. */
      readonly depositable: VenueDepositableView;
      /** Whether a deposit can be made here at all, and why not. */
      readonly depositReady: VenueDepositReadinessView;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly status: 'unreadable';
      readonly reason: string;
      readonly chain: WalletBalanceChain | null;
      readonly balance: null;
      readonly rate: null;
      readonly depositable: VenueDepositableView;
      readonly depositReady: VenueDepositReadinessView;
    };

/**
 * The one annual figure for every venue, and the breakdown behind it.
 *
 * `rate` is `null` **exactly** when `complete` is `false`. There is no shape in
 * which a partial weighted mean is held here, and none in which a complete one
 * is withheld: the backend refused to publish the first, so the browser cannot
 * invent it either.
 */
export interface WalletBalanceYieldView {
  readonly complete: boolean;
  readonly rate: YieldRatioView | null;
  readonly venues: readonly YieldVenueView[];
  readonly unreadableVenues: readonly YieldVenueView[];
  /** The sentence for an incomplete figure, or `null` when it is whole. */
  readonly incompletenessNote: string | null;
}

/**
 * The sentence when the **whole** yield read did not arrive, or arrived
 * unreadable in its own right.
 *
 * Same rule, same tone as `BALANCE_UNREADABLE_NOTE`: a rate that could not be
 * read is not a rate of zero, and a dash or a `0,00%` would say otherwise about
 * somebody's money.
 */
export const YIELD_UNREADABLE_NOTE =
  'No pudimos leer las tasas de todos los lugares donde está tu plata, así que no te mostramos un número. No es que no rindan: es que no lo supimos leer.';

/**
 * The sentence when the reads arrived but **one of them did not land**.
 *
 * It names the venue, because "no pudimos leer una tasa" leaves the person
 * suspecting a yield that is real and lower than it looks.
 */
export const buildYieldIncompletenessNote = (missingLabels: readonly string[]): string | null => {
  if (missingLabels.length === 0) return null;

  return `No pudimos leer ${joinLabels(
    missingLabels,
  )}, así que no te mostramos un número combinado. Lo que sí leímos no alcanza para decir cuánto rinde todo junto.`;
};

/** Plain sentence for a venue that holds nothing, and is therefore out of the mean. */
export const YIELD_ZERO_VENUE_NOTE =
  'No tenés nada depositado acá, así que este lugar no pesa en el número combinado.';

/** A decimal string of a whole integer. Anything else is not a number. */
const toWhole = (value: unknown): bigint | null =>
  typeof value === 'string' && /^[0-9]+$/.test(value) ? BigInt(value) : null;

/**
 * The exact ratio, or `null`.
 *
 * Both halves are parsed with `BigInt` **from their decimal strings**, never with
 * `Number`: at the scale this feature works at — balances in units of `1e-6`
 * times rates at up to nineteen fractional digits — the two halves run far past
 * `Number.MAX_SAFE_INTEGER`. A float parse would round both ends of the division
 * before it ever happened, and the "exact" figure would be exact only to about
 * fifteen digits. A denominator of zero is a refusal, not a rate: it is returned
 * as `null`, so the figure degrades to "not readable" instead of dividing.
 */
const toRatio = (value: unknown): YieldRatioView | null => {
  const ratio = value as Partial<WalletBalanceRatioPayload> | null;
  if (ratio === null || typeof ratio !== 'object') return null;

  const numerator = toWhole(ratio.numerator);
  const denominator = toWhole(ratio.denominator);
  if (numerator === null || denominator === null || denominator === 0n) return null;

  return { numerator, denominator };
};

/** A venue's own rate, or `null` when what arrived is not one. */
const toVenueRate = (value: unknown): YieldVenueRateView | null => {
  const rate = value as Partial<WalletBalanceVenueRatePayload> | null;
  if (rate === null || typeof rate !== 'object') return null;
  if (typeof rate.text !== 'string' || rate.text.trim().length === 0) return null;

  const raw = toWhole(rate.raw);
  if (raw === null) return null;
  if (!Number.isInteger(rate.decimals) || (rate.decimals as number) < 0) return null;

  return { raw, decimals: rate.decimals as number, text: rate.text };
};

/**
 * One venue, degraded in one direction only.
 *
 * A venue whose `status` is not `ok` never reaches the branches that read a
 * balance or a rate, whatever else the body carries — the same rule as
 * `normalizePart`, and for the same reason: a rate next to a failure is a
 * number the screen would paint.
 *
 * `chain`, `depositable` y `depositReady` se leen **en los dos brazos** y fuera
 * de las ramas, porque no son cifras que se pintan: son hechos sobre la fila. La
 * cadena se lee o vale `null` —nunca se deduce de la etiqueta, que es como se
 * ofrece un depósito en la red equivocada— y los otros dos degradan por su cuenta.
 */
const normalizeVenue = (raw: unknown): YieldVenueView => {
  /*
   * `Partial<WalletBalanceVenuePayload>` would not do here: `Partial` does not
   * distribute over that union, so it collapses to the `ok` arm and `reason`
   * stops existing as a property. At this boundary every field is untrusted
   * anyway, so the reader is spelled out structurally and each branch still
   * decides what it is willing to believe.
   *
   * Y por eso `chain`, `depositable` y `depositReady` se leen **estructuralmente**
   * aunque no estén en `WalletBalanceVenuePayload`: en esta frontera el cuerpo es
   * ajeno, y un tipo que declara campos que el servidor todavía no manda es un
   * tipo al que el compilador le prestaría una confianza que acá no existe.
   */
  const venue = raw as {
    readonly key?: unknown;
    readonly label?: unknown;
    readonly status?: unknown;
    readonly reason?: unknown;
    readonly exclusion?: unknown;
    readonly balance?: unknown;
    readonly rate?: unknown;
    readonly chain?: unknown;
    readonly depositable?: unknown;
    readonly depositReady?: unknown;
  } | null;
  if (venue === null || typeof venue !== 'object') {
    return {
      key: 'desconocido',
      label: UNKNOWN_VENUE_LABEL,
      status: 'unreadable',
      reason: 'UNREADABLE',
      chain: null,
      balance: null,
      rate: null,
      depositable: { status: 'unreadable', reason: 'UNREADABLE' },
      depositReady: toDepositReady(null),
    };
  }

  const key = typeof venue.key === 'string' && venue.key.length > 0 ? venue.key : 'desconocido';
  const label = typeof venue.label === 'string' && venue.label.length > 0 ? venue.label : UNKNOWN_VENUE_LABEL;
  const chain = toChain(venue.chain);
  const depositable = toDepositable(venue.depositable);
  const depositReady = toDepositReady(venue.depositReady);

  if (venue.status !== 'ok') {
    return {
      key,
      label,
      status: 'unreadable',
      reason: typeof venue.reason === 'string' ? venue.reason : 'UNREADABLE',
      chain,
      balance: null,
      rate: null,
      depositable,
      depositReady,
    };
  }

  const balance = toUsdView(venue.balance);
  // A readable venue whose balance is not readable is not readable, and it is
  // never downgraded to a zero balance: a zero is a different, true claim.
  if (balance === null) {
    return {
      key,
      label,
      status: 'unreadable',
      reason: 'UNREADABLE',
      chain,
      balance: null,
      rate: null,
      depositable,
      depositReady,
    };
  }

  const exclusion = venue.exclusion === 'zero_balance' ? 'zero_balance' : null;
  return { key, label, status: 'ok', chain, exclusion, balance, rate: toVenueRate(venue.rate), depositable, depositReady };
};

/**
 * The combined figure and its breakdown.
 *
 * `complete` is a **conjunction**, never a copy of the backend's boolean: the
 * backend's word AND the absence of any venue that degraded here AND an exact
 * ratio that survived parsing. A rate nobody can reproduce is not complete, and
 * a venue nobody could read is not hidden behind a `true`.
 *
 * A body with no `yield` at all is a failed read of the yield, not a yield of
 * zero: it normalizes to the same incomplete shape with no venues, and the
 * screen says so.
 */
const normalizeYield = (raw: unknown): WalletBalanceYieldView => {
  const payload = raw as Partial<WalletBalanceYieldPayload> | null;
  if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.venues)) {
    return {
      complete: false,
      rate: null,
      venues: [],
      unreadableVenues: [],
      incompletenessNote: YIELD_UNREADABLE_NOTE,
    };
  }

  const venues = payload.venues.map(normalizeVenue);
  const unreadableVenues = venues.filter((venue) => venue.status === 'unreadable');
  const ratio = toRatio(payload.rate);

  const complete = payload.complete === true && unreadableVenues.length === 0 && ratio !== null;

  return {
    complete,
    // The null here is not defensive noise: `rate` is published only when the
    // backend said the reads were whole, and this view holds it only then.
    rate: complete ? ratio : null,
    venues,
    unreadableVenues,
    incompletenessNote: complete
      ? null
      : unreadableVenues.length > 0
        ? buildYieldIncompletenessNote(unreadableVenues.map((venue) => venue.label))
        : YIELD_UNREADABLE_NOTE,
  };
};

/* ── The one rounding, at paint ────────────────────────────────────────────── */

/**
 * An exact ratio of a fraction of one, painted as a percent.
 *
 * ```
 *   percent = round_half_up( (numerator x 100 x 10^places) / denominator )
 * ```
 *
 * Entirely in `bigint`: the quotient is formed by integer division of whole
 * numbers, and the only loss is the single rounding the display asks for —
 * `roundScaled` does the same thing at a known scale and for the same reason.
 * `null` when there is no figure to paint, which is the only way this function
 * declines: it never returns `"0,00%"` for a read that did not happen.
 */
export const formatYieldRate = (yieldView: WalletBalanceYieldView, places: number = RATE_DISPLAY_DECIMALS): string | null => {
  if (!yieldView.complete || yieldView.rate === null) return null;
  if (places < 0) throw new RangeError(`places must not be negative: ${places}`);

  const { numerator, denominator } = yieldView.rate;
  // Half-up by adding half the divisor before the division: one rounding, and
  // it happens here, on the way to the screen, and nowhere else.
  const scaled = (2n * numerator * 100n * 10n ** BigInt(places) + denominator) / (2n * denominator);

  return `${formatScaled(scaled, places, places)}%`;
};

/**
 * A venue's own rate, painted as a percent, from the exact integer it published.
 *
 * The **same** rounding as the combined figure, over the same kind of number, so
 * a venue can never read as a different rate than the weighted mean it feeds:
 * both are fractions of one, and both are turned into a percentage once, here.
 */
export const formatVenueRate = (
  rate: YieldVenueRateView | null,
  places: number = RATE_DISPLAY_DECIMALS,
): string | null => {
  if (rate === null || places < 0) return null;

  const scaled = (2n * rate.raw * 100n * 10n ** BigInt(places) + 10n ** BigInt(rate.decimals)) / (2n * 10n ** BigInt(rate.decimals));

  return `${formatScaled(scaled, places, places)}%`;
};

/**
 * `DEPOSIT_READY_NOTE`: lo que se dice cuando el destino todavía no acepta
 * depósitos.
 *
 * La frase **del servidor** manda y esta sólo existe para cuando `depositReady`
 * no trajo ninguna: un cuerpo viejo, o una lectura a medio hacer. Es un texto de
 * último recurso y por eso está escrito para no mentir —no promete una fecha, no
 * dice “casi”—, y no reemplaza al del backend cuando ese llega.
 */
export const DEPOSIT_READY_NOTE =
  'Este lugar todavía no puede recibir depósitos. No te escondemos el botón: no hay uno que funcione.';

/**
 * POR QUÉ UNA FILA NO DIBUJA BOTÓN. Cerrado, porque una pantalla que inventa el
 * motivo de una acción que no puede hacer termina explicando mal la plata.
 */
export type VenueRowAbsentReason =
  /** La red todavía no tiene ningún lugar donde rendir esos dólares. */
  | 'no_venue'
  /** La fila del venue no se pudo leer. */
  | 'venue_unreadable'
  /** El servidor dice que ese depósito no se ejecuta todavía, y por qué. */
  | 'deposit_not_ready'
  /** No se pudo leer cuánto hay para depositar: no hay cifra sobre la que firmar. */
  | 'origin_unreadable'
  /** Se leyó y es cero: no hay nada que mandar. */
  | 'origin_zero'
  /** El venue puede recibir, pero la app todavía no tiene su flujo de depósito. */
  | 'no_flow_yet';

/**
 * LO QUE UNA FILA HACE CON SU VENUE, DECIDIDO SIN DIBUJAR NADA.
 *
 * Es lógica pura a propósito. La regla de este repo —*lo que no se pudo leer no se
 * muestra, y cuando se vuelve a poder leer aparece*— no necesita un DOM para ser
 * una regla: necesita poder preguntarle a una función qué hace con cada fila y
 * comparar la respuesta. Por eso la decisión vive acá y la vista sólo la pinta.
 */
export type VenueRowAction =
  | {
      readonly kind: 'deposit';
      readonly venueKey: string;
      /** El tope exacto que el servidor dijo que hay, en la unidad mínima. */
      readonly maxAmountRaw: bigint;
      readonly maxAmountFormatted: string;
    }
  | {
      readonly kind: 'absent';
      readonly reason: VenueRowAbsentReason;
      /** La frase para pintar tal cual. Nunca un código en la vista. */
      readonly message: string;
    };

/** La etiqueta de cada red, escrita una sola vez. */
const CHAIN_LABELS: Readonly<Record<WalletBalanceChain, string>> = {
  monad: 'Monad',
  ethereum: 'Ethereum',
  solana: 'Solana',
};

/**
 * Las redes cuyas filas de destino se dibujan, en el orden en que se ven.
 *
 * Es la **misma** lista de redes que la app ya declara para recibir y para enviar
 * (`KNOWN_CHAIN_IDS` en `portfolio.ts` y `depositInfo.ts`): la app no descubre
 * redes nuevas por su cuenta. Lo que esta lista **no** dice es qué venues hay en
 * cada una —eso lo responde el servidor—; por eso el cruce se arma acá y el
 * destino de cada fila nunca se escribe a mano.
 */
export const YIELD_VENUE_CHAINS: readonly WalletBalanceChain[] = ['monad', 'ethereum', 'solana'];

/**
 * ¿QUÉ HACE LA FILA DE ESTE VENUE?
 *
 * El orden de las guardas es el orden en que sevan descartando las razones, y
 * importa: primero lo que **no existe** (no hay venue), después lo que **no se
 * pudo leer**, después lo que **no se puede hacer** (el servidor dice que no), y
 * recién al final lo que no hay para mandar. Al revés, una fila sin destino
 * terminaría culpando a la plata.
 *
 * - **Sin venue** → la red todavía no tiene un lugar donde rendir. Se lo dice, con
 *   su frase: es una carencia del producto, y esconderla es como si no existiera.
 * - **Fila ilegible** → no se dibuja nada. Un lugar que no se pudo leer no puede
 *   ofrecer una acción: la acción se apoya en lo que no se leyó.
 * - **`depositReady: not_ready`** → no dibuja botón. Ni deshabilitado, ni gris,
 *   ni un “próximamente”: un botón que falla en la red principal es peor que un
 *   botón que todavía no existe. Y el motivo es el que dice el servidor.
 * - **Origen ilegible** → no dibuja botón. Depositar sobre una cifra que nadie
 *   pudo leer no es una acción que vaya a funcionar.
 * - **Origen en cero real** → tampoco. Y es un hecho **distinto** del anterior: se
 *   leyó y no hay nada, contra no se supó cuánto hay. Las dos frases lo dicen así,
 *   porque confundirlas es exactamente el defecto.
 *
 * `flowVenueKey` es el venue para el que la app **sí** tiene un flujo de depósito
 * ejecutable —hoy, el único— y no es una lista de venues con botón: es el flujo que
 * existe. Un venue que el servidor declara listo pero cuyo flujo todavía no está
 * en la app no dibuja nada, porque abrir el flujo de otro venue es mover plata en
 * una cadena que no es la de la fila.
 */
export const venueRowActionOf = (
  venue: YieldVenueView | null,
  chainLabel: string,
  flowVenueKey: string | null,
): VenueRowAction => {
  if (venue === null) {
    return {
      kind: 'absent',
      reason: 'no_venue',
      message: `En ${chainLabel} todavía no tenés un lugar donde rendir esos dólares.`,
    };
  }

  if (venue.status !== 'ok') {
    return {
      kind: 'absent',
      reason: 'venue_unreadable',
      message: `No pudimos leer ${venue.label}, así que no te ofrecemos nada acá. No es que esté vacío: es que no lo supimos leer.`,
    };
  }

  if (venue.depositReady.status !== 'ready') {
    // La frase del servidor manda tal cual: la escribió quien sabe qué falta.
    return {
      kind: 'absent',
      reason: 'deposit_not_ready',
      message: venue.depositReady.message || DEPOSIT_READY_NOTE,
    };
  }

  if (venue.depositable.status !== 'ok') {
    return {
      kind: 'absent',
      reason: 'origin_unreadable',
      message: `No pudimos leer cuánto USDC libre tenés en ${chainLabel}, así que no dibujamos el botón: no se depone sobre un número que nadie conoce.`,
    };
  }

  if (venue.depositable.amount.isZero) {
    return {
      kind: 'absent',
      reason: 'origin_zero',
      message: `No tenés USDC libre en ${chainLabel} para depositar acá. Leímos la cuenta y está en cero.`,
    };
  }

  if (flowVenueKey === null || venue.key !== flowVenueKey) {
    return {
      kind: 'absent',
      reason: 'no_flow_yet',
      message: `${venue.label} puede recibir depósitos, pero todavía no tenemos el paso a paso para hacértelo desde acá.`,
    };
  }

  return {
    kind: 'deposit',
    venueKey: venue.key,
    maxAmountRaw: venue.depositable.amount.raw,
    maxAmountFormatted: venue.depositable.amount.formatted,
  };
};

/**
 * UNA FILA POR RED, con lo que el servidor contó y con lo que no contó.
 *
 * Las redes salen del catálogo de la app (`SUPPORTED_EVM_CHAINS` y Solana), que es
 * donde ya vive la respuesta a “¿en qué redes puede funcionar esto?”. Las venues
 * salen del balance. Cruzarlos es lo que permite que una red **sin** venue se
 * dibuje igual, diciendo que no lo tiene: una fila que no aparece es una carencia
 * del producto disfrazada de dato.
 */
export interface VenueRow {
  readonly chain: WalletBalanceChain;
  readonly chainLabel: string;
  /** La venue de esa red, o `null` cuando todavía no hay ninguna. */
  readonly venue: YieldVenueView | null;
  readonly action: VenueRowAction;
}

export const venueRowsOf = (
  venues: readonly YieldVenueView[],
  chains: readonly WalletBalanceChain[],
  flowVenueKey: string | null,
): readonly VenueRow[] =>
  chains.map((chain) => {
    // La primera venue de la red que aparezca: la composición ya garantiza que un
    // venue sólo pueda tener la suya, así que el cruce no puede dar dos filas.
    const venue = venues.find((candidate) => candidate.chain === chain) ?? null;
    return {
      chain,
      chainLabel: CHAIN_LABELS[chain],
      venue,
      action: venueRowActionOf(venue, CHAIN_LABELS[chain], flowVenueKey),
    };
  });

/* ── The buckets, the total, and the sentences ─────────────────────────────── */

/** A bucket the screen can paint: its total, its pieces and what is missing. */
export interface WalletBalanceBucketView {
  readonly unit: string;
  /** `false` when at least one piece is unreadable. Never inferred away. */
  readonly complete: boolean;
  /** The exact sum the backend sent, or `null` when it could not be read. */
  readonly total: AmountView | null;
  readonly parts: readonly WalletBalancePart[];
  readonly unreadableParts: readonly WalletBalancePart[];
  /** The sentence for an incomplete bucket, or `null` when it is whole. */
  readonly incompletenessNote: string | null;
  /**
   * The **combined** annual figure of the venues in this bucket, when the bucket
   * is the one that carries one. `null` on every other bucket, and `null` when
   * the body had no yield at all: never a zero.
   */
  readonly yield: WalletBalanceYieldView | null;
}

/** The headline, as the backend composed it. Nothing here adds anything to it. */
export interface WalletBalanceTotalView {
  readonly complete: boolean;
  readonly usd: AmountView | null;
  readonly incompletenessNote: string | null;
}

export interface WalletBalanceView {
  readonly generatedAt: string | null;
  /** The unit of every figure below: `"USD"`. */
  readonly unit: string;
  /**
   * Free assets that are not dollar-pegged. What "Bitcoin & Crypto" paints.
   *
   * The backend already left every pegged symbol out, so nothing here filters:
   * a client-side USDC filter would be a competing copy of the peg table.
   */
  readonly cryptoValue: WalletBalanceBucketView;
  /** Every dollar-pegged piece. What "Dólares digitales" paints. */
  readonly digitalDollarsValue: WalletBalanceBucketView;
  /** Pool positions alone: the "de dónde sale" view. Not a third term. */
  readonly investedValue: WalletBalanceBucketView;
  readonly total: WalletBalanceTotalView;
}

/** Names joined with "y": `"Monad"`, `"Monad y Ethereum"`, `"A, B y C"`. */
const joinLabels = (labels: readonly string[]): string => {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
};

/**
 * The sentence for a figure that is **not** the whole truth.
 *
 * It says **which** piece is missing, not merely that something is: a banner that
 * says "something could not be read" leaves the person suspecting a balance that
 * is real. And it states that the number counts only what was read, so a partial
 * total is never read as the whole one.
 */
export const buildIncompletenessNote = (missingLabels: readonly string[]): string | null => {
  if (missingLabels.length === 0) return null;

  return `Este total está incompleto: no pudimos leer ${joinLabels(
    missingLabels,
  )}. El número de arriba sólo cuenta lo que sí pudimos leer.`;
};

/**
 * The sentence for a read that did not arrive at all.
 *
 * It separates two facts that look identical from the outside: a wallet with
 * nothing, and a read that never came. "No tenés nada" is a claim about money
 * nobody verified.
 */
export const BALANCE_UNREADABLE_NOTE =
  'No pudimos leer tu balance. No es que no tengas: es que no lo supimos leer. Probá de nuevo en un rato.';

/**
 * Every bounded reason the backend can file, in Spanish and without jargon.
 *
 * A reason the person cannot act on goes to the log, not to the screen; and an
 * enum nobody expected degrades to "we could not read it", which is still true.
 */
const REASON_PHRASES: Readonly<Record<string, string>> = {
  STALE: 'el precio de este activo quedó viejo',
  NON_POSITIVE: 'el feed de precio respondió cero o menos',
  CHANNELS_DISAGREE: 'los dos canales de precio no coinciden',
  FEED_DECIMALS_UNREADABLE: 'no pudimos leer los decimales del feed de precio',
  PRICE_UNAVAILABLE: 'no tenemos un precio para este activo',
  RPC_UNAVAILABLE: 'no pudimos consultar la red',
  RPC_REJECTED: 'la red rechazó la consulta',
  RPC_MALFORMED_RESPONSE: 'la red respondió algo que no entendimos',
  RESERVE_DECODE_FAILED: 'no pudimos leer la reserva del pool',
  CONFIG_UNREADABLE: 'no pudimos leer la configuración del pool',
  WALLETS_UNAVAILABLE: 'no pudimos leer tus billeteras',
  UNREADABLE: 'no lo supimos leer',
  /* The yield of a venue, which can fail where a balance can. */
  APR_NOT_RECONCILED: 'el pool no pudo reconciliar su propia tasa',
  VAULT_LAYOUT_UNREADABLE: 'no pudimos leer la estructura de la bóveda',
  FARM_STATE_UNREADABLE: 'no pudimos leer el estado de la pool',
  KAMINO_UNAVAILABLE: 'no pudimos consultar a Kamino',
  KAMINO_MALFORMED_RESPONSE: 'Kamino respondió algo que no entendimos',
  SHARE_PRICE_NON_POSITIVE: 'el precio de la parte respondió cero o menos',
  APY_NON_POSITIVE: 'la tasa publicada respondió cero o menos',
};

/** The sentence that goes under a piece that could not be read. */
export const pieceFailureReason = (reason: string): string =>
  REASON_PHRASES[reason] ?? REASON_PHRASES.UNREADABLE;

const normalizeBucket = (raw: unknown, carriesYield: boolean): WalletBalanceBucketView => {
  const bucket = raw as Partial<WalletBalanceBucketPayload> | null;
  if (bucket === null || typeof bucket !== 'object' || !Array.isArray(bucket.pieces)) {
    return {
      unit: 'USD',
      complete: false,
      total: null,
      parts: [],
      unreadableParts: [],
      incompletenessNote: buildIncompletenessNote([UNREADABLE_IDENTITY.label]),
      yield: carriesYield ? normalizeYield(null) : null,
    };
  }

  const parts = bucket.pieces.map(normalizePart);
  const unreadableParts = parts.filter((part) => part.status === 'unreadable');
  const total = toUsdView(bucket.total);

  /*
   * `complete` is a conjunction, never a copy of the backend's boolean: the
   * backend's word AND the absence of any piece that degraded here. A total
   * nobody can reproduce is not complete, and a piece nobody could read is not
   * hidden behind a `true`.
   */
  const complete = bucket.complete === true && unreadableParts.length === 0 && total !== null;

  return {
    unit: typeof bucket.unit === 'string' ? bucket.unit : 'USD',
    complete,
    total,
    parts,
    unreadableParts,
    incompletenessNote: complete
      ? null
      : buildIncompletenessNote(unreadableParts.map((part) => part.label)),
    yield: carriesYield
      ? normalizeYield((bucket as Partial<WalletBalanceInvestedBucketPayload>).yield)
      : null,
  };
};

const normalizeTotal = (raw: unknown, buckets: readonly WalletBalanceBucketView[]): WalletBalanceTotalView => {
  const total = raw as Partial<WalletBalanceTotalPayload> | null;
  const usd = total === null || typeof total !== 'object' ? null : toUsdView(total.usd);

  const missing = buckets.flatMap((bucket) => bucket.unreadableParts.map((part) => part.label));

  const complete = total !== null && typeof total === 'object' && total.complete === true && missing.length === 0 && usd !== null;

  return {
    complete,
    usd,
    incompletenessNote: complete ? null : buildIncompletenessNote(missing),
  };
};

/**
 * Turns the response body into the shape the screens use.
 *
 * Read defensively, in one direction: an unrecognized shape becomes `unreadable`
 * and never zero. `null` means the body was not a balance at all — a malformed
 * response is a failed read, and the caller says so instead of painting
 * `U$0,00` for it.
 */
export const normalizeWalletBalance = (body: unknown): WalletBalanceView | null => {
  const response = body as Partial<WalletBalanceResponse> | null;
  if (response === null || typeof response !== 'object') return null;

  const cryptoValue = normalizeBucket(response.cryptoValue, false);
  const digitalDollarsValue = normalizeBucket(response.digitalDollarsValue, false);
  const investedValue = normalizeBucket(response.investedValue, true);

  return {
    generatedAt: typeof response.generatedAt === 'string' ? response.generatedAt : null,
    unit: typeof response.unit === 'string' ? response.unit : 'USD',
    cryptoValue,
    digitalDollarsValue,
    investedValue,
    // The headline is the backend's `cryptoValue + digitalDollarsValue`.
    // `investedValue` is left out on purpose: its pieces are already inside the
    // dollar bucket, and adding them here would count every deposited dollar
    // twice — which is the defect this whole route was built to remove.
    total: normalizeTotal(response.total, [cryptoValue, digitalDollarsValue]),
  };
};

/**
 * `GET /api/wallet-balance`.
 *
 * Same origin and same cookie as the rest of the app. The route reads nothing
 * from the request: every piece comes from the wallets the cookie proved.
 *
 * @throws `ApiError` with the backend's code. The sentence is this file's job.
 */
export const readRewalletWalletBalance = async (): Promise<WalletBalanceView | null> =>
  normalizeWalletBalance(await getJson<WalletBalanceResponse>('/wallet-balance'));
/* ── Ordering ────────────────────────────────────────────────────────────── */

/**
 * Orders pieces by their dollar value, biggest first.
 *
 * ── Why the values cannot simply be compared ──────────────────────────────
 *
 * Every piece carries its **own** scale: the value is the amount at the asset's
 * decimals times the price at the **feed's** decimals, so MON lands on 18 + 8 =
 * 26 decimals, BTC on 8 + 8 = 16 and SOL on 9 + 18 = 27. Comparing those `raw`
 * integers directly does not compare money — `0.0000001` at 26 decimals is a
 * number far larger than `90000` at 16. It throws nothing and fails no type
 * check; it just sorts the wrong way round, with the cheap asset on top.
 *
 * So both values are raised to the widest scale before they are compared, in
 * `bigint`, without rounding. Nothing is added up: this decides an order, it
 * does not produce a figure.
 *
 * A piece with no value — unreadable, or a row the backend did not send —
 * sorts **last**, and not because it is worth less: because we do not know
 * what it is worth. Putting it first would rank a blank above a number.
 */
export const byUsdValueDesc = (left: WalletBalancePart | null, right: WalletBalancePart | null): number => {
  const valueOf = (part: WalletBalancePart | null): AmountView | null =>
    part !== null && part.status === 'ok' ? part.value : null;

  const a = valueOf(left);
  const b = valueOf(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const scale = Math.max(a.decimals, b.decimals);
  const l = a.raw * 10n ** BigInt(scale - a.decimals);
  const r = b.raw * 10n ** BigInt(scale - b.decimals);
  if (l === r) return 0;
  return l > r ? -1 : 1;
};
