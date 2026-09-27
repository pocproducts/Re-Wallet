import { U } from '../core/utils';
import { UI } from '../ui';
import {
  COUNTRIES,
  searchCountries,
  getCountry,
  toE164,
  DEFAULT_COUNTRY,
  type ParsedPhone,
} from './countries';
import { fromE164 } from './countries';
import type { Country, CountryCode } from '../types';

/**
 * Country picker, rendered as a sheet.
 *
 * Latin America is listed first because that is the launch market; the list is
 * searchable by name, dialling code or ISO code. Returns the chosen Country, or
 * null if the user dismissed it — callers must handle dismissal rather than
 * assuming a selection.
 */
export function pickCountry(current?: CountryCode): Promise<Country | null> {
  const selected = getCountry(current ?? DEFAULT_COUNTRY) ?? COUNTRIES[0]!;

  const row = (c: Country) => `
    <button class="country-row" data-country="${c.code}" aria-pressed="${c.code === selected.code}">
      <span class="country-row__flag">${c.flag}</span>
      <span class="country-row__name">${U.esc(c.name)}</span>
      <span class="country-row__dial">+${c.dial}</span>
      <span class="country-row__check">${c.code === selected.code ? '✓' : ''}</span>
    </button>`;

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: Country | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    void UI.sheet({
      title: 'País',
      content: `
        <div class="field" data-picker-search>
          <input class="field__input" type="search" id="country-q" placeholder=" " autocomplete="off" aria-label="Buscar país">
          <label class="field__label" for="country-q">Buscar país o código</label>
        </div>
        <div class="country-list" data-country-list>${COUNTRIES.map(row).join('')}</div>`,
      onMount(el, close) {
        const input = el.querySelector('#country-q') as HTMLInputElement | null;
        const list = el.querySelector('[data-country-list]') as HTMLElement | null;
        if (!list) return;

        const paint = () => {
          const hits = searchCountries(input?.value ?? '');
          list.innerHTML = hits.length
            ? hits.map(row).join('')
            : `<p class="t-body-sm t-tertiary text-center" style="padding:var(--space-6) 0">Sin resultados.</p>`;
        };

        input?.addEventListener('input', paint);

        list.addEventListener('click', (ev) => {
          const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-country]');
          const code = btn?.dataset.country;
          if (!code) return;
          const country = getCountry(code);
          if (!country) return;
          U.haptic(8);
          close();
          done(country);
        });

        paint();
        setTimeout(() => input?.focus({ preventScroll: true }), 300);
      },
    }).then(() => {
      // Dismissed without picking.
      done(null);
    });
  });
}

/**
 * Preselect the picker for an existing profile.
 *
 * Deliberately returns `ambiguous` so the caller can tell the user the country
 * is a guess: +1 covers both the US and Canada, and guessing wrong silently
 * would mislabel a Canadian number.
 */
export function preselectFor(e164: string): ParsedPhone & { display: string } {
  const parsed = fromE164(e164);
  return { ...parsed, display: parsed.country ? `+${parsed.country.dial}` : '' };
}

export { toE164 };
