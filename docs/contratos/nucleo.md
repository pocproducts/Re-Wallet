# Núcleo del producto — respuestas

> Hoja 1 de N. **Completada por el cliente.** Cada respuesta es una decisión
> tomada, no una propuesta.
>
> **Hoja cerrada.** Las cinco filas están contestadas y las siete contradicciones
> detectadas quedaron resueltas y numeradas más abajo, en un solo lugar. No queda
> nada pendiente: se puede construir.

**Quién cumple:** el backend (`Backend/`) y el front del producto (`05. UI-UX/`).
`Front End/` y `Backend/` fueron laboratorios: sirven de evidencia, no mandan.

---

## 0. Lo que ya estaba decidido y se confirma

**El usuario no ve errores de sistema.** Van a telemetría (Sentry, logs
estructurados en Cloudflare), a la tabla de auditoría `webhook_events`, y al
equipo por alerta. Nunca un stack trace, nunca un código de error, nunca un
`Error: 500`.

---

## 1. Saldo

| | |
|---|---|
| **Si no se pudo leer, qué ve la persona** | El último valor que se conoce, **con la hora**. Ej.: `$1.240,50` · actualizado hace 2 min. **Nunca en blanco**: el silencio en una app de dinero genera ansiedad. |
| **Si el saldo es cero, cómo se ve** | `$0,00` normal. El cero es un estado válido, no un error. |
| **Un saldo negativo, ¿se muestra?** | No. En ReWALLET no existen saldos negativos por diseño. Si el backend devuelve uno, es bug del backend. |
| **Si vale poco, ¿se redondea?** | A dos decimales, que es el estándar de una cuenta en dólares. **Se redondea solo lo que se ve: el dato nunca.** |
| **Quién escribe el número** | El backend, con todos los decimales, **como texto**. El front formatea. El backend nunca formatea: eso lo ata a una locale. |
| **Regla** | El usuario nunca ve un saldo en blanco, `undefined` ni `NaN`. |

## 2. Tasa

| | |
|---|---|
| **Si no se pudo leer, qué ve la persona** | El último valor **con la hora**. Igual que el saldo. |
| **Si la tasa es cero, qué ve la persona** | Un texto humano: **"Ahora no está rindiendo"**. `$0,00%` es jerga de dashboard, no de app de consumo. |
| **Siempre o solo en positivo** | Siempre. Transparencia total: si baja, el usuario lo ve. No hay tasa oculta. |
| **Con qué frecuencia se actualiza** | Al abrir la app, con **pull-to-refresh manual**. Fase 2: evaluar auto-refresh cada 5 min con la pantalla abierta. |
| **Regla** | Se muestra como **porcentaje anual con dos decimales**: `+4,14% anual`. Nunca sin la palabra "anual". |

## 3. Movimientos

| | |
|---|---|
| **Si no se pudieron leer, qué ve la persona** | **Nada.** Reintento automático con espera, sin texto y sin botón. Agotados los reintentos, la lista conserva lo último con su hora. Los movimientos llegan de la base a medida que el webhook escucha y guarda; si la base está caída, es un error de sistema y va a telemetría. |
| **Si no hay movimientos de verdad** | **"Todavía no tenés movimientos"** + ilustración sutil. Esto es estado de producto, no de error. |
| **¿Muestran su importe?** | Sí, siempre. El importe es el corazón del movimiento. |
| **Un movimiento sin origen conocido** | Marcado **"Procesando"** con icono de reloj. Nunca se oculta: si la persona lo hizo, tiene que verlo. Si el origen es externo y no se puede resolver, pasa a **"sin confirmar"** a las 24 h. |
| **Regla** | Todo movimiento muestra tipo, descripción, monto, tiempo relativo y estado. Nunca un movimiento sin importe. |

## 4. Activo y su precio

| | |
|---|---|
| **Un activo sin saldo legible, se ve** | No. **Se oculta la fila.** |
| **Un activo del catálogo que el backend aún no lee** | No aparece, **salvo** los que están en estado `coming_soon`, que sí se muestran con badge **"Pronto"**. La diferencia es "próximamente" (roadmap público) contra "todavía no implementado" (roadmap interno). |
| **¿El precio se muestra?** | Solo en la pantalla de detalle. La lista muestra el saldo en USD. |
| **Cuántas cripto se listan** | Solo las que el backend puede leer **y** están en estado `active`. La lista nunca promete lo que no puede cumplir. |
| **Regla** | El usuario nunca ve un activo con estado roto: cero sin razón, pendiente sin fecha, cargando infinito. O se muestra bien, o no se muestra. |
| **Dónde vive el catálogo** | **En el backend.** El criterio de qué se lista —"lo que se puede leer y está `active`"— es verdad del backend. Si el catálogo viviera en el front, el front sabría de activos que aún no existen. `config/assets.ts` queda como mock y se borra cuando el backend responda. |

## 5. Cuenta

| | |
|---|---|
| **Si todavía no hay cuenta** **[H4]** | **Bienvenida (dos puertas: "Comenzar" o "Ya tengo cuenta") → Passkey → Onboarding (correo → teléfono → nombre) → confirmar el correo → código de 6 dígitos → Home.** El paso "Recuperación" **desaparece**: el teléfono nunca se verifica. **Nada se escribe en la base hasta que el código se pone** (Hoja 4, 0.4). |
| **Si no se pudo saber si hay cuenta** | Se reintenta **solo y sin avisar**, hasta 3 veces, con backoff exponencial. Si las 3 fallan: **"Estamos reconectando…"** + skeleton. **Nunca** se muestra el onboarding por error. |
| **¿Varias cuentas?** **[H4]** | No, una sola: **una persona, un correo verificado**, y el correo es único en Privy — no puede pertenecer a dos cuentas. Una sesión vencida devuelve a la pantalla de las dos puertas (Hoja 4, 4.3), así que **existe el riesgo de que alguien toque "Comenzar" por error y cree una cuenta nueva con otro correo**. Riesgo asumido y aceptado: es una parte chicosima de las cuentas. Lo que sí se cubre: si escribe un correo que ya tiene cuenta, se rechaza y se le ofrece entrar (Hoja 4, 3.5). |
| **¿Puede entrar sin biometría?** **[H4]** | **Sí, y es una vía real, no un residuo.** La puerta de entrada es doble: **passkey o correo con código de 6 dígitos.** Si el Face ID, el Touch ID o la huella fallan, la persona entra por correo. Lo único que quedaría sin cubrir es "la biometría falló hoy", y para eso el **passcode del propio dispositivo** suele alcanzar, porque WebAuthn acepta la verificación de usuario del sistema. El PIN de 6 dígitos propio es una tercera capa, no una necesidad. **Tema menor, no bloquea.** |
| **Identidad de la cuenta** **[H4]** | **El correo verificado.** El passkey es **cómo se ingresa**; el correo es **quién sos**. **Confirmado y cerrado por la Hoja 4.** |
| **Cómo se crea la cuenta** **[H4]** | **Passkey primero**, y después el onboarding. La passkey crea y autentica al usuario; el **correo verificado es lo que da acceso a la app** (Hoja 4, 0.2). Antes se decía "de entrada al Perfil": ya no, porque **el Perfil no existe hasta que el código se pone** (0.3). |
| **Verificación de correo** **[H4]** | **Obligatoria, y en el acto.** Se pide **dentro del onboarding, antes del teléfono y del nombre**, porque es lo único que se verifica. Antes decía "después del onboarding, dentro del Perfil": **quedó sin efecto**. Antes de mandar el código se muestra *"Te va a llegar un código a `juan.perez@gmial.com`. ¿Es correcto?"*, con **Sí** y **Corregir** (Hoja 4, 6.3). |
| **Verificación de teléfono** **[H4]** | **No existe.** El teléfono se pide y **se guarda, pero no se verifica nunca** (Hoja 4, 0.1). La razón es económica: **el envío de un mensaje al teléfono es un gasto fijo por verificación**, y el correo no cuesta por envío. Esto **elimina la dependencia de SMS de Privy**, que fuera de USA/Canadá es un add-on de pago con cuenta Twilio propia. |
| **Qué bloquea estar sin verificar** **[H4]** | **Ahora bloquea la app entera.** Antes era al revés: se veía todo y lo bloqueado era el dinero. **Antes del código, la persona no ve nada de ReWALLET**: pantalla de código y nada más, sin saldo, sin perfil, sin billerera (Hoja 4, 0.3). La razón es que ReWALLET mueve plata real desde el primer día. **Esto da vuelta la contradicción 7 de esta misma hoja.** |
| **Recuperación** **[H4]** | **Solo por correo.** Antes: "con cualquiera de los dos, correo o teléfono". **El teléfono ya no es vía de recuperación**, porque no se verifica nunca y es un número que cualquiera declara (Hoja 4, 0.1). Perder el dispositivo se resuelve con el correo: se entra por código y **se crea una passkey nueva**. Perder **también** el correo ya no tiene autoservicio: hay una **llave de repuesto de 12 palabras**, mostrada una vez al final del onboarding y **guardada solo hasheada**, que soporte compara en vez de decidir (Hoja 4, 6.2). |
| **El código se puede reenviar** **[H4]** | **Solo hay un código**: el del correo, de **6 dígitos**, válido **10 minutos**. Los reenvíos tienen **los límites de Privy**, no los nuestros: el pleno de 1 minuto que estaba escrito acá **ya no aplica**, porque el código lo manda Privy y su plazo no se configura. El botón de reenviar existe y lo que se construye es el **mensaje accionable** cuando el reenvío todavía no se puede pedir (Hoja 4, 3.3). |
| **Qué puede hacer sin verificar** **[H4]** | **Nada.** No ve saldo, no ve la app, no navega, no llega al Perfil. Lo único que ve es **la pantalla del código**. La versión que decía "solo el Perfil" y la que decía "toda la app con una banda arriba" quedaron las dos atrás: la Hoja 4 zanjó esto (0.3). |
| **Regla** | Nunca se ve el onboarding si ya hay cuenta, ni el home si no la hay. El estado de sesión es la única fuente de verdad. |

---

## Reglas de equipo que acompañan las respuestas

- **Timestamps siempre en UTC.** El front convierte a local.
- **Montos siempre como texto**, por precisión decimal. El front formatea.
- **Estados como enums**, no texto libre: `active | coming_soon | planned | disabled`.
- **El backend no formatea** ni `$` ni `%`. Es del front.
- **El front nunca hardcodea activos.** Todo viene del registry filtrado por el backend.
- **Estados de activos con badge:** `active` visible · `coming_soon` visible con "Pronto" · `planned` y `disabled` ocultos.

---

## Contradicciones detectadas

(Se renumeran aquí las siete, en un solo lugar. Antes estaban repartidas en dos
secciones y era imposible contarlas.)

**1. Botones de reintentar — resuelto, con una excepción.** Se respondió "un
mensaje con botón *Reintentar*" y después que se prefiera actualizar solo. Quedó:
reintento automático, **sin texto y sin botón**, y si se agota se conserva el
último valor con su hora.

**Única excepción: el envío.** Si un envío falla, ahí sí se avisa al momento y se
ofrece reintentar —*"No pudimos enviar. Reintentá."*— y **nunca reintenta solo sin
avisar**. Motivo: hay plata en movimiento y la persona la puso en juego. La
excepción no se extiende a ninguna otra pantalla.

**2. "No pudimos cargar tus movimientos" — resuelto, con una precisión.** Ese
mensaje era un error de sistema con otro nombre. Se separaron dos cosas que se
confundían:

- **El webhook todavía no guardó** → estado normal, no es un fallo. Se dice
  "Todavía no tenés movimientos".
- **La base está caída** → error de sistema, va a telemetría, y se conserva lo
  último con su hora.

**3. El catálogo de activos — resuelto: vive en el backend.** Se había dicho "el
front nunca hardcodea activos", lo que contradecía el catálogo que vivía en el
front. Lo que lo zanja es el criterio de la propia respuesta: *"solo las que el
backend puede leer y están activas"*, que es verdad del backend. `config/assets.ts`
pasa a ser simulacro y se borra cuando el backend responda.

**4. Redondeo — resuelto: se redondea solo lo que se ve.** La respuesta no decía si
el redondeo era del dato o de la pantalla. **El dato nunca**: un saldo redondeado
es un saldo falso, y un entero de JavaScript pierde precisión arriba de unos 90
millones.

**5. El PIN de respaldo — resuelto: no hace falta en el MVP. [H4] Actualizado.**
Se respondió que se puede entrar con un PIN de 6 dígitos y que "WebAuthn lo
permite". WebAuthn no provee un PIN: son dos mecanismos. Y como la recuperación es
**por correo verificado** —el teléfono nunca se verifica—, lo único sin cubrir es
"la biometría falló hoy", para lo que alcanza el código del propio dispositivo.

Lo que **agregó** la Hoja 4: si la biometría falla, **no hace falta nada de esto**,
porque el correo con código de 6 dígitos es una puerta de entrada real, no un
residuo.

**6. Límite de reenvío — [H4] DADO VUELTA: ahora manda Privy.** Faltaba acotar
el reenvío de códigos, y quedó en 1 minuto entre uno y otro. **La Hoja 4 cambió el
fundamento:** el código de verificación **lo manda Privy, no ReWALLET** (son 6
dígitos y su plazo no se configura). Entonces:

- **Solo hay un código**, el del correo. Antes eran dos, correo y teléfono.
- **El pleno de 1 minuto ya no es nuestro.** Rige lo que Privy permita.
- La preocupación de fondo —que alguien use el número de otra persona para pedir
  códigos— **desaparece**: no se manda nada al teléfono.

Lo que queda por construir no es el límite sino **el mensaje**: qué ve la persona
cuando pide reenviar y todavía no se puede.

**7. Qué puede hacer alguien sin verificar — [H4] DADO VUELTA DOS VECES. La Hoja 4
lo zanjó.** La puerta se movió tres veces, y vale la pena escribir por qué, porque
es el patrón más caro de este contrato:

| Versión | Dónde | Qué veía sin verificar |
| --- | --- | --- |
| 1 | Hoja 1, primera pasada | Solo el Perfil |
| 2 | Hoja 2, al cruzarla | La app entera, con una banda arriba; lo bloqueado era mover plata |
| **3** | **Hoja 4, 0.3** | **Nada. Pantalla de código y nada más.** |

La versión 2 se justificaba con una frase: *"a nadie se le tapa la billetera por no
haber verificado un correo"*. **La Hoja 4 da vuelta ese argumento**, y lo hace por
una razón que la versión 2 no tenía en cuenta:

> ReWALLET **mueve plata real desde el primer día**. El argumento de "no tapar la
> billetera" venía de una etapa en que ver sin verificar no exponía a nadie. Con una
> app que es permissionless por diseño (Hoja 3) y que manda plata real, dejar entrar
> sin verificar no es generosidad: es abrir la puerta sin preguntar quién está del
> otro lado.

Y hay una consecuencia de producto que la versión 2 no podía ver: **el Perfil donde
se verificaba tampoco existía**, porque la Hoja 4 pide nombre, teléfono y correo
**antes** de verificar. La verificación ya no es una tarea dentro de la app: **es la
puerta de la app**.

**Lo que queda escrito para que no se vuelva a mover la puerta:** el flujo de
identidad de la Hoja 4 es de una sola dirección. Cambiarlo requiere una decisión
explícita, no una mejora de detalle.

**Consecuencias que dejó la verificación de correo**, y que hay que tener
presentes:

- **[H4] El backend ya tiene el campo, con otro alcance — confirmado.** Existen
  `users.recovery_email` y `users.recovery_email_verified`: el correo está para
  **recuperar**. La decisión lo **promueve a condición**, que es otra cosa. No es
  agregar un campo: es **cambiar qué significa**, y la Hoja 4 lo confirmó. **El
  nombre de la columna hay que cambiarlo**: hoy miente.
- **[H4] La identidad de la cuenta se movió — confirmado.** Antes era "una sola
  cuenta vinculada al passkey del dispositivo"; ahora está anclada al **correo
  verificado**. El passkey es cómo se entra, el correo es quién sos.
- **[H4] Lo nuevo que dejó la Hoja 4 y hay que tener presente:**
  - **El teléfono dejó de ser vía de recuperación.** No se verifica nunca, así que
    no prueba nada. `users.recovery_phone_verified` queda en `false` para siempre.
  - **No hay soporte detrás de una cuenta perdida.** Sin términos no hay base
    legal, y soporte no puede mirar nada. La **llave de repuesto** es el mecanismo,
    pero **no se puede activar hasta que haya términos**.
  - **Nada se escribe en la base hasta que la cuenta está completa.** El borrador
    del onboarding vive en el dispositivo. `users.tag` es `NOT NULL` y único, así
    que crear la fila antes de verificar habría gastado un tag por cada intento
    abandonado.

---

## Verificación: estas reglas no son deseos

Cada regla de esta hoja ya está escrita en el código del laboratorio, que fue
donde se descubrieron. No son ideas: son cosas que alguien ya tuvo que
implementar.

| Regla | Dónde está |
|---|---|
| Saldo como texto decimal exacto | `Front End/src/domain/wallet/types.ts` |
| `observedAt` — cuándo se leyó | `Front End/src/domain/assets/types.ts` |
| `unsourced` — el origen no leído se declara | `Front End/src/domain/movements/types.ts` |
| `supplyAprBps` — la tasa en puntos básicos | `Front End/src/data/poolSummary.ts` |
| `hasWallet: false` es válida, no un error | `Front End/src/infrastructure/wallet/httpWalletRepository.ts` |
| Correo de recuperación y su verificación | `Backend/src/infrastructure/db/schema.ts` |

En `05. UI-UX/` **todavía no hay nada que las incumpla**: esa carpeta no tiene capa
de salida, sus datos salen de `config/markets.ts`. Esta hoja existe para que el día
que sí haya lecturas, no empiecen a existir datos que no la respetan.
