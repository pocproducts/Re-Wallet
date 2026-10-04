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
The five variables below are set on the Worker itself with `wrangler secret put`.
Nothing needs to be created, copied or filled in locally to run the tests, the build
or the type checker.

> `05. UI-UX/.env` does exist and is a different matter: it holds `VITE_PRIVY_APP_ID`,
> which is a **public** identifier that is meant to reach the browser. The five
> variables below are not, and none of them may ever be placed in a frontend bundle.

---

## The five required variables

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
| `PRIVY_WEBHOOK_SIGNING_SECRET` | The key Privy's webhooks are signed with (the Svix `svix-*` scheme). It is the **only** credential on `POST /api/webhooks/privy`: that route has no session and no cookie. | Sign any payload as Privy: write rows into `rewallet.webhook_events` with `signature_valid = true`, attributed to whichever DID the payload names, and therefore into that person's notification feed. |

**None of the five ever goes into the frontend.** They are Worker secrets: they are
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

# The webhook signing secret Privy signs its webhooks with.
# Privy Dashboard → Settings → Webhooks → the signing secret of the endpoint
# (it starts with `whsec_`). Changing it invalidates deliveries in flight, so
# Svix's rotation (send the old and the new in `svix-signature`) is the safe path.
npx wrangler secret put PRIVY_WEBHOOK_SIGNING_SECRET
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

The only values the toolchain needs are the five above, and only for commands that
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

## `rewallet.wallets.evm_network` — the EVM network a person operates on

**One EVM address serves every configured EVM network, so the network is a column
and not a row.**

Privy's embedded wallets are chain-agnostic EVM accounts: the EVM address in the
`ethereum` row (`0xaA8A88A0005707D8A90D725fe654A6C06b255f75`) is the address that
reads balances on Ethereum **and** on Monad. There is no second address to write,
so a second EVM row would be refused by `wallets_address_key UNIQUE(address)` —
and would require a wallet the person does not have. `WALLET_CHAIN_ORDER` stays
two entries long for the same reason.

The network in use is therefore a recorded fact **on the row**:

```sql
ALTER TABLE rewallet.wallets
  ADD COLUMN IF NOT EXISTS evm_network text NOT NULL DEFAULT 'eip155:1';
```

(`sql/0001_wallets_evm_network.sql`, applied to Neon. `ADD COLUMN IF NOT EXISTS`
makes it a no-op the second time, and Postgres fills existing rows with the
default, so **no `UPDATE` and no data migration step**.)

| | |
|---|---|
| **Format** | CAIP-2: `eip155:<chain id>`. Self-describing — the namespace is part of the value, so `1` never has to be looked up. |
| **Values** | `eip155:1` Ethereum mainnet (the default, on purpose), `eip155:143` Monad mainnet (verified: `eth_chainId = 0x8f`). |
| **Default** | `eip155:1`. Ethereum was **added to**, not replaced by, Monad — so an existing row, and a row nobody chose a network for, describes a person on Ethereum. |
| **Solana rows** | They carry the column too (it is `NOT NULL`) and it means nothing there. The adapter reports `evmNetwork: null` for a non-EVM row rather than "Ethereum". |
| **Unsupported value** | The adapter reports `null` and the row is still returned. It is never silently defaulted: an operation on a network nobody chose is the one mistake this column exists to prevent (`src/domain/wallet/evmNetwork.ts`). |

No constraint was changed and no row was added or removed. The values the
application accepts are `SUPPORTED_EVM_NETWORK_IDS` in
`src/domain/wallet/evmNetwork.ts`, which is also where the reason the default is
Ethereum is written down.

**Not yet exposed.** Nothing sends a transaction yet, and
`GET /api/portfolio` is unchanged — it reads balances, not the network in use.
Writing the value and refusing an unsupported network at the point of signing
are the next steps, not this one.

## `GET /api/portfolio` — what the person actually holds

**Balances are read from the chain, in the request. There is no cache, and none is
planned for this stage.**

```json
{
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "chains": [
    { "chain": "monad", "status": "ok", "address": "0x…",
      "assets": [
        { "symbol": "MON",  "unit": "MON",  "decimals": 18, "raw": "123456789012345678901", "amount": "123.456789012345678901" },
        { "symbol": "USDC", "unit": "USDC", "decimals": 6,  "raw": "1500000",               "amount": "1.5" }
      ] },
    { "chain": "ethereum", "status": "ok", "address": "0x…", "assets": [ … ] },
    { "chain": "solana",   "status": "error",
      "error": { "code": "CHAIN_READ_FAILED", "reason": "RPC_UNAVAILABLE" } }
  ]
}
```

Authentication is the session cookie, read exactly as `GET /api/auth/session` reads
it: `401 UNAUTHENTICATED` with no cookie or an unverifiable one, and nothing is read
in either case.

### Five decisions that are deliberate

1. **Amounts are unrounded strings, with `decimals` and `unit` stated next to them.**
   `raw` is the exact integer the chain reported, in the smallest unit; `amount` is
   the same value in its unit, as a decimal string, produced by string surgery on
   a `bigint` (`formatUnits`, `src/domain/portfolio/assets.ts`) — never by division,
   which loses digits past the 17th significant figure. The screen decides how to
   round; the app needs the whole value to build a transaction, and a rounded one
   cannot be un-rounded. `decimals` is stated so the screen never has to remember
   it: a wrong exponent is not a wrong picture, it is wrong money.

2. **A chain that fails does not empty the portfolio, and is never a zero.**
   Each chain carries its own `status`, inside a `200`:

   | `status` | Meaning |
   |---|---|
   | `ok` | Read. `assets[].amount` may legitimately be `"0"` — an empty wallet. |
   | `error` | Could not be read. `error.reason` is one of `RPC_UNAVAILABLE`, `RPC_REJECTED`, `RPC_MALFORMED_RESPONSE`. |
   | `no_wallet` | This person has no wallet row for this chain. |

   `reason` is an enum, never the provider's words: a public endpoint's error message
   is a sentence, sometimes an HTML page from a proxy, and a screen can only render
   "we could not read this chain". The provider's text goes to the log. A zero for a
   failed read is the worst possible outcome, because it renders as an empty wallet.

3. **The address comes from `rewallet.wallets`, always.** The route takes no
   address, no chain list, no body and no query parameter — there is no parameter
   through which a foreign address could arrive. The only input is the `userId` the
   cookie proved.

4. **One EVM address, two EVM networks.** `monad` and `ethereum` both resolve to the
   single `ethereum` wallet row (`WALLET_CHAIN_FOR` in
   `src/domain/portfolio/networks.ts`). Privy's embedded wallets are chain-agnostic
   EVM accounts, so there is no second EVM wallet to create, and adding one would
   collide with `address UNIQUE` on `rewallet.wallets`. Monad is deliberately **not**
   in `WALLET_CHAIN_ORDER`: it is a read network, not a wallet chain.

5. **No caching.** Correctness first. Every read goes out per request. If a cache is
   ever added it must be per-request and stated here.

### How each chain is read

| Chain | Native | Token | Port |
|---|---|---|---|
| Monad (`https://rpc.monad.xyz`) | `eth_getBalance` → wei, 18 decimals | `USDC` at `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` via `balanceOf(address)` `eth_call`, 6 decimals | `EvmBalanceReader` |
| Ethereum (chain id 1) | `eth_getBalance` → wei, 18 decimals | same contract, same call | `EvmBalanceReader` |
| Solana (`https://api.mainnet-beta.solana.com`) | `getBalance` → **lamports**, 9 decimals | — | `SolanaBalanceReader` |

USDC has the same address on Monad and on Ethereum mainnet, and it was verified by
hand on both chains before being written down. The same USDC contract is never asked
about a chain it does not answer on.

Two precision notes that are not optional details:

- **`eth_getBalance` answers in hex** and is parsed by `BigInt`. `Number` is already
  wrong past 53 bits, and an 18-decimal balance goes past it.
- **`getBalance` answers in a JSON number**, and Solana's supply is past
  `Number.MAX_SAFE_INTEGER`. The adapter therefore reads the raw response text and
  hands `"value": <digits>` to `BigInt`, because `JSON.parse` would silently round a
  large lamport count.

Both adapters keep three failures apart — `RPC_UNAVAILABLE` (no answer, including
429 and 5xx), `RPC_REJECTED` (the endpoint answered with an error object) and
`RPC_MALFORMED_RESPONSE` (it answered with something that is not a number). The
third must never be mistaken for a zero, which is why it has its own name.

### Optional variables

Unlike the five above, these have working defaults and are **not** required to boot:
`MONAD_RPC_URL`, `ETHEREUM_RPC_URL`, `SOLANA_RPC_URL`. They exist so a deployment
can point at a provider of its own — a public RPC rate-limits, and a rate limit
should show up as a per-chain error, not as a Worker that cannot boot.

### The one 502

`502 WALLETS_UNAVAILABLE`: the wallet rows could not be read, so no address could be
resolved for **any** chain and there is no per-chain truth to report. Answering `200`
would mean reporting all three chains as `no_wallet`, which is a lie about somebody's
account. Every other failure is a per-chain `status`, not an HTTP status.

## `POST /api/webhooks/privy` and `GET /api/notifications` — what arrived, in sentences

One intake, one feed, and nothing in between: **no background processing, no
retries, no side effects.** The intake stores; the feed reads. No wallet work, no
push, and `processed_at` is never written — that column is for a consumer that
does not exist yet, and setting it would claim something was processed.

### `POST /api/webhooks/privy`

```
POST /api/webhooks/privy
svix-id: msg_…
svix-timestamp: 1748779200
svix-signature: v1,<base64 HMAC-SHA256>

200  — stored, or already on file. Empty body.
400  — signed, but the body is not a webhook this Worker understands. Nothing stored.
401  — no signature, a malformed one, a stale timestamp, or a wrong one. Nothing stored.
```

**The signature scheme** (Svix, the delivery provider behind Privy webhooks). The
signed content is the message id, the timestamp and the **raw body** joined with
dots; the key is `PRIVY_WEBHOOK_SIGNING_SECRET` with `whsec_` stripped and the
rest base64-decoded; the result is HMAC-SHA256, base64 encoded. The header may
carry several space-separated `v1,…` values and any one matching is enough, which
is what makes a key rotation work.

**The freshness rule** is Svix's own: five minutes
(`DEFAULT_SIGNATURE_TOLERANCE_SECONDS`), compared in **both** directions, so a
timestamp from the future is stale too. The timestamp is inside the signed
content, so a captured request cannot be re-stamped without the secret.

**Freshness and replay are two different defences, and both are here.**

- An **old timestamp** is refused as `401 WEBHOOK_SIGNATURE_STALE`. Nothing is
  stored.
- A **replay with a fresh signature** is refused by `external_id`: the row already
  exists, `ON CONFLICT (source, external_id) DO NOTHING` writes nothing, and the
  route answers **200 with an empty body**. That is deliberate. Privy retries until
  it gets a 2xx; the delivery *was* honoured, the event is already on file, and a
  4xx would start a retry loop against an event this Worker already has.

**Why nothing unverified is ever stored, not even "for observability":** this route
has no session and is reachable by anybody on the internet. Storing a payload the
signature did not vouch for turns a public endpoint into an open write surface,
and the feed — which a person trusts — reads from exactly that table. There is no
row with `signature_valid = false`: rejection is the whole answer.

**Why the `svix` package was not added.** The scheme is one HMAC over one string
plus one base64 decode, and Web Crypto is already in the runtime. `svix` pulls
Node-oriented dependencies into a `platform: 'neutral'` workerd bundle, and
`build.mjs` keeps its Node-builtin list deliberately short so a dependency cannot
smuggle in a second crypto implementation. `test/domain/svixSignature.test.ts`
re-derives every signature with `node:crypto`, so the implementation is checked
against the scheme and not against itself. **No dependency was added.**

### `GET /api/notifications`

Same door as every other route: the session cookie, the same codec, the same 401.
The person is the DID from the session claims; there is no query parameter, path
segment or header that can name somebody else.

```json
{ "generatedAt": "2025-06-01T12:00:00.000Z",
  "notifications": [
    { "id": "…", "eventType": "wallet.created", "category": "wallet",
      "message": "Se creó una billetera nueva en tu cuenta.",
      "createdAt": "2025-06-01T11:00:00.000Z" } ] }
```

Newest first, at most **50** items (`NOTIFICATIONS_PAGE_SIZE`). **No payload in
the item, and no way to ask for one:** a Privy payload carries a DID, an address
and a wallet id that the UI has no use for. The row stays in the table.

`502 NOTIFICATIONS_UNAVAILABLE` when the rows cannot be read: an empty list is a
claim ("you have no notifications"), and a failed read is not that claim.

### The `event_type` → sentence mapping

One table, in `src/domain/webhooks/eventDescription.ts`:

| `event_type` | Sentence | Category |
|---|---|---|
| `user.created` | Se creó tu cuenta en ReWALLET. | `account` |
| `user.updated` | Se actualizaron los datos de tu cuenta. | `account` |
| `user.deleted` | Se eliminó tu cuenta. | `account` |
| `user.signed_in` | Iniciaste sesión en ReWALLET. | `security` |
| `user.auth_recovered` | Recuperaste el acceso a tu cuenta. | `security` |
| `wallet.created` | Se creó una billetera nueva en tu cuenta. | `wallet` |
| `wallet.deleted` | Se eliminó una billetera de tu cuenta. | `wallet` |
| `linked_account.created` | Conectaste un método de acceso a tu cuenta. | `link` |
| `linked_account.deleted` | Desconectaste un método de acceso de tu cuenta. | `link` |
| **anything else** | **Se recibió un evento de tu cuenta.** (`category: other`) | `other` |

The fallback states one true thing and invents nothing: not the type, not a chain,
not a success. Privy adds event types without asking, and a blank line renders as a
broken row while a dropped event is an event that never happened as far as the
person is concerned. Keys match exactly: `USER.CREATED` is not `user.created`,
because guessing at case would mean two names for one event.

### Events that belong to nobody

Stored, and shown to nobody. Privy sends app-level events, and an event that cannot
be attributed to a person is a **normal** case, not an error. Attribution reads a
fixed list of paths — `user_did`, `user.id`, `object.user_did`, `object.user.id`,
`wallet.user_did` — and only values shaped like `did:privy:…`. A DID *mentioned*
in a payload (`invited_by`) is not attributed: that would put one person's event
in another person's feed.

### Why no attribution column was added

**The table was not touched.** The feed filters on `payload @> …`, one containment
per path in the list above, and `idx_webhook_events_payload` is a GIN index on
`payload` — verified in the catalog: `jsonb_ops` has strategy 7 = `@>`, so the
index can serve the predicate. At the POC's scale the planner picks a sequential
scan anyway (the table has 0 rows today), and the cost of getting this wrong is
bounded: one person sees fewer notifications, never another person's.

A `privy_did` column would have been a copy of a fact already inside `payload`,
written by the same extraction that has to exist anyway, and the two could
disagree — an extraction bug would then hide events the payload clearly attributes.
The same list of paths builds the SQL and the attribution, so writing and reading
cannot drift apart.

The risk this leaves, stated plainly: if Privy changes the shape of a user object,
events stop being attributed and silently stay out of every feed. That is visible
in two places — `webhook.privy stored` in the logs, and
`SELECT count(*) FROM rewallet.webhook_events WHERE NOT (payload @> …)`. The fix,
if it ever comes, is one idempotent `ADD COLUMN IF NOT EXISTS` in `sql/` plus one
condition in the adapter, not a redesign.

## Layout

```
src/
  domain/ports/        the interfaces: what the application needs, in our words
  domain/webhooks/     the signature scheme, the event→sentence table, attribution
  application/         the use cases: session minting, wallet claiming, portfolio
                       reads, webhook intake, notification feed
  infrastructure/      the adapters: Privy, Postgres, JWT, JSON-RPC balance reads
  interface/http/      Hono: routes, cookies, the error boundary
  container.ts         reads config, builds adapters, wires the app
  index.ts             the Worker's `fetch`
test/                  mirrors src, with every port stubbed
sql/                   idempotent migrations for tables this project added to
build.mjs              the esbuild build that produces dist-worker.js
wrangler.jsonc         name, main, routes, assets, compatibility flags, secrets note
```
