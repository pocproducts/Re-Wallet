# ReWallet

Wallet custodia en el backend que deposita USDC en Aave v3 sobre Monad.
Passkey como única forma de entrar. El usuario nunca ve una seed, ni una private
key, ni la palabra gas.

## Estado

| | |
|---|---|
| Tests | **API 65/65 · Web 203/203** |
| Typecheck | 5/5 |
| Registro real | `201` con wallet en la TEE de Privy |
| Firma desde el server | verificada criptográficamente |
| Posición on-chain | legible; la tasa de Aave **no** se muestra a propósito |
| Deploy | groundwork listo, falta lo interactivo |

## Estructura

```
ReWALLET/
├── bestpath/                 el monorepo
│   ├── apps/
│   │   ├── web/              Vite + Preact (isla de Privy) + TS vanilla
│   │   ├── api/              Hono + Drizzle + Postgres
│   │   └── contracts/        Foundry — vacío
│   ├── packages/             shared · config · sdk
│   ├── wrangler.toml         (en apps/api) config del Worker
│   └── dev.sh                arranque local
├── odd/
│   ├── decisions/            ADRs: custodia, alineación del plan
│   └── tasks/                feature docs y la escalera de avance
└── *.md                      documentos maestros y sistema de diseño
```

## Puesta en marcha

```bash
cd "/home/lordbitcoin/Projects Web3/ReWALLET"
./dev.sh up
```

API en `:3000`, web en `http://localhost:5173`.

> Abrí siempre **`localhost`**, nunca `127.0.0.1`. Privy rechaza la IP literal y
> el login muere antes de WebAuthn.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta todos los workspaces |
| `pnpm test` | 203 web + 65 api |
| `pnpm typecheck` | `tsc --noEmit` en los 5 paquetes |
| `pnpm build` | Build de todos los paquetes |
| `pnpm db:migrate` | Aplica migraciones |
| `./dev.sh check` | Diagnóstico del entorno |

## Deploy

Hay **un solo Worker** que sirve la API y la web (`wrangler.toml`, en la raíz del
repo), y es una decisión, no una comodidad: la sesión es una cookie httpOnly con
`SameSite=Lax`, y con dos orígenes —Pages en `rewallet.win` y el Worker en
`api.rewallet.win`— esa cookie tiene que volverse cross-site (`SameSite=None`
más CORS con credenciales). Un solo origen lo evita y deja la auth como está.

El plan de Pages por separado, con el costo exacto, está en
`odd/tasks/deploy-workers.md`.

## Las siete reglas del repo

Cada una existe porque romperla costó un bug, no por estilo.

1. **La plata es `numeric(20,6)` en unidades enteras.** Nunca float.
2. **Todo POST que mueve plata exige `Idempotency-Key`.**
3. **La sesión es una cookie httpOnly.** El store nunca recibe un campo con forma
   de sesión, y hay una auditoría que lo hace fallar si alguien lo intenta.
4. **Un número que no se pudo verificar no se muestra.**
5. **Los errores salen siempre como** `{ ok: false, error, message, code }`.
6. **Nada hardcodeado.** Todo viene de env validado con Zod; el proceso se niega
   a arrancar con config inválida.
7. **Un 4xx de una API externa no prueba que nuestra parte esté bien.**

## Documentos

| Path | Qué hay |
|---|---|
| `odd/decisions/adr-001-custodia.md` | El modelo de propiedad de la wallet |
| `odd/decisions/adr-002-alineacion-plan-original.md` | Qué del plan original se confirmó, corrigió y descartó |
| `odd/tasks/app-functional-ladder.md` | Los peldaños de mock a funcional, con su estado |
| `odd/tasks/deploy-workers.md` | El deploy a Cloudflare, paso a paso |
| `bestpath/apps/web/ENVIRONMENT.md` | Variables del frontend y la regla de `localhost` |
| `ReWallet_UI_UX_Design_System_v1.md` | El sistema de diseño |

## Secrets

Ningún secreto está en el repo. `.env`, `.env.local` y cualquier `.env.<algo>`
(`.env.*`) están ignorados; `.env.example` sí se versiona y está vacío.

Si una clave se filtró —en un commit, un chat o una terminal— hay que
**revocarla**, no borrarla del working tree.
