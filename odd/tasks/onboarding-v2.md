# Feature — Onboarding v2 y Home en dos filas

**Feature**: `onboarding-v2`
**Status**: en progreso
**Created**: 2026-09-27
**Predecesor**: `poc-frontend` (cerrado), skeleton del monorepo (cerrado)
**Deadline de contexto**: Monad Metropolis, 2026-10-13

---

## Objetivo

Que el onboarding capture todo lo que el perfil necesita, y que la home refleje el
estado real del usuario. Es frontend + schema. **El cableado viene después** y es
más mecánico si la UI ya está resuelta.

## Decisiones tomadas (usuario, 2026-09-27)

### Tag estilo `ana`, no random

- El tag es un **alias legible y editable**, no la identidad.
- La identidad la garantiza `users.user_seq` (secuencia, nunca cambia).
- La no-colisión la garantiza `UNIQUE` en `tag` y `tag_normalized`, en todo momento.
- Generación: sanitizar el nombre → si está tomado, anexar `2`, `3`, `4`… hasta
  encontrar uno libre. Loop acotado; si se agota, cae a `user{seq}`.
- Se genera **siempre en el servidor**, dentro de la transacción de registro. Nunca
  en el cliente: dos registros simultáneos en el cliente se pisan.
- El tag **no aparece en la URL de cobro** (esa es `/pay/{id}` con nanoid), así que
  que un alias se libere no rompe pagos existentes. Esto es lo que hace seguro que sea
  editable.

### Paridad de DOM: lista de cambios aprobados

El test de paridad sigue comparando contra el prototipo original, pero tolera un
conjunto explícito de diferencias que se aprueban a mano. Detecta regresiones no
intencionadas y no obliga a elegir entre "test verde" y "test borrado".

---

## Tareas

- [x] F1 — Schema: `first_name`, `last_name`, `user_seq`, `first_funds_at`, país de teléfono
- [x] F2 — Generador de tags server-side, con tests
- [x] F3 — Test de paridad migrado a lista de cambios aprobados
- [x] F4 — Onboarding: nombre y apellido
- [x] F5 — Onboarding: email
- [x] F6 — Onboarding: teléfono con selector de país
- [x] F7 — Home en dos filas: saldo arriba, movimientos recientes abajo
- [x] F8 — Botón contextual: "Recibir" destacado hasta el primer saldo
- [x] F9 — Verificación: typecheck, tests, migración, re-baseline de paridad

## Verificación final

| | |
|---|---|
| `pnpm typecheck` | 5/5 paquetes |
| `pnpm test` | **129/129** — 31 api + 98 web |
| `pnpm build` (web) | ok |
| `dev.sh up` | web :5173 y api :3000, ambas 200 |

## Cierre de UI: placeholders y tag derivado

Últimos ajustes pedidos antes de cablear:

- **Los cuatro inputs usan placeholder como título**, sin `<label>` flotante. El
  campo de texto del CSS ocultaba el placeholder (porque el label flotaba encima);
  se creó `.field-plain`, donde el placeholder sí se lee.
- **El tag dejó de ser input.** Se deriva de nombre + apellido mientras se tipea
  (`suggestTag('Ana Sofía Chen') → anasofachen`), y la disponibilidad se consulta
  sola con debounce de 320 ms. Es la única fila con título, porque no se escribe:
  necesita explicación. Si el handle derivado está tomado, muestra lo que
  propose el servidor.
- **Teléfono en una fila:** bandera + código de área (Argentina por defecto, `+54`)
  + número, todo en una línea. El campo del número sigue siendo solo nacional:
  prefijarlo dos veces rompe el E.164.
- **`pnpm dev` arranca siempre en welcome**, dentro del guard de
  `shouldResetOnBoot()`. Un test verifica que el salto a welcome esté DENTRO de ese
  guard, para que un build de producción conserve el comportamiento de reanudar.

### Orden final de la pantalla

```
fila 1  [ Nombre        ] [ Apellido      ]
fila 2  [ Tu correo                          ]
fila 3  TU USUARIO        @anasofiachen  ✓
fila 4  [ 🇦🇷 +54 ▾ ] [ Número             ]
fila 5  [ Continuar                         ]
```

**Supuesto declarado:** el correo se mantiene. No apareció en la enumeración de filas
pero sí en la lista de placeholders, y descartar un dato que ya se recolecta sin que
me lo digas sería una pérdida. Si lo querés fuera, es una fila y un campo.

## Cierre: listo para probar desde cero

- **Reset en cada arranque de dev.** `config.resetOnBoot` + `shouldResetOnBoot()`
  borran el estado persistido al bootear, así `pnpm dev` siempre arranca en el
  flujo de primera vez. Guardado con `import.meta.env.PROD`: un build de
  producción **nunca** limpia estado real. Cubierto por `scripts/devreset.test.ts`.
- **Onboarding colapsado a una pantalla** con las cuatro filas pedidas
  (nombre+apellido en dos columnas, correo, teléfono, tag con recomendación).
- **Perfil**: identidad limpia (foto + nombre más grande + tag con botón de copiar,
  sin iconos por fila) y sección de contacto con correo y teléfono.

## Decisiones tomadas durante la implementación

### F6 — lista de países reducida

El usuario recortó "todos los países" (~250) a **60**: 22 de Latinoamérica primero
(mercado de lanzamiento), después alta adopción cripto, Europa y Asia-Pacífico.

### Bug encontrado: NANP

`+1` lo comparten US y Canada. `fromE164` parseaba cualquier número de ahí como
americano. Ahora devuelve `candidates[]` + `ambiguous`, y elige el dial más largo
para que un prefijo corto no tape uno más específico.

### F4 — el tag no se previsualiza

La pantalla de nombre **no** muestra un tag estimado. El tag lo aloca el servidor desde
la secuencia, así que un preview en el cliente puede discrepar con lo que el usuario
termina recibiendo. Mostrar nada es mejor que mostrar una mentira.

### F5/F6 — la verificación no se promete

Email y teléfono se **recolectan**; ninguna pantalla dice "verificado" ni menciona
código. La verificación es una feature posterior. Recolectar primero evita bloquear a
quien nunca verifica.

### F4 — la pantalla `recovery` sigue existiendo

Sale del flujo de primera vez, pero se conserva para editar el perfil. Verificado por
test.

### El tag pasó a ser editable con validación

El usuario pidió que el tag fuera un input con el usuario recomendado escrito por
defecto, que verifique que no esté creado. Eso cambió una decisión previa: ya no es
solo "el servidor aloca", sino "el usuario puede elegirlo y el servidor valida".

- El sanitizador se mudó a `packages/shared/src/tag.ts` para que la recomendación
  del cliente y la asignación del servidor **no puedan divergir**. Si el cliente
  adivinara otra regla, mostraría `@ana` y entregaría `anna`.
- La disponibilidad sigue siendo del servidor. El cliente sanea, sugiere y
  pregunta; nunca inventa un handle.
- `BP.api.checkTag()` es la costura que la fase de cableado reemplaza con
  `GET /tags/check?tag=…`.
- Consulta con debounce de 320 ms para no pegarle al endpoint en cada tecla.

### F9 — boot retoma el paso

Onboarding de varios pasos: si el usuario abandona a mitad, `boot.ts` lo devuelve al
paso donde llegó (perfil / email / teléfono) en vez de mandarlo a welcome.

## Fuera de alcance (fase siguiente)

- Verificación real de email y teléfono por código — **solo se recolectan**
- Cableado de la API
- Recover de passkey o el guardado de contactos

---

## Detalles de diseño que hay que respetar

### F1 — por qué `first_funds_at` y no mirar el saldo

El botón "Recibir" destacado se muestra **una sola vez**, hasta que entra el primer
saldo. Si se inferiera de `balance === 0`, un usuario que gastó todo volvería a ver
el onboarding de bienvenida. El campo `first_funds_at` se setea una vez y nunca se
resetea. Es un problema de estado, no de saldo.

### F1 — el teléfono se guarda en E.164

`recovery_phone` guarda el número completo en E.164 (`+549112345678`). El selector de
país solo sirve para construirlo y para preseleccionar la UI, así que hace falta el
código de país aparte para no perder el valor que el usuario eligió.

### F2 — sanitización del tag

- minúsculas
- quitar acentos: `á` → `a` (NFD + strip de diacríticos, no replace manual)
- solo `[a-z0-9]`
- colapsar separadores
- fallback `user` si el nombre queda vacío

---

## Criterios de aceptación

1. `pnpm typecheck` limpio en los 5 paquetes
2. `pnpm test` verde: tests de la API + los de la web + paridad
3. La migración crea las columnas nuevas y `user_seq` rellena solos a los users
   existentes
4. El generador de tags tiene tests: colisión, acentos, nombres vacíos, unicidad
5. El onboarding completo se puede recorrer de punta a punta en el navegador
6. Un usuario nuevo ve "Recibir" destacado; uno con saldo ve "Enviar"
7. El test de paridad pasa y distingue cambio aprobado de regresión

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Romper el flujo verificado de passkey | F4-F6 agregan pasos, no tocan la lógica de auth |
| La paridad tape regresiones reales | La lista de aprobados es explícita y revisable, no un catch-all |
| Onboarding queda largo para el video | Verificar el tiempo del flujo completo; si molesta, agrupar en una pantalla |
