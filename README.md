# Re Wallet™ — a dollar account for people who don't know crypto

> **Live beta:** https://beta.rewallet.win · **Landing:** https://rewallet.win
> **Spanish version of this document:** [README.es.md](./README.es.md)

---

## The problem

In Argentina, saving in dollars means cash under the mattress or handing your money to an app that takes custody of it. Crypto wallets ask for seed phrases, network selection and gas fees — the people who actually need to protect their savings don't use them.

The problem is not access to dollars. **It is trust.** Every existing option asks the saver to believe a number on a screen.

## The product

Re Wallet is a dollar account with an email login:

1. **You sign up with your email.** Privy creates an embedded wallet for you — no seed phrase, no extension, no network to choose.
2. **You see your dollars.** USDC on Solana, plus the rest of your crypto, one balance.
3. **Send to an @tag.** You send to `@sofia`, not to a 44-character address. It is a real SPL transfer on Solana, signed in your browser.
4. **Your dollars earn.** Balances can sit in yield venues (Kamino on Solana, Aave on Monad) and the app shows the position as read from chain.

### Honest balance — the differentiator

Every number in the app is read from the chain or it is not shown. When a read fails, the app says so:

- It never renders a `0` where the truth is "we could not read it". A zero is a claim about someone's money.
- It never derives a price in the browser. Quotes come from the backend, and an unreadable quote is shown as unreadable.
- Each failure carries its **cause**: "no route for this pair", "not enough liquidity", "the network did not answer" and "this deployment is not configured" are four different sentences, because they are four different facts.
- The transfer screen always shows the transaction hash and links to the explorer. An unverifiable send is a promise, not a send.

## How it uses Solana

Solana is not decoration here; it is where the dollars live and move.

- **USDC as a real SPL transfer.** `POST /api/send/prepare` builds an unsigned Solana message server-side with the reference client (`@solana/web3.js`): the sender's associated token account, the recipient's ATA (created if missing) and a **`TransferChecked`** instruction — checked, so the token program verifies the mint and the decimals on chain instead of trusting the caller.
- **Signed by the user's own embedded wallet.** The browser receives the compiled message bytes and calls `signAndSendTransaction` through Privy. The app never holds a private key and never signs on the user's behalf; the session cookie authenticates the API, not the money.
- **The signature is the receipt.** The base58 signature returned by the wallet is what the screen shows, with a link to `explorer.solana.com`. That is the same identifier any judge can open and verify without believing us.
- **Solana balances and yield are read, not assumed.** Lamports and SPL balances are read over JSON-RPC; the Kamino Earn vault is read from chain (and its share price from Kamino's public API). If the RPC fails, the balance says it failed to read.
- **Cluster is configuration, not a constant.** Mainnet by default; a `SOLANA_CLUSTER` value switches the deployment to devnet for demos, together with the devnet USDC mint and the devnet genesis hash — one place decides, so a prepared message can never be signed against a different ledger than the one the app says.

**On fees, honestly:** today the wallet pays the standard Solana network fee (a fraction of a cent) and the app refuses the send with a clear message when the wallet has no native balance to pay it. Sponsored gas, so a user never needs to hold SOL, is the next step — not a claim in this README.

## Architecture

```
                       ┌──────────────────────────────────────────────┐
   Browser (mobile)    │  React SPA (Vite)                            │
   ─────────────────   │  · Privy email login + embedded wallets      │
                       │  · signs Solana messages with the user wallet │
                       │  · shows hash + explorer link after signing   │
                       └───────────────┬──────────────────────────────┘
                                       │ same origin (httpOnly __Host- cookie)
                                       ▼
                       ┌──────────────────────────────────────────────┐
   Cloudflare Worker   │  Hono API + static assets, one origin        │
   ─────────────────   │  /api/auth  /api/portfolio /api/send         │
                       │  /api/pool  /api/payment-requests            │
                       │  /api/wallet/policy  /api/wallet/swap        │
                       └───┬───────────────┬──────────────┬───────────┘
                           │               │              │
                    ┌──────▼─────┐  ┌──────▼──────┐  ┌────▼─────────┐
                    │ Privy      │  │ Solana RPC  │  │ Neon         │
                    │ users +    │  │ balances,   │  │ Postgres     │
                    │ wallets    │  │ SPL, Kamino │  │ users, sends │
                    └────────────┘  └─────────────┘  │ policy log   │
                                                     └──────────────┘
                    EVM + Monad: JSON-RPC balance readers, Aave V3 pool
                    Swap (Monad): Uniswap Trading API for real quotes
```

**Why one origin:** the session is an httpOnly `SameSite=Lax` cookie with a `__Host-` prefix. Two origins would force `SameSite=None` plus credentialed CORS — the exact pair of security downgrades this design refuses.

## Stack

`Solana` · `USDC (SPL)` · `@solana/web3.js` · `Kamino` (yield positions) · `Privy` (email auth + embedded wallets) · `Cloudflare Workers` (API + assets) · `Neon Postgres` · `React + Vite + TypeScript` · `Hono` · `Aave V3 + Monad` (secondary yield) · `Uniswap Trading API` (Monad swap quotes)

## Repository layout

```
05. UI-UX/        the app (React + Vite + TypeScript, tests with Vitest)
07.PockBackend/   the API (Hono on Cloudflare Workers, Neon Postgres)
04. Landing Page/ the public landing site
07.PockBackend/sql/  schema and migrations
docs/             contracts and decisions (in Spanish)
odd/tasks/        the task record for each feature
```

## Run it in under five minutes

Prerequisites: Node 20+, a Postgres database (Neon works), and a Privy app id.

```bash
# 1. API
cd 07.PockBackend
npm install
cat > .env <<'ENV'
DATABASE_URL=            # Neon or any Postgres
PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_WEBHOOK_SIGNING_SECRET=
SESSION_SECRET=          # openssl rand -base64 48
SOLANA_RPC_URL=          # optional: public default, verified
SOLANA_CLUSTER=          # optional: mainnet (default) | devnet
ENV
npm test                  # 935 tests, no network, no database required
npm run build             # bundles the Worker (esbuild → dist-worker.js)
npx wrangler dev          # serves /api locally

# 2. App
cd ../05. UI-UX
npm install
cp .env.example .env      # VITE_PRIVY_APP_ID (+ VITE_API_BASE_URL for a remote API,
                          #  VITE_SOLANA_CLUSTER=devnet for a devnet demo build)
npm test                  # 241 tests
npm run dev               # http://localhost:3000
```

Deploy: `npm run build && npx wrangler deploy` from `07.PockBackend` (the Worker serves the SPA from `05. UI-UX/dist` **and** the API, so there is one origin and one certificate).

## Trust & compliance

- **Who signs, who holds.** The user's embedded wallet signs every transfer; Re Wallet never holds the private key and cannot move funds without the user's signature. The backend prepares unsigned messages and reads balances. The session cookie authenticates the API — it is not a spending permission.
- **Yield is variable and sourced.** Rates come from the venue (Kamino's vault, Aave's reserve) and are shown with their source and as a projected annual figure, never as a promise. There is no "always growing" claim in the product.
- **No hidden numbers.** If a read fails, the app shows the failure and its cause. This is also what makes support possible: the failure has a code, and the code is logged.
- **Data.** The app stores the user's email, tag and wallet addresses in Postgres, and the RPC providers see the addresses that are read. There is no selling of data and no third-party analytics beyond Cloudflare's own.
- **Regulatory posture (open item).** A product that receives dollars and routes them to yield may fall under local PSAV/registration rules in Argentina. We treat this as a pre-launch requirement, not a detail: the current deployment is a public beta with test-scale balances, and legal review is scheduled before any real-money onboarding.

## What works today, and what is next

**Works end to end today:** email login with embedded wallets · balances read from chain (Solana + six EVM networks) · USDC send to an @tag on Solana with the signature on screen · send on Monad · yield positions read from Kamino and Aave · payment requests with a QR/link · spending policy evaluated before signing.

**Next, in order:**

1. **Kamino deposit execution.** The prepared transaction deliberately reports `executes: false`: the vault's two Farms instructions do not have an authoritative layout we could verify, and we refuse to build a money transaction we cannot validate. Reads and the deposit message exist; the executing path lands when the layout is verified against the on-chain program.
2. **Sponsored gas on Solana**, so a new user never needs SOL.
3. **Solana Pay for the "Cobrar" QR**, so a payment request is an ecosystem standard instead of a custom payload.
4. **Local peso ramps** in and out — without them the product does not serve an Argentine saver.

## Evidence

| What | Where |
| --- | --- |
| USDC send to an @tag on Solana (signature) | `<paste explorer.solana.com signature URL>` |
| Kamino deposit (labeled next, see above) | — |
| Live beta | https://beta.rewallet.win |
| Demo video (≤3:00, English) | `<paste YouTube link>` |
| Pitch (2:00, English) | `<paste link>` |

## Team

- **Joaquín** — architecture and backend (Cloudflare Workers, Solana integrations, policy engine)
- **Facundo** — product and growth
- **Santiago** — finance and operations

Buenos Aires, Argentina.

## License

See [LICENSE](./LICENSE).
