# Hoja 4 — Identidad, acceso y seguridad: quién entra y qué se protege

> Hoja 4 de N. **CERRADA. 38 de 38 celdas contestadas, cero preguntas abiertas.**
> Las seis contradicciones que quedaron abiertas no son preguntas de esta hoja: son
> reglas de las hojas 1 y 2 que esta hoja cambió, más trabajo de construcción. Todas
> están listadas al pie con su dueño.

**Ya decidido en las hojas 1, 2 y 3, y no se pregunta aquí:**
- La persona **no ve errores de sistema**; ve mensajes accionables.
- La **dirección nunca se ve ni se escribe**: la prohibición es **global**.
- **Nunca jerga técnica**: ni "gas", ni "red", ni "confirmaciones", ni nombres de
  protocolo, cadena o token.
- **Nunca vacío**: si un dato no se pudo leer, último valor conocido con su hora.
- **Ninguna acción pide biometría.** La biometría protege la creación de la
  passkey. Ni enviar, ni retirar, ni cobrar, ni convertir (Hoja 3, contradicción 7).
- El detalle de una operación **es privado**.
- Sesión actual en el código: `rw1_` + SHA-256, cookie httpOnly, sliding 30 días,
  techo 90 días, revoke idempotente.

**Quién cumple:** el backend (`Backend/`) contra `application/auth` e
`infrastructure/auth` — **ambos vacíos hoy** — y la tabla `users`. El front
(`05. UI-UX/`) usa hoy un `MockAuthProvider` que hay que reemplazar.

---

## 0. Decisiones de fondo

### 0.1 ¿Cómo se verifica el teléfono en Fase 1? — **NO SE VERIFICA**

**El teléfono se pide y se guarda. No se verifica nunca en Fase 1.**

La razón es económica y es una buena: **el envío de un mensaje al teléfono es un
gasto fijo por verificación**, y el costo no se amortiza con volumen chico. El
correo, en cambio, no cuesta por envío. Entonces **el correo es el único canal de
verificación** y el teléfono queda como un dato de contacto, sin verificar.

Consecuencias escritas, y son las que hacen esta decisión coherente:

- **No hay costo de SMS ni WhatsApp.** Se descarta el problema de Privy: el SMS
  fuera de USA/Canadá es un add-on de pago, con cuenta Twilio propia, y solo en
  planes Escala o Empresa. Al no verificar el teléfono, **ese costo nunca aparece**
  en Fase 1 y **ReWALLET no depende de Twilio**.
- `users.recovery_phone` se **llena pero nunca se marca como verificado**. La
  columna `recovery_phone_verified` queda en `false` para siempre.
- El teléfono **no sirve para entrar** (sección 3, pregunta 6).
- El teléfono **no sirve para recuperar la cuenta** (sección 6, pregunta 2).

<!--
COMENTARIO — por qué el teléfono no se verifica, y qué se pierde por eso.

Decisión del cliente: el costo del SMS es un gasto fijo y en Fase 1 no se
justifica. El correo verificado alcanza como única prueba de identidad.

Consecuencia asumida y escrita: **el teléfono es un dato que la persona
declara, no un dato probado.** Cualquiera puede escribir el número de otra
persona. Eso tiene dos efectos que hay que tener presentes al construir:

  1. El teléfono NO puede ser una evidencia para soporte. Ver la sección 6,
     pregunta 2: el rescate por soporte se apoya en el teléfono, y con el
     teléfono sin verificar esa evidencia no prueba nada. Hay que resolverlo
     con otra cosa.
  2. El teléfono no sirve para avisarle a nadie con seguridad. Un aviso por SMS
     a un número no verificado puede llegar a otra persona.

Lo que NO se hace: no se manda SMS "de prueba" para ver si el número existe. Eso
también es un costo y además confirma un dato falso ante un tercero.

Lo que queda a favor de la decisión: el correo verificado tiene una garantía
técnica real y no cuesta por envío. Es el canal correcto para el único canal.
-->

### 0.2 ¿La verificación es obligatoria para entrar? — **SÍ, BLOQUEA TODA LA APP**

**El código de verificación del correo desbloquea toda la app.** No hay modo de
usar ReWALLET sin haberlo puesto.

La secuencia completa, en orden:

1. La persona abre la app por primera vez y elige una de las **dos puertas**
   (sección 1): **Crear cuenta** o **Ya tengo cuenta**.
2. Si es nueva, se le pide la **passkey**: Face ID, Touch ID o huella. Esa es la
   creación de la cuenta.
3. En el onboarding se piden, en este orden: **correo → teléfono → nombre y
   apellido** (sección 2). Los tres campos son obligatorios.
4. Se envía un **código de 6 dígitos** al correo recién escrito.
5. Se lo pone. **Recién ahí se desbloquea la app.**

Y en el camino inverso, para quien ya tiene cuenta: se envía el mismo código de
6 dígitos al correo con el que se registró, se lo pone, y entra.

Antes de ponerlo, **no ve nada de ReWALLET**: pantalla de código y nada más (ver
0.3).

**La passkey no abre la app por sí sola.** Crea la cuenta, pero el acceso real lo
da el correo verificado. La passkey es *cómo se demuestra que sos vos*; el correo
es *quién sos*.

<!--
COMENTARIO — el código de verificación es el de Privy, y eso define sus reglas.

Decisión del cliente: se sigue lo que Privy hace. No se manda un código propio.

Entonces las reglas del código **no son nuestras**, son las de Privy:

  - **6 dígitos.** No 4. La longitud no se configura ni en el SDK ni en el
    dashboard.
  - **10 minutos** de validez, fijo.
  - Los límites de reenvío son los de Privy, no un pleno de 1 minuto nuestro.

Y lo que se pierde, que estaba pedido y ya no existe:

  - **No se puede cambiar el correo de destino.** No hay hook: el destinatario
    queda fijo en el envío. Esto caía bien porque se quería dar una segunda
    oportunidad a quien se equivoca al escribir el correo. Ver el riesgo de la
    6.3.
  - **No hay pleno de 1 minuto.** Mandar otro código es llamar de nuevo a Privy y
    correr con lo que él permita.

Lo que se gana, y es más que lo que se pierde:

  - **Cero dependencias nuevas.** No hace falta proveedor de correo: no hay
    Resend, ni Postmark, ni SES. El proyecto hoy no tiene ninguno y no pasa a
    tener uno.
  - **La garantía de correo único viene de Privy.** `primaryEmailAddress`
    *"cannot be linked to another user"*: un correo no puede pertenecer a dos
    cuentas, y el backend lo rechaza sin ambigüedad. La 3.5 no hay que
    implementarla, se hereda.
  - **No hay código que hashcar ni tabla que crear.** El código nunca lo ve
    ReWALLET: lo manda Privy, lo verifica Privy y lo borra Privy.

El flujo técnico, que es el que hay que construir:

  1. La passkey **crea y autentica** al usuario en Privy.
  2. El onboarding pide el correo.
  3. Se llama a **linkear el correo** al usuario que ya existe, no a crear una
     sesión nueva. Es la diferencia entre `linkEmail` y `useLoginWithEmail`: si se
     usara el segundo, el correo crearía un usuario nuevo y desligado del que
     creó la passkey. **Ese es el error a evitar.**
  4. Privy manda el código. La persona lo pone.
  5. El correo queda **verificado por el hecho de haberlo verificado**: no hay
     un estado "verificado" aparte, la verificación ES el linkeo.

Dos cosas que esto obliga a definir, y que no están contestadas:

  - **La fila de `users` no debería crearse hasta que el correo esté verificado.**
    Si se crea antes, cada intento de onboarding abandonado deja una cuenta sin
    correo a la que nadie puede volver a entrar. Hoy `users.tag` es `NOT NULL` y
    único, así que además cada intento gasta un tag.
  - **Privy tiene `is_guest` y usuarios sin método de acceso linked.** Una cuenta
    creada con passkey y abandonada antes del correo queda viva del lado de Privy.
    Hay que decidir si se limpia.
-->

### 0.3 ¿Se sigue manteniendo "a nadie se le tapa la billetera por no verificar"? — **NO. PANTALLA DE CÓDIGO Y NADA MÁS**

**Opción a.** Antes de poner el código, la persona **no ve la app**: ve la
pantalla del código y nada más. Sin saldo, sin acciones, sin perfil, sin billerera.

La regla de la Hoja 2 queda **reemplazada**: sí se tapa, y la razón es que ReWALLET
mueve plata real desde el primer día. No es una app de lectura.

Es la opción más simple de construir y la más coherente con la 0.2: si el código
desbloquea todo, entonces antes del código no hay nada. No hay un estado
intermedio que haya que mantener.

**Consecuencia que hay que aceptar:** el primer contacto con ReWALLET no muestra el
producto. Quien llega, ve "creá tu cuenta con tu huella, mandanos un código a tu
correo", y recién ahí conoce la app. Es la apuesta: se pide un costo de entrada
para que después no haya un limbo sin verificar.

---

### 0.5 ¿En qué orden se crean las wallets? — **[FIJO] PRIMERO LA EVM, DESPUÉS LA DE SOLANA**

**La cuenta se crea primero y después la wallet. En ese orden. No se cambia.**

| | |
| --- | --- |
| **1° — la EVM** | Siempre primero. **Sin excepción.** |
| **2° — la de Solana** | Siempre después. Obligatoria. |
| **Cadenas** | **Solo esas dos en esta etapa.** |

**"Cadenas" significa solo EVM y Solana.** No hay una tercera. En el laboratorio
existió `cosmos` como tipo de cadena, **y no llega a la etapa actual**: no se escribe
en el schema de `06. Backend/`.

**Esto no es un default de Privy.** `createWallet` es **una llamada por cadena**, y
en ambas variantes el parámetro de "wallet adicional" viene en `false`. O sea que
Privy no crea "primero EVM y después Solana" por su cuenta: **el orden lo elegimos
nosotros, y quedó fijado así.** Si el código llama a `createWallet` al revés, está
mal, no es una preferencia.

**Por qué importa el orden y no es un detalle.** No es una cuestión estética:
hay dos razones por las que llamarlo al revés rompe cosas.

1. **La EVM es la que se usa.** La Hoja 3 define Fase 1 sobre Monad, que es EVM. La
   wallet que se necesita para operar tiene que ser la primera; la de Solana
   acompaña.
2. **El orden es lo que hace verificable la escritura en la base.** El schema valida
   la dirección **según la cadena declarada**: una fila `ethereum` exige un patrón
   `0x…` y una `solana` exige un patrón SVM. Si se creara al revés y se escribieran
   en el orden equivocado, la base rechaza la dirección — que es lo correcto, y es
   exactamente el error que el orden fijo previene.

**Consecuencia asumida y escrita.** La wallet de Solana es obligatoria **aunque
todavía no haya producto sobre Solana**. Fase 1 opera sobre Monad. Es decir: se paga
el costo de provisionar una wallet TEE en una cadena que el producto aún no usa. Se
acepta a la vista, y por eso queda escrito acá: el día que se mire el costo de
provisión por usuario, esta es la línea que lo explica.

**Una wallet por persona por cadena, nunca dos.** El schema lo garantiza con
`UNIQUE (user_id, chain_type)`: una EVM y una Solana, como máximo. Repetir una
dirección del mismo tipo es un bug, no un caso de uso.


### 0.4 ¿Qué pasa con un onboarding a medias? — **NO SE ESCRIBE NADA HASTA EL FINAL**

**Nada existe hasta que la cuenta está completa.** Ni usuario, ni tag, ni wallet.

**Cómo funciona**

1. La passkey crea el usuario en Privy — eso es inevitable, lo hace Privy — pero
   **ReWALLET no escribe nada todavía**.
2. Los datos del onboarding (correo, teléfono, nombre) **viven en el dispositivo**,
   como un borrador local. No llegan a la base.
3. Al poner el código de 6 dígitos, y solo ahí, se escribe la fila de `users`, se
   genera el @tag y **se provisiona la wallet TEE **en el orden fijo de la 0.5: primero la EVM, después la de Solana**.
4. Si la persona vuelve, **el borrador sigue ahí** y sigue en el paso donde estaba.
   No tiene que empezar de cero.

**Por qué esta y no una tabla de "borradores"**

Es el patrón que usan las fintech para bajar el abandono: **guardar el
progreso parcial y restaurarlo**, en vez de crear una cuenta a medio hacer. Y para
ReWALLET tiene una ventaja que no tiene la alternativa: **si nunca vuelve, no queda
nada**. Sin tarea de limpieza, sin cuentas muertas, sin tags gastados.

La alternativa —crear una fila con `status = 'draft'` y un TTL— obliga a una tarea
periódica que la borre, y el día que esa tarea falle quedan cuentas a medias. Acá el
borrador no está en la base: **no hay nada que limpiar porque no hay nada escrito.**

**Cómo se fuerza a terminar, entonces, si no queda nada escrito**

Con lo contrario: **no perder lo que ya hizo.** Volver es un toque y sigue donde
estaba. La sesión de la passkey sigue viva, así que ni siquiera hay que volver a
escanear el dedo. Abandonar es caro para la persona, no para el sistema — y esa es
la diferencia: **el sistema no necesita castigar el abandono para que la gente
termine.**

**Dos detalles que hay que respetar**

- El borrador es **dato personal en el dispositivo**. Cuando la cuenta se completa,
  **se borra**. Y si vuelve a la app mucho después sin completar, también.
- Se puede reabrir el draft si la persona reinstala o cambia de dispositivo, pero
  **empezando de cero**: el borrador no viaja. Es un borrador.

<!--
COMENTARIO — por qué NO crear una fila con status draft.

Se evaluó la alternativa habitual: crear la fila de `users` al empezar el
onboarding con un `status = 'draft'` y un TTL que la borre. El problema concreto:

`users.tag` es `NOT NULL` y **único** (`schema.ts:280-281`). Cada intento de
registro consumiría un tag, incluidos los que se abandonan al minuto uno. Y la
wallet TEE, si se provisiona antes de tiempo, es un recurso real creado para una
cuenta que quizá no exista nunca.

Con el borrador en el dispositivo, ninguna de las dos cosas existe hasta que la
cuenta es real. Y no hace falta ninguna tarea de limpieza: **no hay nada que
limpiar porque no hay nada escrito.**
-->

---

## 1. Crear la cuenta

### 1.1 ¿Cuál es el primer paso al abrir la app por primera vez? — **DOS PUERTAS**

La pantalla de bienvenida tiene **dos botones** y solo dos:

| Puerta | Qué pasa |
| --- | --- |
| **Crear cuenta** | Passkey → onboarding (correo, teléfono, nombre) → código de 4 dígitos al correo → entra. |
| **Ya tengo cuenta** | Se pide el correo con el que se registró → se envía el mismo código de 6 dígitos → lo puesto y entra. |

En la segunda puerta **no se pide passkey**: entra directo por correo. La passkey
solo se crea en la primera vez.

### 1.2 ¿Puede alguien entrar con un método que no sea passkey? — **SÍ, POR CORREO**

**Opción b.** El correo con código es una puerta de entrada real, no solo un
rescate. Si el código corresponde a una cuenta que ya existe, **entra a esa
cuenta**; no crea una nueva.

Esto es lo que hace que la segunda puerta de la 1.1 funcione, y es lo que evita
que un correo ya usado cree una segunda cuenta en paralelo.

### 1.3 ¿Dónde vive el passkey? — **EN EL DISPOSITIVO, SIN RESPALDO**

**La passkey vive solo en el dispositivo y no tiene respaldo.**

La consecuencia es la que está escrita en la 6.1 y se acepta a la vista:
**perder el dispositivo es perder una vía.** La otra es el correo verificado.

Se eligió sin respaldo, y no es un descuido: con respaldo, la passkey reaparece
sola en cualquier otro dispositivo del usuario, y eso vuelve el correo — que es lo
único que sirve como identidad y lo único que el sistema puede comprobar — en una
vía opcional. **El correo tiene que ser el ancla, y para que lo sea no puede haber
una vía igual de cómoda por debajo.**

En la práctica: en iPhone la passkey suele respaldarse en iCloud, y en Android en
Google Password Manager, sin que nadie lo decida. Decir "sin respaldo" es decir
**"ReWALLET no garantiza ni promete nada del respaldo"**, que es lo que hay que
poder decir.

### 1.4 Si la passkey falla en el momento, ¿qué ve la persona? — **PUEDE ENTRAR POR CORREO**

Si el Face ID, el Touch ID o la huella fallan, **la persona no queda encerrada**:
puede entrar por el correo con el código de 6 dígitos, que es la segunda puerta y
está siempre disponible.

Lo que se ve en el momento del fallo es **el diálogo nativo del sistema**, porque
esa pantalla no es de ReWALLET. ReWALLET no la intercepta ni la reemplaza.

Esto es coherente con la Hoja 3: la biometría nunca fue una barrera, fue un
comodorio. Cuando el comodio falla, queda el correo.

### 1.5 ¿Se pide biometría para crear la passkey? — **SÍ, Y SE EXPLICA POR QUÉ**

Antes de que aparezca el diálogo nativo, ReWALLET **explica para qué** se pide,
en palabras de persona: **"Usamos tu huella para que nadie entre a tu cuenta"**.

La Hoja 3 ya había cerrado que la biometría protege **solo la creación de la
cuenta**. Esto no agrega un segundo pedido biométrico en ningún otro momento: es el
mismo, con una explicación antes.

### 1.6 ¿Se puede crear una cuenta sin passkey? — **SÍ, POR CORREO — Y SOLO EN WEB Y MÓVIL**

El correo verificado es una **vía de acceso real**, no un residuo: la segunda puerta
de la 1.1 funciona así.

**No hay desktop.** El producto es **web y app móvil**, y ahí el correo está
disponible. Se descarta la pregunta de desktop y queda una sola superficie que
soportar.

---

## 2. Onboarding: los datos

### 2.1 ¿Qué se pide y en qué orden? — **CORREO → TELÉFONO → NOMBRE**

| Orden | Campo | Qué pasa |
| --- | --- | --- |
| 1 | **Correo** | Es el primero porque **es el único que se verifica**. Se manda el código de 6 dígitos y se pone en el acto. |
| 2 | **Teléfono** | Se pide y **se guarda. No se verifica.** |
| 3 | **Nombre y apellido** | Un solo input de texto libre. Es lo último porque no se verifica y no bloquea nada. |

El criterio del orden es uno: **primero lo que se prueba, al final lo que no**.

### 2.2 ¿El nombre es un input o dos? — **UNO SOLO**

Un solo input: `"Juan Pérez"`. No hay campo de nombre y campo de apellido.

### 2.3 ¿Hay un nombre "para los demás" y otro "para mí"? — **NO, UNO SOLO**

El mismo nombre en todos lados. No hay nombre social separado del personal.

### 2.4 ¿Se puede dejar un campo en blanco? — **NO, LOS TRES SON OBLIGATORIOS**

No hay campos opcionales y no hay "completar después". El onboarding se completa o
no se completa.

**Ojo con el teléfono**: es obligatorio **como campo escrito**, pero **no se
verifica**. Obligatorio no es lo mismo que probado.

### 2.5 ¿Quién escribe el @tag? — **LO GENERAMOS NOSOTROS, Y SE PUEDE PEDIR OTRO**

El @tag se construye a partir del nombre, con un sufijo para que sea único:
`juan.perez.a3f2`.

Se genera nuestro porque pedir un @tag libre a alguien que acaba de crear la
cuenta es pedirle que se acuerde de una regla abstracta en el peor momento. La
persona **puede pedir otro** si no le gusta el que le tocó.

### 2.6 ¿Términos y condiciones? — **NO HAY CHECK**

**No hay términos, no hay pantalla de aceptación, no hay Privacy Policy.** Usar la
app es aceptar.

Se raisaó y se volvió a dejar así: los términos y el consentimiento **se hacen
cuando haya algo que atender formalmente** (crédito, retiro bancario, producto
regulado). Antes de eso serían texto legal vacío que nadie lee y que igual
tendría que mantenerse al día.

El costo de esa decisión está escrito en la 6.6 y hay que aceptarlo a la vista:
**sin consentimiento explícito, soporte no puede mirar una cuenta.** Punto.

---

## 3. Verificar el correo

### 3.1 ¿En qué momento se verifica? — **EN EL ACTO**

Se escribe el correo, se manda el código, se lo pone, listo. No hay una pantalla
posterior de "verificá tu cuenta" que alguien pueda saltarse.

Es lo mismo que dijo la 2.1: correo primero, porque es lo único que se verifica.

**Es el linkeo del correo al usuario que ya existe**, no un login nuevo: la
passkey ya lo autenticó. Ver el comentario de la 0.2.

### 3.2 ¿Cuánto vive el código? — **10 MINUTOS, LOS DE PRIVY**

Válido por **10 minutos**, fijo, que es lo que manda Privy. No es un parámetro
nuestro y no hay forma de cambiarlo.

### 3.3 ¿Se puede reenviar el código? — **SÍ, CON LOS LÍMITES DE PRIVY**

Se puede pedir otro código. **El plazo entre uno y otro no es nuestro**: se
cayó el pleno de 1 minuto cuando se decidió seguir las reglas de Privy, así que
rige lo que Privy permita.

Lo que hay que construir no es un botón sino el manejo: si se pide demasiado
rápido, la respuesta de Privy tiene que volverse un mensaje accionable, no un
error. Y hay que decidir **qué se le dice a la persona** cuando el reenvío no se
puede hacer todavía.

### 3.4 Si el código nunca llega, ¿qué ve la persona? — **"NO LLEGÓ EL CÓDIGO. PROBÁ DE NUEVO."**

Mensaje simple y un botón para reintentar. Sin jerga, sin decir "SMTP", sin decir
"dirección de correo inválida", sin tiempos de espera técnicos.

Se mantiene la línea de la Hoja 1: lo que se ve son **mensajes accionables**, lo
que no funciona va a telemetría.

### 3.5 Si el correo ya pertenece a otra cuenta, ¿qué pasa? — **SE RECHAZA Y SE OFRECE ENTRAR**

Si alguien escribe un correo que ya tiene una cuenta, la app **no crea una cuenta
nueva**: lo rechaza y dice **"Ese correo ya tiene una cuenta"**, ofreciendo entrar
con él.

Se dice explícitamente que la cuenta existe, en vez de un rechazo neutro. Es una
app de dinero: una persona que se equivoca de correo necesita saber que se
equivocó, no un silencio.

Esto está respaldado por Privy: `primaryEmailAddress` *"cannot be linked to
another user"*. Un correo no puede pertenecer a dos usuarios, así que el backend
puede rechazarlo sin ambigüedad.

### 3.6 ¿El teléfono sirve para entrar? — **NO**

El teléfono se guarda, no se verifica, y **no es puerta de entrada**. El acceso es
passkey o correo, y nada más.

---

## 4. Sesión — **[CERRADA, 6 DE 6]**

La sesión vive y se renueva sola, y todo eso es cosa de Privy. Las seis preguntas
de esta sección están contestadas.

### 4.1 ¿Cuál de las dos sesiones manda? — **[DECIDIDA] MANDA LA DE ReWALLET**

**Manda la sesión de ReWALLET. Privy es la autoridad solo al ingresar y al cerrar.**

- **Al ingresar**: Privy autentica (passkey o código de correo), el backend valida
  ese token **una vez**, y si está bien acota la sesión `rw1_`.
- **En cada request**: solo la cookie y la base. **Ninguna llamada de red a Privy.**
- **Al cerrar o al perder acceso**: el logout y el borrado de cuenta en Privy tienen
  que **revocar las sesiones de ReWALLET**.

Por qué así y no al revés:

- Cada request es **una consulta indexada a la base**, no una verificación de red.
  La app no depende de que Privy esté arriba.
- Se conservan la tabla `sessions` y todo lo que ya está testeado: dispositivos, IP,
  revocación inmediata.
- El riesgo de la sesión propia —que sobreviva a un borrado en Privy— se cierra
  con el webhook, que es un cambio chico.

### Tres acciones que salen de esta decisión

1. **Reaccionar a `user.deleted` y revocar las sesiones.** Hoy
   `'user.deleted': null` significa explícitamente no hacer nada, y lo único que
   escribe `revoked_at` es el logout propio. **Hoy, borrar la cuenta en Privy
   deja mover plata hasta 90 días.**
2. **Bajar el techo de 90 a 30 días.** Decidido en la 4.2. Es un cambio de una
   constante, no de lógica: el sliding y el refresh ya están hechos.
3. **Crear el puerto de verificación del token de Privy**, aunque se use una sola
   vez, al ingresar. Hoy no existe: no hay JWKS, `PRIVY_VERIFICATION_JWKS` está
   declarada en el env y ningún código la lee.

### Lo que existe hoy, según el código

| | Estado real |
| --- | --- |
| Mecánica de sesión | **Excelente y completa.** `rw1_` + 32 bytes aleatorios, SHA-256 sin sal, comparación en tiempo constante, cookie httpOnly + Secure, sliding 30 d con techo de 90 d, revocación idempotente. Todo cubierto por tests. |
| Creación de sesión | **No existe.** `SessionService.issue` está escrito y testeado, pero **ningún request lo llama**: no hay ruta de login. La fila de `users` tampoco se crea en ningún lado — los tests dependen de un seed SQL. |
| Verificación del token de Privy | **No existe.** No hay JWKS, no hay `verifyAccessToken`, en ningún archivo de `src/`. La variable `PRIVY_VERIFICATION_JWKS` está declarada en el env y **ningún código la lee**. |
| Rutas de lectura del saldo | **Sin sesión.** `/wallet`, `/wallet/movements` y `/wallet/assets` responden sin autenticación, y la dirección viene de una constante de configuración. |

### La pregunta de fondo: ¿cuál de las dos sesiones manda?

| | Privy manda | La de ReWALLET manda |
| --- | --- | --- |
| Cada request | Verifica un JWT contra JWKS (con caché, es barato) | **Una consulta indexada a la base**, y nada más |
| Si se borra la cuenta en Privy | El acceso muere al instante | **Sigue vivo hasta 90 días** |
| Sesiones por dispositivo | No las ve | Las ve, con dispositivo, IP y navegador |
| Revocación real | La hace Privy | La hacemos nosotros, inmediata |
| Qué falta construir | El puerto de verificación, que no existe | La ruta de login |

### El agujero concreto que hay que cerrar

Está en el código y es verificable: el registro de eventos de Privy tiene
`'user.deleted': null` — un `null` significa **"guardá el evento, no hagas nada"**.
Y lo único que pone `revoked_at` es el logout del propio usuario.

O sea: **si alguien borra su cuenta en el panel de Privy, sigue metiendo plata en
ReWALLET hasta 90 días.** Eso en una app de plata real no es un detalle.

**La 4.6 es la peligrosa:** enrolar MFA con passkey en Privy hace que **firmar y
enviar transacciones exijan la passkey**, y eso contradice la Hoja 3.

### 4.2 ¿Cuánto dura la sesión? — **[DECIDIDA] INACTIVA 30 DÍAS, TECHO 30 DÍAS**

**Lo que hay hoy**: 30 días de inactividad, sliding, con techo de 90 días.

**Lo que queda**: **30 días de inactividad, sliding, con techo de 30 días.**

| | Hoy | Ahora |
| --- | --- | --- |
| Inactividad | 30 días | 30 días |
| Techo absoluto | **90 días** | **30 días** |

**El número de inactividad no se toca; el techo sí.** La inactividad de 30 días ya
estaba bien y además coincide con los 30 días del refresh token de Privy: **las dos
sesiones mueren juntas**. La persona nunca pasa por una ventana donde una
viva y la otra no.

El techo baja de 90 a 30. Ahí está el cambio real: **aunque alguien use la app todos
los días, a los 30 días tiene que volver a demostrar quién es.**

**Lo que resuelve:** la contradicción 14. Antes, borrar la cuenta en Privy dejaba
mover plata hasta 90 días. Con el techo en 30 y el webhook de la 4.1, **ninguna
sesión sobrevive más de 30 días sin importar qué pase afuera**.

### 4.3 ¿Qué ve la persona si expiró? — **[DECIDIDA] A LA PÁGINA 1: "COMENZAR" O "YA TENGO CUENTA"**

Si la sesión expiró, la persona vuelve a la **primera pantalla del onboarding**:
la de las dos puertas, **"Comenzar"** o **"Ya tengo cuenta"**. Directo ahí, sin
pantalla intermedia y sin mensaje de error.

<!--
COMENTARIO — hay un caso en el que la persona no ve nada, y es el más común.

La sesión de ReWALLET y la de Privy son dos cosas distintas con vida distinta:

  - La de **Privy** tiene un refresh token de 30 días, guardado en su SDK, que se
    renueva solo.
  - La de **ReWALLET** dura 7 días de inactividad con techo de 30.

Entonces hay dos casos, y se ven distinto:

  1. **Privy sigue vivo** (la misma persona, el mismo dispositivo, dentro de los 30
     días de Privy). La sesión `rw1_` se puede volver a emitir **sin preguntarle
     nada**. La persona abre la app y está adentro. **No ve nada.**
  2. **Privy también murió** (cambió de dispositivo, pasaron los 30 días, hizo
     logout, o borró la cuenta). Ahí sí aparece la pantalla de las dos puertas.

Que el caso 1 no se vea es lo correcto, y no es un detalle: es la misma regla de la
Hoja 1, **"problemas de plataforma no"**. Renovar una sesión no es un problema que
se le muestre a nadie.

**Lo que hay que construir entonces no es la pantalla, es el reingreso invisible:**
que el backend pueda volver a emitir una `rw1_` cuando el token de Privy sigue
válido, sin intervención de la persona. Si eso no existe, la sesión de 7 días se
vuelve una molestia para todos.

**El riesgo de mandar a la pantalla de las dos puertas.** La de "Comenzar" es para
gente **sin** cuenta. Quien ya tiene una y su sesión expiró podría tocarla por
distracción y **crear una cuenta nueva**, dejando la vieja con plata y huérfana.

**Decisión: las dos puertas, sin cambios.** La pantalla de sesión expirada es
exactamente la misma que ve alguien que nunca entrou.

Que esta opción tenga un riesgo está escrito, y con 30 días de inactividad **el
riesgo es chico y se acepta a la vista**:

  - La pantalla de "Comenzar" solo aparece **cuando la sesión venció de verdad**, y
    con 30 días de inactividad eso es poco común: la persona vuelve de un viaje, de
    una semana sin mirar la plata, o cambió de teléfono. **No es una pantalla que
    uno vea seguido.**
  - Si toca "Comenzar" por error, la 3.5 cubre el caso habitual: si escribe el
    correo con el que ya tiene cuenta, Privy lo rechaza y le ofrece entrar.
  - Lo que **no** cubre: que la cuenta nueva se haga con **otro** correo. Eso deja
    una segunda cuenta, y la vieja queda con plata y sin dueño conocido.

Por qué se acepta: para que pase, alguien tiene que volver de más de un mes, tocar
la puerta equivocada **y** Inventarse un segundo correo. Es una parte chicosima de
las cuentas, y el costo de arreglarlo (una pantalla distinta para dos casos que la
persona no distingue) es mayor que el costo de tenerlo.

Lo que hay que hacer igual, porque sale barato: **cuando alguien registra con un
correo que ya existe, ofrecer siempre entrar** (ya está en la 3.5). Y cuando alguien
tiene dos cuentas, no hay ninguna regla que las una — eso es una decisión posterior,
no de esta hoja.

Lo que **no** cambia en ningún caso: **la pantalla no dice "tu sesión expiró"**.
No hay mensaje de error. Eso lo prohibe la Hoja 1.
-->

### 4.4 ¿Se ven y se cierran las sesiones abiertas? — **[DECIDIDA] SÍ, Y CON BOTÓN DE CERRAR TODAS**

En el **Perfil** hay una sección de sesiones:

> **Sesiones activas**
> Este dispositivo · y los demás que abriste
> **[ Cerrar todas las sesiones ]**

Si cierra todas, entra de nuevo con su huella. La sesión que cerró es la única que
sobrevive.

**Lo que cuesta poco, porque ya está hecho.** La tabla `sessions` ya guarda
dispositivo, IP y navegador, y la revocación **ya es idempotente** (`revoke` con
`WHERE revoked_at IS NULL`). No hay que construir nada de cero: hay que exponer lo
que ya se guarda y exponer un endpoint que llame a un método que ya existe.

**Por qué es la pieza que cierra el resto:**

| | Sin la 4.4 | Con la 4.4 |
| --- | --- | --- |
| Entrar con la passkey | No revoca la sesión del otro dispositivo | Sigue igual |
| **La persona ve que entró alguien** | No puede hacer nada | **Cierra todas y entra con su huella** |
| El aviso de la 4.5 | Promete un botón que no existe | **Dice la verdad** |
| Un atacante con la cookie | Aguanta hasta 30 días | **Máximo 30 días, y se corta con un toque** |

Es **el único interruptor de emergencia** que tiene el titular. Todo lo demás lo
resuelve el sistema; esto lo resuelve la persona.

**Lo que no se ve.** La IP y el navegador **no se muestran**: eso es la clase de dato
que la Hoja 2 prohíbe. Se ve **el dispositivo en palabras de persona** —"Este
iPhone", "Chrome en Windows"— y nada más. La dirección IP nunca aparece en
pantalla.

### 4.5 ¿Se avisa al entrar desde un dispositivo nuevo? — **[DECIDIDA] SÍ, POR CORREO**

Cuando alguien entra desde un dispositivo o navegador que el backend no reconoce, se le
manda un correo: **"Entraste a tu cuenta de ReWALLET desde un dispositivo nuevo"**.

**Es el primer uso real del correo verificado.** Hasta acá el correo servía para
identificar y para volver a entrar; ahora también sirve para **avisar**. Es el mismo
principio de la 6.2: el correo es el canal de confianza del producto.

**El tono no es de alarma.** Es un aviso, no un "ALERTA DE SEGURIDAD". En una app
de plata, un mensaje que asusta cada vez que alguien entra desde el celular de un
amigo entrena a la gente a ignorar los avisos que sí importan. El texto dice qué
pasó, cuándo, y **qué hacer si no fue ella**.

**La regla que no se rompe:** el aviso **no bloquea nada**. La sesión entra igual. Es
información, no un error — la misma línea de la Hoja 1.

**Y acá aparece una dependencia.** El aviso dice "si no fuiste vos, hacé esto". Para
que eso signifique algo, **"esto" tiene que existir**: es la 4.4, cerrar las sesiones
desde el Perfil. **El correo de la 4.5 promete un botón que la 4.4 tiene que
construir.** Si la 4.4 no se hace, el aviso tiene que decir otra cosa.

### 4.6 ¿Se enrola MFA con passkey? — **[DECIDIDA] NO**

**No se enrola MFA de wallet en esta etapa.** En Privy, MFA hace que **firmar y
enviar transacciones exijan la passkey** — y eso ya estaba decidido en la Hoja 3,
en la contradicción 7: ninguna acción pide biometría.

Queda escrito para que no se vuelva a abrir: la seguridad de la cuenta es
**la sesión + el correo verificado + la passkey de acceso**. El MFA de wallet es
una capa más, para una etapa en que haya algo que esa capa proteja.

**Lo que hoy protege la plata**, entonces, sin MFA:

| Capa | Qué hace |
| --- | --- |
| La passkey | Prueba que sos vos al entrar y al recuperar |
| El correo verificado | Es la identidad, y es la vía de vuelta |
| La sesión | Se renueva sola, dura 30 días, y se cierra sola (4.2) |
| La revocación | **Falta**: la 4.4 |

### Las 6 preguntas de la sección 4

| # | Pregunta | Por qué importa |
| --- | --- | --- |
| **4.1** | ¿Cuál sesión manda? | **DECIDIDA.** Manda la de ReWALLET |
| **4.2** | ¿Cuánto dura la sesión? | **DECIDIDA**: 30 inactividad / 30 techo |
| **4.3** | ¿Qué ve si expiró? | **DECIDIDA**: a la pantalla de las dos puertas, sin cambios |
| **4.4** | ¿Se ven y se cierran sesiones abiertas? | **DECIDIDA**: sí, con "Cerrar todas las sesiones" |
| **4.5** | ¿Se avisa al entrar desde un dispositivo nuevo? | **DECIDIDA**: sí, por correo, sin tono de alarma |
| **4.6** | ¿Se enrola MFA con passkey? | **DECIDIDA: no.** Contradicta la Hoja 3 |

---

## 5. Identidad hacia los demás

### 5.1 ¿Qué ve alguien que me busca por mi @tag? — **NOMBRE Y COLOR**

Solo el **nombre** y un **color de avatar**. Nada más: ni la dirección, ni el
saldo, ni un identificador.

Es coherente con la Hoja 3, donde ya estaba escrito que la fila de un pago dice
"Carlos pagó" y **nunca una dirección**.

### 5.2 ¿El nombre es público? — **PÚBLICO PARA TODOS**

Cualquiera con el @tag ve el nombre y el color. No hace falta ser contacto.

### 5.3 ¿Se puede cambiar el nombre? — **NO, NUNCA**

El nombre se escribe una vez en el onboarding y **no se cambia jamás**. No hay
pantalla para editarlo.

> Esto choca con la Hoja 2, pantalla 6 (Perfil), donde el nombre aparece como dato
> editable. Ver contradicción 2.

### 5.4 ¿Se puede cambiar el @tag? — **SÍ, Y EL NUEVO ES EL ÚNICO VÁLIDO**

Se puede cambiar. Cuando se cambia, **el anterior deja de funcionar**: no hay
alias, no hay periodo de gracia, no quedan los dos.

### 5.5 Si dos personas eligen el mismo @tag, ¿qué pasa? — **EL SEGUNDO NO PUEDE USARLO**

El tag ya tomado **no se puede elegir**, y se le propone otro. No se resuelve
agregando números al final.

> Tensión con la 2.5: el @tag se genera con un sufijo aleatorio para que sea
> único, así que en la práctica es raro que colisione. Pero si la 5.4 permite
> elegirlo a mano, la 2.5 y la 5.4 son dos caminos distintos para el mismo campo.
> Ver contradicción 3.

### 5.6 ¿Hay bloqueo? — **NO**

No existe el bloqueo. Cualquiera puede buscarte por tu @tag, escribirte y
pedirte plata. No hay lista de bloqueados ni restricción para enviar.

Consecuencia asumida y escrita: **el único control que tiene la persona es no
compartir su @tag.** No hay defensa en la app.

---

## 6. Perder el acceso y seguridad

### 6.1 Si alguien pierde el dispositivo, ¿cómo vuelve? — **POR CORREO, Y SE CREA UNA PASSKEY NUEVA**

Entra con el correo y el código de 4 dígitos, y **eso le crea una passkey nueva**
en el dispositivo donde entró.

Con esto la 1.3 deja de importar tanto: aunque la passkey no tenga respaldo, el
correo verificado es la vía de regreso, siempre.

### 6.2 Y si perdió el dispositivo y el correo... ¿y el teléfono? — **[REESCRITA] SIN LLAVE DE REPUESTO**

**La promesa del producto es sin llaves semillas.** Por eso se usa Privy: él
despliega las wallets y resuelve la autenticación, y la recuperación es **por
correo**. Una palabra semilla es de las wallets cripto; ReWALLET es un producto de
pago, y ese es el patrón al que hay que alinearse.

**Lo que queda escrito, entonces:**

| Situación | Qué pasa | Cuándo funciona |
| --- | --- | --- |
| Perdio el dispositivo, **tiene correo** | Entra con el código de 6 dígitos y **se le crea una passkey nueva** | **Ya, hoy, gratis** |
| Tiene correo y quiere entrar sin passkey | Entra con el código de 6 dígitos | **Ya, hoy, gratis** |
| Perdio el dispositivo **y** el correo | **La cuenta no se recupera.** No hay autoservicio | Fase 3 |
| Verificación por teléfono | **Fuera.** No existe | Mañana |

**Lo que se retiró.** Se había propuesto una llave de repuesto de 12 palabras, con
rescate por soporte comparando un hash. **Se retira entera**, por dos razones que se
escriben para que no se vuelva a proponer:

1. **Es un patrón de wallet cripto, no de producto de pago.** No hay una app de
   pagos que le pida eso a alguien que quiere guardar plata.
2. **Era un parche de dos decisiones ajenas.** Nació porque la 4.6 descartó el MFA de
   Privy y la 6.6 dejó a soporte sin base legal. **Si alguna de las dos se mueve,
   hay que revisar esta celda.**

**El destino real es la 3:** el rescate por soporte con verificación de identidad,
que es el estándar de los productos de pago y que ya hace falta para el producto
regulado. Va con la 6.6: cuando haya términos, soporte puede mirar la cuenta, y
ahí la recuperación existe. **Es una decisión de Fase 3, y se escribe acá para que
no quede como un agujero sin nombre.**

**Lo que sí cambia ahora, por decisión:** la verificación por teléfono queda
**fuera**. Cuando vuelva, el camino barato es **WhatsApp y no SMS**, y por una
razón concreta: el SMS fuera de USA/Canadá es un add-on de Privy que exige cuenta
Twilio propia, verificada, con permisos geográficos, y un contacto a Privy para
habilitar cada país. **WhatsApp no tiene esa restricción de región.** El costo por
mensaje sigue existiendo, pero deja de ser un bloqueo de plataforma y pasa a ser
una decisión de volumen.

<!--
COMENTARIO — por qué se retiró la llave de repuesto.

La propuesta era mostrar 12 palabras al final del onboarding, guardarlas solo
hasheadas, y que soporte comparara un hash en vez de decidir a criterio. El
argumento era bueno: convertía una decisión de confianza en una comparación
objetiva.

Pero se resolvió contra dos cosas:

1. **El patrón es equivocado para este producto.** Una palabra semilla es la
   forma en que una wallet cripto resuelve "yo no tengo nada más". ReWALLET **sí
   tiene algo más**: el correo verificado, que es gratuito, no se pierde con el
   dispositivo, y ya está construido. La llave solo llenaba el hueco de un caso
   que en una app de pagos se resuelve con soporte.

2. **Era una decisión, no una necesidad.** Nadie la pidió: se ofreció porque el hueco existía. Se ofreció porque el
   hueco existía, y un hueco se puede cubrir o se puede aceptar. Acá se acepta.

Lo que **no** cambia: la consecuencia sigue siendo real y escrita. **Sin dispositivo
y sin correo, hoy la cuenta se pierde.** Esa es una regla del producto en esta
etapa, y es la línea que hay que respetar: cuando aparezca el producto regulado, esa
línea se cierra con soporte y verificación de identidad, no con una palabra
semilla.
-->


### 6.3 ¿Se puede cambiar el correo? — **SOLO MIENTRAS ESTÁ SIN VERIFICAR**

**La regla exacta:**

- **Mientras la cuenta no está verificada: se puede cambiar.** Antes de mandar el
  código, la pantalla muestra *"Te va a llegar un código a `juan.perez@gmial.com`.
  ¿Es correcto?"*, con **Sí** y **Corregir**. Si se corrige, se manda a la
  dirección nueva.
- **Una vez verificado: no se puede cambiar. Jamás.**

Que el cambio sea solo durante el registro es exactamente lo que lo hace seguro:
mientras el correo no está verificado **no hay nada que proteger**, porque la cuenta
todavía no tiene identidad. Una vez que lo tiene, el correo **es** la identidad y
cambiarlo sería cambiar de dueño.

Esto cierra el agujero de la contradicción 11: equivocarse el correo **sí tiene
salida**, en el único momento en que se puede tener salida.

**La consecuencia que se acepta:** una cuenta con el correo mal escrito y **ya
verificado** (porque el código llegó a otra casilla) es irrecuperable desde la app.
Solo soporte. Es un caso que prácticamente no ocurre —para que pase, el código tiene
que haber llegado a un correo equivocado que alguien controla— y tiene una vía
escrita: soporte.

**Lo que ya no existe:** la ventana de 1 minuto para corregir el destino de un
envío ya hecho. Al seguir las reglas de Privy no hay forma de cambiar el
destinatario de un código ya enviado. Por eso la corrección va **antes** de
mandar, no después.

> Esto contradice de frente la Hoja 2, pantalla 6, que dice: *"¿Se puede cambiar
> correo o teléfono? Sí, pero re-verificando"*. Ver contradicción 1.

Y tiene una consecuencia que hay que decir: **el correo es la identidad y es
eterno**. Si alguien se equivoca al escribirlo y la cuenta queda con un correo
equivocado, no hay arreglo desde la app. Solo soporte.

<!--
COMENTARIO — por qué la corrección va antes de mandar y no después.

Había dos reglas que se protegían entre sí:

  - El correo **no se puede cambiar nunca** (6.3).
  - El correo **se podía corregir en la pantalla del código**, a partir del minuto
    1, cambiando el destino del envío.

La segunda **ya no existe**: al seguir las reglas de Privy no hay forma de cambiar
el destinatario de un código que ya salió. Sin embargo, la necesidad que la
sostenía sigue entera: **la gente escribe mal su correo.** Un punto, una `@` de más.

La solución es mover la corrección **antes**, que es el único lado donde todavía
existe. Cuesta un paso extra y **corta el error en el único lugar donde se puede
cortar**.

La cadena del problema, resuelta:

  1. Tipeás mal el correo.
  2. Antes de mandar nada, la app te muestra a quién se lo va a mandar.
  3. Lo corregís y ahora sí llega.

Y si igual se escribe mal, la app no muestra "No llegó el código. Probá de nuevo."
—que es el mensaje de un problema de red y está equivocado para una dirección
mala— sino **la dirección misma**, para que la veas.
-->

### 6.4 ¿Se puede eliminar la cuenta? — **NO, NO EN FASE 1**

No hay "Eliminar mi cuenta". No hay ninguna forma de cerrar la cuenta desde la app.

### 6.5 ¿Qué se guarda y qué se ve en el Perfil? — **[REESCRITO: EL QR DEL PERFIL]**

`onboarding_complete` **se sustituye por el QR del perfil**. El QR pasa a ser la
señal de que la identidad está completa, y aparece en el Perfil.

El criterio que lo justifica: **si el Perfil muestra el QR, agregar amigos de
ReWALLET es más rápido.** La persona abre su QR y el otro lo escanea y ya está.
Es el camino más corto entre "tengo ReWALLET" y "te envío plata".

Los QR de las wallets **viven en el listado de los assets**, no en el Perfil. Son
objetos distintos conConsumeres distintos: el QR del Perfil es **para sumar
personas**, el QR de la wallet es **para recibir**.

Lo que se guarda, en total: `name`, `tag`, `recovery_email`,
`recovery_email_verified`, `recovery_phone`, `avatar_color`. Más lo que el QR
implica. Nada más.

> Dos cosas que este cambio obliga a dejar escritas:
>
> 1. **El QR del Perfil no se lee, se escanea.** Contiene la dirección por
>    debajo, pero la prohibición de mostrarla sigue vigente: nadie la ve en
>    pantalla. Igual que el QR de envío de la Hoja 3.
> 2. **Que el QR sea la señal de "perfil completo" rompe con el caso de la 0.3.**
>    Si el código de verificación bloquea toda la app, el QR no puede ser a la vez
>    la señal de que el perfil está completo, porque el perfil no existe hasta que
>    el código se puso. Hay que ver cuál de las dos señales manda.

### 6.6 ¿Qué puede ver soporte? — **[DECIDIDA] HOY NO VE NADA**

**Decisión tomada: por ahora no hay términos ni consentimiento.** Se deja para
cuando haya algo que atender formalmente.

Eso deja esta celda **sin respuesta, a propósito**, y el bloqueo es real:

> **Sin consentimiento explícito, soporte no puede mirar una cuenta.** No hay
> forma legal de hacerlo, y no hay forma de fingirla.

Lo que queda escrito, entonces:

- **Hoy soporte no ve nada.** Y eso incluye el rescate de la 6.2: por ahora no hay
  rescate por soporte, porque no hay base para que alguien mire la cuenta.
- **La 6.2 queda solo con la vía automática**: entrar por el correo y crear una
  passkey nueva. Si además se perdió el correo, **la cuenta no se recupera**. Es una
  regla, no un agujero, y es coherente con que el correo es la identidad.
- Cuando se hagan los términos, esta celda se responde. Y la respuesta va a tener
  que decir **qué ve soporte exactamente** — la lista de movimientos con importes y
  contrapartes, la dirección, el detalle interno de cada transacción. **"Todo" no
> es una definición que se pueda implementar ni auditar.**

<!--
COMENTARIO — por qué el check marcado por defecto quedó descartado, aunque se
hayan decidido no hacer términos.

Se evaluó una pantalla de consentimiento con el check **marcado por defecto**,
para que soporte tuviera una base legal. Se descartó, y no por el marcado en sí:

  1. **No habría dado la base.** El RGPD exige "clear affirmative action"
     (art. 4(11), considerando 32) e invalida las casillas premarcadas. Con el check
     marcado, soporte sigue sin poder mirar la cuenta — y el proyecto queda
     expuesto. Se pierde por los dos lados.
  2. **"Acepto los términos" no es "soporte puede ver todo".** El RGPD pide
     consentimiento específico por finalidad. Son dos cosas distintas y necesitan
     dos check distintos.

La lección que queda escrita, para cuando se hagan los términos: el check va
**desmarcado y bloqueante**, y el acceso de soporte a los datos va en un
**consentimiento separado**. Es lo único que tiene valor probatorio.
-->

### 6.7 Lo que sí queda escrito sobre soporte

Aunque la 6.6 esté bloqueada, tres reglas no dependen de ella:

- **El detalle de una operación es privado** (Hoja 3, sigue vigente sin excepción).
- **Toda operación queda registrada** con autor y hora.
- **La dirección nunca sale a pantalla**, ni en Actividad, ni en el detalle, ni para
  soporte.

---

## HOJA CERRADA — 39 de 39 contestadas

| Sección | Estado |
| --- | --- |
| 0 — Decisiones de fondo | **5 de 5** |
| 1 — Crear la cuenta | **6 de 6** |
| 2 — Onboarding | **6 de 6** |
| 3 — Verificar el correo | **6 de 6** |
| 4 — Sesión | **6 de 6** |
| 5 — Identidad hacia los demás | **6 de 6** |
| 6 — Perder el acceso | **6 de 6** |

**Cero preguntas abiertas.** La 6.6 no está pendiente: está **decidida**, y lo
decidido es que **soporte no ve nada** hasta que haya términos. Eso tiene un costo
escrito y aceptado: **no hay rescate por soporte**, y la 6.2 tiene solo la vía del
correo.

Las contradicciones que quedan abiertas (2, 3, 5, 6, 8, 15, 16) **no son preguntas
de esta hoja**: son decisiones de las hojas 1 y 2 que esta hoja cambió, o trabajo de
implementación. Están abajo con su dueño.

### Contradicciones detectadas al cruzar con las hojas 1, 2 y 3

| # | Tema | Choca con | Estado |
| --- | --- | --- | --- |
| 1 | El correo no se puede cambiar **una vez verificado** | Hoja 2 pant. 6: "se puede cambiar, pero re-verificando" | **cerrada**: ahora sí se puede, pero solo antes de verificar |
| 2 | El nombre no se cambia nunca | Hoja 2 pant. 6: el nombre es dato editable | abierta |
| 3 | El @tag se genera con sufijo (2.5) pero se puede cambiar a mano (5.4) | interna | abierta |
| 4 | Soporte ve todo, con consentimiento de crear la cuenta (6.6) | Hoja 3 §6: "ni soporte sin consentimiento explícito" | **cerrada**: la Hoja 3 gana. Soporte no ve nada |
| 5 | El código de verificación bloquea toda la app (0.2) | Hoja 2 pant. 6: "sin verificar, la app entera con una banda arriba. No bloquea ver nada" | abierta |
| 6 | `recovery_email_verified` es la identidad, no una recuperación | `schema.ts:278-279`, el nombre de la columna miente | abierta |
| 7 | El código se pidió de 4 dígitos, con destino editable y pleno de 1 min | Privy: 6 dígitos, 10 min fijos, sin edición de destino | **resuelta: se siguen las reglas de Privy** |
| 8 | El QR del Perfil es la señal de perfil completo | la 0.3: si el código bloquea, el perfil no existe antes | abierta |
| 9 | El rescate se apoyaba en el teléfono | la 0.1: el teléfono no se verifica nunca | **cerrada por la 6.2**: la recuperación es por correo |
| 10 | No hay pantalla de términos (2.6) | la 6.6 exigía un consentimiento | cerrada: **la 6.6 queda bloqueada** hasta que haya términos |
| 11 | Correo mal escrito sin salida dentro de la app | interna | **cerrada**: la corrección va antes de mandar el código |
| 13 | El check de consentimiento marcado por defecto | Legal: no es consentimiento válido bajo RGPD ni Ley 25.326 | **cerrada por ausencia**: se decidió no hacer términos, así que no hay check |
| 16 | No hay base legal para que soporte vea una cuenta | la 6.6 queda bloqueada; el rescate por soporte de la 6.2 queda sin vía | **abierta — consecuencia aceptada a la vista** |
| 14 | **Una sesión `rw1_` sigue viva hasta 90 días** después de que la cuenta se borre en Privy | `events.ts:50` — `'user.deleted': null` es explícitamente no hacer nada | abierta — ver sección 4 |
| 15 | `/wallet`, `/wallet/movements` y `/wallet/assets` **responden sin sesión** | `app.ts:278-296`, y la dirección sale de una constante de configuración | abierta — a resolver antes de que haya plata real |
| 12 | La fila de `users` se crearía antes de verificar el correo | `tag` es `NOT NULL` y único: cada intento abandonado gasta un tag y deja una cuenta muerta | **cerrada por la 0.4**: no se escribe nada hasta el final |

### Registro de decisiones de implementación

Salen de esta hoja y hay que hacerlas. No son preguntas abiertas, son trabajo:

1. **Renombrar `recovery_email` y `recovery_email_verified`.** Ya no son una
   recuperación: son la identidad de la cuenta. `schema.ts:278-279`.
2. **Corregir las rutas de lectura sin sesión.** `/wallet`, `/wallet/movements` y
   `/wallet/assets` responden sin autenticación y toman la dirección de una
   constante (`app.ts:278-296`). A resolver **antes** de que haya plata real.
3. **Reaccionar a `user.deleted`** revocando las sesiones, y **bajar el techo de
   90 días** de la sesión. Salen de la 4.1.
4. **Crear el puerto de verificación del token de Privy**, que no existe.
5. **Diferenciar el estado de una cuenta**: sin verificación, verificada, y
   borrada. Hoy solo hay `recovery_email_verified`.

### Resueltas de las contradicciones

- **Correo mal escrito (11).** Cerrada con una pantalla de confirmación antes de
  mandar el código, con botón para corregir. Barato y corta el error en el único
  lugar donde se puede cortar.
- **El rescate por soporte (9).** Cerrada **sin llave de repuesto**: la promesa del
  producto es sin palabras semilla. La recuperación es por correo, y el caso sin
  dispositivo **y** sin correo es de Fase 3, con soporte y verificación de identidad.
- **El consentimiento de soporte (4, 10 y 13).** Se decidió **no hacer términos
  todavía**. Entonces no hay check, no hay problema de check marcado, y la Hoja 3
  gana: **soporte no ve nada**. La consecuencia está escrita en la 6.6.
- **Las cuentas abandonadas (12).** Cerrada con la 0.4: nada se escribe hasta que la
  cuenta está completa.

### Decisiones que hay que tomar en las hojas 1 y 2

Estas no son preguntas de la Hoja 4: son reglas escritas que esta hoja cambió, y hay
que decidir si se actualizan o se rompen.

1. **Contradicción 5 — la verificación ahora bloquea la app entera.** La Hoja 2
   pantalla 6 y la Hoja 1 dicen que sin verificar se ve todo con una banda arriba.
   La 0.3 dice que no: pantalla de código y nada más. **Hay que actualizar la Hoja 2.**
2. **Contradicción 2 — el nombre no se cambia nunca.** La Hoja 2 pantalla 6 lo tiene
   como dato editable.
3. **Contradicción 6 — `recovery_email_verified` es la identidad**, no una
   recuperación. El nombre de la columna hay que cambiarlo.
4. **Contradicción 8 — el QR del perfil como señal de "perfil completo"** choca con
   la 0.3: si el código bloquea todo, el perfil no existe antes de verificarlo.
5. **Contradicción 3 — el @tag se genera con sufijo (2.5) pero se cambia a mano
   (5.4).** Son dos caminos distintos para el mismo campo.
6. **Contradicción 16 — sin base legal, soporte no ve nada.** Es consecuencia
   aceptada, pero hay que decirlo en la Hoja 3, que hoy promete lo contrario.

### Trabajo de construcción que sale de esta hoja

1. **Renombrar `recovery_email` y `recovery_email_verified`.**
2. **Meter las tres rutas de lectura detrás de la sesión.** Hoy `/wallet`,
   `/wallet/movements` y `/wallet/assets` responden sin autenticación.
3. **Reaccionar a `user.deleted`** revocando las sesiones.
4. **Crear el puerto de verificación del token de Privy** y la ruta de login.**
5. **El reingreso invisible:** reemitir la `rw1_` cuando el token de Privy sigue
   válido, sin preguntarle nada a la persona.
6. **Endpoint y pantalla de "Cerrar todas las sesiones"** (4.4).
7. **Correo de aviso de dispositivo nuevo** (4.5).
8. **Diferenciar el estado de la cuenta**: sin verificar, verificada, borrada.
10. **Borrador local del onboarding** (0.4), con su fecha de vencimiento.

**Lo que ya no hace falta decidir:** el correo mal escrito se resuelve antes de
mandar el código; la recuperación es por correo y sin llaves semillas, así que el
rescate con soporte es de Fase 3; y las cuentas abandonadas no dejan rastro porque
no se escribe nada.
