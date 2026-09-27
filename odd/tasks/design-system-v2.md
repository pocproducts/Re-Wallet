# Feature — Rebrand a ReWallet Design System v2

**Feature**: `design-system-v2`
**Status**: planificado — no iniciado
**Created**: 2026-09-27
**Predecesor**: `onboarding-v2` (cerrado 9/9, 129/129 tests)
**Fuente**: `ReWallet_UI_UX_Design_System_v1.md` (Design System UI/UX v2, 53 secciones)
**Deadline de contexto**: Monad Metropolis, 2026-10-13

---

## Objetivo

Aplicar la identidad visual del design system —negro azulado profundo + verde flúor +
esmeralda + grises tecnológicos— sobre el prototipo que ya está verificado, **alineado a
las features que realmente tenemos**.

Es el último retoque antes de cablear. Después, `POST /auth/register/finish` y `GET /me`.

---

## Lo que SÍ se aplica

| Área | Cambio actual | Nuevo |
|---|---|---|
| Fondo | `#0A0A0B` (neutro) | `#080F14` (negro azulado) |
| Superficie | `#141416` / `#1C1C1F` | `#121C23` / `#18242C` |
| Acento | `#5B4DFF` **púrpura** | `#39FF14` **verde flúor** |
| Éxito | `#34C759` | `#19A800` texto / `#39FF14` marca |
| Warning | `#FFB020` | `#FFC857` |
| Error | `#FF6B5B` | `#FF4D5A` |
| Info | — no existe | `#3D8BFF` |
| Texto | `#F5F5F7` / `#A1A1A6` / `#6E6E73` | `#F7FAFC` / `#B8C2C9` / `#7F8B94` |
| Tipografía | Inter | **Montserrat** (400/500/600/700) |
| Tokens | `--color-*` | `--rw-*` |

## Lo que NO se aplica, y por qué

Esto es lo importante del documento de origen: trae bastante que no corresponde.

### 1. Light Mode — la trampa de tiempo

Las secciones 6, 46, 47 y el checklist (§53 "funciona en Light Mode") asumen un tema
claro completo. **No tenemos ninguno.** Implementarlo es días de trabajo: una segunda
paleta completa, y revisar los ~15 componentes que hoy usan `--color-bg-*` de forma
implícita.

El propio documento se declara *dark-first* en su introducción, así que el light mode
es aspiracional dentro de su propio marco. **Queda explícitamente fuera.**

### 2. Navegación de 5 tabs (§18)

El doc propone `Inicio | Wallet | Transferir | Actividad | Perfil`. Tenemos 3
(`Inicio | Actividad | Cuenta`). Y **"Transferir" como tab entra en conflicto con el
botón contextual que acabamos de construir**: en el flujo nuevo, la acción depende de si
el usuario ya recibió fondos. Una tab fija de "Transferir" contradice esa lógica.

**No se aplica.** La navegación queda como está.

### 3. 18 pantallas prioritarias (§49)

Tenemos 13. Faltan: Splash, tab Wallet, Cards, Card Detail, Security, Notifications,
Support. Ninguna está en el alcance de este hackathon. **No se aplican.**

### 4. Tarjeta virtual (§26) y sidebar de escritorio (§19)

Features, no colores. Somos un PWA mobile-first con marco de teléfono. **Fuera.**

### 5. Lucide como librería de iconos (§13)

Tenemos ~25 SVG a mano que ya funcionan y están verificados por la paridad de DOM.
Migrar a Lucide es agregar una dependencia y reescribir 25 iconos, con riesgo de
regresión visual justo antes de cablear. **El metalenguaje es el mismo** (outline,
stroke 1.5–2, redondeado). **Queda para después.**

### 6. Balance card (§24)

Acá el doc y lo que construimos **coinciden**: "Saldo disponible / saldo / variación /
[Enviar] [Recibir]" es exactamente la home en dos filas. No hay que cambiar nada.

---

## Los 11 literales inline: lo que rompe un rebranding

Un cambio de token **no toca** los colores escritos dentro de TypeScript. Estos son los
que hay que migrar a mano:

| Valor | Dónde | Qué pinta |
|---|---|---|
| `#5B4DFF` ×4 | `core/utils.ts` paleta `colorFrom`, `screens/settings.ts` avatar | **identidad de marca** |
| `#7A6EFF` ×3 | `components/icons.ts` logo, `screens/passkey.ts` Face ID ×2 | **lo más visible: el logo y el passkey** |
| `#8F84FF` ×2 | `boot.ts` log de consola | marca |
| `#34C759`, `#FFB020`, `#FF6B5B`, `#FF6BAE`, `#41B5FF`, `#A56BFF`, `#FF8F6B`, `#A1A1A6` | `core/store.ts` colores de contactos, `utils.ts` paleta | **avatares de contacto** |

Los últimos son un problema aparte: los colores de avatar se **guardan en el store**.
Migrarlos exige decidir si se re-pintan los existentes o solo los nuevos.

---

## Contradicción interna del design system que hay que resolver

El doc pide identidad verde flúor (§3) y en §52 dice que el producto
*"no debe parecer una app gamer o crypto experimental"*. El verde neón es exactamente
la señal visual que el público asocia con "cripto gamer". **El documento pide la
estética que dice evitar.**

Su propio §41 lo reconoce: DON'T usar verde flúor para todo, no usar glow excesivo,
no convertir cada pantalla en marketing.

**Cómo lo resuelvo:** el flúor queda para **identidad y CTA principal** (el botón
"Recibir dinero" de usuario nuevo, el saldo, el foco). Esmeralda para datos y gráficos.
Los grises hacen la jerarquía. Es decir: seguir la regla del doc, no sólo su paleta.

---

## Tareas

- [x] D1 — Tokens `--rw-*`: paleta, semánticos, spacing, radius
- [x] D2 — Migrar los literales inline a tokens
- [x] D3 — Tipografía Montserrat, JetBrains Mono conservada
- [x] D4 — Glow acotado al CTA principal
- [x] D5 — Estados accesibles: el texto de éxito usa `-700`, no verde flúor
- [x] D6 — Verificación: paridad, tests, build
- [x] D7 — Cambio de nombre a ReWallet (superficie visible)
- [x] D8 — Migración de avatares 0.5 → 0.6

## Desviación del design system: verde de marca

El usuario cambió la base de `#39FF14` a **`#3BAC28`** porque el neón resaltaba
demasiado. La desviación está justificada con medición, no con gusto:

| | sobre `#080F14` |
|---|---|
| `#39FF14` (neón) | **14.23:1** |
| `#3BAC28` (elegido) | **6.54:1** |

14:1 no es "más accesible": es vibración. El borde de un glifo a 14:1 serpentea
visualmente. 6.5:1 sigue pasando AA (4.5:1) con holgura y se lee como color.

**La escala se re-derivó, no se copió.** En fondo oscuro, más legible significa más
CLARO, no más oscuro — un error fácil de cometer:

| token | valor | contraste | uso |
|---|---|---|---|
| `brand-400` | `#55C447` | 8.61:1 | texto chico, badges, hover |
| `brand-500` | `#3BAC28` | 6.54:1 | CTA, saldo, foco |
| `brand-600` | `#2E8C20` | 4.49:1 | solo presionado, **nunca texto** |
| `brand-700` | `#266E1A` | — | texto en light mode; no se usa |

### Dos problemas que encontró el test de contraste

1. **El esmeralda quedó más brillante que la marca.** Al mutear el neón, el esmeralda
   `#1DB981` pasó a medir MÁS que `#3BAC28`, invirtiendo la regla del propio doc
   ("la identidadidentify sobre los datos"). Bajado a `#17A87A` (6.35:1, por debajo).

2. **Los bordes no identifican un input.** `--rw-dark-600` del doc da **1.48:1** sobre
   la superficie: WCAG 1.4.11 pide 3:1 para todo lo que define un control. Se separación
   en dos tokens: `--rw-dark-600` sigue para decoración, y los inputs usan
   `--rw-border-input: #5E717B` (3.39:1).

Cubierto por `scripts/contrast.test.ts` (16 tests), que calcula los ratios desde el CSS
real para que un "volvamos a hacerlo más brillante" no pase inadvertido.

## Decisiones tomadas (usuario, 2026-09-27)

1. **Se adopta ReWallet como nombre.** El producto pasa a llamarse ReWallet.
2. **Los avatares existentes se re-pintan** con la paleta nueva, no solo los nuevos.
   Implementado como la migración de store `0.5 → 0.6`, que remapea los colores
   viejos por posición en la paleta.
3. **Montserrat + JetBrains Mono se mantiene.** Una sola familia habría perdido el
   carácter técnico de tags y montos.

## Lo que quedó fuera a propósito

- **Renombre de paquetes del monorepo** (`@bestpath/shared`, `@bestpath/api`). Es
  interno: no se ve en la demo, toca config de pnpm, y agrega churn antes de cablear.
- **Light mode.** Fuera de alcance, escrito arriba para que no se cuele.
- **Migración a Lucide.** 25 SVG verificados por la paridad; mismo metalenguaje.
- **Dominio real `rewallet.app`.** Los links del mock ya apuntan ahí, pero el dominio
  no existe todavía.

## Verificación

| | |
|---|---|
| `pnpm typecheck` | 5/5 paquetes |
| `pnpm test` | **146/146** — 31 api + 115 web |
| `pnpm build` | ok |
| `dev.sh up` | web 200, api 200 |
| Literales de paleta vieja fuera de la tabla de migración | **0** |
| Tokens `--color-*` restantes | **0** |

## El hallazgo que costó caro

El renombre de tokens **no toca los `rgba()` crudos**. Había 24 rgba de la paleta
violeta/verde-manzana分布 por `global.css`, `welcome.ts` y `activity.ts` que una
renumeración ingenua de `var(--color-x)` deja intactos. Se migraron con una tabla que
preserva el alpha, no a ojo.

## Criterios de aceptación

1. Cero literales hex en `.ts` que no sean datos de avatar
2. `pnpm typecheck` 5/5, `pnpm test` verde, build ok
3. La paridad de DOM sigue pasando, con los tokens en la lista de diffs aprobados
4. Contraste de texto principal y CTA por encima de 4.5:1
5. Ningún estado financiero se comunica solo con color

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El verde neón cansa o vibra en pantalla | Usarlo solo en identidad y CTA; el resto en esmeralda y grises |
| Romper la paridad de DOM | Los tokens van a la lista de diffs, no se borra el test |
| Re-pintar avatares rompe datos guardados | Decidir explícitamente: solo nuevos, o migrar los existentes |
| Perder tiempo en light mode | Fuera de alcance, escrito acá para que no se cuele |
