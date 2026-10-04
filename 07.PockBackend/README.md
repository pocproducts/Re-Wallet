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

## `GET /api/deposit-info` — what can be received, on which network, and where

The deposit screen is the one place where a mistake does not produce an error: it
produces a lost deposit. That is why this route exists instead of the frontend
holding a list of networks — see `src/domain/deposit/catalog.ts` for why the
catalog is a server fact and not a client constant.

```
GET /api/deposit-info            (the same session cookie as every other route)

200
{
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "networks": [
    { "chain": "monad", "label": "Monad", "evmNetwork": "eip155:143",
      "hasWallet": true, "address": "0x…",
      "assets": [
        { "symbol": "MON",  "name": "Monad",  "decimals": 18, "native": true,
          "token": null, "balanceReadable": true },
        { "symbol": "USDC", "name": "Dólares digitales", "decimals": 6,
          "native": false,
          "token": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
          "balanceReadable": true } ] },
    { "chain": "solana", "label": "Solana", "evmNetwork": null,
      "hasWallet": false,
      "assets": [ { "symbol": "SOL", … } ] }
  ]
}

401  — no cookie, or a cookie that does not verify. Nothing was read.
502  — WALLETS_UNAVAILABLE: the wallet rows could not be read.
404  — not mounted when `readDepositInfo` is not wired.
```

### Four rules the response cannot break

1. **`address` comes from `rewallet.wallets`, and from nowhere else.** The use case
   takes a user id and nothing else: no address parameter, no chain parameter, no
   body, and no `POST`. "We ignored the parameter you sent" is a much better
   property than "we validated the parameter you sent".
2. **A network with no wallet row carries `hasWallet: false` and no `address`
   field at all.** Not `""`, not `null`. There is nowhere to receive, and an empty
   address in a QR is a destination nobody can claim.
3. **`balanceReadable` travels per asset, not per network.** It depends on what can
   be read on-chain for that token. `false` still means **receivable**: the asset
   appears with its network and its address, and only the figure is missing. The
   screen says "we could not read it". It never renders `0` — unreadable is not
   zero, and this is a consumer payments product.
4. **The asset order per network is stable**, and a test asserts it. A list that
   reorders between reads turns "the second one" into "the one you then pick".

### The one EVM address, twice

`monad` and `ethereum` resolve to the **same** `ethereum` wallet row: Privy's
embedded wallets are chain-agnostic EVM accounts, so one address is valid on both
networks and can receive any ERC-20 of either. The response states it twice, each
time attached to its network, because an address without its network next to it is
exactly the mistake this route exists to prevent. `solana` has its own address.

### Adding an asset

One entry in `DEPOSIT_NETWORKS`, **after** its contract has been verified on the
network where the entry declares it. The `token` field is per network and is not
copied: the USDC on Monad (`0x7547…b603`) and the USDC on Ethereum (`0xA0b8…eB48`)
are different contracts, and reading one from the other network returns a
plausible zero from an address with no code.

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

## `GET /api/pool` — the Aave V3 USDC reserve on Monad, and this person's position

**Mainnet. Real money. The contract addresses live here and nowhere else: the
frontend receives transactions to sign, never a contract to call.**

```json
{
  "generatedAt": "2026-10-04T05:00:00.000Z",
  "network": { "name": "monad", "chainId": 143, "protocol": "Aave V3" },
  "asset": { "symbol": "USDC", "unit": "USDC", "decimals": 6 },
  "reserve": { "status": "ok", "reason": null },
  "reserveDecimals": 6,
  "apr":  { "supply": { "status": "ok", "value": "4.1196" },
            "borrow": { "status": "ok", "value": "4.9876" } },
  "totals": {
    "supplied":   { "status": "ok", "value": { "raw": "173874477777314", "amount": "173874477.777314", "decimals": 6, "unit": "USDC" } },
    "borrowed":   { "status": "ok", "value": { "raw": "159699152138313", … } },
    "available":  { "status": "ok", "value": { "raw": "14175325639001",  … } },
    "utilisation":{ "status": "ok", "value": "91.8473" }
  },
  "lastUpdate": { "status": "ok", "value": { "unix": 1791088293, "iso": "2026-10-04T04:31:33.000Z" } },
  "reconciliation": { "status": "ok", "value": { "percent": "4.1228", "agrees": true } },
  "position": {
    "address": "0x…",
    "aTokenBalance": { "status": "ok", "value": { "raw": "820428", "amount": "0.820428", "decimals": 6, "unit": "aMonUSDC" } },
    "availableUsdc": { "status": "ok", "value": { "raw": "5000000",  … } },
    "gasBalance":    { "status": "ok", "value": { "raw": "3000000000000000000", "amount": "3", "decimals": 18, "unit": "MON" } }
  }
}
```

### The addresses, and where they came from

| What | Address | Verified by |
|---|---|---|
| Pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | `aave-address-book` `AaveV3Monad.POOL`, **and** `aMonUSDC.POOL()` on chain |
| Data provider | `0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad` | `AAVE_PROTOCOL_DATA_PROVIDER`, and `getReserveTokensAddresses(USDC)` returns `A_TOKEN` |
| USDC (reserve 1) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | `ASSETS.USDC.UNDERLYING`, 6 decimals, `symbol()` = USDC |
| aUSDC | `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042` | `ASSETS.USDC.A_TOKEN`, `symbol()` = `aMonUSDC` |
| Chain | 143 | `eth_chainId` on `rpc.monad.xyz` = `0x8f` |

They live in `src/domain/pool/aaveMonad.ts`, which is also where the four
selectors are: `getReserveData` `0x35ea6a75`, `approve` `0x095ea7b3`,
`deposit` `0xe8eda9df`, `allowance` `0xdd62ed3e`.

### The two ways this read was wrong before

**The selector.** `getReserveData(address)` is `0x35ea6a75` on **V3**.
`0x026b1d5f` is the **V2** selector and *reverts* on a V3 pool — and a revert was
read, for a whole session, as "the pool moved". A selector is four bytes of ABI,
so it is a constant with a test, not a comment.

**The ABI.** The official declaration
(`@aave/core-v3/contracts/misc/AaveProtocolDataProvider.sol`) has **twelve**
outputs, in this order:

```
uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken,
uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate,
uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate,
uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp
```

Declaring fewer, or in another order, does not throw: everything after the missing
word slides one slot early. That is how a `lastUpdateTimestamp` of `4e25` (the year
4921) and a supply APR of `130.281.299%` were produced. `decodeReserveData`
therefore **refuses** any answer that is not exactly twelve hex words, and
`RESERVE_DECODE_FAILED` is a failure reason of its own — a struct we cannot read is
ours to investigate, not "the endpoint did not answer".

**The rate is an annual rate in RAY** (`RAY = 1e27`). Read per second, the same
number is `130.281.299%`. The conversion is `rate x 1e6 / RAY`, in integers, and
the scale of every percentage in the response is **one unit = 0.0001%**.

### The check that a rate has to pass

`liquidityRate = variableBorrowRate x utilisation x (1 - reserveFactor)`. With the
reserve factor of this deployment (`1000` bps = 10%, from
`getReserveConfigurationData`):

```
supply   4.1196%      utilisation 91.8473%      borrow 4.9876%
4.9876 x 0.918473 x 0.9 = 4.1228%      difference 0.0032 pp = the strategy spread
```

The response carries that number in `reconciliation`, with `agrees`. The
application does not reconcile it to be decorative: `agrees: false` is the signal
the frontend uses to **not show a rate at all** (`displayableSupplyApr` becomes
`null` on the client), because a rate that cannot be reproduced from the rest of
the reserve is exactly what a misaligned decode produces.

### `unreadable` is not `0`

Every field carries its own state. A reserve that could not be read answers 200
with `status: "unreadable"` and a bounded `reason`
(`RPC_UNAVAILABLE`, `RPC_REJECTED`, `RPC_MALFORMED_RESPONSE`,
`RESERVE_DECODE_FAILED`, `CONFIG_UNREADABLE`); the provider's own words go to the
log. A position of `0` answers `status: "ok"` with `raw: "0"`. The two are different
truths and the screen is told which one it has. One trap worth naming: a `0n` is
falsy, so the application tests `'ok' in result` and **not** truthiness — otherwise
a real zero position is reported as a failed read.

## `POST /api/pool/deposit` — the unsigned transactions, built here, signed there

Request: `{ "amount": "1000000" }` — the amount in the **smallest unit**, as a
decimal string. No decimal fraction is accepted: there is nothing to convert, so
there is nothing to get wrong.

Response:

```json
{
  "chainId": 143,
  "address": "0x…",
  "asset": { "symbol": "USDC", "unit": "USDC", "decimals": 6 },
  "amount": { "raw": "1000000", "amount": "1", "decimals": 6, "unit": "USDC" },
  "approvalRequired": true,
  "allowance": { "status": "ok", "value": { "raw": "0", "amount": "0", "decimals": 6, "unit": "USDC" } },
  "transactions": [
    { "purpose": "approve", "to": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      "data": "0x095ea7b3…", "value": "0", "chainId": 143 },
    { "purpose": "deposit", "to": "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
      "data": "0xe8eda9df…", "value": "0", "chainId": 143 }
  ],
  "gasBalance": { "status": "ok", "value": { "raw": "3000000000000000000", "amount": "3", "decimals": 18, "unit": "MON" } }
}
```

- **`approve` first, then `deposit`,** in that order, because the deposit reverts
  without the allowance.
- **The approval is the exact amount**, never `2^256 - 1`. An infinite approval is
  a standing permission that outlives this deposit and nobody asked for one.
- **`onBehalfOf` is the address from `rewallet.wallets`.** No request parameter can
  change it: the body carries only `amount`, and an `address` or an `onBehalfOf` in
  the body or the query is not read.
- **Already approved → `approvalRequired: false`** and the `approve` is absent from
  `transactions`, so the app skips that signature. An allowance that could *not* be
  read keeps the approval: an unnecessary one costs a signature, a missing one costs
  the deposit.
- **Refusals**, one code per distinct fact: `AMOUNT_INVALID`, `AMOUNT_NOT_POSITIVE`,
  `AMOUNT_EXCEEDS_BALANCE`, and `BALANCE_UNREADABLE` — which is *not* "you have
  nothing": an unreadable balance never becomes a zero one.

| Status | When |
|---|---|
| 400 | the amount is refused (one of the codes above) |
| 401 `UNAUTHENTICATED` | no cookie, or a cookie that does not verify |
| 502 `WALLETS_UNAVAILABLE` | the wallet rows could not be read: no address, nothing to sign |

The route is mounted only when **both** use cases are wired: a deposit route next
to a read that cannot answer would be a deposit nobody priced.

### Environment

`MONAD_POOL_RPC_URL` is optional and **defaults to `https://rpc.monad.xyz`**, the
same endpoint the Monad balances already use. Like the other RPC overrides, it
adds a candidate endpoint ahead of the defaults; a public endpoint going down is a
per-field `unreadable`, not a Worker that cannot boot.

### What is not proven

No signed transaction has gone through this path. The calldata is asserted against
composed ABI words, the amounts and the balances come from an injected reader, and
the signing itself happens in Privy in the browser — on a machine with a real
wallet and real MON. `gasBalance` is reported so the screen can say **"no tenés MON
para el gas"** *before* the first signature; nothing here estimates gas, because
an estimate that guesses wrong costs the person the deposit.

## Layout

```
src/
  domain/ports/        the interfaces: what the application needs, in our words
  domain/deposit/      the deposit catalog: what can be received, where, and the
                       per-token balance-readability flag
  domain/pool/         the Aave V3 Monad addresses, the twelve-output reserve
                       decode, the RAY arithmetic, the deposit calldata
  domain/webhooks/     the signature scheme, the event→sentence table, attribution
  application/         the use cases: session minting, wallet claiming, portfolio
                       reads, deposit catalog, webhook intake, notification feed,
                       pool read and deposit preparation
  infrastructure/      the adapters: Privy, Postgres, JWT, JSON-RPC balance reads,
                       and the Aave pool reader
  interface/http/      Hono: routes, cookies, the error boundary
  container.ts         reads config, builds adapters, wires the app
  index.ts             the Worker's `fetch`
test/                  mirrors src, with every port stubbed
sql/                   idempotent migrations for tables this project added to
build.mjs              the esbuild build that produces dist-worker.js
wrangler.jsonc         name, main, routes, assets, compatibility flags, secrets note
```
