/**
 * `CountrySelect` — the country half of the phone field.
 *
 * ── Why a component and not a second `<select>` in the form ────────────────
 *
 * Because the prefix is a fact about a country, and a fact about a country
 * belongs to exactly one country list. A second inline `<select>` is a second
 * list: the one nobody updates when a country is added, and the one that
 * silently keeps offering a dial code the first one no longer offers.
 *
 * ── A native `<select>`, and that is not laziness ──────────────────────────
 *
 * A custom listbox is a keyboard trap waiting to happen: someone has to
 * implement arrow keys, type-ahead, escape, focus return and the screen-reader
 * announcement that goes with them, and every one of those is a bug a customer
 * finds. The native control has all of it, has been audited on every platform
 * this app will run on, and — the part that matters at 198 rows — it hands the
 * list to the OS picker, which already knows how to scroll and search a list
 * this long.
 *
 * What it does NOT give us is the look, so the native control is made invisible
 * and the row you can see is drawn on top of it: the flag, the prefix and a
 * chevron. The control underneath stays a real control — it holds the focus
 * ring, the keyboard, and the value.
 *
 * ── Why the closed state shows the flag and the prefix ─────────────────────
 *
 * The sibling product's selector shows three letters (\`ARG\`, \`MEX\`), which is
 * enough for a twenty-country list. This one is the whole world: at 198 rows
 * three letters collide — Congo, Congo, Costa de Marfil, Costa Rica, Chipre and
 *Christmas Island all start the same way, and `COR` is not a country. The flag
 * plus the dialling code is the only pair that identifies one country
 * unambiguously, so that is what the collapsed control shows; the full Spanish
 * name is in every dropdown row and in the accessible name, so nothing is lost.
 */

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

import { COUNTRIES } from '../../config/countries';
import type { Country } from '../../config/countries';

interface CountrySelectProps {
  readonly value: Country;
  readonly onChange: (country: Country) => void;
}

export function CountrySelect({ value, onChange }: CountrySelectProps) {
  const id = useId();

  return (
    <div className="relative flex min-h-[46px] shrink-0 items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 pl-3 pr-2.5 transition-colors focus-within:border-black">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-1.5">
        <span aria-hidden className="text-base leading-none">
          {value.flag}
        </span>
        <span className="text-xs font-bold text-black">{value.dial}</span>
      </label>

      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden strokeWidth={2.5} />

      {/*
        The real control, on top and invisible. Not `hidden` and not `sr-only`:
        both take it out of the tab order, which would make this field
        unreachable by keyboard — and a phone field some customers cannot reach
        is a phone field some customers cannot fill in at all.
      */}
      <select
        id={id}
        value={value.code}
        onChange={(event) => {
          const next = COUNTRIES.find((country) => country.code === event.target.value);
          if (next !== undefined) onChange(next);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="País"
      >
        {COUNTRIES.map((country) => (
          <option key={country.code} value={country.code}>
            {country.flag} {country.name} ({country.dial})
          </option>
        ))}
      </select>
    </div>
  );
}
