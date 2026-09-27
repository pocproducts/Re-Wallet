# Deploy a Cloudflare Workers

**Feature**: `deploy-workers`
**Estado**: groundwork listo, falta lo interactivo
**Fecha**: 2026-09-27

---

## Lo que está hecho

| Archivo | Qué es |
|---|---|
| `apps/api/wrangler.toml` | Configuración del Worker, con Hyperdrive y las vars públicas |
| `apps/api/src/worker.ts` | Entry point del Worker: `export default { fetch }` |

Dos entradas, un solo app: `src/index.ts` para Node local (`serve()` + `.env`) y
`src/worker.ts` para `workerd` (que no tiene puerto ni filesystem). Las dos
delegan en el mismo `createApp()`, así que **el comportamiento no puede diferir
entre local y producción** — que es la forma de que un bug solo aparezca en prod.

## Hallazgos que cambiaron el plan

**1. El driver de base de datos NO hay que cambiarlo.** La tabla de drivers
soportados de Cloudflare incluye **Postgres.js desde `postgres@3.4.4`**; nosotros
estamos en 3.4.9, y Drizzle está soportado también. El documento de contexto decía
"no usar pg, usar postgres" y acertaba, pero por la razón opuesta a la que
implicaba: no es que `postgres` no funcione, es que el que no funciona solo es
`pg` para Hyperdrive en versiones viejas.

**2. `nodejs_compat` es implícito.** Se activa por defecto para
`compatibility_date` ≥ 2026-08-04, y el nuestro es 2026-09-27. El documento de
contexto dice de agregarlo a mano; con esta fecha sobra.

**3. La RPC pública de Monad limita `eth_getLogs` a 100 bloques** (verificado:
error `-32614`). Es una restricción de diseño del indexer, no un detalle: va a
paginar en ventanas de ≤100 bloques. Y esa RPC **no tiene estado histórico**, así
que localizar una transacción vieja por bisección no es una opción.

## Lo que falta, y por qué lo hago yo y vos

`wrangler login` abre un navegador. Eso no lo puedo hacer yo, y **ningún paso
interactivo del deploy es automatizable**. Todo lo demás ya está escrito.

## Pasos, en orden

### 1. Instalar y autenticar

```bash
npm i -g wrangler
wrangler login
```

### 2. La base de datos

Dos caminos. El primero es el que da `$0` y el que ya está cableado:

```bash
# Crear una base en Neon (free tier) desde el panel, copiar el connection string
wrangler hyperdrive create rewallet-db --connection-string='<EL_STRING_DE_NEON>'
# devuelve un id -> ponerlo en wrangler.toml, en [[hyperdrive]] id
```

Alternativa si no querés usar Neon todavía: `wrangler secret put DATABASE_URL` con
la cadena de la base de Docker. El código ya tiene ese fallback, para que
`wrangler dev` y un smoke en una laptop funcionen sin Hyperdrive.

### 3. Migraciones contra la base remota

Las migraciones se corren **desde la máquina**, no desde el Worker: drizzle-kit
habla TCP directo.

```bash
DATABASE_URL='<LA_DE_NEON>' pnpm --filter @bestpath/api db:migrate
```

### 4. Secrets — uno por uno, y ninguno en el repo

```bash
cd apps/api
wrangler secret put PRIVY_APP_ID
wrangler secret put PRIVY_APP_SECRET
wrangler secret put PRIVY_VERIFICATION_JWKS
wrangler secret put PRIVY_WALLET_AUTH_PRIVATE_KEY   # la authorization key
wrangler secret put PRIVY_WALLET_OWNER_ID           # el key quorum
wrangler secret put SESSION_SECRET
wrangler secret put WEBHOOK_SECRET_PRIVY
```

⚠️ **`PRIVY_WALLET_AUTH_PRIVATE_KEY` es la que apareció en el chat de
desarrollo.** Hay que revocarla en el panel de Privy y emitir otra ANTES de este
paso. Deployarla así sería publicar una credencial que ya es pública.

### 5. Deploy y dominio

```bash
wrangler deploy
```

Después, en el panel: **Workers → rewallet-api → Settings → Domains & Routes →
Add Custom Domain** → `api.rewallet.win`.

### 6. Los dos ajustes que solo funcionan en el dominio real

- **Privy → Allowed origins**: agregar `https://api.rewallet.win`. `localhost` se
  queda, si no dejamos de poder desarrollar.
- **Cookie**: `COOKIE_DOMAIN` vacío (host-only) y `COOKIE_SECURE=true` (ya está en
  las vars). Con `COOKIE_DOMAIN=localhost` la cookie no viaja a ningún otro
  dominio y el login queda roto **sin error visible**.

### 7. La web, que es una historia aparte

El frontend es Vite: se builda (`pnpm build`) y se sirve estático. En Cloudflare
eso es **Pages** o un bucket en R2, no el Worker. Decisión a tomar: Pages
gratis con deploy desde GitHub, o servir el `dist/` desde el mismo Worker.

## Pendiente que bloquea el login real

**El passkey necesita un origen HTTPS con dominio registrable, y `rewallet.win` ya
lo es.** Con la API en `api.rewallet.win` y la web en `rewallet.win`, abrir la
webapp **en el teléfono** completa la ceremonia: el teléfono tiene dónde guardar
la credencial, que es exactamente lo que en localhost no pasaba.

## Lo que NO va a funcionar en Workers, y ya lo sabemos

| Necesita | Por qué no | Qué va en su lugar |
|---|---|---|
| `d1 generate` para leer el `.env` | no hay filesystem | `wrangler secret put` + bindings |
| `child_process` | no existe | nada |
| timers largos | límite de CPU por request | `triggers.crons` |
| un solo `eth_getLogs` grande | la RPC limita a 100 bloques | paginar |
