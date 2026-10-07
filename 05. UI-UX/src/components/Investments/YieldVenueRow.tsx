import React from 'react';

import {
  formatVenueRate,
  pieceFailureReason,
  type YieldVenueView,
} from '../../services/walletBalance';

/**
 * One venue of the combined yield, painted with **its own** rate.
 *
 * ── Why this is a component and not three lines of JSX in the card ────────────
 *
 * Because the three cases are not one case with a nullable field. "Rinde 4,18%",
 * "no tenés nada depositado acá" and "no lo supimos leer" are three different
 * facts, and each one has a different right-hand side and a different color. The
 * union in the service already refuses to let them collapse into each other; a
 * component keeps that refusal visible in the JSX instead of re-deriving it at
 * every call site.
 *
 * ── Why a venue with no balance still gets a row ─────────────────────────────
 *
 * `exclusion: 'zero_balance'` is a **real, true fact**: the venue was read, it
 * holds nothing, and that is why it carries no weight in the combined figure. It
 * is painted as such — never as a failure, never as `0,00%`, and never as a
 * contribution to the headline. Hiding the row would make a person think the
 * money vanishes between venues; saying "no pesás acá" explains the arithmetic
 * they are looking at.
 *
 * ── Why an unreadable venue paints no number ────────────────────────────────
 *
 * Same rule as `BalancePieceRow`: a dash and a zero are both claims about
 * somebody's money that nobody verified. So the row states the reason and shows
 * nothing numeric, and the combined headline stays unpublished — a weighted mean
 * over the venues that happened to answer is a confident number built from
 * missing data.
 */
interface YieldVenueRowProps {
  readonly venue: YieldVenueView;
}

/** The right-hand side of a readable venue that owes a rate but has none. */
const MissingRate = () => (
  <div className="text-right shrink-0 max-w-[60%]">
    <span className="text-sm font-extrabold text-amber-600 block leading-none">No se pudo leer</span>
    <span className="text-[11px] font-medium text-amber-600/80 block mt-0.5 leading-snug">
      No lo supimos leer porque el lugar no publicó una tasa.
    </span>
  </div>
);

export const YieldVenueRow: React.FC<YieldVenueRowProps> = ({ venue }) => {
  if (venue.status === 'unreadable') {
    return (
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-slate-500 truncate">{venue.label}</span>
        <div className="text-right shrink-0 max-w-[60%]">
          {/* No number: not the venue's rate and, above it, no combined rate. */}
          <span className="text-sm font-extrabold text-amber-600 block leading-none">No se pudo leer</span>
          <span className="text-[11px] font-medium text-amber-600/80 block mt-0.5 leading-snug">
            {`No lo supimos leer porque ${pieceFailureReason(venue.reason)}.`}
          </span>
        </div>
      </div>
    );
  }

  if (venue.exclusion === 'zero_balance') {
    return (
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-slate-400 truncate">{venue.label}</span>
        <div className="text-right shrink-0 max-w-[60%]">
          <span className="text-sm font-bold text-slate-400 block leading-none">Sin saldo depositado</span>
          <span className="text-[11px] font-medium text-slate-400 block mt-0.5 leading-snug">
            No pesás en el número combinado.
          </span>
        </div>
      </div>
    );
  }

  // The one rounding, made by the service, in `bigint`. This file prints it.
  const rate = formatVenueRate(venue.rate);

  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm font-semibold text-slate-500 truncate">{venue.label}</span>
      {rate === null ? (
        <MissingRate />
      ) : (
        <span className="text-sm font-extrabold text-black shrink-0">{rate}</span>
      )}
    </div>
  );
};