

/* ---- shared screen helpers ---- */

/**
 * Last balance painted by the home screen, kept module-level so the yield
 * ticker can tell a real change from a re-render. It was implicitly shared in
 * the single-file prototype; the split made the dependency explicit.
 *
 * Held as an object because ES modules forbid assigning to an imported binding,
 * and both the home screen and the yield ticker write to it.
 */
export const shownBalance = { value: 0 };

export function detectBiometricLabel(){
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows Hello';
  if (/Android/i.test(ua)) return 'huella';
  return 'Face ID';
}
