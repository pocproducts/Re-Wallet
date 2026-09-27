# Escalera — de la app mock a la app funcional

**Feature**: `app-functional-ladder`
**Created**: 2026-09-27
**Regla del usuario**: una parte por vez, respetando la arquitectura de backend,
para que cuando lleguen los contratos on-chain esté todo ordenado.
**Deadline**: 2026-10-13

Cada peldaño dice qué hay que poder **ver o hacer** para darlo por terminado. Un
peldaño con el backend listo y el cableado hecho, pero sin forma de comprobarlo,
no está terminado.

| # | Peldaño | Backend | Frontend | Estado |
|---|---|---|---|---|
| 1 | Ver la app con datos reales | listo | login real sin probar | **en curso — falta el smoke en browser** |
| 2 | E2E del contrato de auth | escrito | escrito | **HECHO** — encontró 3 bugs |
| 3 | Perfil real | `PATCH /auth/profile` OK | mock | pendiente |
| 4 | Contactos reales | rutas stub (`items: []`) | mock | pendiente |
| 5 | Plata (depositar/enviar) | devuelven `null` | mock | pendiente (lo grande) |
| 6 | Yield real | falta leer Aave | mock | pendiente |
| — | Deploy a Cloudflare | groundwork listo | — | **en curso** (`deploy-workers.md`) |

---

## Peldaño 1 — estado exacto

**Hecho hoy**
- `apps/web/.env.local` con `VITE_PRIVY_APP_ID=cmujipdcj04ba0cl73basud0z`. El
  backend ya tenía ese mismo App ID en `.env`: los dos lados coinciden.
- El probe corre **siempre**, incluso en la rama de dev. Antes se saltaba, y un
  reload en dev dejaba la app en cero mientras el servidor tenía un saldo real:
  el número que el developer mira está mal y nada lo dice.
- Tras un login exitoso, `boot.ts` escucha `bp:privy:authenticated` y dispara
  `refreshWallet()`. El envelope de auth trae `{user, wallet}` pero **no** los
  movimientos: sin esto, home mostraba saldo real sobre historial del prototipo.

**Verificado por mí, sin browser**
- `127.0.0.1:5173/api/health` → 200 a través del proxy (same-origin funciona).
- `/api/auth/session` sin cookie → 401 con el envelope exacto
  `{ok:false,error:'unauthorized',message:'Sesión requerida.',code:401}`.
- `/api/wallet` sin cookie → 401. El scope de cookie no se puede esquivar.
- 199/199 tests web, typecheck 5/5.

**Lo que falta, y es una decisión de riesgo**
El **render real de la isla nunca se probó**. Al poner el App ID, el test que
antes pasaba sin querer Ahora la monta y falla con
`Cannot read properties of null (reading 'useContext')`.

Diagnóstico: **es artefacto de vitest, no del browser.** vitest externaliza
`node_modules`, así que el alias `react → preact/compat` no le llega al SDK y
corre React 18 con dispatcher nulo. Se verificó que **no hay dos preact** (app y
SDK resuelven a `preact@10.29.8`), y el build de producción sí resuelve la isla
a su propio chunk, o sea el alias aplica donde importa.

El test ahora afirma lo que puede afirmar (boot **llega** al mount, y un mount
fallido no tira la app) y dice explícitamente que el render queda sin probar. Un
test que afirmara lo contrario estaría mintiendo en las dos direcciones.

**Cómo se cierra este peldaño** (necesita tu máquina, 10 minutos)
1. `pnpm dev`, y abrir **`http://localhost:5173`** — NUNCA `127.0.0.1`.
2. Tocar "iniciar sesión" → debería pedir la passkey.
3. Si entra: login real andando. La pantalla de actividad tiene que mostrar los
   movimientos del seed, no los mocks.
4. Si la isla no renderiza: se ve en blanco / error en consola. Pasame el error y lo
   depuro — es el primer dato real del render.

### Lo que se descubrió trying (2026-09-27, smoke en browser)

**La isla SÍ monta y renderiza.** Los warnings del SDK en la consola lo prueban:
`PrivyProvider` inicializó y normalizó la config. El `useContext` nulo que se
veía en vitest era, efectivamente, artefacto del entorno de test.

**El login llegó hasta WebAuthn y chocó con el origin:**

```
SecurityError: 127.0.0.1 is an invalid domain
```

Privy valida `window.location.origin` contra su allowlist y rechaza IPs
literales. La causa era `server.host: '127.0.0.1'` en `vite.config.ts`. Ahora es
`'localhost'`. `localhost` responde 200 y es contexto seguro para WebAuthn.

**El warning de `showWalletLoginFirst` no es un bug nuestro.** Leyendo el SDK
instalado: con solo `passkey` como método, el normalizador fuerza ese flag a
`true` y avisa, **lo que se le pase**. Es cosmético e inmodificable desde el
cliente. No tocarlo.

**El `GET /api/auth/session 401` del primer arranque es lo correcto**: el probe
funciona y no inventó sesión.

Mientras tanto, el API y el web quedan levantados por mí (logs en `/tmp/api.log`
y `/tmp/web.log`).

---

## Peldaño 2 — CERRADO (2026-09-27). Encontró tres bugs.

`apps/api/tests/integration/auth.e2e.test.ts`, 13 tests. Firma un ES256 real
contra un JWKS local servido por el propio test, maneja la app Hono real contra
la DB real, y **corre la respuesta real por el guard y el mapper del frontend**.

API: **55/55** (estable en 3 corridas). Web: 199/199. Typecheck 5/5. Build ok.

### Lo que encontró

**1. `register/finish` no podía registrar un segundo usuario, nunca.**
El tag estaba hardcodeado a `@rewallet` para todo el mundo, así que el segundo
registro moría en `users_tag_unique` con un 500 crudo de Drizzle — ni siquiera un
409. `allocateTag` estaba importado en el archivo pero solo se usaba en el perfil.

Arreglado con `provisionalTag()` en `services/tag.ts`: un handle **provisional**
`u<nanoid8>`. Random a propósito, no `allocateTag`: en el registro todavía no hay
nombre del que derivar un handle, y una consulta de disponibilidad sería una
carrera check-then-insert contra otro registro simultáneo. El handle de verdad lo
pone `PATCH /me/profile` desde el nombre, que es donde ya vive la regla de
producto.

**2. `register/finish` no era transaccional.** Insertaba el usuario y DESPUÉS
provisionaba la wallet. Cualquier falla en el medio dejaba una cuenta sin wallet,
y `login/finish` responde entonces 500 "user has no wallet": **un passkey
atascado para siempre, sin salida.** Hoy es justamente lo que pasa, porque la
custodia tira.

Arreglado con `db.transaction` sobre usuario + wallet.

**3. El frontend no se podía importar desde el test del backend.**
`wire/privy.ts` importa el Router, que toca `window` al cargar: el guard del
frontend no se podía correr contra una respuesta real fuera del browser. Y eso era
justo el agujero que dejaba las dos mitades en verde mientras el login real
funcionaba o no.

Arreglado extrayendo la mitad pura a `apps/web/src/wire/session-envelope.ts`
(stages, `PrivyBridgeError`, auditoría de credenciales, `isApiSession`,
`toStorePatch`), sin DOM en su grafo. `privy.ts` lo reexporta, así que ningún
consumidor cambió; `wallet.ts` ahora también apunta ahí y quedó importable sin
browser.

### Un detalle que costó encontrar

El token tiene que llevar **`typ: 'JWT'`** en el header. `verifyAccessToken` lo
pasa a `jwtVerify`, y un header sin ese claim se rechaza como inválido aunque la
firma, el issuer, la audience y la expiración estén perfectos. Salió de leer el
SDK instalado, no de adivinar. El token necesita: ES256, `iss: 'privy.io'`,
`aud: <app id>`, `iat`, `exp`, `sid` y `sub`.

### Lo que sigue bloqueando el login real

`getWalletForUser` **sigue tirando** `TODO(feature: passkey)`. Con la custodia
implementada el flujo de registro funciona entero; sin ella, `register/finish`
responde 500. El test lo deja explícito en su propio bloque para que no se
olvide. **La custodia es el próximo peldaño grande, y es el mismo trabajo que el
peldaño 5** (los endpoints de plata), así que conviene hacerlos juntos.

## Deuda que sigue abierta

1. **No hay repo git.** Toplevel = `/home/lordbitcoin` (el home), cero commits.
   Sin esto no hay work-unit commits ni rollback de nada.
2. `.env` con `MONAD_CHAIN_ID=10143` (testnet) contra la decisión de mainnet 143.
3. La isla pesa 633 kB gzip y se pide en cada boot.
4. `TODO(feature: passkey)` en `routes/auth.ts` está desactualizado: `verifyIdToken`
   ya verifica local con JWKS vía jose.
