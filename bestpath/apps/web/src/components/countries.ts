import type { Country, CountryCode } from '../types';

/**
 * Country list for the phone field.
 *
 * Scope: Latin America plus the countries with meaningful crypto adoption.
 * Deliberately NOT all ~250 — a full list is mostly countries the product will
 * never be used from, and a long list is a worse picker. Latin America is
 * sorted first because that is the launch market.
 *
 * `dial` is the international dialling code WITHOUT the plus, so the E.164 value
 * is `+${dial}${nationalNumber}`.
 */

export const COUNTRIES: Country[] = [
  // ── Latinoamérica ──────────────────────────────────────────────────────
  { code: 'AR', name: 'Argentina', dial: '54', flag: '🇦🇷' },
  { code: 'MX', name: 'México', dial: '52', flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴' },
  { code: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱' },
  { code: 'PE', name: 'Perú', dial: '51', flag: '🇵🇪' },
  { code: 'BR', name: 'Brasil', dial: '55', flag: '🇧🇷' },
  { code: 'EC', name: 'Ecuador', dial: '593', flag: '🇪🇨' },
  { code: 'UY', name: 'Uruguay', dial: '598', flag: '🇺🇾' },
  { code: 'PY', name: 'Paraguay', dial: '595', flag: '🇵🇾' },
  { code: 'BO', name: 'Bolivia', dial: '591', flag: '🇧🇴' },
  { code: 'VE', name: 'Venezuela', dial: '58', flag: '🇻🇪' },
  { code: 'CR', name: 'Costa Rica', dial: '506', flag: '🇨🇷' },
  { code: 'PA', name: 'Panamá', dial: '507', flag: '🇵🇦' },
  { code: 'GT', name: 'Guatemala', dial: '502', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', dial: '504', flag: '🇭🇳' },
  { code: 'SV', name: 'El Salvador', dial: '503', flag: '🇸🇻' },
  { code: 'NI', name: 'Nicaragua', dial: '505', flag: '🇳🇮' },
  { code: 'CU', name: 'Cuba', dial: '53', flag: '🇨🇺' },
  { code: 'DO', name: 'República Dominicana', dial: '1809', flag: '🇩🇴' },
  { code: 'HT', name: 'Haití', dial: '509', flag: '🇭🇹' },
  { code: 'PR', name: 'Puerto Rico', dial: '1787', flag: '🇵🇷' },

  // ── Alta adopción cripto ────────────────────────────────────────────────
  { code: 'US', name: 'Estados Unidos', dial: '1', flag: '🇺🇸' },
  { code: 'CA', name: 'Canadá', dial: '1', flag: '🇨🇦' },
  { code: 'NG', name: 'Nigeria', dial: '234', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenia', dial: '254', flag: '🇰🇪' },
  { code: 'ZA', name: 'Sudáfrica', dial: '27', flag: '🇿🇦' },
  { code: 'IN', name: 'India', dial: '91', flag: '🇮🇳' },
  { code: 'PK', name: 'Pakistán', dial: '92', flag: '🇵🇰' },
  { code: 'VN', name: 'Vietnam', dial: '84', flag: '🇻🇳' },
  { code: 'PH', name: 'Filipinas', dial: '63', flag: '🇵🇭' },
  { code: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩' },
  { code: 'TH', name: 'Tailandia', dial: '66', flag: '🇹🇭' },
  { code: 'MY', name: 'Malasia', dial: '60', flag: '🇲🇾' },
  { code: 'UA', name: 'Ucrania', dial: '380', flag: '🇺🇦' },
  { code: 'TR', name: 'Turquía', dial: '90', flag: '🇹🇷' },

  // ── Europa ─────────────────────────────────────────────────────────────
  { code: 'GB', name: 'Reino Unido', dial: '44', flag: '🇬🇧' },
  { code: 'DE', name: 'Alemania', dial: '49', flag: '🇩🇪' },
  { code: 'FR', name: 'Francia', dial: '33', flag: '🇫🇷' },
  { code: 'ES', name: 'España', dial: '34', flag: '🇪🇸' },
  { code: 'IT', name: 'Italia', dial: '39', flag: '🇮🇹' },
  { code: 'NL', name: 'Países Bajos', dial: '31', flag: '🇳🇱' },
  { code: 'CH', name: 'Suiza', dial: '41', flag: '🇨🇭' },
  { code: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { code: 'IE', name: 'Irlanda', dial: '353', flag: '🇮🇪' },
  { code: 'PL', name: 'Polonia', dial: '48', flag: '🇵🇱' },
  { code: 'RO', name: 'Rumanía', dial: '40', flag: '🇷🇴' },
  { code: 'SE', name: 'Suecia', dial: '46', flag: '🇸🇪' },
  { code: 'NO', name: 'Noruega', dial: '47', flag: '🇳🇴' },
  { code: 'DK', name: 'Dinamarca', dial: '45', flag: '🇩🇰' },
  { code: 'BE', name: 'Bélgica', dial: '32', flag: '🇧🇪' },
  { code: 'AT', name: 'Austria', dial: '43', flag: '🇦🇹' },

  // ── Asia-Pacífico y Oriente Medio ───────────────────────────────────────
  { code: 'JP', name: 'Japón', dial: '81', flag: '🇯🇵' },
  { code: 'KR', name: 'Corea del Sur', dial: '82', flag: '🇰🇷' },
  { code: 'SG', name: 'Singapur', dial: '65', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', dial: '852', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwán', dial: '886', flag: '🇹🇼' },
  { code: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺' },
  { code: 'NZ', name: 'Nueva Zelanda', dial: '64', flag: '🇳🇿' },
  { code: 'AE', name: 'Emiratos Árabes Unidos', dial: '971', flag: '🇦🇪' },
  { code: 'SA', name: 'Arabia Saudita', dial: '966', flag: '🇸🇦' },
];

export const DEFAULT_COUNTRY: CountryCode = 'AR';

export function getCountry(code: CountryCode | null | undefined): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code);
}

/** Build the E.164 number: +<dial><national digits>. */
export function toE164(country: Country, nationalNumber: string): string {
  const digits = String(nationalNumber ?? '').replace(/\D/g, '');
  return `+${country.dial}${digits}`;
}

export interface ParsedPhone {
  /** Matched countries, longest dial code first. Ambiguous within the NANP. */
  candidates: Country[];
  /** Best single guess, for preselecting the picker. Undefined if no match. */
  country?: Country;
  national: string;
  /** True when several countries share the matched dial code (NANP). */
  ambiguous: boolean;
}

/**
 * Split a stored E.164 number back into dial code + national number so the
 * picker can be preselected when the user edits an existing profile.
 *
 * The NANP (US, Canada and the Caribbean) shares country code +1, so a dial code
 * is NOT unique. When several countries match we return all of them rather than
 * guessing: a Canadian number that silently resolved to "United States" would be
 * worse than asking. `country` is only the first candidate, as a starting point.
 */
export function fromE164(e164: string): ParsedPhone {
  const value = String(e164 ?? '');
  if (!value.startsWith('+')) return { candidates: [], national: value, ambiguous: false };
  const digits = value.slice(1);
  const matches = COUNTRIES.filter((c) => digits.startsWith(c.dial));
  if (matches.length === 0) return { candidates: [], national: digits, ambiguous: false };
  // Longest dial wins, so a short prefix cannot shadow a longer, more specific one.
  const best = matches.reduce((a, b) => (b.dial.length > a.dial.length ? b : a));
  const candidates = matches.filter((c) => c.dial === best.dial);
  return {
    candidates,
    country: candidates[0],
    national: digits.slice(best.dial.length),
    ambiguous: candidates.length > 1,
  };
}

/** Naive but predictable search over name and dial code. */
export function searchCountries(query: string): Country[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return COUNTRIES;
  return COUNTRIES.filter(
    (c) => c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase() === q,
  );
}
