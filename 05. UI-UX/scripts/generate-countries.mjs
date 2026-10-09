/**
 * Regenerates `src/config/countries.ts` — the country list and its dialling codes.
 *
 * Run it instead of editing a row by hand:
 *
 *   npm run generate:countries
 *
 * The data comes from the ISO 3166-1 country list (`world-countries`) and the ITU
 * numbering plan (`libphonenumber-js`), both devDependencies. A dialling code
 * typed from memory is a number that rings nowhere, and nobody finds out until a
 * customer is waiting for an SMS that never arrives.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const wc = require('world-countries/countries.json');
const { getCountryCallingCode } = require('libphonenumber-js');

const NO_DIAL = new Set(['AQ', 'BV', 'HM']);
const DIAL_OVERRIDE = { TF: '+262', GS: '+500', PN: '+64', UM: '+1' };
/** Spanish names the dataset shortens or transliterates. */
const NAME_OVERRIDE = {
  CD: 'República Democrática del Congo',
  CG: 'República del Congo',
  BN: 'Brunéi',
  BH: 'Baréin',
};

const rows = wc
  .filter((c) => (c.independent === true || c.unMember === true || DIAL_OVERRIDE[c.cca2]))
  .filter((c) => !NO_DIAL.has(c.cca2))
  .map((c) => ({
    code: c.cca2,
    flag: c.flag,
    name: NAME_OVERRIDE[c.cca2] ?? c.translations?.spa?.common ?? c.name.common,
    dial: DIAL_OVERRIDE[c.cca2] ?? `+${getCountryCallingCode(c.cca2)}`,
  }));

const collator = new Intl.Collator('es');
const ordered = [rows.find((r) => r.code === 'AR'), ...rows.filter((r) => r.code !== 'AR').sort((a, b) => collator.compare(a.name, b.name))];

if (new Set(ordered.map((r) => r.code)).size !== ordered.length) throw new Error('duplicate code');
if (ordered.some((r) => !r.flag || !/^\+\d+$/.test(r.dial))) throw new Error('incomplete row');

const body = ordered.map((r) => `  { code: '${r.code}', flag: '${r.flag}', name: '${r.name.replace(/'/g, "\\'")}', dial: '${r.dial}' },`).join('\n');

const header = `/**
 * Every country this product can be used from, with its international dialling code.
 *
 * ── Why this file is generated and not written by hand ──────────────────────
 *
 * A dialling code that is wrong is a number that rings nowhere, and nobody finds
 * out until a customer is standing in a sign-up form waiting for an SMS. So the
 * data comes from the ISO 3166-1 country list (\`world-countries\`) and the ITU
 * numbering plan (\`libphonenumber-js\`) instead of from recall: 198 rows is far
 * past the number a human types correctly twice.
 *
 * Regenerate with \`npm run generate:countries\` (this script), never by editing
 * a row here.
 *
 * ── \`code\` is the ISO alpha-2, and \`dial\` is NOT derived from it ────────────
 *
 * Two different systems that both look like "country code". \`AR\` is Argentina;
 * \`+54\` is Argentina's dialling code. There is no arithmetic between them, so
 * both are written down. \`dial\` is what composes a number; \`code\` is what a
 * flag, a locale or a payment rail keys on.
 *
 * ── The list is the world, not a region ────────────────────────────────────
 *
 * The earlier version of this list was Latin America only, on purpose: the
 * product was scoped to the region and nobody outside it could have opened an
 * account. It can now, so restricting the selector would be a lie about who the
 * product is for. Argentina stays on top because it is the launch market and the
 * default; the rest is alphabetical in Spanish, which is the language the person
 * reading the list is reading it in.
 *
 * ── What is NOT here, and why ──────────────────────────────────────────────
 *
 * Three entries are missing on purpose: Antarctica, Bouvet and Heard &
 * McDonald Islands. They are territories with no permanent population and no
 * dialling code, so a row for them would be a row that cannot receive anything.
 * Pitcairn (\`+64\`) and the minor US outlying islands (\`+1\`) DO have a code, and
 * they are here, written by hand because the dataset does not carry theirs.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. \`AR\`, \`CL\`, \`MX\`. The key a flag or locale resolves on. */
  readonly code: string;
  /** The flag, as an emoji. \`aria-hidden\` in the UI; \`name\` carries the meaning. */
  readonly flag: string;
  /** Full name, in Spanish. Shown in the dropdown row. */
  readonly name: string;
  /** The international dialling code, with its \`+\`. */
  readonly dial: string;
}

export const COUNTRIES: readonly Country[] = [
`;

const footer = `
] as const;

/** The country offered when the user has not chosen one. */
export const DEFAULT_COUNTRY: Country =
  COUNTRIES.find((country) => country.code === 'AR') ?? (COUNTRIES[0] as Country);

/** The country for a code, or the default. Never throws, never returns null. */
export function countryByCode(code: string | null | undefined): Country {
  if (code === null || code === undefined) return DEFAULT_COUNTRY;
  return COUNTRIES.find((country) => country.code === code) ?? DEFAULT_COUNTRY;
}

/**
 * Composes a local number with its country's prefix.
 *
 * The person never types the \`+\` and never names the country. The prefix is a
 * fact about the country and the digits are a fact about the person; making
 * anyone retype either one is asking for a support ticket.
 *
 * A number with no digits returns \`''\` rather than a bare \`+54\`, so the field
 * never shows a prefix for a number nobody has typed yet.
 */
export function composePhone(local: string, country: Country): string {
  const digits = local.replace(/\\D/g, '');
  return digits ? \`\${country.dial} \${digits}\` : '';
}
`;

const target = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'config',
  'countries.ts',
);
writeFileSync(target, header + body + footer);
console.log('wrote', target, ordered.length, 'countries');
