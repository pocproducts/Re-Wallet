# MVP v1 — Shell limpio: Onboarding, Billeteras y Perfil

<!--
> **RECONCILIADO 2026-09-29**
> **Estado real: superseded.** Su T8 le pasó el backend a `odd/tasks/backend-fase1.md`,
> que ya lo llevó hasta T14. T3 y T8 son casillas muertas: T3 duplica a T5 del mismo
> documento, y T8 duplica a T1 de backend-fase1. El "Próximo paso: T4" del final se
> contradice con su propia sección Progreso, que ya reporta T4, T4b, T4c y T5. El mapa
> técnico es un corte del 2026-09-28: varias rutas fueron renombradas o borradas desde
> entonces. Cita tres veces `odd/decisions/adr-001-custodia.md`, que NO EXISTE (`odd/`
> sólo contiene `qr/` y `tasks/`): esa deuda de custodia sigue sin resolver y sin registro,
> y queda anotada en el mapa. El cuerpo de abajo no se tocó: es el registro de por qué
> el código es como es.
> **Mapa y contradicciones: `odd/roadmap.md` sección 4.3.**
-->

## Objetivo

Sacar el MVP de ReWALLET adelante sobre una base limpia: levantar el front en local,
eliminar la gamificación urbana (mapa + misiones) y reconstruir, en este orden, el
**onboarding** (primer feature), **Billeteras** y **Perfil**.

## Orden de ejecución

**El usuario cambió el orden: el onboarding va primero, el mapa después.** Los IDs de
task son estables y no se renumeran; lo que cambia es cuál se ejecuta primero.

| Orden | Task | Feature |
| --- | --- | --- |
| 1 | T0 | Commitear la reestructuración (decisión de rama pendiente) |
| 2 | **T4** | **Onboarding** — primer feature de producto |
| 3 | T3 | Mapa y misiones fuera |
| 4 | T2 | Deps muertas |
| 5 | T5 | Billeteras |
| 6 | T6 | Perfil |
| 7 | T8 | Backend |

Por qué el onboarding primero, aunque el mapa siga en el shell: el mapa es *contorno*, el
onboarding es el *camino*. El mapa no se quita antes porque hoy aparezca después del
onboarding, sino porque hasta que la pantalla de Bienvenida deje de ser "explorá tu
ciudad" + "sincronizando con OpenStreetMap", **no hay un producto que probar**. Arranca
en `map` (`App.tsx:36`) y vuelve a `map` al completar (`App.tsx:68`); eso se corrige en
T3, y hasta entonces T4 se verifica mirando la pantalla de onboarding, no la de después.

El riesgo real de este orden —aterrizar en un mapa nuevo— queda acotado por una
decisión de T4: **el mapa se elimina del camino del onboarding, pero sobrevive en
`App.tsx` hasta T3.** El flujo de registro nunca lo muestra.

## Decisión de arquitectura: frontera de provider

La dirección de wallet sale de **Privy** (decisión del usuario). Este feature **no toca
backend** ni cablea Privy. Lo que se construye es la **frontera**:

- Un contrato/puerto de autenticación provider-agnostic.
- Un adaptador **mock** local que devuelve una sesión falsa determinista.
- El adaptador real de Privy entra después, sin que la UI ni el perfil se enteren.

### La forma del contrato: tres piezas, no una

El contrato se modela contra la **respuesta real de Privy**, no contra una forma
cómoda. Evidencia del PoC (obs #511):

- El passkey **no es dueño de la wallet**. `provisionFor` pasa
  `owner_id: PRIVY_WALLET_OWNER_ID`, un quórum fijo del dashboard idéntico para todos
  los usuarios. El passkey es solo la identidad (`users.privy_did`).
- `register/finish` **crea** una wallet nueva; no vincula una existente.
- `providerWalletId` se devolvía y **no se persistía** (la tabla `wallets` solo guardaba
  `address`, y `act(providerWalletId)` necesita el id). **Eso ya está arreglado**: la
  rama `fix/wallet-address-in-store` está mergeada en `main`. La lección de *forma* sigue
  en pie —por eso el contrato lleva las tres piezas— pero el defecto está cerrado.

Por lo tanto la sesión del contrato lleva las tres piezas:

```ts
type AuthSession = {
  privyDid: string          // identidad del usuario en el provider
  address: string           // dirección de wallet
  providerWalletId: string  // lo necesita act() más adelante
};
```

Si el contrato fuera `{ address: string }`, al cablear Privy habría que cambiar el
contrato **y la UI con él**, que es exactamente lo que la frontera existe para evitar.

### Deuda conocida del PoC (congelado, no se corrige acá)

`odd/decisions/adr-001-custodia.md` promete un quórum 2-de-2 (passkey del usuario +
authorization key del server) pero **lo desplegado es un quórum fijo que el servidor
puede satisfacer solo**. El ADR describe algo que el código no hace. Queda anotado;
el PoC está congelado y no es alcance de este documento.

Los dos flujos de recuperación (correo / celular) quedan como **stubs navegables**, no
como formularios completos. Razón: cuando llegue Privy, **Privy es el dueño del OTP**;
escribir "te enviamos un código" a mano es escribir código que va a morir.

## Problema

`Front End/` es un prototipo de Google AI Studio construido alrededor de una idea que
ya no es el producto: explorar calles en OpenStreetMap y desbloquear recompensas. Eso
arrastró conceptos (mapa, misiones, geolocalización, GPS, recompensas por calle) que
hoy son ruido y que hay que desenredar antes de construir encima.

Mientras eso siga mezclado, cada cambio de producto cuesta más de lo que debería.

## Por qué

El usuario no sabe nada de Web3. La app tiene que **enseñar** en vez de exponer: si la
pantalla de Billeteras sigue hablando de "Mapeo Urbano & Red", le estás explicando al
usuario un concepto que no pidió. Lo que tiene que ver es que su dinero puede estar en
más lugares que una cuenta — y qué pasó con su dinero.

## Alcance autorizado

Solo dos áreas:

- **Front End** — trabajo de UI/UX. Es lo que hace este documento.
- **Backend** — clean architecture. Se scaffoldea contra requisitos reales, al final
  (T8), no antes. `Backend/` y `Contracts/` están vacíos hoy.

**El onboarding entra en alcance** y es el **primer feature de producto**. Se construye
sobre la frontera de provider descrita arriba: sin backend, sin Privy, sin OTP propio.

**Fuera de alcance (explícito):** integración real de Privy, cualquier endpoint, y
lógica de negocio que hoy vive en el PoC congelado.

## Mapa técnico (verificado 2026-09-28)

| Archivo | Líneas | Rol |
| --- | --- | --- |
| `src/App.tsx` | 423 | Router manual por `currentTab` + modales. Arranca en `'map'`. |
| `src/components/Wallet/WalletView.tsx` | 224 | Billeteras. Contiene el div "Mapeo Urbano & Red" (L208-221). |
| `src/components/Profile/ProfileView.tsx` | 224 | Perfil. Face ID pill (L107-110), botón reset (L213-220). |
| `src/components/Activity/ActivityView.tsx` | 383 | Actividad. Datos hardcoded L34-98. `copyHash` L103. |
| `src/components/InvestmentsView.tsx` | 267 | Inversiones. Recibe `onOpenMissions`. |
| `src/components/Navigation/BottomNavbar.tsx` | 89 | 4 tabs, incluye `'map'`. |
| `src/components/Map/*` | 146 | A eliminar. |
| `src/components/Missions/MissionsView.tsx` | 96 | A eliminar. |
| `src/hooks/useGeolocation.ts` | 84 | A eliminar. |
| `src/types/index.ts` | 26 | `NavTab` incluye `'map'`. `UserProfileData` **no tiene campo de dirección**. |
| `src/index.css` | 76 | 37 líneas de overrides de Leaflet + keyframe `radar-ping-lemon`. |

Stack: Vite 8, React 19, Tailwind 4, alias `@` → raíz del front. Sin tests, sin
vitest. `tsconfig.json` **no tiene `strict`**. `package.json` se llama `react-example`.

Checks aplicables: `npm run lint` (=`tsc --noEmit`) y `npm run build`.

## Restricciones

- `node_modules` ya está instalado (ver T1). **bun no está instalado**: los comandos son
  npm.
- **Vite 8 ya no usa esbuild** — migró a Rolldown. `esbuild` y `tsx` eran pines muertos de
  la era Vite 6/7 que rompían `npm install` con ERESOLVE: ningún script los usa y ningún
  archivo los importa. Ya se quitaron (T1).
- `currentTab` arranca en `'map'` (`App.tsx:36`) y vuelve a `'map'` al completar
  onboarding (`App.tsx:68`). Al eliminar el mapa, **Billetera pasa a ser el tab por
  defecto** o la app abre en una pestaña inexistente.
- Los datos de transacciones viven **dentro** de `ActivityView.tsx:34-98`. La card de
  "últimos 5 movimientos" necesita los mismos datos: extraer a un módulo compartido,
  no duplicar.
- La única "sesión" que existe es `localStorage['geodrop_user_profile_data']`
  (`App.tsx:31`). No hay auth, no hay logout, no hay Privy en este proyecto.
- **BUG heredado, a corregir en T4:** el passkey de `OnboardingFlow.tsx:109-131` se traga
  todos los errores en el `catch` (L128-130) con un `console.warn`. Si el usuario cancela
  el prompt biométrico, el flujo continúa **como si hubiera exitoso**.
- `faceIdKeyId` es `Math.random()` (`OnboardingFlow.tsx:174`) y no lo usa nadie.
- Deps sin un solo import en `src/`: `@google/genai`, `express`, `dotenv`, `motion`,
  `@types/express`, `autoprefixer`. Los que sí se importan: `react`, `react-dom`,
  `lucide-react`, `leaflet`, `canvas-confetti`.
- `canvas-confetti` **se queda**: es decoración del onboarding, no del mapa. `leaflet` y
  `@types/leaflet` se van en T3.

## Checklist

- [ ] **T0** — Commitear la reestructuración del repo. Hay 168 borrados sin commitear
      en `main`; `01.Poc-bestpath/` y `Front End/` están untracked. Sin esto, un
      `checkout` o `stash` se come el trabajo nuevo. Comparar contra `origin/main`
      primero. **Ruta: inline.** (own work-unit commit) — **esperando decisión de rama
      del usuario.**
- [x] **T1** — Levantar en local. `npm install`, confirmar que `npm run dev` levanta y
      que `npm run lint` + `npm run build` pasan limpios sobre la base actual.
      **Ruta: inline** (la delegación falló: *OpenCode's free tier can only be used
      from within OpenCode*). **HECHO.**
- [ ] **T2** — Limpiar dependencias muertas. Sacar `@google/genai`, `express`, `dotenv`,
      `motion`, `@types/express`, `autoprefixer` de `package.json`: nada las importa.
      Renombrar el paquete de `react-example` a algo real. **Ruta: inline.**
      (own work-unit commit, chico)
- [ ] **T3** — Eliminar mapa y misiones por completo. Borrar `Map/`, `Missions/`,
      `hooks/useGeolocation.ts`; limpiar 45 referencias en 7 archivos; quitar `'map'`
      de `NavTab` y del navbar; borrar los overrides de Leaflet y `radar-ping-lemon`
      de `index.css`; sacar `leaflet` y `@types/leaflet` de `package.json`; quitar
      `requestFramePermissions` de `metadata.json`; Billetera como tab por defecto.
      **Ruta: delegated writer.** (own work-unit commit)
- [ ] **T4** — **Onboarding: primer feature.** Reescribir `OnboardingFlow.tsx` (651
      líneas). **El fork ocurre en Bienvenida, no en un paso intermedio** (corrección del
      usuario; la versión anterior de este documento lo tenía mal):

      - **Bienvenida** — saludo, **sin tarjeta**, CTA **"Comenzar"** (no "Comenzar Ahora"),
        y debajo **"Ya tengo cuenta"**.
      - **Rama "Comenzar"** — toda la creación, encadenada: formulario (nombre, correo,
        teléfono) → passkey → confetti → perfil. Línea de apoyo del CTA:
        **"Tu cuenta, tu identidad"**. Botón del formulario: **"Crear cuenta"**.
      - **Rama "Ya tengo cuenta"** — pantalla **"Ingresar con huella digital"**
        (`navigator.credentials.get`), y debajo **"¿Olvidaste la contraseña?"** →
        dos stubs navegables (**correo** / **número**). Esta rama **no entra** en la
        barra de progreso de 3 pasos: no es el flujo de creación.
      - La barra de progreso de 3 segmentos solo se muestra en la rama de creación.

      Además: contrato de provider + adaptador mock determinista; `UserProfileData` gana
      dirección y `providerWalletId`, que vienen del provider y no del formulario; arreglar
      el `catch` que se traga la cancelación del prompt biométrico; borrar todo el copy de
      OpenStreetMap. **Ruta: inline** (la delegación no está disponible).
      (own work-unit commit; **va a pasar las 400 líneas — ver nota abajo**)

      **Decisiones de T4 que son juicio de ingeniería, no pedido del usuario** (se reportan
      para que se puedan revertir):
      - Un fallo de passkey **no** avanza el flujo. Se distingue cancelación
        (`NotAllowedError`) de "este dispositivo no tiene autenticador".
      - Si no hay autenticador, el registro **igual se completa** pero con
        `faceIdLinked: false` y un aviso explícito. Es preferible a inventar un passkey
        que no existe, y deja el camino local demo-able.
      - En la rama de login, un fallo de passkey **enfatiza "¿Olvidaste la contraseña?"**,
        que ya está en pantalla. Es la respuesta honesta: sin `allowCredentials` (no hay
        `credentialId` guardado mientras no haya backend) la plataforma no puede resolver
        la huella.
- [ ] **T5** — Billeteras: contenido nuevo del div conservado. Card A =
      educación/marketing sobre **pools de liquidez** (por qué hay más opciones de
      rendimiento que la cuenta). Card B = **últimos 5 movimientos** + botón
      **"Ver todo"** → sección Actividad. **Ruta: delegated writer.** (own work-unit)
- [ ] **T6** — Perfil. (a) Debajo de "Registrado el {fecha}", en gris, **dirección
      resumida copiable**. (b) "Reiniciar Onboarding y Datos" → **"CERRAR SESIÓN"**, en
      **rojo**, cerrando la sesión. (c) Eliminar la pill "Face ID Activo" y poner
      **2 chips del mismo color** en **2 columnas** con registro (fecha) y wallet.
      **Ruta: delegated writer.** (own work-unit commit)
- [ ] **T7** — Decisión pendiente: la frase "Face ID Activo" aparece **también** en el
      modal de Notificaciones (`App.tsx:353`). El pedido fue sobre el perfil.
      Decidir si se saca de los dos lados o solo del perfil.
- [ ] **T8** — Backend: scaffoldear clean architecture **derivada de lo que el front
      ya necesita**, no especulativa. Dominios visibles hoy: billeteras, actividad,
      perfil, pools de liquidez, auth. **Ruta: delegated writer.** (own work-unit commit)

## Nota de tamaño (heurística de 400 líneas, no criterio de aceptación)

T4 reescribe un archivo de 651 líneas y **va a superar las 400**. No se parte en dos
porque el flujo de 3 pasos es un comportamiento coherente: cortarlo al medio produce
código que no corre. La heurística guía planificación, no fragmenta unidades de
trabajo. Si T3+T4 juntos quedan demasiado grandes para un PR, la estrategia de entrega
es una decisión del usuario, no un corte artificial.

## Bloqueo conocido (T6a)

`UserProfileData` (`types/index.ts:9-16`) es `nombre`, `correo`, `telefono`,
`faceIdLinked`, `faceIdKeyId`, `registradoEn`. **No hay campo de dirección/wallet.**
**Resuelto en diseño por T4:** la dirección sale del provider de auth (mock ahora,
Privy después), no del formulario. T6 solo la muestra.

## Criterios de aceptación

- `npm run lint` y `npm run build` pasan sin errores.
- No queda ninguna referencia a `map`, `misiones`, `leaflet`, `geolocation`,
  `Ticket` ni `radar-ping` en `src/`, ni en `package.json` ni en `metadata.json`.
- Billeteras abre por defecto y el div "Mapeo Urbano & Red" muestra las dos cards.
- "Ver todo" lleva a Actividad.
- El perfil cierra sesión de verdad (limpia el `localStorage` y vuelve al onboarding).
- El onboarding ofrece las dos ramas desde Bienvenida ("Comenzar" / "Ya tengo cuenta"),
  ambas son alcanzables, los dos stubs de recuperación son navegables, y cancelar el
  prompt biométrico **no hace avanzar** el flujo.
- La dirección que llega al perfil viene del contrato de provider, no del formulario:
  cambiar el adaptador mock por el de Privy no toca la UI.

## Progreso

- **T1 — HECHA.** Causa raíz del install roto: `esbuild@^0.25.0` pineado contra
  `vite@8.3.1` (`esbuild ^0.27 || ^0.28`) y `tsx@4.21.0` (`~0.27.0`). Vite 8 migró a
  Rolldown y no usa esbuild: ambos pins eran muertos. Se quitaron `esbuild`, `tsx`,
  `autoprefixer` y `@types/express` de `devDependencies`.
  Evidencia: `npm install` → *added 161 packages, found 0 vulnerabilities*.
  `npm run lint` → exit 0. `npm run build` → exit 0, 1674 módulos, 465.17 kB
  (132.55 kB gzip). **Baseline verde: hay contra qué comparar cada task.**
  Warning menor pendiente: `vite.config.ts:11` usa `__dirname`, Vite 8 quiere
  `import.meta.dirname`.

- **T4 — IMPLEMENTADA, falta verificación visual.** Fork en Bienvenida: `Comenzar` /
  `Ya tengo cuenta`. La barra de progreso de 3 segmentos solo se muestra en la rama de
  creación; login y recuperación quedan fuera del embudo. `OnboardingFlow.tsx` bajó de
  651 a 547 líneas. Frontera nueva: `src/auth/contract.ts` (81) +
  `src/auth/mockProvider.ts` (157). `UserProfileData` gana `privyDid`, `walletAddress` y
  `providerWalletId`, que salen del provider y no del formulario.
  Evidencia: `npm run lint` (tsc) → exit 0. `npm run build` → exit 0, 1676 módulos,
  459.92 kB (132.79 kB gzip). Dev server sirve el módulo en 200.
  **Pendiente:** el flujo interactivo no se verificó clickeando. `Front End/` no tiene
  tests ni harness de DOM, así que el click-through queda como paso manual del usuario en
  `http://localhost:3000/`. No se marca `[x]` hasta eso.
  **Sin commit:** T0 sigue sin decisión de rama.

### T4b — Onboarding en tema claro + recuperación con popup de código

Dos correcciones del usuario sobre T4:

1. **Tema.** El primer pase quedó en dark (`bg-[#0A0A0A]`) y la app es **light**. Tokens
   reales, leídos de `index.css` y `ProfileView.tsx` — no inventados:
   - página `bg-[#f3f4f6]`, texto `text-black` / `text-slate-500`
   - cards `bg-white border-slate-200/80 rounded-[32px]`
   - **botón primario `bg-black text-[#ccff00]`** (no gradiente lima)
   - acento `bg-[#ccff00]`, pills `rounded-full`
   - `max-w-md` porque `App.tsx:102` ya constrain el ancho
2. **Recuperación.** Se rehízo: país **fijo y no editable** (bandera + nombre simplificado +
   prefijo) al lado del campo, el usuario **solo escribe su número**, y al enviar se abre
   un **popup de código de verificación**. Se reutilizó el idioma del modal de acción de
   `App.tsx:372-378` (backdrop `bg-black/60 backdrop-blur-sm`, card
   `bg-white rounded-[36px]`, cierre `bg-slate-100`).

`OnboardingFlow.tsx` quedó en 683 líneas. `npm run lint` exit 0, `npm run build` exit 0,
1676 módulos, 463.13 kB (133.43 kB gzip). CSS bajó de 66.65 a 58.83 kB: Tailwind 4 solo
emite las clases que se usan. Dev server sirve el módulo en 200.

**El popup no puede verificar todavía.** No hay backend ni provider, así que el envío y la
verificación del código son trabajo de Privy. El popup lo dice explícitamente en un aviso
ámbar y "Verificar" responde con un mensaje honesto en vez de fingir éxito. Es la misma
frontera de provider que ya quedó registrada arriba.

### T4c — Perfil: wallet a la vista, sin Face ID en vivo, y teléfono con prefijo fijo

Tres cambios pedidos por el usuario, en 2 archivos. **Sin commits** (decisión explícita).

**1. `ProfileView.tsx` (224 → 208 líneas)**
- Se elimina el botón **"Verificar Face ID en Vivo"**, su feedback de éxito, `handleVerifyFaceId` y los
  estados `isVerifying`/`verifySuccess`. Era un `setTimeout` que "verificaba" sin verificar nada.
- El avatar de la inicial se elimina del header.
- El pill verde **"Face ID Activo"** se reemplaza, en ese mismo lugar, por la **dirección de billetera
  resumida** (`0x3f8a...b21c`, primeros 6 + últimos 4) con **botón de copiar** al lado, que escribe la
  dirección **completa** con `navigator.clipboard` y confirma con un check verde por 1,8s.
- `Reiniciar Onboarding y Datos` → **`Cerrar Sesión`**. El handler **no cambia**: `handleResetOnboarding`
  (App.tsx:77) ya borra `localStorage`, limpia el profile y vuelve a `welcome`. Por eso **no se tocó
  `App.tsx`**.

**2. `OnboardingFlow.tsx` (683 → 694 líneas)**
- El teléfono del registro ahora tiene el **mismo bloque de país fijo y no editable** que la recuperación:
  bandera + `Argentina` + `+54` separado por `border-r`, y el input recibe **solo el número local**
  (`inputMode="numeric"`, `onChange` que descarta todo lo que no sea dígito, placeholder `9 11 0000 0000`).

**El gotcha que costó una corrección:** componer el teléfono en `onComplete` **no alcanzaba**. El mock
guarda el input crudo (`this.known = input`, mockProvider.ts:134) y el login lo pasa por `buildProfile`
sin componer, así que registrar → cerrar sesión → volver a entrar **en la misma sesión** mostraba
`911...` sin el `+54`. Recargar no lo reproduce, porque `known` es memoria del módulo. El fix compone
**una sola vez** en un objeto `registro` que va al provider *y* al perfil:

```ts
const registro = { ...form, telefono: composePhone(form.telefono) };
const { session, biometricLinked } = await authProvider.register(registro);
onComplete(buildProfile(registro, session, biometricLinked));
```

**Bug de layout que también era mío:** en los dos campos de teléfono (registro y recuperación) el
bloque de país no tenía `shrink-0` y el input tenía `w-full` dentro de un flex con `overflow-hidden`.
El bloque se comprimía, "Argentina" pasaba a dos líneas y el input se recortaba. Corregido en los dos:
`shrink-0` en el país, `min-w-0` en el input.

`npm run lint` exit 0. `npm run build` exit 0, 462.85 kB (133.35 kB gzip), CSS 58.39 kB.

### T5 — Fuera el mapa y las misiones; barra persistente y arranque en billetera

Decisión del usuario: "eliminamos por completo el mapa y las misiones... el perfil, el icono de
búsqueda y las notificaciones son un div que nunca desaparece, es como el que tenemos abajo para
navegar, solo no se lo ve cuando entramos a perfil". La app **arranca en billetera**.

**Borrado (4 archivos + 3 directorios):** `Map/OSMMap.tsx`, `Map/MapOverlayControls.tsx`,
`Missions/MissionsView.tsx`, `hooks/useGeolocation.ts` (solo lo usaba el mapa), más los dirs `Map/`,
`Missions/` y `hooks/`. `leaflet` y `@types/leaflet` fuera de `package.json` y `package-lock.json`,
`leaflet/dist/leaflet.css` fuera de `main.tsx` y las reglas `.leaflet-*` fuera de `index.css`.
`NavTab` pasó de 4 a 3 tabs (`wallet | investments | activity`).

**El hallazgo que cambió el plan:** el header con `$tag` + lupa + ticket + campana estaba
**duplicado 4 veces** — en `App.tsx` (dentro del bloque del mapa) y una copia en cada uno de
`WalletView`, `InvestmentsView` y `ActivityView`. Además la **lupa y la campana no tenían `onClick`**
en esas 3 copias: estaban muertas, y por eso el modal de Notificaciones solo se abría desde la
campana del header del mapa. Al borrar el mapa se perdía el **único acceso al perfil**, que es la
razón por la que el usuario decidió la barra persistente.

**Barra persistente:** sibling flex de `#screen-main-content` (NO absoluta, ocupa su franja y
`flex-1` toma el resto), envuelta en `{!isProfileOpen && ...}` para que desaparezca en el perfil.
Cápsula `$tag` a la izquierda (abre perfil) + píldora con la campana a la derecha (abre
notificaciones). El ícono de búsqueda **se eliminó**: su modal solo buscaba calles de OpenStreetMap.
Los 3 headers duplicados se borraron de los views.

**`profile` murió en los 3 views** al quitar el avatar y el `userTag` local: era un prop que ya no
leía nadie, porque esas pantallas muestran **datos hardcodeados**, no el perfil real. Se sacó de
las interfaces y de los call-sites. `ActivityViewProps` quedó vacía.

`App.tsx` 423 → 297 líneas. `npm run lint` exit 0, `npm run build` exit 0. **El bundle bajó de
462.85 a 296.47 kB (133.35 → 87.56 kB gzip) y el CSS de 58.39 a 38.53 kB: 166 kB que eran leaflet.**

**Pendiente de decisión — RESUELTO por el usuario:** "borrar solo la frase rota". Se eliminó SOLO la
oración de `WalletView.tsx` que mandaba a explorar el mapa ("Explora el mapa de calles..."). Quedan
intactas, por decisión explícita del usuario, "OpenStreetMap GeoLedger" (`ActivityView.tsx:287`) y
"Red OpenStreetMap Lemon" (`App.tsx:280`). También se limpió la interface vacía
`ActivityViewProps`. `npm run lint` exit 0, `npm run build` exit 0 (296.23 kB / 87.46 kB gzip,
CSS 39.56 kB), `dist/` borrado.

**Nota:** la sección "Mapeo Urbano & Red" de `WalletView` quedó con título + pill "Conectado" pero
sin cuerpo.

_(se completa task por task, con el commit de cada work-unit)_

## Próximo paso

**T4** — reescribir el onboarding. T0 (rama + commit de la reestructuración) sigue sin
decisión del usuario y **bloquea el aterrizaje, no la programación local**: se sigue
practicando en el working tree sin commitear, y no se commitea hasta que el usuario elija
rama.

### T6 — Sección de billetera: rendimiento del pool + últimas actividades

Reemplazada la sección vacía "Mapeo Urbano & Red" de `WalletView.tsx`. Transacciones extraídas a
módulos compartidos (`src/data/transactions.ts` con `mockTransactions`, y
`src/components/Activity/TransactionIcon.tsx` como componente) para no duplicarlas entre Wallet y
Activity. Nueva sección: div propio de Rendimiento Anual (header + `+12% anual` + nota placeholder,
todo envuelto en un div), y "Últimas Actividades" con `ultimas3 = mockTransactions.slice(0,3)` y
"Ver todo" como link de texto en el header que llama `onNavigateToActivity` (prop nueva en
`WalletView`/`App.tsx`, → `setCurrentTab('activity')`). Se eliminó el botón negro "Ver todo" de
abajo por redundante (ya está el link en el header). lint 0, build 0, dist borrado.
