# Hoja 2 — Qué ve la persona, y cuándo no

> Hoja 2 de N. **Completada por el cliente.** Las celdas están contestadas y las
> contradicciones que aparecieron al cruzarla quedaron resueltas y escritas en las
> dos hojas. **Cero pendientes.**
>
> **Actualizada al cerrar la Hoja 3** (`docs/contrato-dinero.md`, 34 preguntas).
> Nueve celdas cambiaron y una regla transversal se amplió; están marcadas abajo
> con **[H3]**.
>
> **Actualizada al cerrar la Hoja 4** (`docs/contrato-identidad.md`, 39 preguntas).
> **La pantalla 6 —Perfil— fue reescrita entera** y la contradicción 1 **dio vuelta
> por segunda vez**. Todo lo tocado está marcado con **[H4]**. Nada quedó sin resolver.

**Nota de alcance.** Esta hoja describe las **pantallas que la persona ve cuando ya
está dentro**. El acceso —pantalla de bienvenida, passkey, onboarding, pantalla del
código y llave de repuesto— lo define la Hoja 4 y **no tiene pantalla propia acá**.
Es el hueco conocido de esta hoja, y está anotado al pie.

**Ya decidido y no se pregunta aquí:**
- El usuario no ve errores de sistema. Van a telemetría.
- La persona no debe ver que hay blockchain detrás.
- Si no se puede leer un dato: último valor conocido con su hora. Nunca vacío.

---

## 1. Billetera

| | |
|---|---|
| **Qué se ve siempre** | Saldo, acciones y línea de rendimiento. El saldo es el protagonista; las acciones son el CTA; la línea de rendimiento es el diferenciador. |
| **Si el saldo no se pudo leer** | Último valor con su hora: "actualizado hace 2 min". Nunca vacío. |
| **¿La línea de rendimiento se ve siempre?** | Sí, siempre. Es la promesa central. Ocultarla cuando es negativa rompe la transparencia. |
| **¿El saldo, en ARS o en USD?** | **Siempre USD.** Es la unidad de cuenta del producto. |
| **Estado vacío** | No aplica: siempre muestra el saldo, aunque sea `$0,00`. |
| **Qué no puede aparecer nunca** | Ningún nombre de protocolo, cadena o token. Nunca "EVM", "SVM", **"Aave", "Monad"**. Solo "dólares" y "rendimiento". |
| **De dónde sale** | `GET /wallet`. El backend compone el saldo total (líquido + posiciones). |

## 2. Inversiones — lista de cripto

| | |
|---|---|
| **Qué se ve por fila** | Símbolo, nombre y saldo. **La lista NO lleva variación.** La variación vive en la pantalla de detalle. |
| **¿Se ve el precio del activo?** | Solo al tocar la fila, en la pantalla de detalle. |
| **Un activo sin saldo legible** | La fila **no aparece**. |
| **Estado vacío** | "Todavía no tenés cripto" + ilustración + CTA "Añadir dinero". |
| **La variación diaria** | En la lista **no aparece**. En el detalle **sí, siempre y completa: con signo, color y flecha** arriba o abajo. |
| **Qué no puede aparecer nunca** | Ningún activo con estado roto: `NaN`, `undefined`, carga infinita. |
| **De dónde sale** | `GET /wallet/assets`, filtrando el registry por estado `active`. |

## 3. Actividad — movimientos

| | |
|---|---|
| **Qué se ve por fila** | Descripción, importe, momento y estado. El estado es crítico: "Completado", "Procesando", "Falló". |
| **El momento, ¿cómo se escribe?** | Mixto. Hoy: "hace 2 min". Ayer: "ayer 14:32". Antiguo: "12 oct 2026". |
| **El importe, ¿con signo?** | Sí. `+$1.200,00` en verde para ingresos, `−$50,00` en negro para egresos. |
| **"Procesando" y "sin confirmar"** | Se muestran con su etiqueta. Nunca se ocultan: la persona tiene derecho a saber qué pasó con su dinero. |
| **Estado vacío** | "Todavía no tenés movimientos" + ilustración + CTA "Añadir dinero". |
| **Qué no puede aparecer nunca** | IDs de transacción, hashes, códigos de error. Tampoco un movimiento sin importe. |
| **De dónde sale** | `GET /wallet/movements?cursor=`, con paginación. |

## 4. Detalle de un activo

| | |
|---|---|
| **Qué se ve siempre** | Saldo y precio. El precio se muestra acá, no en la lista. |
| **¿Se ve el gráfico?** | Solo si hay datos. Fase 1 no tiene gráfico; Fase 2 agrega el de rendimiento acumulado. |
| **El gráfico sin datos** | No se dibuja y no ocupa espacio: se colapsa y aparece el resto. |
| **Las acciones disponibles** | Menos las que no apliquen. Para USDC: "Recibir", "Enviar", "Ver rendimiento". Para activos volátiles: se agrega "Convertir". |
| **¿Se ve el precio de la moneda?** | Sí. `1 USDC = $1,00`. Aporta sin romper la simplicidad. |
| **Qué no puede aparecer nunca** | Jerga técnica: ni "APY", ni "TVL", ni "utilización". Solo "Rendimiento anual: 4,14%". |
| **De dónde sale** | `GET /wallet/assets/:id`, que compone posición, precio y rendimiento. |

## 5. Tu dinero — rendimiento

| | |
|---|---|
| **Si la tasa baja, ¿se avisa?** | No. El número tal cual. Transparencia sin dramatismo: la tasa sube y baja, es normal. |
| **El respaldo, ¿en palabras?** | **No se nombra el protocolo.** La credibilidad la da **la cifra**: "Respaldo: $150.198.641". Un nombre propio no aporta nada a quien no lo conoce. |
| **El porcentaje de uso, ¿se muestra?** | Sí, en el detalle, y **sin la palabra "pool"**: "92% está prestado". |
| **Si no se pudo leer la tasa** | Último valor con su hora. |
| **¿Se explica qué es el rendimiento?** | Sí, en una línea: "Tu dinero genera interés automáticamente. No tenés que hacer nada." |
| **¿Dónde se ve el acumulado?** **[H3]** | **Solo en esta pantalla de detalle:** "Ganaste $0,12 desde el 25 de septiembre". **En la pantalla principal no va una cifra aparte:** el rendimiento se suma al saldo y la persona ve un solo número. |
| **Qué no puede aparecer nunca** | Jerga DeFi: "APY", "yield farming", "liquidity pool", "TVL". Ni números con más de 2 decimales. |
| **De dónde sale** | `GET /yield/summary`, que lee el pool vía RPC. |

## 6. Perfil **[H4] REESCRITA AL CIERRE DE LA HOJA 4**

> **Lo que hay aquí cambió entero.** Antes este perfil era donde se verificaba el
> correo. **Ya no: la verificación es la puerta de la app y pasa antes de que el
> perfil exista** (Hoja 4, 0.3). Y el contenido del perfil creció con tres cosas que
> la Hoja 4 decidió: el QR de la persona, las sesiones abiertas y el aviso de
> dispositivo nuevo.

| | |
|---|---|
| **Sin verificar, ¿qué se ve?** **[H4]** | **Nada del Perfil, porque no se ve la app.** Antes decía "la app entera, con una banda arriba". **Dado vuelta:** hasta que el código de 6 dígitos no se pone, lo único en pantalla es la pantalla del código. Sin saldo, sin billetera, sin perfil, sin navegación. |
| **¿Puede navegar sin verificar?** **[H4]** | **No.** Antes decía "sí, puede ver todo, y lo único bloqueado es mover plata". **Dado vuelta** por la misma razón: ReWALLET mueve plata real desde el primer día, y dejar entrar sin verificar no es generosidad, es abrir la puerta sin preguntar quién está del otro lado (Hoja 4, 0.3). |
| **Con todo verificado, ¿se ve la verificación?** **[H4]** | Desaparece del todo. **La banda ya no existe:** no hay banda, hay pantalla de código. Y una vez dentro, el estado normal no muestra validaciones — igual que antes. |
| **¿Se puede cambiar el correo?** **[H4]** | **Antes de verificar, sí. Verificado, nunca.** Se corrige en la pantalla del código, *antes* de mandarlo: *"Te va a llegar un código a `juan.perez@gmial.com`. ¿Es correcto?"*, con **Sí** y **Corregir**. **Después no se cambia jamás**: el correo es la identidad, y cambiarlo sería cambiar de dueño. **No hay ningún control de cambio de correo en esta pantalla.** |
| **¿Se puede cambiar el teléfono?** **[H4]** | **No hay pantalla que lo cambie.** El teléfono se pidió una vez en el onboarding, no se verifica nunca, y **no es vía de recuperación** (Hoja 4, 0.1 y 6.3). |
| **¿Se puede cambiar el nombre?** **[H4]** | **No. Nunca.** El nombre se escribe una vez en el onboarding y no tiene edición. Antes esta pantalla lo tenía como dato editable. |
| **El @tag, ¿se puede cambiar?** **[H4]** | **Sí.** Y cuando se cambia, **el anterior deja de funcionar**: no hay alias ni periodo de gracia. |
| **El QR de la persona** **[H4]** | **Sí, en el Perfil: es el contenido principal.** El QR de ReWALLET de esa persona, para **sumarla**, no para recibir. **Los QR de las wallets viven en el listado de los activos**, que son cosas distintas para consumidores distintos. **El QR se escanea, no se lee:** la dirección no aparece en pantalla (Hoja 4, 6.5). |
| **Sesiones abiertas** **[H4]** | Una sección con los dispositivos **en palabras de persona** —"Este iPhone", "Chrome en Windows"— y un botón **"Cerrar todas las sesiones"**, que cierra y obliga a entrar de nuevo con la huella. **La dirección IP y el navegador no se muestran nunca**: son del tipo de dato que la regla 1 prohíbe. Es **el único interruptor de emergencia** que tiene la titular (Hoja 4, 4.4). |
| **Aviso de dispositivo nuevo** **[H4]** | Cuando alguien entra desde un dispositivo o navegador que el backend no reconoce, **se manda un correo**: *"Entraste a tu cuenta de ReWALLET desde un dispositivo nuevo"*. **Sin tono de alarma** y **sin bloquear nada**: es información, no un error. El caso frecuente es entrar desde el celular de otro, y un mensaje que asusta cada vez entrena a la gente a ignorar los avisos que sí importan (Hoja 4, 4.5). |
| **El saldo de la cuenta, ¿se ve?** | No, solo en la Billetera. El perfil no repite información. |
| **Qué no puede aparecer nunca** | La dirección de la wallet, la dirección IP, el identificador del navegador. Ni EVM ni Solana. El perfil muestra solo tag, nombre, color y contacto. |
| **De dónde sale** | `GET /me` y `PATCH /me/profile`. La pantalla de sesiones necesita un endpoint propio para revocar, que **hoy no existe**. |

<!--
COMENTARIO — por qué este perfil ya no verifica nada.

El perfil era el lugar donde se pedía el correo, porque la verificación se
inventó como una tarea suelta dentro de una app que ya se podía usar. **La Hoja 4
la volvió la puerta**, y eso arrastra tres cosas:

  1. **El Perfil solo existe para quien ya verificó.** No hay "perfil sin
     verificar", porque no hay app sin verificar.
  2. **Los datos del perfil se piden antes, no después.** Nombre, teléfono y correo
     entran en el onboarding, antes del código.
  3. **El perfil deja de ser una pantalla de configuración de la cuenta y pasa a
     ser la pantalla de "esta cuenta es mía y estas son mis cosas":** mi QR para
     sumar gente, mis sesiones, mi tag.

El cambio de fondo es que antes el perfil era **una lista de ajustes**. Ahora es
**la tarjeta de la persona dentro de ReWALLET**, y por eso el QR del perfil es su
contenido principal: es lo que hace que sumar a alguien sea un escaneo.

**Lo que este perfil no tiene:** no hay "eliminar mi cuenta" (Hoja 4, 6.4),
no hay cambio de correo, y no hay cambio de nombre. Son tres ausencias, y las tres
son decisiones, no olvidos.
-->


## 7. Cobrar y pagar con QR

| | |
|---|---|
| **¿Cuánto tiempo vive el QR?** **[H3]** | Lo que diga el backend. Por defecto: **24 horas**, y es el mismo plazo para los dos caminos —QR presencial y link de cobro—, sin distinción. |
| **Si expira, ¿qué ve?** | Aviso "Este cobro expiró" + botón "Generar uno nuevo". Nunca vuelve al inicio sin explicación. |
| **¿Importe antes de cobrar?** | Sí. La persona ingresa el monto antes de generar el QR; después solo comparte. |
| **Si alguien ya cobró, ¿se avisa?** | Sí: "Ana ya pagó este cobro" + hora. El estado del QR pasa a "Pagado". **El enlace es de un solo uso:** cuando alguien paga, termina. **[H3]** |
| **¿Quién es el que pagó?** **[H3]** | Si tiene cuenta ReWALLET: **"Carlos pagó"** + hora. Si el pago llegó desde otra billetera externa: **"Se recibió de otra billetera externa"** + monto + hora. **Una dirección nunca aparece en pantalla.** |
| **¿Se puede cancelar un cobro?** | Sí, mientras no se cobre. Botón "Cancelar cobro" con confirmación. |
| **Qué no puede aparecer nunca** | La palabra "USDC" ni "blockchain" en el QR. Solo "dólares" y el nombre de quien recibe. |
| **De dónde sale** | `POST /wallet/request`, que genera el identificador y el link. |

## 8. Enviar

| | |
|---|---|
| **¿Se puede enviar a cualquiera?** **[H4]** | **Sí: a cualquier persona de ReWALLET.** Se llega por **escanear su QR** o por **buscar su nombre o @tag**. **Nunca se escribe una dirección a mano y nunca se ve una.** Quien no tiene ReWALLET no se puede enviar desde la app. |
| **La red, ¿se ve?** **[H4]** | **Sí, como una pastilla siempre visible: "Red: Monad".** Una sola línea, como dato, **sin menú para elegir y sin explicarla**. No se pide entenderla: se pide confirmarla. Ver el comentario completo en la Hoja 3, sección 1. |
| **Los contactos, ¿de dónde?** | De envíos anteriores: el backend registra destinatarios y los sugiere. La libreta del teléfono, en Fase 2. |
| **Si el contacto no existe** | El @tag que se busca no aparece: se avisa y se ofrece crearlo, **"@carlos no está en ReWALLET. ¿Querés invitarlo?"**. Un QR que no es de ReWALLET se rechaza sin dejar la pantalla vacía. **[H3]** |
| **El importe, ¿se confirma antes?** | Sí, siempre. Hoja de confirmación con destinatario, monto y botón "Confirmar". Nunca envío accidental. |
| **Si el envío falla** | Avisa al momento: "No pudimos enviar. Reintentá." con botón. **Nunca reintenta solo sin avisar.** |
| **Qué no puede aparecer nunca** | "Gas", "fee", "confirmaciones", "hash". Solo "Enviando...", "Listo" y el nombre de la red como dato. |
| **De dónde sale** | `POST /wallet/send`, con **Idempotency-Key obligatorio**. |

---

## Las tres reglas que cruzan todo

1. **Nunca jerga técnica.** Ni "EVM", ni "gas", ni "blockchain", ni "APY", ni "TVL". La persona ve "dólares", "rendimiento", "envío".
2. **Nunca dejar vacío.** Si no se puede leer, se muestra el último conocido con su hora. Nunca en blanco, nunca `NaN`, nunca carga eterna.
3. **Nunca mostrar errores de sistema.** Van a telemetría. Lo que ve la persona son mensajes accionables: "Reintentá", "No llegó el código. Probá de nuevo.", "Revisá tu conexión". **[H3] El botón de reintentar aparece solo cuando la acción movió plata** —envío, retiro y cobro—. En el resto, el reintento es automático y silencioso: leer el saldo no es una emergencia. **[H4] "Verificá tu correo" ya no aparece en ninguna parte**: la verificación dejó de ser una tarea dentro de la app y pasó a ser la puerta (Hoja 4, 0.3). **Tampoco hay un mensaje de sesión expirada**: cuando la sesión muere, la persona llega directo a la pantalla de las dos puertas, sin explicación (Hoja 4, 4.3).

---

## Contradicciones detectadas

Las cuatro aparecieron al **cruzar esta hoja con la del núcleo**: tres no eran
contradicciones internas, sino que una hoja decía una cosa y la otra la
contraria.

**1. La verificación dejó de bloquear el uso — [H4] DADO VUELTA. Ahora bloquea
todo.** Esta contradicción se resolvió dos veces y la segunda la revirtió la Hoja 4:

| | Qué veía sin verificar |
| --- | --- |
| Primera resolución | Solo el Perfil |
| Segunda resolución | La app entera, con una banda arriba; bloqueado solo mover plata |
| **[H4] Hoja 4, 0.3** | **Nada. Pantalla de código y nada más.** |

El argumento de la segunda resolución era *"a nadie se le tapa la billetera por no
haber verificado un correo"*. **La Hoja 4 lo dio vuelta**, y la razón es que ese
argumento venía de una etapa en que ver sin verificar no exponía a nadie. ReWALLET
**mueve plata real desde el primer día** y es **permissionless por diseño** (Hoja
3): dejar entrar sin verificar no es generosidad, es abrir la puerta sin preguntar
quién está del otro lado.

Y la consecuencia que la segunda versión no podía ver: **el Perfil donde se
verificaba tampoco existía**, porque ahora el nombre, el teléfono y el correo se
piden **antes** de verificar.

Las dos hojas quedaron actualizadas con lo mismo. **La puerta no se vuelve a mover
sin una decisión explícita.**


**2. La variación diaria — resuelto.** **La lista no lleva variación; el detalle
sí, completa**: con signo, color y flecha. Los dos números que se parecen
—variación de un activo y tasa del pool— quedan con reglas distintas y escritas.

**3. Los textos prohibidos — resuelto.** Ni "Aave" ni "pool". La credibilidad la
da **la cifra**: "Respaldo: $150.198.641". Y el porcentaje de uso se dice **"92%
está prestado"**. Un nombre propio no le aporta nada a quien no lo conoce, y la
regla 1 se cumple sin excepciones.

**4. El envío fallido — resuelto como excepción explícita, y después ampliado.**
El reintento silencioso sin texto ni botón es la regla, y el envío es la excepción:
avisa al momento y ofrece reintentar, porque hay plata en juego.

**[H3] Ampliación al cerrar la Hoja 3:** la excepción ya no es solo el envío. El
botón "Reintentar" aparece **cuando la acción movió plata** —envío, retiro y
cobro—. El resto, incluido el envío de dinero que no llegó a salir, reintenta solo
y en silencio. La línea que decide: **problemas de plataforma no, problemas con tu
plata sí.**

**5. La dirección nunca se muestra ni se escribe — resuelto, y cierra el envío.**
Esta hoja decía que en Fase 1 solo se podía enviar a cuentas ReWALLET, y la Hoja 3
había mantido que se podía enviar a cualquier dirección EVM escribiendo o pegando
esa dirección a mano. Eso obligaba a levantar la prohibición de la dirección en la
pantalla 8, y dejaba solo una advertencia —la red— para no perder plata.

Se resuelve mejor por el otro lado: **la dirección nunca se escribe ni se ve.**
Se llega al destinatario por **QR** o por **nombre o @tag**, y ReWALLET resuelve
la dirección solo. Tres consecuencias:

- La **prohibición de la dirección vuelve a ser global**, y la del Perfil deja de
  ser la única que la aplicaba.
- La **pastilla de red sigue visible** (pantalla 8): aunque nadie escriba la
  dirección, quien envía tiene que saber a qué red va.
- **Quien no tiene ReWALLET no se puede enviar desde la app.** El envío externo
  queda para una fase siguiente.


**6. El nombre de quien paga — resuelto.** La fila dice "Carlos pagó" si viene de
ReWALLET, y "Se recibió de otra billetera externa" si no. **Una dirección nunca
aparece en pantalla.** Se descartó mostrarla porque rompía la regla 1 y la
prohibición de identificadores de la pantalla 3.

**7. El Perfil dejó de ser donde se verifica — [H4] cerrado.** La pantalla 6 fue
reescrita entera. Antes era donde se pedía el correo, porque la verificación se
inventó como una tarea suelta dentro de una app que ya se podía usar. **La Hoja 4 la
volvió la puerta de la app**, y arrastró tres cosas: el Perfil solo existe para
quien ya verificó, los datos se piden antes en el onboarding, y la pantalla deja de
ser una lista de ajustes para ser **la tarjeta de la persona dentro de ReWALLET** —
por eso el QR del perfil pasó a ser su contenido principal.

Con esto la hoja queda cerrada y **coherente con la Hoja 1, la Hoja 3 y la Hoja 4**.
Cero pendientes.

### El hueco conocido de esta hoja

La Hoja 4 define **cinco pantallas de acceso** —bienvenida con las dos puertas,
creación de passkey, onboarding de correo/teléfono/nombre, pantalla del código de 6
dígitos, y la llave de repuesto de 12 palabras— y **esta hoja no tiene ninguna
pantalla para ellas**. Las ocho pantallas que cubre arrancan todas adentro de la app.

No se escribió ahora porque **son trabajo nuevo, no alineación**: no es cruzar dos
hojas, es decidir el contenido de cinco pantallas que nunca se/redaron. Queda como
trabajo pendiente, no como contradicción.
