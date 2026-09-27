import { describe, it, expect } from 'vitest';
import { stripApiPrefix } from '../../src/worker';

/**
 * The `/api` rewrite, without a Worker.
 *
 * `stripApiPrefix` is the production stand-in for the Vite dev proxy: the
 * frontend calls `/api/wallet/position` in BOTH environments, and something has
 * to turn that into `/wallet/position` before the Hono routes see it. In dev
 * that something is the proxy. If this function is wrong, every request 404s in
 * production while the API is healthy and every test is green — the failure only
 * appears after deploying.
 *
 * It is pure, so it is testable without a runtime, and that is the only reason it
 * is a separate exported function instead of three lines inline in the handler.
 */

const base = 'https://rewallet.win';

/** The real function, applied to a Request, answering the URL back. */
const urlAfterRewrite = (url: string): string => stripApiPrefix(new Request(url)).url;

describe('the /api prefix, stripped the way the dev proxy strips it', () => {
  it('an API call loses the prefix and keeps the query', () => {
    expect(urlAfterRewrite(`${base}/api/wallet/position`)).toBe(`${base}/wallet/position`);
    expect(urlAfterRewrite(`${base}/api/wallet/movements?limit=20&cursor=abc`)).toBe(
      `${base}/wallet/movements?limit=20&cursor=abc`,
    );
  });

  it('a static asset is left completely alone', () => {
    // The Worker serves the built web itself. Stripping here would rewrite
    // /assets/index-abc.js into a path the assets binding does not own, and the
    // app would ship without its own JavaScript.
    for (const path of ['/', '/index.html', '/assets/index-abc123.js', '/favicon.ico']) {
      expect(urlAfterRewrite(base + path)).toBe(base + path);
    }
  });

  it('a path that merely STARTS with the same letters is not an API call', () => {
    expect(urlAfterRewrite(`${base}/apidocs`)).toBe(`${base}/apidocs`);
    expect(urlAfterRewrite(`${base}/apiary`)).toBe(`${base}/apiary`);
  });

  it('the bare prefix maps to the root, not to an empty path', () => {
    expect(urlAfterRewrite(`${base}/api`)).toBe(`${base}/`);
  });

  it('a hash survives, because a deep link must not lose the anchor', () => {
    expect(urlAfterRewrite(`${base}/api/wallet/position#top`)).toBe(`${base}/wallet/position#top`);
  });
});
