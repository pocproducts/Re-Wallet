# Login social con Privy — backend en `07.PockBackend` y acceso directo a la app

## Por qué esta tarea

El flujo de onboarding de `05. UI-UX` (correo → código → passkey) lleva dos días
atascado en un solo punto: `sendCode` / `linkWithPasskey` de Privy. La causa ya
está identificada y el arreglo del orden se aplicó, pero **el circuito completo
nunca llegó a completarse ni una vez**: Neon tiene 0 usuarios, 0 sesiones y 0
wallets después de todos los intentos.

Decisión del owner: **no se implementa más nada en `06. Backend`**. El backend
nuevo vive en `07.PockBackend`, el login es **directo con el stack de Privy**
(login social, sin código por correo, sin passkey, sin onboarding), y el
objetivo es **entrar a la app y ver Billetera, Inversiones y Actividad**.

`06. Backend` queda **congelado**: no se le agrega, no se le quita, no se le
corrige. Se lee si hace falta como referencia.

## Decisiones tomadas

1. **Correo electrónico, directo.** Sin Google, sin Apple, sin passkey. El
   login method de correo de Privy (`useLoginWithEmail`) ya está habilitado en
   el dashboard.
2. **Una sola puerta.** No hay dos: no existe "Comenzar" contra "Ya tengo
   cuenta". `sendCode({ email })` **sin `disableNewUsers`** crea la cuenta la
   primera vez y entra a la que ya existe después. Esa única llamada es la que
   decide, y por eso desaparece de un plumazo toda la dances de
   `linkEmail`/`signupWithPasskey` que estaba trabando el flujo.

   ### Por qué esto cambia el problema, y qué riesgo queda

   El correo nos devuelve **a la misma llamada que falló** (`sendCode`), y hay que
   decirlo claro. Lo que cambia es todo lo que la acompañaba:

   - **Desaparece `linkWithPasskey`**, que exigía sesión y respondía
     `must_be_authenticated`. Ya no hay passkey que pegar.
   - **Desaparecen las dos puertas**, y con ellas la confusión de si el alta
     tenía que crear al usuario o no.
   - **La secuencia queda entera dentro de Privy**: `sendCode` y luego
     `loginWithCode`. No hay paso nuestro en el medio que pueda dejar la sesión
     a medio hacer.

   Riesgo residual, y no es menor: quedan en Privy los **dos usuarios duplicados
   de ayer con ese correo**, y hubo seis intentos seguidos, así que
   `too_many_requests` es una respuesta plausible. Si aparece, la causa no es el
   código: es estado viejo en el dashboard y límites de envío.
3. **Mismo dominio, Worker nuevo.** `07.PockBackend` pasa a servir
   `app-dev.rewallet.win` y la API bajo `/api`, igual que hoy. Un solo origen:
   la cookie de sesión es `httpOnly` con prefijo `__Host-` y eso obliga a mismo
   origen. `rewallet-api` (el de `06. Backend`) deja de atender ese dominio y
   queda disponible para volver atrás con un redeploy.
4. **Base: las tablas que ya están en Neon**, esquema `rewallet`. Están en 0
   filas y verificadas. No se crea un esquema nuevo.
5. **Wallets embebidas: EVM y Solana, en ese orden.** El orden lo posee el caso
   de uso, no el adaptador.
6. **`05. UI-UX` es el producto**: no se rediseña ni se toca la UI de las tres
   secciones. Solo se cambia la puerta.

## Lo que ya existe y NO hay que escribir

`05. UI-UX/src/App.tsx` ya tiene `WalletView`, `InvestmentsView`, `ActivityView`,
`BottomNavbar` y los modales de segundo y tercer nivel (Aave, Dólares
Digitales, Bitcoin & Crypto, QR de cobro, escáner, búsqueda, notificaciones).
La única línea que las esconde es:

```tsx
{!isOnboardingCompleted ? <OnboardingFlow … /> : ( …las tres secciones… )}
```

`isOnboardingCompleted` sale de `localStorage`. **El shell de la app existe y
funciona; lo que cambia es la puerta.**

## Fundamento en la documentación de Privy

Verificado el 2026-10-03 contra `docs.privy.io`:

- **Correo con OTP**: `useLoginWithEmail()` → `sendCode({ email, disableNewUsers? })`
  y `loginWithCode({ code })`. Es un **login method por sí mismo**: el primero
  manda el código, el segundo autentica. No hace falta ninguna otra llamada.
- **Dashboard**: el login method de correo ya está habilitado. Falta confirmar
  `app-dev.rewallet.win` en *Allowed domains*.
- **OAuth queda documentado pero no usado**: `useLoginWithOAuth()` →
  `initOAuth({ provider, disableNewUsers })` con Google, Apple, Twitter/X,
  Discord, GitHub, LinkedIn, Spotify, TikTok, Instagram, Telegram y LINE. No se
  implementa en esta pasada.
- **Wallets embebidas**: `owner` = id de usuario, para que solo esa persona la
  controle. Se pueden crear del lado del cliente (`useWallets`) o del servidor
  (`PrivyClient`, de `@privy-io/node`).
- **Verificación de token**: `PrivyClient.verifyAuthToken`, de `@privy-io/node`.
  El DID viaja en el claim `sub`.

**Advertencia que ya no aplica**: Google OAuth podía fallar dentro de navegadores
embebidos (el webview de Instagram, el de la app de Facebook). Con login por
correo eso deja de ser un factor.

## Variables de Privy que se reusan

| Dónde | Nombre | Estado |
|---|---|---|
| `05. UI-UX/.env` | `VITE_PRIVY_APP_ID` | ya existe |
| `05. UI-UX/.env` | `VITE_API_BASE_URL` | ya existe |
| `05. UI-UX/src/components/Auth/CodeVerification.tsx` | — | **ya existe y se reusa**: 6 dígitos, reenvío con cuenta regresiva, error, `onBack`. La puerta no se escribe, se usa |
| Worker (secret) | `PRIVY_APP_ID` | ya puesto en producción |
| Worker (secret) | `PRIVY_APP_SECRET` | ya puesto |
| Worker (secret) | `PRIVY_VERIFICATION_JWKS` | ya puesto |
| Worker (secret) | `PRIVY_WEBHOOK_SIGNING_SECRET` | ya puesto |
| `07.PockBackend/.env.neon` | `DATABASE_URL` | se copia de `06. Backend` |

## Tareas

### T1 — `07.PockBackend`: el Worker y la puerta

Carpeta nueva, proyecto Node con Hono, `wrangler.jsonc` apuntando a
`app-dev.rewallet.win`, `assets` sirviendo `05. UI-UX/dist` y `/api` para la API.

- `POST /api/auth/session`: recibe el access token de Privy, lo verifica con
  `PrivyClient.verifyAuthToken`, busca o crea el usuario por DID en
  `rewallet.users`, **provisiona las wallets EVM → Solana**, y emite la cookie
  de sesión `httpOnly` con prefijo `__Host-`. **El cuerpo de la respuesta va
  vacío**: el token no vuelve al JavaScript de la página.
- `GET /api/auth/session`: dice si la sesión actual sirve.
- `DELETE /api/auth/session`: la cierra.
- El **orden de las cadenas lo posee el caso de uso**, no el adaptador, y tiene un
  test que lo afirma.
- Tests con `vitest`, sin red: el verificador de token y el aprovisionador de
  wallets son dependencias inyectadas.

**Gate**: `npm test` en verde y `tsc --noEmit` limpio.

### T2 — Despliegue del Worker nuevo

`07.PockBackend` en `app-dev.rewallet.win` con sus secrets y su `.env.neon`.
Verificar que el sitio responde y que `GET /api/auth/session` da 401 sin cookie.

**Gate**: sitio 200 y `GET /api/auth/session` → 401.

### T3 — La puerta de correo en `05. UI-UX`

- **Dos pantallas**: correo, y código de 6 dígitos. La segunda **reusa
  `components/Auth/CodeVerification.tsx`**, que ya está hecho y con su cuenta
  regresiva. No se reimplementa la entrada de código.
- El envío es `sendCode({ email })` **sin `disableNewUsers`**, y la entrada es
  `loginWithCode({ code })`. Una sola puerta para alta e ingreso.
- `App.tsx` decide con "¿hay sesión?" en lugar de `isOnboardingCompleted` de
  `localStorage`. `OnboardingFlow` **no se borra**: deja de ser la puerta.
- Cada llamada a Privy reporta su error a `POST /api/diagnostics`, que ya existe
  en `06. Backend` y hay que replicar en `07.PockBackend`: es la única forma de
  leer un error del navegador cuando la prueba es desde el celu.

**Gate**: `npm run lint` (`tsc --noEmit`) en verde y build ok.

#### Evidencia de T3 (2026-10-03)

- `components/Auth/LoginGate.tsx` (nuevo): una sola puerta, `sendCode({ email })`
  sin `disableSignup` y `loginWithCode({ code })`, reusando
  `CodeVerification.tsx` sin tocarlo.
- `services/session.ts`: `openRewalletSession` ya **no parsea el cuerpo** (el
  `POST` responde `204` vacío); se agregaron `isRewalletSessionActive` y
  `closeRewalletSession`.
- `services/api.ts`: `request` compartido más `getJson` y `deleteJson`.
- `hooks/useSessionGate.ts` (nuevo) + `App.tsx`: la decisión es
  `checking` → `authenticated` | `anonymous`; logout = `DELETE` + `logout()` de
  Privy. `OnboardingFlow` queda en el árbol, sin referencias.
- Gates: `npm run lint` limpio, `npm run build` ok con el texto de la puerta en
  `dist/assets/index-CYLnVRaS.js`, y `grep -rn isOnboardingCompleted src` sin
  coincidencias.

**Lo que sigue sin probarse contra producción**: el envío real del correo, el
`204` con cookie, el `502 IDENTITY_UNAVAILABLE`, el `too_many_requests` por los
usuarios duplicados que quedaron en el panel, y que `/diagnostico` exista en
`07.PockBackend` (si no, los errores de Privy no llegan al log del Worker).

#### Corrección 2026-10-04 — "autenticado en Privy" no es "con sesión en ReWALLET"

**Evidencia de producción (18:37)**: Privy autenticó a la persona con el código
por correo, y nuestro Worker falló después en `session.identity_lookup` (secreto
roto). El navegador quedó **autenticado en Privy** y **sin sesión de ReWALLET**,
y la puerta le pidió un código nuevo como si no hubiera nada. Al entrar ese
código, Privy respondió `DIAGNOSTIC {"etapa":"login_codigo","codigo":"cannot_link_more_of_type"}`:
no fue un login, fue el intento de **enlazar** un segundo correo del mismo tipo.

**Causa**: la puerta y `useSessionGate` trataban las dos sesiones como una sola,
y el camino de "reintentar" era un `loginWithCode` contra alguien que Privy ya
daba por autenticado. Ese camino no puede funcionar, ni una vez.

**Arreglo**:

- `hooks/useSessionGate.ts` pasa a ser la máquina de estados explícita de la
  puerta: `checking` → `checking_session` → `exchanging` → `authenticated` |
  `anonymous` | `exchange_failed`. El intercambio (`getAccessToken()` +
  `POST /api/auth/session`) **se dispara solo** cuando Privy ya dice
  autenticado y no hay cookie: ahí no se pide ningún código.
- `components/Auth/LoginGate.tsx` queda siendo **solo** el correo y el código,
  para gente que no está autenticada en Privy. Además se niega a mostrar el
  formulario si `usePrivy().authenticated` es `true` (defensa en los dos lados,
  porque el síntoma era invisible).
- `exchange_failed` **no reintenta solo** (bucle contra un backend roto) ni
  pide código: muestra el fallo y da una salida que funciona — cerrar sesión en
  Privy y volver al correo. Se reporta con etapas nuevas
  (`login_intercambio_token`, `login_intercambio_sesion`).
- `App.tsx` renderiza `checking` / `checking_session` / `exchanging` con una
  pantalla neutra: ni un flash de la puerta a alguien autenticado, ni un flash
  de la app a quien no lo está. `exchange_failed` tiene su propia pantalla.
- `services/privy.ts`: `toDiagnosticCode` traduce los códigos del backend y de
  Privy al vocabulario cerrado que acepta `POST /api/diagnostics`.

**Gates**: `npm run lint` limpio, `npm run build` ok (los textos nuevos están en
`dist/assets/index-CsAVbaSp.js`) y `grep -rn isOnboardingCompleted src` sin
coincidencias. **Sin test runner en este proyecto**: los gates son `tsc` y el
build, y eso es lo que hay.

**Lo que sigue sin probarse con un ingreso real**: que el intercambio automático
abra sesión cuando Privy ya está autenticado (la ruta que falló a las 18:37),
que el fallo de `IDENTITY_UNAVAILABLE` muestre la pantalla de salida, y el caso
`getAccessToken()` en `null` con Privy autenticado.

### T4 — El perfil sale de Privy

`WalletView`, `InvestmentsView` y `ActivityView` reciben `nombre` y `correo` del
usuario de Privy. **Sin cambios en la UI de las tres secciones**: si hay que
tocarlas, es porque el tipo no alcanza, y eso se dice antes de tocarlo.

**Gate**: `npm run lint` en verde.

#### Evidencia de T4 (2026-10-03)

`services/profile.ts` deriva el perfil del usuario de Privy: correo de la cuenta
de correo vinculada, nombre real si existe y si no la parte local del correo,
teléfono de Privy o "No informado", `faceIdLinked: false` y la fecha de creación
de la cuenta como registro. **Sin tocar la UI ni el tipo de las tres vistas**:
`UserProfileData` se satisface entero desde Privy. Nada se persiste.

### T5 — Prueba end-to-end y verificación en Neon

Desde el celu, en el navegador abierto: Google o Apple → entrar a la app → ver
las tres secciones. Después: **una fila real en `rewallet.users`, una sesión y dos
wallets (EVM y Solana)**, que es la primera evidencia de que el circuito entero
funcionó.

**Gate**: las consultas a Neon devuelven las filas esperadas.

### T6 — La wallet es de la persona, no de la app (fix de seguridad)

**Evidencia de producción, 2026-10-03.** El Worker creaba las wallets embebidas
desde el servidor. Lo que Privy responde hoy de esas wallets:

```
GET /v1/wallets/o2oxert46wgndsi2x2gcu7ze → owner: null, owner_id: "is5plzb8spdqrv6n590y31jf"
GET /v1/users/did:privy:cmussgc9y00f80cjvv8gcmbqs → wallets: []
```

Las wallets eran de un **quórum de claves de la app** y el usuario ni las tenía
listadas: el derecho de retiro era de la aplicación. Una request REST cruda con
nuestro body exacto (`POST /v1/wallets` con `owner: { user_id }`) devuelve `200`
y asigna el quórum igual — el endpoint ignora `owner`. No era un bug del backend,
era el endpoint.

**Decisión del owner**: el navegador crea la wallet (Privy da dueño usuario a las
creadas desde el SDK de cliente) y el backend la **verifica**.

1. `WalletProvisioner` desaparece. En su lugar, el puerto
   `WalletOwnershipVerifier`: "qué wallets reporta Privy para este DID".
2. `POST /api/wallets/claim` con `{ accessToken, wallets: [{ chain, walletId, address }] }`.
   Verifica el token como `POST /api/auth/session`, resuelve el usuario con el
   mismo lookup del directorio, **exige que cada `walletId` esté en el registro de
   Privy de esa persona**, exige que la `address` sea la que Privy reporta, y
   escribe EVM y después Solana. Si un claim no se prueba: **se rechaza todo y no
   se escribe nada**.
3. `mintSession` ya no aprovisiona: anuncia `session.wallets_pending` y no puede
   fallar el login.
4. `05. UI-UX` garantiza una wallet de Ethereum y una de Solana por persona
   autenticada (`useWallets` + `useCreateWallet`, y el subpath `/solana`), en ese
   orden, y manda el reclamo. **Un reclamo fallido no bloquea la entrada**: se
   reporta por el helper de diagnóstico y se muestra un aviso.

**Gate**: `07.PockBackend` → `npm test`, `npx tsc --noEmit`, `npm run build`;
`05. UI-UX` → `npm run lint`, `npm run build`; y
`grep -rn "wallets().create\|wallets\.()" 07.PockBackend/src` sin resultados.

#### Corrección 2026-10-05 — el canal de diagnóstico dice el motivo real

**Evidencia de producción**: un hook que crea las wallets y las reclama falló en
el navegador y el log del Worker mostró

```
DIAGNOSTIC {"etapa":"wallets_reclamar","codigo":"unknown_error","allowlisted":true,"estado":"ok"}
```

sin un solo `POST /api/wallets/claim`. La causa era desconocida: `toDiagnosticCode`
mandaba a `unknown_error` todo lo que no reconocía, y la ruta del backend sólo
acepta una lista cerrada de códigos. El canal existe justamente para esto — un
fallo del navegador es invisible desde el servidor, y la prueba se hace desde un
celular sin consola — así que sin motivo real no servía.

1. `07.PockBackend/.../diagnostics.ts`: el body acepta ahora un `detalle`
   **opcional** (string, 200 caracteres como máximo). Se sanea con la misma regla
   de los códigos desconocidos (se quita todo lo que no sea `[a-z0-9_]`), los
   espacios y saltos de línea se colapsan en un `_`, y el corte va al final. El
   allowlist de `codigo` **no se toca**, y la respuesta sigue siendo `204` sin
   cuerpo: `detalle` nunca se devuelve.
2. `05. UI-UX/src/services/privy.ts`: `reportPrivyErrorWithDetail` (más
   `buildPrivyErrorDetail`) manda etapa, código real, status HTTP cuando hay
   respuesta y nombre del error. Se compone con una lista cerrada de piezas
   leídas por nombre —el `message` del error no entra nunca— así que un correo o
   un token no tienen por dónde filtrarse, y se corta en 200 antes de enviar.
   `toDiagnosticCode` no cambia para los llamadores que ya lo usan.
3. `05. UI-UX/src/hooks/useUserWallets.ts`: ahora reporta en **todas** las etapas
   que pueden fallar (crear la de Ethereum, crear la de Solana, armar el payload,
   el token, el post). Antes sólo reportaba el reclamo. Una wallet sin `id` —
   caso real de la de Solana, cuyo tipo expone `address` y no `id`— se reporta
   con su propia nota (`walletidmissing_solana`) en vez de disfrazarse de otro
   `unknown_error`.

**Tests**: `07.PockBackend` pasó de 78 a 85 (`test/interface/diagnostics.test.ts`
de 7 a 14). Los nuevos cubren: `detalle` registrado junto a un código conocido,
`detalle` hostil de 300 caracteres cortado a 200 con sólo `[a-z0-9_]`, colapso de
espacios que impide varias líneas de log, `detalle` que no es string (se ignora),
ausencia de `detalle` (la clave no aparece) y `detalle` nunca devuelto en la
respuesta.

**Gates**: `07.PockBackend` → `npm test` 85/85, `npx tsc --noEmit` limpio, `npm
run build` produciendo `dist-worker.js`; `05. UI-UX` → `npm run lint` limpio y
`npm run build` ok. **Sin test runner en `05. UI-UX`**: los gates de esa app son
`tsc` y el build, y eso es lo que hay; lo nuevo del front no tiene test.

**Lo que sigue sin probarse contra producción**: que una etapa real con fallo
muestre `detalle` en el log, y qué motivo concreto produce hoy ese
`unknown_error` en `wallets_reclamar`.

**Pendiente que sólo se prueba con un login real**: que el `id` que devuelve
`useCreateWallet` aparezca efectivamente en `linked_accounts` del usuario de Privy,
y qué pasa con una persona que ya tiene una wallet de Solana del circuito anterior
(el tipo público de las wallets standard de Solana no expone `id`, así que esa
cadena no se reclama: no se crea una segunda).

## T7 — Un correo es una cuenta, aunque Privy rote el DID

### El fallo de producción que lo motivó

```
session.failed  { step: 'session.user_upsert',
                  reason: 'duplicate key value violates unique constraint "users_email_key"' }
→ 401
```

Comprobado contra los dos sistemas: Privy tenía **un** usuario para ese correo,
`did:privy:cmut0tb8i00d10cktp99v35vb`, creado minutos antes, y el DID anterior ya
no existía. Neon tenía **una** fila para el mismo correo, atada al DID **viejo**.
La fila había quedado huérfana: el upsert buscaba por DID, no encontraba nada, y el
insert chocaba con el `UNIQUE` del correo.

### La regla

El correo es la identidad estable (es lo que la persona **prueba** recibiendo un
código); el DID es un identificador técnico que el proveedor puede rotar y que de
hecho rota. Por eso la resolución son **cuatro pasos explícitos** en
`resolveAccount` (`application/user/resolveAccount.ts`), no un statement listo:

| DID | correo | qué pasa | línea de log |
| --- | --- | --- | --- |
| conocido | igual | re-login normal; la fila se upserta, que sigue absorbiendo el doble clic | `session.account_existing` |
| **desconocido** | **conocido** | la fila **adopta** el DID nuevo | `session.account_adopted` (con `previousPrivyDid`) |
| desconocido | desconocido | cuenta nueva | `session.account_created` |
| conocido | **distinto** | se **rechaza**: `409 IDENTITY_CONFLICT` | `session.failed` con `IdentityConflict` |

Dos personas no pueden chocar en el segundo caso: llegar ahí exige haber recibido
el código enviado a ese correo, y la escritura sólo toca `privy_did`.

1. **`domain/ports/user-store.ts`**: el puerto ya no ofrece un `upsert` que tiene
   que ser listo para ser correcto. Ofrece los pasos — `findByPrivyDid`,
   `findByEmail`, `upsert`, `adoptPrivyDid`, `create` — y la **decisión** vive en
   la capa de aplicación. `StoredUser` suma `tagNormalized`, la columna viva, para
   que la adopción se pueda afirmar sobre ella y no sólo sobre el valor devuelto.
   `UserStoreConflict` (Postgres `23505`) entra en el puerto como condición con
   nombre en vez de error de driver.
2. **`infrastructure/db/userStore.pg.ts`**: cinco sentencias en vez de una.
   `adoptPrivyDid` es `UPDATE … SET privy_did = $1` y nada más: `name`, `tag` y
   `tag_normalized` son un handle de persona, no una función del DID, y
   regenerarlos rompería cada referencia existente a esa persona. `upsert` sigue
   como `ON CONFLICT (privy_did) DO UPDATE` porque la rama "DID conocido" todavía
   tiene una ventana. Todo `23505` pasa por `guarded()` y sale como
   `UserStoreConflict` con el nombre de la restricción; cualquier otro error se
   relanza intacto, para que una caída no se disfraze de conflicto.
3. **`application/session/mintSession.ts`** y
   **`application/wallet-claim/claimWalletsFor.ts`**: ambos llaman al mismo
   `resolveAccount` (con `stepPrefix` y `markStep`, que mantienen el marcador de
   paso del `catch` apuntando a la sentencia que falló). Dos resoluciones de "quién
   es esta persona" serían dos maneras de discrepar, y las dos rutas escriben
   claves sobre el mismo `rewallet.users.id`.
4. **`interface/http/errors.ts`** (nuevo): los dos 409 compartidos. 409 y no 401
   porque la persona **sí** está autenticada y un 401 manda al browser a
   reintentar para siempre ante una contradicción que no se resuelve reintentando.
   `IDENTITY_CONFLICT` (los datos se contradicen) y `ACCOUNT_CONFLICT` (una
   restricción perdió la carrera) son códigos distintos porque las causas lo son.

**Tests**: `07.PockBackend` pasó de 85 a 106. Nuevos: `test/application/resolveAccount.test.ts`
(12), `test/infrastructure/userStore.pg.test.ts` (6), un caso de login completo
con DID rotado en `mintSession.test.ts` y dos casos 409 en `auth.test.ts`. El
fake `test/support/userStore.ts` **impone los `UNIQUE` de la tabla viva** (incluido
el `citext` del correo) en vez de devolver lo que el test le pide: un stub que no
colisiona es lo que dejó pasar el upsert viejo hasta producción. La comparación
de correo va en modo `citext`, porque `Ana@Example.com` y `ana@example.com` son un
correo solo para Postgres.

**Lo que sigue sin probarse**: el SQL real contra Neon. El adaptador se prueba
con un transporte falso que devuelve filas o lanza `23505`; lo que Postgres
entienda de `citext`, de `db.unsafe` en el `SELECT` y del nombre de la
restricción sólo se ve con un login real. Tampoco se ha probado que una fila
**real** ya huérfana quede reparada por la adopción en producción: el caso está
cubierto contra el fake, no contra el DID viejo de verdad.

## Allowed edit surfaces

Los de T7, además de los de abajo: `07.PockBackend/src/**`,
`07.PockBackend/test/**`, `07.PockBackend/README.md` y este archivo.

- `07.PockBackend/**` (nuevo)
- `05. UI-UX/src/App.tsx`
- `05. UI-UX/src/components/Auth/**` (reusar `CodeVerification.tsx`; no reescribirlo)
- `05. UI-UX/src/services/privy.ts`
- `05. UI-UX/src/main.tsx`

**`06. Backend/**` está fuera de toda superficie de edición.** Se puede leer.

## Fuera de alcance, para que quede dicho

- `06. Backend`: congelado.
- `OnboardingFlow` y `ProfileView`: no se borran, no se arreglan, no se leen
  para este trabajo. Quedan como código muerto a la vista.
- código por correo social (Google, Apple, X, Discord): fuera; el ingreso es por
  correo electrónico con OTP.
- passkey, verificación de teléfono: fuera.
- Multichain más allá de EVM y Solana: fuera.
- Yield,.onramp, bridge, movimientos reales: fuera. La app entra con los datos
  que ya tiene.