/**
 * THE BUILD.
 *
 * `wrangler.jsonc` points `main` at `dist-worker.js`, and until this script existed
 * nothing produced it: `wrangler deploy` failed on a missing entry point, which is
 * the shape a project takes when it was never actually deployed.
 *
 * ── Why esbuild, and not wrangler's own bundler ────────────────────────────────
 *
 * `wrangler deploy` does bundle TypeScript, and that is fine right up until the
 * first person runs `wrangler dev --local`, `wrangler versions upload`, or a test
 * that needs the artifact without deploying it. This script makes `dist-worker.js` a
 * build output that exists independently of any command that happens to need it.
 *
 * ── The three options that matter on Cloudflare ───────────────────────────────
 *
 * - `format: 'esm'` — a Worker module is an ES module. `iife` would work and would
 *   also make `import` impossible later.
 * - `platform: 'neutral'` — with `browser` or `node`, esbuild resolves the runtime
 *   from those platforms' assumptions. `neutral` plus the `workerd` condition is
 *   how you get the Workers build of a dependency, which is the one whose
 *   conditional exports were written for this runtime.
 * - `node: builtins stay external` — `src/application/user/buildProfile.ts` imports
 *   `node:crypto`, and `src/index.ts` reads `process.env`. Under
 *   `compatibility_flags: ["nodejs_compat"]` the Workers runtime *provides* both, so
 *   bundling a browser polyfill for them would be strictly worse: a second, subtly
 *   different implementation of SHA-256 than the one the runtime already has.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Every Node builtin this project can reach, and none that it does not.
 *
 * `esbuild` with `platform: 'neutral'` leaves nothing external by itself, so without
 * this list it would try to *bundle* `node:crypto` and fail the build outright.
 * Listing them explicitly is also what keeps `nodejs_compat` load-bearing: add a
 * builtin import that is not on this list and the build fails loudly, rather than
 * silently shipping a polyfill.
 */
const nodeBuiltins = [
  'node:assert',
  'node:async_hooks',
  'node:buffer',
  'node:crypto',
  'node:events',
  'node:os',
  'node:path',
  'node:process',
  'node:stream',
  'node:string_decoder',
  'node:timers',
  'node:url',
  'node:util',
  'node:zlib',
];

/**
 * `@solana/web3.js`, pointed at its **browser** entry.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `@solana/web3.js` publishes no `exports` map. With `platform: 'neutral'` esbuild
 * takes its `module` entry — `lib/index.esm.js` — which imports the Node builtins
 * `util`, `http` and `https` and pulls `node-fetch` behind it.
 * `@solana/spl-token` depends on that same package and therefore the same entry,
 * and additionally reaches `bindings` through `bigint-buffer`. None of that exists
 * in a Worker, so the build failed outright.
 *
 * ── Why the alias is on `@solana/web3.js` and not on `@solana/spl-token` ─────
 *
 * Because the `browser` entry is the one that exists to be bundled: it drops the
 * Node transports. `@solana/spl-token` ships **no** browser entry — its `exports`
 * map only exposes `.` — so there is nothing to alias it to, and its ESM build is
 * already the one a bundler is meant to read.
 *
 * The alias matches **every** import of `@solana/web3.js`, including the one inside
 * `@solana/spl-token`, which is the part that actually fixes that package: a
 * source-level deep import would leave its internal bare import on the Node entry.
 *
 * ── Why an `alias` and not `platform: 'browser'` ─────────────────────────────
 *
 * `platform: 'browser'` is a switch for the **whole** bundle: it would change how
 * every other dependency resolves, including the EVM paths that build correctly
 * today. An alias changes exactly one resolution and leaves everything else alone,
 * which is the property worth having in a bundle that already works.
 *
 * `mainFields: ['browser', …]` does **not** work for this package: its `browser`
 * field is a *remap* of an already-resolved path, not an entry-point hint.
 *
 * ── Why the path is absolute ─────────────────────────────────────────────────
 *
 * Because the package has no `exports` map, esbuild cannot resolve a deep import
 * written as a bare specifier; an absolute file path is the one form that means
 * the same thing in every resolution mode.
 *
 * ── `bigint-buffer`, and why it is here too ─────────────────────────────────
 *
 * The same Node-first reach, one level deeper: `@solana/spl-token` loads
 * `@solana/spl-token-group` and `@solana/spl-token-metadata`, which load
 * `@solana/buffer-layout-utils`, which loads `bigint-buffer`. Its default entry is
 * `dist/node.js`, and that file does `require('bindings')` — the **native** addon
 * loader, which reaches `fs` and `path` and does not exist in a Worker. Its
 * `browser` field points at `dist/browser.js`, which is the same buffer maths
 * without the addon, and that is what this alias selects.
 *
 * `bindings` itself is not aliased: it is imported by exactly one file in the tree,
 * `bigint-buffer/dist/node.js`, and aliasing it would paper over *what* is being
 * loaded rather than selecting the right variant of the package that loads it.
 *
 * ── Why this is not `npm audit fix --force` ──────────────────────────────────
 *
 * Because that wants `@solana/web3.js@3.0.0`, a breaking major that changes these
 * very APIs. The two moderates it would clear (`stream-json`, `uuid`, both via
 * `jayson`) are documented in the README and stand until that major is taken on
 * deliberately. See "Known dependency advisories".
 */
const alias = {
  '@solana/web3.js': fileURLToPath(new URL('./node_modules/@solana/web3.js/lib/index.browser.esm.js', import.meta.url)),
  'bigint-buffer': fileURLToPath(new URL('./node_modules/bigint-buffer/dist/browser.js', import.meta.url)),
  '@domain/ports/logger': fileURLToPath(new URL('./src/domain/ports/logger.ts', import.meta.url)),
  '@domain/portfolio/errors': fileURLToPath(new URL('./src/domain/portfolio/errors.ts', import.meta.url)),
  '@domain/swap/uniswapV3': fileURLToPath(new URL('./src/domain/swap/uniswapV3.ts', import.meta.url)),
  '@infrastructure/rpc/httpDeadline': fileURLToPath(new URL('./src/infrastructure/rpc/httpDeadline.ts', import.meta.url)),
  '@domain/portfolio': fileURLToPath(new URL('./src/domain/portfolio', import.meta.url)),
  '@domain/swap': fileURLToPath(new URL('./src/domain/swap', import.meta.url)),
  '@infrastructure/rpc': fileURLToPath(new URL('./src/infrastructure/rpc', import.meta.url)),
};

const result = await build({
  absWorkingDir: projectRoot,
  entryPoints: ['src/index.ts'],
  outfile: 'dist-worker.js',
  bundle: true,
  format: 'esm',
  // V8 in the Workers runtime, not V8 in the build machine's Node. Anything newer
  // than this parses here and fails on deploy.
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser', 'import', 'default'],
  alias,
  external: nodeBuiltins,
  sourcemap: false,
  minify: false,
  metafile: true,
  logLevel: 'info',
  banner: {
    js: '// Generated by `npm run build`. Do not edit; edit `src/index.ts` instead.',
  },
});

const bytes = Object.values(result.metafile.outputs).reduce((total, output) => total + output.bytes, 0);
const { name: projectName, version } = JSON.parse(
  readFileSync(new URL('package.json', import.meta.url), 'utf8'),
);

console.log(`dist-worker.js built from src/index.ts (${bytes} bytes, ${projectName} ${version}).`);
