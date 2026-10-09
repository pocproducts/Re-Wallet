# Feature: multi-chain wallets, and the order they may be created in

## The constraint that makes this irreversible

Privy's documentation, quoted:

> *"If your app uses both Ethereum and Solana embedded wallets, you must create
> the Ethereum embedded wallet first before creating a Solana embedded wallet. If
> you create a Solana embedded wallet first, you will not be able to create an
> Ethereum embedded wallet later."*

**That is not a recommendation. It is a documented restriction, and getting it
wrong is permanent for that user.** There is no migration and no support path:
the EVM slot is gone the moment a Solana wallet exists on the account.

It is therefore not a property of this schema. It is a property of the ORDER in
which this product provisions wallets, and the schema has to be able to ENFORCE
that order rather than merely permit it.

### Audited on 2026-09-29, before writing any of this

A provisioning attempt during this session created five Solana wallets in the
real Privy app while isolating an API failure. The consequence of the rule above
would have been five permanently EVM-less users, so the app was audited before
anything else:

```
usuarios: 2
wallets VINCULADAS a algun usuario: 0
wallets totales en la app: 16   (11 preexistentes + 5 de esta sesion)
NINGUN usuario esta bloqueado: ninguna wallet Solana quedo vinculada.
```

All of them are UNOWNED, and the reason is measured rather than lucky: a
user-owned wallet requires a valid access token FROM THE USER, so a server
holding only app credentials cannot produce one. The failure mode of the
constraint above is therefore gated behind real authentication — which is exactly
where a product wants it gated.

The same audit turned up `0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6` already
present in Privy, which is the same address this project uses as its development
watch address.

## Privy's chain vocabulary, and the tiers

`WalletChainType` from `@privy-io/node@0.35.0`, verbatim:

```
ethereum | solana | cosmos | stellar | sui | aptos | movement | tron
bitcoin-segwit | bitcoin-taproot | pearl | near | ton | starknet | xrpl | spark
```

**`ethereum` means EVM, not one chain.** Privy has a single key for every
EVM-compatible chain, so a Monad wallet is `chain_type = 'ethereum'` and the
network is a separate concern. A schema that stored `monad` in that column would
disagree with the provider about every wallet it holds.

| Tier | Capability | Chains |
| --- | --- | --- |
| 3 | send transactions | EVM (any), Solana, Tempo, Base, Arbitrum, HyperEVM, Eclipse |
| 2 | sign transactions | Aptos, Sui, Tron, NEAR, others |
| 1 | sign only | Bitcoin (SegWit), Spark, Stellar, Cosmos, Starknet, TON |

EVM and Solana come from `createOnLogin`. Tier 2 and Tier 1 do NOT exist on login
and are created on demand — a user does not need a Bitcoin wallet on day one, and
giving them one is a claim this product cannot make about what they want.

## What the schema does today, and why it cannot hold this

```sql
user_id  UUID NOT NULL UNIQUE          -- una wallet por persona
CHECK (address ~ '^0x[a-fA-F0-9]{40}$') -- solo hex EVM
```

Two constraints, and each one is a wall:

- **`UNIQUE (user_id)`** makes a second wallet impossible, so a user can never
  hold an EVM address AND a Solana address.
- **The CHECK rejects base58.** A Solana address is 32 bytes in 43-44 printable
  characters with no `0x`, so it cannot be stored at all.

And there is no column that says WHICH chain a row is, so even with both
constraints relaxed nothing could tell an EVM row from a Solana one. Every read
above the database assumes a single EVM address: `UserProfileData.walletAddress`
is one string, the profile truncates it as `0x`+40, and the client's own address
check is `^0x[0-9a-fA-F]{40}$`.

## The design

**`chain_type` with Privy's vocabulary, as an enum in the database.** Not a free
text column and not a `network` column: the value has to be comparable with what
the provider says, and an enum makes an unsupported chain a write that fails
instead of a row nobody can read.

**A family-aware address CHECK.** `chain_type` decides the format: EVM is hex,
SVM is base58, and the rest have their own shapes. A single regex would either
reject valid addresses or accept anything, and both have already been a bug in
this project.

**`UNIQUE (user_id, chain_type)`** replaces `UNIQUE (user_id)`. A person may hold
one wallet per chain, and may hold several EVM wallets on different networks.

**The order is enforced, not documented.** A partial unique index cannot express
"no Solana row before an EVM row exists" on its own, so the rule is enforced where
it belongs: a creation path that refuses to provision a non-EVM chain for a user
who has no EVM wallet. A database that merely permits the order leaves the
permanent mistake one deploy away.

## Tasks

### T1 — The chain vocabulary, in one place

- [x] `domain/chains/registry.ts` — Privy's `WalletChainType` verbatim, and the
      four ADDRESS FAMILIES rather than seventeen regexes
- [x] `CREATION_ORDER`, with EVM first and the reason it is first
- [x] A test asserting the registry and the SDK's declared type AGREE. Verified it
      fails: adding a chain Privy does not have fails the build, and putting
      Solana first fails the build.

### T2 — The wallets table

- [x] `chain_type` column, declared LAST on purpose (see below)
- [x] `UNIQUE (user_id)` becomes `UNIQUE (user_id, chain_type)` — **one wallet per
      CHAIN per user**, which is what the product owner specified and what Privy's
      vocabulary makes possible
- [x] The address CHECK is family-aware: EVM hex, SVM base58 32-44, Cosmos
      bech32, and a deliberately loose one for the sign-only chains
- [x] Migration `0001_multi_chain_wallets`, applied to the test database
- [x] The reference DDL updated, because the schema file states the patterns are
      byte-for-byte the ones in the DDL
- [x] Proven against a REAL Postgres, not read off the schema:

```
PERMITE   1ra EVM                          RECHAZA  2da EVM  (otra dirección)
PERMITE   1ra Solana                       RECHAZA  2da Solana (otra dirección)
PERMITE   Bitcoin (primera de esa cadena)
wallets del usuario: bitcoin-segwit, ethereum, solana   TOTAL: 3
```

- [x] The database also REFUSES the conflation this feature ends: a Solana address
      in the `ethereum` chain, and an EVM address in `solana`.

### Two things the work surfaced that are worth stating

**`ALTER TABLE ADD COLUMN` appends, so a migrated database and a fresh one
disagree on column order.** `chain_type` is therefore declared LAST, not next to
`address` where it reads better — so the schema and a live database can be
compared at all, which is what `test/db/schema.test.ts` does.

**A generation bug of mine, caught by the database rather than by review.**
`inList()` already returns a bare `'a', 'b'` list, and I wrapped it in `literal()`
again, which produced `IN ''a', 'b''` — a doubled quote written straight into the
migration and rejected with a bare syntax error. The `IN` list is now wrapped once,
in parentheses.

### T3 — The order, enforced

- [x] `domain/chains/provisioning.ts` — `decideProvision`, a pure function over
      the wallets a user already has. Refuses a non-EVM chain when no EVM wallet
      exists, and the refusal message says the failure is PERMANENT.
- [x] 10 tests, and the central one asserts the REFUSAL rather than the creation
- [x] `scripts/privy-provision-wallet.ts` consults it BEFORE calling the provider,
      and stops

Proven in the tool itself, against the real app:

```
  usuario: did:privy:cmuk1b8ek...
  cadena : solana
  NO SE CREO: No se puede crear una wallet de solana antes que una EVM. ...
               makes an Ethereum embedded wallet impossible for that user PERMANENTLY

  cadena : ethereum
  wallet creada: 0xdC8c76DaD5A5695b73ebf767FDCc0c8c38761505
```

**And it is deliberately fail-safe in a way worth knowing about.** Without a user
access token the script cannot SEE a user's wallets, so it cannot verify the
order, so it refuses every non-EVM chain. That is the correct direction to be
wrong in: the tool is useless for Solana until authentication exists, rather than
dangerous.

#### Why the rule is code and not a database constraint

Tempting, and worth recording why not. A trigger could refuse the second row, and
the failure would be a constraint violation surfaced as a 500 during a login, with
a user watching. A refusal is a decision with a sentence, and the person who made
the wrong call is the one who can understand it. The database's job here is
`UNIQUE (user_id, chain_type)`, which it already does.

### T4 — The reads that assumed one address

- [x] `domain/wallet/types.ts` — `WalletRef` (chain + address + provider id),
      `primaryWallet` as a DERIVED function, and a chain-aware address check
- [x] `AuthSession.wallets: readonly WalletRef[]` replaces `address: string`
- [x] `UserProfileData.wallets` replaces `walletAddress`
- [x] `mockProvider` produces TWO wallets — EVM and a base58 Solana — **EVM first,
      which is the order Privy requires**, so a mock can never teach the mistake
- [x] `ProfileView` draws one row per wallet with the CHAIN named next to it, and
      the copied state is the ADDRESS rather than a boolean, so two buttons and one
      flag do not tick at once
- [x] Profiles saved by an earlier build keep working: a stored `walletAddress`
      migrates on READ into an EVM wallet, and is not written back, because a read
      is not the place to mutate someone's stored profile

The chain is drawn, not implied. A bare `0xe40c...` and a bare `2B8Xm...` look the
same at a glance, and that difference is what decides which explorer a link opens.

### T5 — The wallets this session created

- [x] Audited before deleting: 17 wallets in the app, 0 linked to any user
- [x] Archived exactly the SIX this session created, by address, one by one
- [x] Did NOT touch the 11 that predate the session — one of them is
      `0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6`, the project's own watch address,
      which somebody created at Privy on purpose

```
wallets en la app: 11 (antes 17)
```

**The SDK's `wallets().archive()` is broken against the current API** — it answers
415 `Expected application/json request body`. The REST call
`POST /v1/wallets/{id}/archive` with `{}` works. Worth knowing before anything
tries to clean up from a script.

## T6 — Prepared for Solana, which is not a rewrite when it arrives

The chain a Solana balance needs plugs into a seam that already exists, and this
is what was laid so the arrival is an addition.

### The backend declares CHAINS, not just assets

`GET /wallet/assets` now carries a `chains` array beside `assets`:

```
ethereum         covered        0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6
solana           unsourceable
bitcoin-segwit   not-enabled
```

Three states, and the middle one is the point:

- `covered` — a read ran.
- `unsourceable` — this product is on this chain and has not wired the reader yet.
  A gap the current phase could close. **Solana is here, not `not-enabled`,**
  because it is decided, planned and provisioned: publishing it as "not enabled"
  would tell a customer we had not thought about a chain we are actively building
  for.
- `not-enabled` — Privy has the chain and this product has not reached it. A
  decision this phase made, which is a different sentence to a customer.

The declaration is published on the success path, the no-wallet path AND the
failed-read path. The success path is the one that could have been skipped — the
read worked, so what would a screen need to be told — and it is the path a client
sees almost every time.

### The catalogue and the chain list are separate facts

`ASSET_CATALOGUE` answers "which tokens are on screen" and `ENABLED_CHAINS`
answers "which chains can this product read". They happen to line up today — one
EVM reader and one native token — and that coincidence is exactly what would make
the next chain expensive: Solana needs a reader that is not about any token, and
it needs to be ABLE to need one before it needs one.

### The client can NAME the chain it could not read

A dash beside a row is unexplainable. The crypto category now says:

> "Tu Solana y tu Bitcoin todavía no los leems: todavía no conectamos esa red.
> Por eso el total de arriba no incluye nada de ahí."

The second half is the load-bearing sentence: it tells the customer the number
above is not the whole portfolio, which is why `cryptoTotalUsd` refuses to total
at all when a measured row has no valuation.

### The vocabulary collision that would have shipped

`COVERAGES` in the asset adapter already meant `covered | unsourceable |
unreadable`, and I first wrote the chain check against it. `not-enabled` would
have been rejected as unknown, and `unreadable` published for a chain — two
sentences a customer would read, both wrong. The two vocabularies are now separate
constants, with the reason written next to them.

## Evidence

The audit above, and the four measured API outcomes in
`scripts/privy-provision-wallet.ts`'s header:

```
users().pregenerateWallets(uid, {wallets:[{chain_type:'solana'}]})  -> FAILED: auth token
users().get(uid)                                                     -> FAILED: auth token
wallets().create({chain_type:'solana', owner:{user_id}})             -> 200, wallet NOT linked
wallets().create({chain_type:'solana'})                              -> 200, unowned
```
