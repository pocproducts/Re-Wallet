import { describe, it, expect } from 'vitest';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  getCountry,
  toE164,
  fromE164,
  searchCountries,
} from '../src/components/countries';

/**
 * The phone field builds a real E.164 number, and a malformed one is a phone
 * number nobody can receive a verification code on. These pin the conversion.
 */

describe('country list', () => {
  it('is not empty and has no duplicate ISO codes', () => {
    expect(COUNTRIES.length).toBeGreaterThan(30);
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('shares dial codes only within the NANP, as E.164 requires', () => {
    // +1 is shared by US and Canada. Any other repeat is a data bug: it would
    // make fromE164 guess between two unrelated countries.
    const seen = new Map<string, string[]>();
    for (const c of COUNTRIES) {
      const list = seen.get(c.dial) ?? [];
      list.push(c.code);
      seen.set(c.dial, list);
    }
    for (const [dial, codes] of seen) {
      if (codes.length > 1) expect(dial, `dial ${dial} shared by ${codes.join(',')}`).toBe('1');
    }
  });

  it('covers Latin America', () => {
    for (const code of ['AR', 'MX', 'BR', 'CO', 'CL', 'PE', 'UY', 'EC', 'PA', 'CR']) {
      expect(getCountry(code), `missing ${code}`).toBeDefined();
    }
  });

  it('has a resolvable default', () => {
    expect(getCountry(DEFAULT_COUNTRY)).toBeDefined();
  });

  it('every entry has a flag, a dial and a name', () => {
    for (const c of COUNTRIES) {
      expect(c.flag.length, `${c.code} flag`).toBeGreaterThan(0);
      expect(c.dial, `${c.code} dial`).toMatch(/^\d+$/);
      expect(c.name.length, `${c.code} name`).toBeGreaterThan(0);
    }
  });
});

describe('toE164', () => {
  it('builds a full number', () => {
    expect(toE164(getCountry('AR')!, '9112345678')).toBe('+549112345678');
    expect(toE164(getCountry('MX')!, '5512345678')).toBe('+525512345678');
    expect(toE164(getCountry('US')!, '2025550143')).toBe('+12025550143');
  });

  it('strips formatting the user typed', () => {
    expect(toE164(getCountry('AR')!, '911 234-5678')).toBe('+549112345678');
    expect(toE164(getCountry('AR')!, '(911) 234 5678')).toBe('+549112345678');
  });
});

describe('fromE164', () => {
  it('splits back into country and national number', () => {
    const parsed = fromE164('+549112345678');
    expect(parsed.country?.code).toBe('AR');
    expect(parsed.national).toBe('9112345678');
  });

  it('round-trips', () => {
    const parsed = fromE164('+525512345678');
    expect(toE164(parsed.country!, parsed.national)).toBe('+525512345678');
  });

  it('flags NANP ambiguity instead of guessing US for a Canadian number', () => {
    // +1 is shared. Silently resolving to the first match would mislabel every
    // Canadian phone number as American.
    const parsed = fromE164('+12025550143');
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.candidates.map((c) => c.code)).toContain('US');
    expect(parsed.candidates.map((c) => c.code)).toContain('CA');
  });

  it('is not ambiguous for a non-NANP country', () => {
    expect(fromE164('+549112345678').ambiguous).toBe(false);
  });

  it('prefers the longest matching dial code', () => {
    // 1 (NANP) must not shadow a longer specific code if both could match.
    const parsed = fromE164('+549112345678');
    expect(parsed.country?.code).toBe('AR');
  });

  it('returns the raw digits when the dial is unknown', () => {
    const parsed = fromE164('+999123456');
    expect(parsed.country).toBeUndefined();
    expect(parsed.national).toBe('999123456');
  });

  it('tolerates a value that is not E.164', () => {
    expect(fromE164('').national).toBe('');
    expect(fromE164('9112345678').country).toBeUndefined();
  });
});

describe('searchCountries', () => {
  it('returns everything for an empty query', () => {
    expect(searchCountries('')).toHaveLength(COUNTRIES.length);
  });

  it('matches by name, ignoring case and accents', () => {
    const hits = searchCountries('argentina');
    expect(hits.map((c) => c.code)).toContain('AR');
  });

  it('matches by dialling code', () => {
    const hits = searchCountries('54');
    expect(hits.map((c) => c.code)).toContain('AR');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchCountries('zzzz')).toHaveLength(0);
  });
});
