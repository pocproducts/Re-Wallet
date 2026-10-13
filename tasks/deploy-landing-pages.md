# Deploy Landing Page to Cloudflare Pages

Feature: `deploy-landing-pages`
Status: complete
Account: `c5b83b727e241a6a99869f144f0e3378`
Target host: `rewallet.win` (custom domain on the Pages project)

## Context

`04. Landing Page` is a Next.js 16 App Router app with a single route, 53 client
components and no API routes, server actions or backend fetches. It is fully
static, so it deploys as a static export on Cloudflare Pages (user decision:
Pages direct upload, not Workers).

## Tasks

- [x] T1 Make the Next build emit a static export (`output: 'export'`, unoptimized images)
- [x] T2 Build and verify `out/` (index.html, _next assets, public files)
- [x] T3 Create the Pages project and upload the static build -> `rewallet-landing.pages.dev` (HTTP 200, CSS served, 404 works)
- [x] T4 -- RESOLVED 2026-09-30. See "Domain migration" below.

## Cloudflare Pages caveat

Wrangler 4.142 delegates `wrangler pages project create` to Cloudflare Workers and fails
with "Missing entry-point to Worker script or to assets directory". The project was created
with `--force` (legacy Pages). `--force` is only needed for project creation; later
`pages deploy` commands run directly against Pages.

## Follow-up: drop the template branding

- [x] Replace v0 "Brutalist AI SaaS" metadata in `app/layout.tsx` with ReWALLET identity
- [x] Replace v0 README with real stack/build/deploy docs
- [x] Add `.gitignore` (was pulling 28k node_modules/.next/out files into the repo)
- [x] Commit `a9b9330` on `feat/landing-rewallet-branding`, pushed
- [x] Deploy to Pages -- prod live at rewallet.win, title verified

## Domain migration (2026-09-30)

The apex `rewallet.win` was a **custom domain of Worker `rewallet`**, not the Pages
project. Sequence:

1. `DELETE /accounts/{acc}/workers/domains/{domain_id}` -- detached the apex from the
   worker. This left the zone with no origin, so the site 404'd until DNS was fixed.
2. `POST /accounts/{acc}/pages/projects/rewallet-landing/domains` with `rewallet.win`
   -- attached the apex to Pages. Stayed `initializing` / "CNAME record not set".
3. User created the DNS record manually (Wrangler OAuth token has no dns scope).
   Domain went `active` and the site returned 200.

## Gotchas

- Domain is `rewallet.win` (with "t"), not "rewalle.win".
- **Pages is NOT git-connected.** `source: null`, no build_config. Every deploy is
  `ad_hoc` via `wrangler pages deploy`. Pushing to GitHub does NOT deploy -- a green
  push is not evidence prod updated. Verify by hitting the domain and checking the
  title, or by reading the canonical deployment id.
- `pnpm` is broken (corepack points at a missing 12.6.0). Use `./node_modules/.bin/next build`.
- `next.config.mjs` keeps `typescript.ignoreBuildErrors: true`; do not change it.
- `components/about-section.tsx` uses `next/image`, so `images.unoptimized` is required
  for `output: 'export'`.
- The repo working tree has 168 pre-existing deletions (`bestpath/`, root `README.md`, etc.)
  that are NOT committed. Branch off carefully so they do not ride along.
- Worker `rewallet` is still live, just domain-less. Deleting it is still pending user call.

## Commits

- `a9b9330` feat(landing): reemplazar branding de template por la identidad de ReWALLET
