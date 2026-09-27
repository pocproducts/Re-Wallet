import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrast of the brand palette against the app background.
 *
 * This exists because the original #39FF14 was not "more accessible" — it was
 * 14.2:1, which is past the point where legibility turns into vibration. The
 * replacement is chosen to stay above WCAG AA while reading as a colour rather
 * than a light source, and this pins that so a future "let's brighten it again"
 * cannot land unnoticed.
 */

const TOKENS = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const token = (name: string): string => {
  const m = TOKENS.match(new RegExp(`--rw-${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m?.[1]) throw new Error(`token --rw-${name} not found`);
  return m[1]!;
};

const luminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const ratio = (a: string, b: string): number => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const BG = '#080F14';
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe('brand palette contrast', () => {
  it('the brand base is the chosen green, not the neon one', () => {
    expect(token('brand-500')).toBe('#3BAC28');
  });

  it('brand-500 passes AA as text on the background', () => {
    expect(ratio(token('brand-500'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('brand-400 (small text) clears AA with margin', () => {
    expect(ratio(token('brand-400'), BG)).toBeGreaterThanOrEqual(7);
  });

  it('brand-400 is lighter than brand-500, so small text has headroom', () => {
    // On a dark background, "more legible" means lighter. If a future change
    // darkens the text step it will fail here rather than in a review.
    expect(luminance(token('brand-400'))).toBeGreaterThan(luminance(token('brand-500')));
  });

  it('the pressed step is never used as a text colour', () => {
    // 4.49:1 — deliberately below the text threshold.
    expect(ratio(token('brand-600'), BG)).toBeLessThan(AA_TEXT);
  });

  it('background is blue-black, never pure black', () => {
    expect(token('dark-900')).toBe(BG);
    expect(token('dark-900')).not.toBe('#000000');
  });

  it('body text is comfortably above AA', () => {
    expect(ratio(token('text-primary'), BG)).toBeGreaterThanOrEqual(7);
  });

  it('secondary and tertiary text stay readable', () => {
    expect(ratio(token('text-secondary'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(token('text-tertiary'), BG)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('the success text step is readable — it is not the brand fill', () => {
    expect(ratio(token('success-text'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('the emerald is muted so it cannot out-shout the CTA it supports', () => {
    // The doc's #00E676 measured 11.5:1, brighter than its own brand colour.
    expect(ratio(token('emerald-500'), BG)).toBeLessThan(ratio(token('brand-500'), BG) + 2);
    expect(ratio(token('emerald-500'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('brand stays above emerald, so identity outranks data', () => {
    expect(luminance(token('brand-500'))).toBeGreaterThan(luminance(token('emerald-500')));
  });

  it('primary button text is readable on the brand fill', () => {
    expect(ratio(BG, token('brand-500'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('semantic colours clear AA as text', () => {
    expect(ratio(token('error-text'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(token('warning'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(token('info-text'), BG)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('form borders clear the non-text threshold', () => {
    // The system's --rw-dark-600 is 1.5:1 on the surface: fine for decoration,
    // not for something that defines a control. Inputs use a separate step.
    expect(ratio(token('dark-600'), token('dark-800'))).toBeLessThan(AA_NON_TEXT);
    expect(ratio(token('border-input'), token('dark-800'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('no neon left behind', () => {
  it('the old neon base is gone from the tokens', () => {
    expect(TOKENS).not.toContain('--rw-brand-500:#39FF14');
  });

  it('no raw rgba of the old neon survives in the sources', () => {
    const files = [
      'src/styles/global.css',
      'src/screens/welcome.ts',
      'src/screens/activity.ts',
    ];
    for (const rel of files) {
      const s = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(s, `${rel} still has the old neon rgba`).not.toContain('rgba(57,255,20');
      expect(s, `${rel} still has the old emerald rgba`).not.toContain('rgba(0,230,118');
    }
  });
});
