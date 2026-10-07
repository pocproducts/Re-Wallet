import React from 'react';

import { formatUnitPrice, pieceFailureReason, type WalletBalancePart } from '../../services/walletBalance';

/**
 * One piece of a bucket, painted the way the owner asked for it: **the dollar
 * value on top, the coin quantity underneath.**
 *
 * ── Why the value and the quantity are the same row ──────────────────────────
 *
 * The person compares values without doing arithmetic and still sees how much of
 * the asset that value is. Splitting them into two screens is what made the old
 * numbers impossible to reconcile by eye.
 *
 * ── Why an unreadable piece shows a sentence and no number ───────────────────
 *
 * A `0` here would say "this is worth nothing", and a dash reads as a zero to
 * anyone scanning the list. Both are claims about money that nobody verified. So
 * the row states the reason and shows nothing numeric — not the value, not the
 * quantity, not a placeholder.
 *
 * ── Why a zero is still a number ─────────────────────────────────────────────
 *
 * `isZero` is a real zero that was read: an empty wallet has to be able to look
 * empty. It is greyed out instead of hidden, which is the difference between
 * "worth nothing" and "we do not know".
 */

interface BalancePieceRowProps {
  readonly part: WalletBalancePart;
  /**
   * Adds the unit price under the label.
   *
   * Worth it in the crypto list, where the price is the thing that explains the
   * value; noise on a card that already shows a total.
   */
  readonly showPrice?: boolean;
  /**
   * Hides the piece's own label and price line.
   *
   * For the crypto list, where the row **already** says who the asset is on the
   * left — icon, name, ticker — so the label repeated it ("MON en Monad") and
   * the price repeated a number the row already carries in its value.
   */
  readonly hideLabel?: boolean;
  /** Compact mode for the small cards of the investments tab. */
  readonly compact?: boolean;
}

/** The price line: a peg says why it needs no oracle, a feed says its number. */
const priceLabel = (part: WalletBalancePart): string | null => {
  if (part.status !== 'ok') return null;

  const price = formatUnitPrice(part.price);
  if (price === null) return null;

  return part.price.source === 'peg'
    ? 'valuado a 1 por definición'
    : `a U$ ${price}`;
};

export const BalancePieceRow: React.FC<BalancePieceRowProps> = ({
  part,
  showPrice = false,
  hideLabel = false,
  compact = false,
}) => {
  const price = showPrice ? priceLabel(part) : null;
  const showsHeader = !hideLabel || price !== null;

  return (
    <div className="flex items-start justify-between gap-3">
      {showsHeader && (
        <div className="min-w-0">
          {!hideLabel && (
            <span className={`${compact ? 'text-[11px]' : 'text-sm'} font-semibold text-slate-500 block truncate`}>
              {part.label}
            </span>
          )}
          {price !== null && <span className="text-[10px] font-medium text-slate-400 block mt-0.5">{price}</span>}
        </div>
      )}

      {part.status === 'ok' ? (
        <div className="text-right shrink-0">
          {/* The value the backend computed. Nothing here multiplies anything. */}
          <span
            className={`${compact ? 'text-sm' : 'text-sm'} font-extrabold block leading-none ${
              part.value.isZero ? 'text-slate-400' : 'text-black'
            }`}
          >
            {`U$${part.value.formatted}`}
          </span>
          {/* The real quantity underneath, so the value is not the whole story. */}
          <span className="text-[11px] font-semibold text-slate-400 block mt-0.5">
            {`${part.quantity.formatted} ${part.quantity.unit}`}
          </span>
        </div>
      ) : (
        <div className="text-right shrink-0 max-w-[60%]">
          {/* No number at all: neither a zero nor a dash. */}
          <span className={`${compact ? 'text-xs' : 'text-sm'} font-extrabold text-amber-600 block leading-none`}>
            No se pudo leer
          </span>
          <span className="text-[11px] font-medium text-amber-600/80 block mt-0.5 leading-snug">
            {`No lo supimos leer porque ${pieceFailureReason(part.reason)}.`}
          </span>
        </div>
      )}
    </div>
  );
};