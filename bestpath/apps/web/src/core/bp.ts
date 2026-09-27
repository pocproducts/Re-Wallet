/**
 * The single shared namespace, assembled from the modules that attach to it.
 *
 * The prototype used a mutable global (`window.BP`). Under real ES modules the
 * global is unnecessary, but every render body was written as `BP.screens.x()`.
 * Rewriting all of those call sites is a broad mechanical edit with real
 * regression risk, so the namespace shape is preserved and the *files* are split.
 * Swapping `BP.api` for a real client in the next phase touches one file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as tag from '@bestpath/shared/tag';

export type AnyFn = (...args: any[]) => any;
export type Renderer = (...args: any[]) => string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BP: any = {};
(window as any).BP = BP;

/**
 * Shared tag helpers are surfaced on the namespace so any module (and the
 * tests) can reach them without a second import path. The rules themselves live
 * in @bestpath/shared and are shared with the server.
 */
export const shared = BP.shared = {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ...tag,
};
