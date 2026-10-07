# `07.PockBackend` — the ReWALLET Worker

One Cloudflare Worker that serves the API **and** the front end, on the same origin.
`POST /api/auth/session` mints the session cookie; everything under `/api` is the
API; everything else is the single-page application in `../05. UI-UX/dist`.

The session is an httpOnly, `SameSite=Lax` cookie with a `__Host-` prefix. That
prefix forces `Secure`, no `Domain` and `Path=/`, which is the whole reason the API
and the UI share an origin instead of living on two.

---

## There is no `.env` file in this project, on purpose

Not by oversight, and not because one is missing. A `.env` file is a file on disk
that holds live credentials in clear text, that gets copied into screenshots, that
ends up in a zip, and that a well-meaning commit picks up. Cloudflare secrets are
not that: they live in the Workers runtime, they arrive in the `env` object, and they
are never in the repository, in the build, in the bundle, or in a `dist-worker.js`
anybody can read.

**So this project has no `.env` and this README is the setup documentation instead.**
The four variables below are set on the Worker itself with `wrangler secret put`.
Nothing needs to be created, copied or filled in locally to run the tests, the build
or the type checker.

> `05. UI-UX/.env` does exist and is a different matter: it holds `VITE_PRIVY_APP_ID`,
> which is a **public** identifier that is meant to reach the browser. The four
> variables below are not, and none of them may ever be placed in a frontend bundle.

---

## The four required variables

None of these is optional. The Worker **fails closed at boot** if any is missing —
`readConfig` in `src/container.ts` throws before the first request — because a Worker
that starts without knowing which Privy app or which database it belongs to looks
healthy and then rejects everybody, or writes to the wrong place.

| Variable | What it is | What happens if it leaks |
|---|---|---|
| `PRIVY_APP_ID` | The identifier of the Privy application this Worker belongs to. Public by nature — it is in `05. UI-UX/.env` on purpose — and harmless without the secret next to it. | Nothing meaningful on its own. Still not sent to the frontend from here. |
| `PRIVY_APP_SECRET` | The server-side credential for that Privy application. It authorises every call this Worker makes to Privy: verifying tokens and reading user records — including the wallets a person owns. It no longer mints wallets. | Full control of the Privy app: read and write every user, and read every wallet they own. |
| `DATABASE_URL` | The Postgres connection string for the Neon database holding the `rewallet` schema. It carries the database user and its password. | Read and write the entire database, including every user's email, DID, wallets and balances. |
| `SESSION_SECRET` | The key that signs and verifies the session cookie. It is the only thing standing between a forged cookie and somebody else's account. | Forge a session cookie for any `userId` and walk into that account. |

**None of the four ever goes into the frontend.** They are Worker secrets: they are
set per-Worker, they arrive in the `env` parameter of `fetch`, and the built bundle
never contains them — `dist-worker.js` reads them at request time through
`readConfig({ ...process.env, ...env })`. `PRIVY_APP_ID` appears in the browser, but
only because it is a public identifier by design and it is served from
`05. UI-UX`'s own configuration, not from this Worker.

The rule they all follow: **a secret that reaches the browser is no longer a secret.**
Nothing in `src/` writes any of them to a response, a log, or a metric.

### Setting each one

From `07.PockBackend`, one command per variable. Each prompts for the value and
encrypts it into the Worker; nothing is echoed back and nothing is written to disk.

```bash
# The Privy application this Worker authenticates against.
# Dashboard → Settings → General → App ID.
npx wrangler secret put PRIVY_APP_ID

# The Privy application's server-side secret.
# Dashboard → Settings → General → App Secret.
npx wrangler secret put PRIVY_APP_SECRET

# The Postgres connection string for Neon, schema `rewallet`.
# Neon console → Connection Details → Pooled connection string.
npx wrangler secret put DATABASE_URL

# A long random value used to sign the session cookie.
# Generate one with:  openssl rand -base64 48
# It must be identical across every deployment of this Worker, or sessions issued by
# the previous deployment stop verifying — which logs everybody out, by design.
npx wrangler secret put SESSION_SECRET
```

To see the **names** that are set (never their values):

```bash
npx wrangler secret list
```

To remove one and set it again, for example after rotating it:

```bash
npx wrangler secret delete SESSION_SECRET
npx wrangler secret put SESSION_SECRET
```

---

## Local commands

Run everything from `07.PockBackend`.

### Install

```bash
npm install
```

The only values the toolchain needs are the four above, and only for commands that
talk to Cloudflare. Install, build, typecheck and test all run without any of them.

### Build

```bash
npm run build
```

Bundles `src/index.ts` into `dist-worker.js` with esbuild — `format: esm`,
`target: es2022`, `platform: neutral` with the `workerd` condition, and Node
builtins left external so `node:crypto` (used by `buildProfile`) and `process.env`
(resolved per request in `src/index.ts`) keep coming from the Workers runtime under
`compatibility_flags: ["nodejs_compat"]`. That file is what `wrangler.jsonc` names as
`main`, so it must exist before any deploy command.

### Typecheck

```bash
npm run typecheck
```

`tsc --noEmit`, and nothing else. There is no linter in this project. `npm run lint`
is an alias of the exact same command, kept because the existing documentation and
gates refer to it — **it is not a linter**, it is a second name for the type
checker, and it will not tell you anything the type checker does not.

### Test

```bash
npm test
```

Vitest, no watch mode, and **no network and no database**. That is not a convenience,
it is the reason the architecture is shaped the way it is: the token verifier, the
Privy user directory, the wallet ownership verifier and the stores are all injected
ports, so the whole session-minting and wallet-claiming flow is exercisable
offline. A test that needs Privy to
be up is a test that only runs on the day Privy is up.

### Dry-run deploy

```bash
npx wrangler deploy --dry-run
```

Validates `wrangler.jsonc`, requires `dist-worker.js` to exist, uploads the assets
from `../05. UI-UX/dist`, prints the bundle size and exits **without publishing
anything**. Run it after `npm run build`. A real deploy — which does publish, to
`app-dev.rewallet.win` — is `npm run deploy` and is a separate, deliberate act.

---

## How a login works

`POST /api/auth/session` takes `{ accessToken }` and, in this order:

1. **Verify the access token.** `verifyAuthToken` proves the caller and yields the
   Privy DID. This is the authority on identity and it is first; nothing is written
   before it succeeds.
2. **Resolve the user, by that DID.** `users()._get(privyDid)` asks Privy for the
   record that identifier names. The access token carries no email claim — the SDK's
   payload reader enumerates `aud`, `iss`, `iat`, `exp`, `sid`, `sub` — so the
   mailbox has to come from the user record, and that record is addressable by the
   DID the verification just proved. No second token is needed or accepted. The
   fetched user's own `id` is compared with the verified DID; a record belonging to
   anybody else is refused. (`_get` is underscore-prefixed in
   `@privy-io/node@0.35.0` because it shadows the older token-based
   `users().get({ id_token })`; it is the SDK's own documented-by-example path for
   a single user by id.)
3. **Resolve `rewallet.users`, by DID and then by mailbox.** `email`, `name`,
   `tag` and `tag_normalized` are all `NOT NULL` and `UNIQUE`. On a first login
   all four are built from the real email plus a short SHA-256 digest of the DID.
   If the lookup cannot produce a real email, the login is **refused** with a 502
   and the failing step in the log. No address is ever invented. On a later login
   the resolution is one of four answers — see
   [One email, one account](#one-email-one-account).
4. **Announce that the wallets are pending.** Nothing is created here — see
   [Who owns the wallet](#who-owns-the-wallet) — and the step can never fail this
   login.
5. **Issue the session cookie.** The body of the response is empty; the token
   travels in the httpOnly cookie and nowhere else.

## One email, one account

**The mailbox is the identity. The DID is an identifier Privy may rotate.**

Step 3 used to be a single `INSERT ... ON CONFLICT (privy_did)`, and that is what
broke in production:

```
session.failed  { step: 'session.user_upsert',
                  reason: 'duplicate key value violates unique constraint "users_email_key"' }
→ 401
```

Both systems were checked. Privy had exactly one user for that mailbox,
`did:privy:cmut0tb8i00d10cktp99v35vb`, created minutes earlier, and the previous
DID no longer existed. Neon had exactly one row for the same mailbox, still bound
to the **old** DID. The row was an orphan: the upsert looked up by DID, missed, and
the insert collided with the mailbox that was already on file.

So the resolution is four explicit steps (`resolveAccount`), never one clever
statement, because the interesting branch needs a **read** to exist:

| The DID | The mailbox | What happens | Log line |
| --- | --- | --- | --- |
| known | same | ordinary re-login; the row is upserted so two simultaneous logins still resolve to one row | `session.account_existing` |
| **unknown** | **known** | the existing row **adopts** the new DID; nothing else changes | `session.account_adopted` (with `previousPrivyDid`) |
| unknown | unknown | a new account | `session.account_created` |
| known | **different** | **refused**: `409 IDENTITY_CONFLICT` | `session.failed` with `IdentityConflict` |

Two people cannot collide on the second row: reaching it requires having received
the code sent to that mailbox, and it only ever rewrites `privy_did`.

**Adoption preserves the person.** `name`, `tag` and `tag_normalized` are a
handle, not a function of the DID, so the adoption statement is
`UPDATE … SET privy_did = $1` and nothing else. The `id` every wallet, movement
and policy row already points at does not change either. Regenerating a tag
because a provider rotated a technical identifier would break every existing
reference to that human.

**A mailbox that differs only in case is the same mailbox.** `rewallet.users.email`
is `citext`, and so is every comparison on the way in — a provider-side casing
change is not a second person.

**A known DID with a different mailbox is refused, not resolved.** Overwriting the
stored address is the one move that could hand one person's account to another, so
the login fails closed. 409, not 401: the person *is* authenticated, and a 401
would send the browser round the login loop forever.

**A raced unique violation is a clean failure.** Postgres `23505` is translated
into `UserStoreConflict`, which carries the constraint name for the log and
answers `409 ACCOUNT_CONFLICT`. No driver message, table name or index name
reaches a browser. Anything that is *not* a unique violation — an outage, say —
is re-thrown untouched rather than disguised as a conflict.

Both write paths use it. `/api/auth/session` and `/api/wallets/claim` key their
writes on the same `rewallet.users.id`, so they call the same resolver rather than
each having their own idea of who the person is.

## Who owns the wallet

**The user owns the wallet. This Worker creates none.**

The Worker used to create embedded wallets from the server side, on every login.
Privy's production answer to what it had produced was unambiguous:

```
GET /v1/wallets/o2oxert46wgndsi2x2gcu7ze → owner: null, owner_id: "is5plzb8spdqrv6n590y31jf"
GET /v1/users/did:privy:cmussgc9y00f80cjvv8gcmbqs → wallets: []
```

The wallets belonged to an **app key quorum** and the person did not even list
them. A raw REST call reproducing our exact request shows it was not our bug
either: `POST /v1/wallets` with `{"owner":{"user_id":"did:privy:…"}}` answers
`200` and still assigns the key quorum. The endpoint ignores `owner`.

So the direction is inverted. The **browser** creates the wallet (Privy gives
client-side creations a user owner) and the **backend verifies** it:

`POST /api/wallets/claim`

```json
{ "accessToken": "<privy access token>",
  "wallets": [ { "chain": "ethereum", "walletId": "…", "address": "0x…" },
               { "chain": "solana",   "walletId": "…", "address": "…" } ] }
```

1. The `accessToken` is verified **exactly** as `POST /api/auth/session` does, and
   its DID is the only key the rest of the request may use.
2. The user is fetched from Privy with the same directory lookup, which also
   resolves the `rewallet.users.id` the wallets table is keyed by — through the
   same account resolver the session uses, so a claim that arrives after Privy
   rotated the DID lands on the same row instead of failing on the mailbox.
3. **Ownership proof.** Every claimed `walletId` must appear in *that* user's Privy
   record (`linked_accounts`, the embedded-wallet entries). If one does not, the
   **entire claim is rejected and nothing is written** — a partial write is worse
   than no write.
4. The claimed `address` must match the address Privy reports, and **Privy's**
   address is what gets stored. EVM addresses are compared case-insensitively,
   base58 Solana addresses exactly.
5. Verified wallets are written EVM first and then Solana (that order belongs to
   `claimWalletsFor`, not to the adapter), and re-claiming is a no-op thanks to the
   existing `UNIQUE (user_id, chain_type)`.

Answers: `204` on success (no body), `400` for a malformed body, `401
UNAUTHENTICATED` for a token that does not verify, `403 WALLET_CLAIM_REJECTED` for
a claim that is not true, `502 WALLET_OWNERSHIP_UNAVAILABLE` / `502
IDENTITY_UNAVAILABLE` when the provider cannot answer, and `409 IDENTITY_CONFLICT` /
`409 ACCOUNT_CONFLICT` when the account itself cannot be resolved (see
[One email, one account](#one-email-one-account)). A provider outage is never
dressed up as a refusal: telling somebody to try again would fail identically.

## Layout

```
src/
  domain/ports/        the interfaces: what the application needs, in our words
  application/         the use cases: session minting, wallet claiming
  infrastructure/      the adapters: Privy, Postgres, JWT
  interface/http/      Hono: routes, cookies, the error boundary
  container.ts         reads config, builds adapters, wires the app
  index.ts             the Worker's `fetch`
test/                  mirrors src, with every port stubbed
build.mjs              the esbuild build that produces dist-worker.js
wrangler.jsonc         name, main, routes, assets, compatibility flags, secrets note
```
