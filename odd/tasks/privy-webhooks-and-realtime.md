# Feature: Privy webhooks, and the real-time path

## What the SDK actually says, measured rather than pasted

The event vocabulary was read out of the installed `@privy-io/node@0.35.0`, not
from a document. The SDK declares **66 event types**, extracted mechanically from
`node_modules/@privy-io/node/resources/webhooks.d.ts`:

```
intent.*               5
mfa.*                  2
transaction.*          7
usage.*                2
user.*                10
wallet*               40
```

A test asserts the registry still equals the SDK's declared set, for the same
reason the chain registry has one: a hand-typed list rots silently, and the failure
looks like a Privy bug rather than a stale file here.

The list that motivated this feature is a **subset**. Present in the SDK and
absent from it: `user.deleted`, `user.kyc.updated`, `user_operation.completed`,
`transaction.provider_error`, `wallet.automation.submitted`, the whole `intent.*`
family, `wallet_action.earn_withdraw.*` / `earn_incentive_claim.*` /
`earn_fee_collect.*`, `yield.*`, `kraken_embed.*` and `wallet_deposit_account.*`.

## How a Privy webhook is actually verified

**Svix.** Not a bespoke signature: Privy delivers through Svix, and the headers
are `svix-id`, `svix-timestamp` and `svix-signature`. Verification is the Svix
scheme over `{svix_id}.{svix_timestamp}.{body}`, and the timestamp is checked
against a tolerance so a captured request cannot be replayed forever.

Two things about the installed SDK, both discovered rather than assumed:

- `client.webhooks` exposes ONLY `unsafeUnwrap`. The name is the warning: it parses
  a body and returns it, and **nothing else**. A webhook endpoint built on it is a
  write endpoint for anybody on the internet.
- The real verifier, `PrivyWebhooksService.verify`, exists at
  `public-api/services/webhooks.mjs` and is **not exported** from the package root
  in 0.35.0. Reaching it would mean a deep import into a path the SDK is free to
  move.

So the adapter uses `svix` directly — the same library the SDK itself uses,
installed as its dependency — rather than a private path. The scheme is then
visible in this codebase instead of hidden behind a method that may be exported
next version or never.

**The signing secret is the whole security boundary.** Without it there is no way
to tell a webhook from a stranger with a POST, and this product's webhook writes
to a database. An endpoint with no configured secret refuses everything rather than
accepting unsigned events, and says which setting is missing.

## Why persist before reacting

The `webhook_events` table already exists with `signature_valid`, `processed_at`
and `error`. That shape is the reason for the order: **the event is stored first
and reacted to second.**

A webhook that updates a balance and then finds its handler broken has lost the
event, and Privy will not redeliver a 2xx. Storing first means the reaction is
re-runnable from the ledger, and an event that arrived while a handler was broken
is still there afterwards. A handler that reacts inline and then crashes has
destroyed the evidence.

## Architecture

Hexagonal, and the arrows point the same way as everywhere else in this backend.

```
interface/http/webhookRoutes.ts      ← Hono; no knowledge of Svix or of Drizzle
application/webhooks/receiveWebhook  ← verify, persist, then react
domain/ports/webhook-store.ts        ← the port the ledger is written through
infrastructure/webhooks/svixVerifier ← the Svix signature check
infrastructure/db/webhookStore.pg    ← the `webhook_events` table
```

The route does not know what a signature is, and the store does not know what
Svix is. The use case is the only place that knows both, and it is the only place
that decides what an event MEANS.

## What "real time" is here, precisely

Not a WebSocket. A WebSocket is a real product decision — connections, reconnect,
fan-out, and a place to hold state in memory that a deploy throws away. It comes
after the events are being stored correctly, not before.

What this feature delivers is the **condition a real-time layer needs and the
product cannot have without it**: a durable, verified, ordered ledger of what
happened, and a way for the client to learn about it. The client polls that, and
when the ledger proves out, the polling is replaced by a push and nothing above it
changes — because the read is a read either way.

Polling a public RPC every few seconds is what the events REPLACE. Polling this
product's own database is a different cost, and it is the one this feature keeps.

## Tasks

### T1 — The vocabulary and the port

- [x] `domain/webhooks/events.ts` — the event registry, asserted against the SDK
- [x] `domain/ports/webhook-store.ts` — the ledger port
- [x] The events THIS PRODUCT acts on, which is a small subset of the 66

### T2 — Verification, and refusing without a secret

- [x] `infrastructure/webhooks/svixVerifier.ts` over `svix`, with the replay
      tolerance written next to it
- [x] No secret configured ⇒ refuse every request, with the missing setting named
- [x] Tests: a valid signature passes, a tampered body fails, a stale timestamp
      fails, a missing secret fails

### T3 — Receive, persist, then react

- [x] `application/webhooks/receiveWebhook.ts` — verify, store, then hand off
- [x] The store writes `signature_valid`, and an unverified event is NOT stored as
      valid
- [x] A react step that is allowed to fail without losing the event

### T4 — The route, and the read the client uses

- [x] `POST /webhooks/privy`, registered unconditionally in `createApp`
- [x] A read endpoint returning what happened, for the client to poll
- [x] Tests: the route is not a silent 404, an unsigned POST is refused

### T5 — The client

- [x] Learn about events, and refresh the affected read when one arrives
- [x] No polling of the chain — the events replaced that, and reintroducing it
      would undo the point

## Three things the implementation found, and one of them corrected a design

### The secret is base64, and the constructor throws

`new Webhook(secret)` base64-decodes the secret after the `whsec_` prefix. A
secret typed by hand — `whsec_test_secret`, which is what a developer writes first —
throws `Base64Coder: incorrect characters for decoding` at CONSTRUCTION. Unguarded
that is a 500 on every webhook, forever, and the log says nothing about a setting
being wrong. The constructor is now inside the same guard as the verify, and the
refusal says the setting is malformed. There is a test for it.

### An hour-wide replay window is not enforceable, and the design said otherwise

The verifier was written with a one-hour tolerance, on the reasoning that a late
`funds_deposited` is real and dropping it leaves a balance wrong. **It does not
work.** Svix asserts the timestamp against its own five-minute tolerance inside
`verify()`, so widening the window in this file changes nothing: the library
rejects the event first.

The two honest options are to accept five minutes, or to reimplement the signature
check so a wider window applies. The second is a cryptographic routine written by
hand for a window Privy themselves do not honour — a bad trade against a benefit
nobody asked for. So: five minutes, and a test that pins the behaviour so the
comment cannot become a false claim later.

**The late-delivery concern is not dropped, it is moved.** It belongs to the
`webhook_events` table, where an unprocessed row is visible and a reaction can be
re-run. A missed webhook is recoverable from the ledger; a hand-written signature
check is not recoverable at all.

### Svix uses the real clock, so an injected one tests a fiction

A test that injects `now` into OUR verifier does not make the LIBRARY's clock
injected. A fixed instant made every positive test fail with "Message timestamp too
new", thrown by Svix itself. The tests use the real clock and the injection stays
only where it helps.

## Evidence

- **66 event types** declared by `@privy-io/node@0.35.0`, extracted mechanically
- **Svix is the delivery mechanism**, verified by reading the SDK's own
  implementation rather than a blog post
- **13 verification tests**, all passing, and the happy path is not the one that
  matters: ten of them are ways a stranger's POST gets refused
- **460 backend tests, 459 passing**; the one red is still the `.env.example` line

```
Test Files  1 failed | 35 passed (36)
Tests       1 failed | 459 passed (460)
```

## Closed on 2026-09-29: what the last three tasks found

### The response said `processed: false` for the event it had just processed

`result.event` is the row **as the ledger held it before the reaction ran**, and
that is deliberate: a reaction that crashes halfway must not have left evidence
that it finished. The route then published `processed: result.event.processedAt
!== null`, so the field reported `false` for an event the same request had just
processed and `true` for one that had been REJECTED. A boolean named `processed`
reporting the opposite of the truth in both directions, to the client that was
about to be written against it.

The fix is the outcome, not the row, because the outcome is what the use case
decided. The field is now `settled` — "will the ledger re-run this?" — and
`settled: false` is exactly the retry list plus the rejected rows.

### A test that broke when the product was used

`webhookContainer.pg.test.ts` read the SEEDED user and phrased its assertions
over that user's whole feed ("no `wallet.funds_deposited` in here"). Sound only
while `rewallet_test` holds nothing else — and it does not, because the same
database is the development one. Posting one genuine delivery during manual
testing turned two assertions red for a reason that had nothing to do with the
code under test.

A test that breaks when the product is used is a canary pointed the wrong way.
The file now creates and deletes its OWN user, which keeps the property the
assertions actually need (a real `users.id` beside a real `privy_did`, which is
the join under test) and drops the one they never needed: a shared feed.

### The delivery-id key was written twice, and a test was asked to hold it

The use case writes `rewallet_delivery_id`; the store reads it; neither may
import the other, so the literal was duplicated with a test asserting the copies
agreed. That is a promise someone has to keep. It is now ONE constant in
`domain/webhooks/delivery.ts` — the layer both sides may depend on — with
re-exports so no import site had to move. **A test pinning two copies is a
promise; a shared constant is a fact.**

### The secret is not in the environment, so the route refuses everything

`WEBHOOK_SECRET_PRIVY` is a real setting that was never set locally, and the
container was not receiving it from `index.ts` at all. Fail-closed, therefore
correct — but indistinguishable from a working setup. The call site now passes it,
and the end-to-end proof below runs with a locally generated throwaway secret,
because a proof that needs a dashboard login is a proof that never runs.

## Proof, against a running server, signed by Svix itself

`Webhook.sign` — the same call Privy makes — posted to the real route, read back
out of the real ledger:

```
1. signed delivery           200 outcome=processed
2. redelivery, same svix-id  200 outcome=alreadyProcessed   (ONE row, not two)
3. forged signature          400 webhook_signature_rejected
4. tampered body             400 webhook_signature_rejected
```

and in `rewallet.webhook_events`, the rejected ones are stored with
`signature_valid = false` and the reason on the row, which is what keeps them off
the retry list and out of every client read.

```
 Test Files  41 passed (41)
      Tests  506 passed (506)
```

The one red that had been open since the native-history feature — an
undocumented `MONAD_ARCHIVE_RPC_URL` in `.env.example`, whose comment block had
been mangled into something that was not a comment — is fixed. The suite is
green for the first time in this project.

## What the client does with an event, and what it deliberately does not do

`decideFromEvents` is pure and never reads `type`: the backend already decided
per event whether a number on screen is stale (`invalidatesBalance`), and a second
vocabulary on the client is how it ends up refreshing on an event that changes
nothing. A new, unseen, balance-invalidating event calls the same refetch the
visibility change calls. There is **no timer**: the driver is the focus/visibility
refetch plus one silent read to establish the cursor, and a timer would ask on
tabs nobody is looking at.

The customer sees one line, `● Saldo actualizado`, with `aria-live="polite"`, gone
after eight seconds. It says what the APP did, never what the event was: naming a
transfer there would be a second Privy vocabulary in the UI, and the movement with
its receipt already lives in Actividad. A line that says "we just refreshed" and is
still there four minutes later is a claim that stopped being true.

Without a session — which is the case today, because the front end still
authenticates through `MockAuthProvider` — the read 401s and the client stands
down silently: no spinner, no toast, no lost screen, cursor not advanced, and
`useRefetchOnFocus` still refreshing exactly as before. **The real-time path is
complete and correct, and it is currently invisible in the app because there is no
session to see it with.**
