# Hoja 3 — Acciones del dinero: qué se puede hacer y bajo qué reglas

> Hoja 3 de N. **Completada por el cliente.** Cada respuesta es una decisión
> tomada, no una propuesta.
>
> **Hoja abierta.** Ninguna fila tiene respuesta todavía.

**Ya decidido en las hojas 1 y 2, y no se pregunta aquí:**
- La persona **no ve errores de sistema**. Los reintentos son invisibles, salvo el
  envío (única excepción escrita).
- **Sin correo verificado no se mueve plata**, pero se ve toda la app.
- **Nunca jerga técnica**: ni "gas", ni "red", ni "confirmaciones", ni nombres de
  protocolo, cadena o token. Solo "dólares", "rendimiento", "envío".
- **Nunca vacío**: si un dato no se pudo leer, último valor conocido con su hora.

**Quién cumple:** el backend (`Backend/`), contra `application/payments`,
`application/contacts`, `infrastructure/gas` y la tabla `policy_decisions` — que
hoy están vacíos. El front (`05. UI-UX/`) solo refleja lo que el backend permita.

---

## 1. Enviar a otra cuenta

| | |
|---|---|
| **¿Puede enviarse a una cuenta que no existe todavía?** **[H4]** | **No. El destinatario siempre tiene ReWALLET.** Se llega por **QR** o por **nombre o @tag**, y ReWALLET resuelve la dirección por detrás: **nadie escribe una dirección ni la ve.** El envío a una billetera externa queda para una fase siguiente. |
| **¿Hay un límite por envío?** | **No, ninguno.** La base del Trust Policy Engine queda sembrada para el futuro, pero en Fase 1 no se aplica ningún límite. El objetivo es que el flujo funcione end-to-end antes de restringir. |
| **¿Y un límite diario acumulado?** | **No.** Misma razón que la anterior: cuando haga falta limitar, el Trust Policy Engine lo activa con una regla nueva. Por ahora, flujo libre. |
| **¿Quién decide si el envío se permite?** | **El backend, siempre.** En Fase 1 el backend **solo verifica tres cosas**: saldo suficiente, destinatario válido e idempotencia. El destinatario se valida como identidad ReWALLET —por QR o por tag—, no como una dirección escrita. Las reglas del Trust Policy Engine están sembradas pero **inactivas**. |
| **¿Qué pasa si la misma orden se manda dos veces?** | **El backend la reconoce y la ejecuta una sola vez.** `Idempotency-Key` obligatorio: si llega una segunda request con la misma key, devuelve el resultado de la primera **sin ejecutar nada**. |
| **Mientras espera, ¿qué ve la persona?** | **"Enviando..." con un loader circular animado.** Un spinner limpio, centrado, hasta que la transacción se confirme. Al terminar, el saldo se actualiza y el loader desaparece. |

**Cómo se llega al destinatario — decisión del cliente.** La pantalla de envío tiene
**dos caminos y ninguno de los dos es escribir una dirección**: escanear el QR de la
otra persona, o buscarla por nombre o por @tag. ReWALLET resuelve la dirección por
detrás y la muestra en ninguna parte. Esto cierra de raíz el problema de la red: la
pastilla "Red: Monad" sigue visible, pero **nadie puede meter una dirección de otra
red a mano**, así que el error que perdía el dinero ya no se puede cometer desde la
app.

<!--
COMENTARIO — la ayuda para no enviar a la red equivocada.
NO es una decisión todavía: es el lugar donde tiene que caer.
Leer antes de construir la pantalla de envío.

Contexto que da el cliente: en W3 los fondos enviados a una red que no era la
correcta SE PIERDEN. No hay reclaim, no hay soporte que los devuelva, no hay
transacción que revierta. Eso convierte a la selección de red en la función más
importante de esa pantalla, no en un detalle técnico.

El problema: la Hoja 2 prohíbe que la persona vea que hay blockchain detrás
(ni "EVM", ni "Solana", ni el nombre de una red). Pero quien escribe una
dirección equivocada pierde plata para siempre. El silencio y la seguridad
entran en conflicto acá, y no se resuelven solos.

Cómo se resuelve sin mostrar jerga:
  1. Una sola pastilla de red visible en la pantalla de envío, SIEMPRE activa y
     a la vista. No un detalle: el elemento principal. Ej.: "Red: Monad".
  2. Se muestra en una sola línea, como dato, sin explicación ni menú. No se
     pide entenderla: se pide confirmarla.
  3. **La pastilla va igual aunque nadie escriba direcciones.** Se llegó a la
     decisión de que el destinatario se busca por QR o por @tag, y la dirección
     nunca se escribe ni se ve. La pastilla sigue: la red sigue siendo el dato que
     define si el dinero llega o se pierde, y quien envía tiene que poder verla.
  4. **Lo que queda por decidir** es qué pasa cuando el QR capturado pertenece a
     otra red o a otro producto. Ahí sí hace falta un aviso en palabras de
     persona, no de red: "Este código no es de ReWALLET" o "viene de otra red".
     Cada red soportada necesita su propio texto, porque los formatos de QR y de
     dirección no son iguales entre una cadena y otra.

Lo que NO hay que hacer:
  - Un selector de red con una lista para elegir a mano: convierte la pantalla
    en una herramienta de desarrollo y multiplica el error humano.
  - Explicar qué es una red. No hace falta que lo entienda: hace falta que no
    pueda errar.

Pendiente de decidir: qué redes se soportan en Fase 1 y qué texto se muestra cuando
el QR capturado no corresponde a la red actual. Hoy hay una sola red en juego
(Monad), así que el aviso puede ser simple. Si mañana entra Solana, los formatos
de QR y de dirección cambian y ahí sí hacen falta un texto por red.

Nota del cliente, 2026-10-02: aunque la Fase 1 llegue solo a Monad, **el modelo
deja la puerta abierta para agregar otras redes**. No se define acá cuáles ni
cuándo: el cliente todavía no lo décisionó y por eso no lo detaltaba. La
estructura de la UI tiene que permitir agregar una red sin rediseñarse — de ahí
la pastilla única en vez de un selector.
-->

## 2. Cobrar y recibir

| | |
|---|---|
| **¿Qué se puede cobrar?** | **Un importe fijo.** Quien cobra define el monto antes de generar el QR o el link. |
| **¿Alguien sin cuenta ReWALLET puede pagar el cobro?** | **Sí, y por dos caminos.** Si tiene una wallet cripto, envía directo a la dirección EVM. Si tiene ReWALLET, escanea el QR y paga vía tag. El cobro es un link/QR que abre cualquiera de las dos puertas. |
| **¿Cuánto vive un cobro?** | **24 horas.** Un solo plazo para los dos caminos: QR presencial y link de cobro. Configurable en el backend; **el default es 24 horas**. |
| **Si nadie cobra, ¿qué pasa con el importe?** | **Nunca se aparta.** No hay reserva de fondos: el importe solo existe al cobrar. **Es una intención, no una transacción.** |
| **¿Se puede cobrar de nuevo el mismo enlace?** | **No: es de un solo uso.** Un enlace = un cobro. Cuando alguien paga, el estado pasa a **"Pagado"** y el enlace termina. |
| **¿Quién ve los datos de quien paga?** | **Nombre y hora si viene de ReWALLET; una frase si viene de afuera.** Si quien paga tiene cuenta ReWALLET: **"Carlos pagó"** + hora. Si el pago llegó desde otra billetera externa: **"Se recibió de otra billetera externa"**, con monto y hora. **La dirección no aparece nunca.** |

## 3. Depositar y retirar (entrada y salida de la cuenta)

| | |
|---|---|
| **¿Cómo entra dinero a la cuenta?** | **Desde otra cripto.** En Fase 1 el usuario deposita USDC desde otra wallet cripto. |
| **¿Esa entrada existe en la Fase 1?** | **Sí, y por dos caminos:** se crea por un link compartido, o cualquier wallet cripto deposita directo a la dirección EVM del usuario. **Y se hace directamente en Monad Mainnet, no en testnet** — es un cambio respecto a lo planificado, y acelera la validación real. |
| **¿Se puede retirar a una cuenta bancaria?** | **No en la Fase 1.** El retiro bancario es Fase 3: requiere licencias y un proveedor on/off-ramp. |
| **¿Cuánto tarda en estar disponible?** | **El tiempo que diga el proveedor, y se avisa.** No aplica en Fase 1; cuando exista, se comunica con claridad. |
| **Si el retiro se rechaza, ¿qué ve la persona?** | **Por qué se rechazó y qué hacer.** No aplica en Fase 1; cuando exista, el mensaje es claro y accionable. |
| **¿Se puede cancelar un retiro en camino?** | **Sí, mientras el proveedor lo permita.** No aplica en Fase 1; queda definido para cuando exista. |

## Las tres reglas que cruzan las secciones 1 a 3

1. **Fase 1 es permissionless.** Sin límites por operación ni diarios. El Trust
   Policy Engine queda sembrado pero inactivo: primero que el flujo funcione,
   después se restringe.
2. **Todo va sobre Mainnet desde el día uno.** Depositar y enviar se hace en
   **Monad Mainnet**. No se espera a testnet: se quiere validar con dinero real.
3. **El backend decide, la persona ve.** El backend valida saldo, dirección e
   idempotencia. La persona ve un loader y el resultado. Sin jerga, sin códigos,
   sin errores técnicos.

## 4. Convertir e intercambiar

**En Fase 1 no existe.** Todo lo de esta sección es una decisión ya tomada para
Fase 2, escrita ahora porque el contrato tiene que nacer bien. En Fase 1 lo único
que hay es el puerto sembrado.

| | |
|---|---|
| **¿Se convierte dentro de ReWALLET?** | **No en la Fase 1.** El swap interno llega en **Fase 2: USDC ↔ USDT0 dentro de Monad**. Base sembrada hoy: la interfaz `SwapProvider` queda definida con un adapter vacío que devuelve "no implementado". Cuando se activa, se cambia **una línea en el container**; el frontend no se toca. |
| **¿Cómo se elige la tasa?** | **La del mercado, congelada al abrir la pantalla.** Nunca una tasa fija del backend: sería deshonesto mostrar una tasa que no refleja el mercado real. Base sembrada: el tipo de la cotización lleva un **campo de expiración obligatorio**. Hoy no se usa, pero el contrato ya establece que toda cotización vence. |
| **¿Se ve el importe recibido antes de confirmar?** | **Sí, con el equivalente en dólares.** Simple, sin plazos ni estimaciones. Base sembrada: el preview incluye **siempre origen y destino, ambos con su valor en USD**. El frontend no calcula nada: lo que ve la persona es lo que el backend devolvió. Nada de "recibís antes de las 14:32" — es jerga de exchange. |
| **Si la tasa cambia mientras se confirma, ¿qué pasa?** | **Se usa la que se vio.** Congelada al abrir, se respeta; no se vuelve a pedir confirmación. Base sembrada: la ejecución del swap recibe el **identificador de la cotización**, no los parámetros originales — eso obliga al backend a usar la tasa que la persona confirmó. Si la cotización expiró, se rechaza y la persona genera una nueva. **Nunca se ejecuta con una tasa distinta a la mostrada.** |
| **¿Hay un slippage máximo?** | **Sí, uno fijo, invisible: 1%.** Quien no es cripto no sabe qué es slippage, y si lo ve, se asusta. El campo existe en el contrato de la cotización con ese default, **pero no se expone al frontend**: lo usa el backend. Si el mercado se mueve más del 1%, la operación falla y la persona reintenta. |
| **¿Se puede convertir a una moneda local?** | **No.** Convertir a moneda local es **Fase 3**, porque requiere licencias y regulación. Base sembrada: el tipo de ruta de swap ya define los cuatro caminos posibles — misma red, cross-chain, entrada de fiat y salida de fiat. Aunque en Fase 1 solo exista "misma red", los otros tres ya están tipados, y cuando llegue Fase 3 el adapter de fiat implementa el mismo puerto. |

### El principio que une estas seis respuestas: sembrar los tipos, no las implementaciones

En Fase 1 no se implementa swap ni bridge, pero queda sembrado:

- Los **tipos** en `packages/shared`.
- Los **puertos** en `domain/ports`.
- Un **adapter vacío** que devuelve "no implementado".
- Las **tablas de cotizaciones y ejecuciones** en el schema, vacías.
- El **endpoint que devuelve 501** mientras no esté activo.

Con eso, cuando llegue Fase 2, activar el swap es **implementar el adapter**: no es refactorizar el backend. El frontend no cambia, los contratos no cambian, las tablas no cambian. Se agrega código en un solo lugar.

## 5. Rendimiento

| | |
|---|---|
| **¿El rendimiento se activa solo?** | **Sí, siempre, sin acción de la persona.** Este es el corazón del producto: **el dinero empieza a rendir al depositarse.** La persona nunca activa nada. |
| **¿Se puede sacar el dinero mientras rinde?** | **Sí, en cualquier momento.** Sin locks, sin mínimos, sin penalidades. Es la promesa de "retiro cuando quieras". |
| **Si la tasa baja a cero, ¿qué hace el saldo?** | **No pasa nada: sigue igual y deja de rendir.** El saldo principal está intacto; lo único que se pausa es el rendimiento. |
| **¿El rendimiento se suma al saldo o va aparte?** | **Al saldo, siempre.** La persona ve **un solo número**, y en la pantalla principal el rendimiento no se muestra aparte. |
| **¿Se puede ver de cuánto es el rendimiento acumulado?** | **Sí, en dólares y con su fecha.** En el detalle del rendimiento: **"Ganaste $0,12 desde el 25 de septiembre".** |

## 6. Reglas que cruzan todas las acciones

| | |
|---|---|
| **¿Hace falta confirmar con biometría o código?** | **En ninguna acción.** La biometría protege **la creación de la passkey**, una sola vez; ninguna operación la pide: ni envío, ni retiro, ni cobro, ni conversión. Queda configurable en el Trust Policy Engine más adelante. **Ver contradicción 7.** |
| **¿Cada acción queda registrada para la persona?** | **Sí, en Actividad, con su fecha.** Todo movimiento queda registrado y la persona lo ve: **es su dinero.** |
| **Si una acción queda a medio camino, ¿qué ve la persona?** | **"Procesando" con hora, siempre: nunca desaparece sin avisar.** Si falla, el error con botón **"Reintentar"** aparece **solo cuando la acción movió plata** — envío, retiro, cobro—. En el resto, el reintento es automático y silencioso, sin texto ni botón. **Ver contradicción 6.** |
| **¿Se puede deshacer una acción?** | **No. Ninguna.** Por eso la UI tiene que ayudar en todo lo posible *antes* de que la persona confirme. |
| **¿Quién puede ver el detalle de una operación?** | **Solo quien la hizo.** El detalle de una operación es privado: **ni siquiera el soporte lo ve sin consentimiento explícito.** |

## Contradicciones detectadas

Se anotan acá, numeradas, cuando surjan al cruzar esta hoja con la 1 y la 2.
No se resuelven en el momento: se anotan y se cierran todas juntas al final.

**1. El envío y la dirección — CERRADO, y cambió dos veces.**
La primera respuesta decía que en Fase 1 se podía enviar a **cualquier dirección
EVM**, escribiendo o pegando esa dirección a mano. Eso **reemplazaba** la regla de
la Hoja 2 que limitaba el envío a cuentas internas.

Después, al alinear las hojas, salió el problema de la dirección: escribirla a mano
obliga a levantar la prohibición de mostrarla en la pantalla 8, y con el dinero de
W3 perdiéndose en la red equivocada, una pantalla donde alguien teclea una dirección
es una pantalla peligrosa.

**Decisión final:** **solo QR y @tag.** El destinatario siempre tiene ReWALLET,
ReWALLET resuelve la dirección solo, y **ninguna dirección se escribe ni se ve en
ninguna parte**. La prohibición de la dirección queda global, como en la Hoja 2.
El envío a una billetera externa queda para una fase siguiente.

**2. "Carlos pagó" no siempre se puede mostrar — CERRADO: nombre o frase, nunca
dirección.**
La respuesta 12 decía que quien cobra ve el nombre de quien pagó. Pero la
respuesta 8 dice que **cualquier wallet cripto puede pagar**, sin tener cuenta
ReWALLET. Una dirección de un exchange, por ejemplo, **no tiene nombre**.

Había una primera salida — mostrar la dirección de esa wallet — que rompía dos
reglas escritas de la Hoja 2: el encabezado *"la persona no debe ver que hay
blockchain detrás"* y la prohibición de identificadores de la pantalla 3
(Actividad). Se descartó a favor de una frase.

**Decisión final:** la fila dice **"Carlos pagó"** cuando hay nombre, y **"Se
recibió de otra billetera externa"** cuando no lo hay, con monto y hora en los
dos casos. **La dirección no aparece nunca en pantalla.**

El backend sí la registra —es la clave para auditar y para que el soporte pueda
reclamar—, pero eso es interno: la Hoja 1 ya establece que lo técnico no se
muestra.

Con esto la Hoja 2 vuelve a cumplirse entera: ni blockchain ni identificadores a
la vista.

**Consecuencia asumida:** quien cobra **no puede identificar por sí mismo** a una
wallet externa, y —según aclara el cliente— **tampoco podría reclamar**: en W3 los
fondos enviados a una red que no era la correcta **se pierden**, no hay vuelta atrás
que el producto pueda ofrecer. Es el precio de no romper la promesa de simplicidad, y
queda escrito como decisión y no como olvido.

> **Por qué esto obliga a cambiar la prioridad de la UI.** Si el error no tiene
> remedio, **todo lo que ayude a no cometerlo es la función más importante de la
> pantalla de envío**, por encima de la simplicidad. Ver el comentario de la sección
> 1.

**5. Riesgo, no contradicción — permissionless en producción.**
La regla 1 de las secciones 1 a 3 (sin límites, destinatario cualquiera, Mainnet
con dinero real) es coherente consigo misma, pero conviene dejarla escrita como
riesgo asumido y no como descuido: **en Fase 1, ReWALLET es una herramienta de
transferencia cripto abierta, sin controles de monto ni de contraparte.** Eso
atrae uso indebido y lo modela el Trust Policy Engine antes de que el producto
crezca. Es una decisión consciente para validar rápido, y por eso está escrita
como decisión y no como olvido.

**6. El reintento visible se volvió la regla — CERRADO: el botón aparece solo
cuando la acción movió plata.**
La respuesta 32 decía que *toda* acción a medio camino muestra error con botón
"Reintentar". Eso contradecía dos reglas ya resueltas: la Hoja 1 (la persona **no
ve el fallo**; el reintento es automático y silencioso) y la contradicción 4 de la
Hoja 2 (el envío es **la única excepción**, y "no se extiende a ninguna otra
pantalla").

La respuesta 32 era más prudente, no menos, pero el botón en todas partes
deshacía una decisión tomada. Se resuelve en un término medio que conserva las
dos cosas:

- **"Procesando" con hora, siempre.** Toda acción a medio camino lo muestra. Nunca
  desaparece sin avisar. Esto no contradice nada: es información, no un error.
- **Error con botón "Reintentar", solo cuando la acción movió plata**: envío,
  retiro y cobro. Ahí el fallo tiene consecuencias y la persona tiene que poder
  actuar.
- **El resto reintenta solo y en silencio**, sin texto ni botón. Leer el saldo no
  es una emergencia: si falla, se reintenta y no se molesta a nadie.

La línea que decide es una sola, y es la que ya estaba escrita en la Hoja 2:
**"Problemas de plataforma" no, "problemas con tu plata" sí.**

**7. La confirmación con biometría — CERRADO: ninguna acción la pide.**
La pregunta 30 preguntaba si hacía falta confirmar con biometría o código **en cada
acción**. La respuesta fue "al crear la passkey", que es otro momento. Queda
confirmado por el cliente: **no se necesita biometría para las acciones.**

Queda así:

- La **biometría protege la creación de la cuenta** (passkey). Una sola vez.
- **Ninguna operación la pide.** Ni enviar, ni retirar, ni cobrar, ni convertir.
- Es coherente con la contradicción 5 de la Hoja 1, que ya había descartado un PIN
  de 6 dígitos propio por operación: la recuperación ya la cubren el correo y el
  teléfono verificados, y el passcode del propio dispositivo cubre el caso de
  "la biometría falló hoy".

**Consecuencia asumida y escrita:** el control de que quien opera es el titular
**no está en la biometría del momento**, sino en el acceso a la sesión y en el
registro interno de cada operación. Si en el futuro eso resulta insuficiente, la
banda del Trust Policy Engine —ya sembrada en Fase 1— es donde se agrega la regla.

---

## Estado de la hoja

**34 de 34 preguntas contestadas. Cero pendientes.**

Siete contradicciones registradas al cruzar con las hojas 1 y 2:

| # | Tema | Estado |
| --- | --- | --- |
| 1 | El envío y la dirección: solo QR y @tag | cerrada |
| 2 | "Carlos pagó": nombre o frase, nunca dirección | cerrada |
| 3 | El enlace de cobro es de un solo uso | cerrada |
| 4 | Un solo plazo de cobro: 24 horas | cerrada |
| 5 | Permissionless en producción | riesgo asumido, por diseño |
| 6 | El botón "Reintentar" solo cuando la acción movió plata | cerrada |
| 7 | Ninguna acción pide biometría | cerrada |

**Hoja siguiente: la 4 — identidad, acceso y seguridad.**

Lo que queda abierto a propósito, y por qué:

- **Qué redes se soportan más allá de Monad** (comentario en la sección 1): la
  estructura tiene que permitir agregarlas sin rediseñar, pero la lista no se
  decidió.
- **El envío a una billetera externa**: quedó fuera de Fase 1 y sin fecha.
