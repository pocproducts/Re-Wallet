# Acceso por Privy: verificación de 6 dígitos en el onboarding

> Tarea de trabajo único, derivada de la Hoja 4 del contrato
> (`docs/contrato-identidad.md`, cerrada 38/38). Todo lo que sigue está decidido;
> acá no hay preguntas de producto.

## Por qué esta tarea

`05. UI-UX/` tiene un flujo de acceso simulado que **no coincide con el contrato**:

1. La verificación de correo vive en el **Perfil**, después de entrar a la app. El
   contrato dice que **la verificación es la puerta**: hasta que el código se pone,
   no se ve nada de ReWALLET (Hoja 4, 0.3).
2. El componente de código acepta **4 dígitos**. Los de Privy son **6**.
3. El componente acepta **cualquier** código como válido, y tiene un botón de
   desarrollo `Autocompletar código de prueba (1234)`.
4. Hay **verificación de teléfono**, que el contrato sacó: el teléfono se guarda y
   no se verifica nunca (Hoja 4, 0.1).

## El flujo que tiene que quedar

```
Bienvenida (Comenzar / Ya tengo cuenta)
  → Datos (correo → teléfono → nombre y apellido)
    → Confirmación del correo ("¿es correcto? Sí / Corregir")
      → Passkey
        → Código de 6 dígitos
          → Ingreso
```

El código va **después** de la passkey. La passkey crea y autentica al usuario en
Privy; el código **linkea el correo** a ese usuario y es lo que abre la app.

## Decisiones tomadas antes de implementar

Cuatro puntos que no estaban en el contrato y que el cliente resolvió:

1. **"Datos" es un solo formulario con los tres campos**, y el código se pide al
   enviarlo. No son tres pasos. La 2.1 y la 2.4 de la Hoja 4 admiten las dos
   lecturas; se eligió la que no rompe la pantalla que ya existe.
2. **La barra de progreso muestra el total real** de cada flujo. Como "Comenzar" y
   "Ya tengo cuenta" tienen etapas distintas, el rótulo cambia según por dónde se
   entró. Se caída la barra de tres segmentos que hoy dice "Paso N de 3".
3. **El código de prueba es `123456`, en una constante con nombre de mock**, y
   **toda la validación pasa por una sola función**. Esa función es el único punto
   que hay que reemplazar cuando se cablee Privy. Si el `123456` aparece en dos
   lugares distintos, la tarea está mal hecha.
4. **Si la passkey falla, la persona ve el error en la misma pantalla**, con un link
   a entrar por correo. No se salta sola al correo, y no se reintenta a ciegas.

## Alcance de esta pasada

**Solo `OnboardingFlow` y el componente nuevo de código.** `ProfileView` **no se
toca** y queda para la pasada siguiente.

Lo que queda inconsistente hasta entonces, y conviene no olvidar:

- `ProfileView` conserva un modal de código de **4 dígitos** que ya no corresponde
  a nada.
- `ProfileView` conserva la **verificación de teléfono**, que la Hoja 4 sacó.
- `ProfileView` conserva la fila **"Face ID — Listo"**, siempre en "Listo".

Son tres cosas que el contrato dice que no existen. No rompen nada mientras nadie
las toque, pero están ahí.

## Alcance

### 1. Nuevo componente reutilizable de código — `components/Auth/CodeVerification.tsx`

- **6 dígitos**, no 4. Índices `0..5`.
- Casillas separadas, con `inputMode="numeric"`, `maxLength={1}` y
  `autoComplete="one-time-code"`.
- **Autoavance** al escribir, **retroceso** al borrar, y **pegado** de los 6 dígitos
  de una vez (pegar un código completo es el caso real, no la excepción).
- **Borrar todo** con un toque.
- **Botón de reenvío** con cuenta regresiva visible. El plazo es el de Privy, no
  nuestro: el componente recibe `resendAvailableInSeconds` como prop y no lo decide.
- Mensaje de error: **"No llegó el código. Probá de nuevo."** con botón Reintentar.
  Esa es la redacción del contrato (Hoja 4, 3.4), sin jerga y sin nombres de sistema.
- **Prohibido**: un botón de autocompletar código de prueba. Ningún código es válido
  por defecto en el componente.
- El componente **no llama a la red**. Recibe `onSubmit(code)` y devuelve el string
  de 6 dígitos. Quien lo usa decide qué hacer con él.

### 2. `components/Onboarding/OnboardingFlow.tsx` — el flujo

- Insertar la etapa de **código de 6 dígitos** entre la passkey y el ingreso.
- Insertar la **confirmación del correo antes de mandarlo**: *"Te va a llegar un
  código a `juan.perez@gmial.com`. ¿Es correcto?"*, con **Sí** y **Corregir**.
  While  no se confirma, no se manda nada.
- **"Ya tengo cuenta"** deja de fabricar un perfil fijo. Pasa a la etapa de código
  con el correo pedido, y de ahí al ingreso.
- La barra de progreso y los rótulos **"Paso N de 3"** dejan de estar atados a tres
  pasos fijos.
- El `navigator.credentials.create` que ya existe **deja de tirar el resultado a la
  basura**: hoy el `catch` traga el error y el flujo sigue como si la passkey se
  hubiera creado. Eso es un error real de seguridad de presentación y hay que
  arreglarlo. Si la passkey falla, **se entra por correo**.
- **Nada se escribe en `localStorage` hasta que el código se pone** (Hoja 4, 0.4).

### 3. `components/Profile/ProfileView.tsx` — limpieza

- **Se borra** el modal de verificación de correo.
- **Se borra** la verificación de teléfono y su botón.
- **Se borra** `"Face ID"` de la lista de verificaciones, con su "Listo" fijo.
- La fila de **Verificaciones** desaparece: después de la Hoja 4, **toda cuenta que
  existe ya está verificada**, así que una lista de verificaciones no informa nada.

### 4. Lo que NO entra en esta tarea

- **No se cablea Privy de verdad.** El `PrivyProvider` real y el login de backend son
  otra tarea, y es la más grande del proyecto. Acá los puntos de llamada quedan
  listos y el transporte sigue simulado.
- **No se agrega runner de tests.** `05. UI-UX/` no tiene ninguno y `package.json`
  no tiene script de test. Agregarlo es una decisión aparte. **El gate de esta tarea
  es `npm run lint`**, que es `tsc --noEmit`, en verde.

## Contrato de textos

Voseo rioplatense, sin jerga, nunca alarming. Los textos que ya existen y se
conservan: *"Hola"*, *"¡Bienvenido!"*, *"Comenzar"*, *"Ya tengo cuenta"*,
*"Nombre y Apellido"*, *"Correo Electrónico"*, *"Número de Teléfono"*,
*"Crear cuenta"*.

## Allowed edit surfaces

- `05. UI-UX/src/components/Auth/` (nuevo)
- `05. UI-UX/src/components/Onboarding/OnboardingFlow.tsx`
- `05. UI-UX/src/components/Profile/ProfileView.tsx`
- `05. UI-UX/src/components/common/index.ts` (solo si hace falta exportar el nuevo)

## Gate

`cd "05. UI-UX" && npm run lint` en verde.

## Fuera de alcance, para que quede dicho

- Verificación por teléfono. Fuera por decisión (Hoja 4, 0.1).
- Llave de repuesto de 12 palabras. **Retirada**: la promesa del producto es sin
  llaves semillas (Hoja 4, 6.2).
- Rescate por soporte. Es Fase 3 y depende de que haya términos (Hoja 4, 6.6).
---

# Segunda pasada — ProfileView y la puerta "Ya tengo cuenta"

## Decisiones del cliente

1. **El modal del Perfil pasa a 6 dígitos.** No se borra: se arregla. Debe reusar
   el componente `CodeVerification`, no reimplementar la entrada de código otra vez.
2. **La verificación de teléfono sale del Perfil.** El teléfono no se verifica
   nunca (Hoja 4, 0.1).
3. **"Face ID — Listo" se queda.** El cliente lo considera correcto: la passkey se
   creó en el onboarding, así que es un dato real. Con el teléfono eliminado, el
   bloque "Verificaciones" queda con una sola fila y **deja de ser una lista de
   pendientes**: pasa a ser un estado.
4. **"Ya tengo cuenta" valida que el correo exista**, y es lo que faltaba:
   - **El correo tiene cuenta** → se manda el OTP a ese correo → entra.
   - **El correo no tiene cuenta** → **se la manda a "Comenzar"**, con el correo
     ya escrito en el formulario de datos. No se crea una cuenta desde la puerta de
     ingreso.

## El detalle que hay que respetar en el punto 4

**No se anuncia que el correo no existe.** Se lleva a "Comenzar" con el correo
pre-cargado, sin decir nada. La razón es que anunciar "ese correo no está
registrado" convierte la pantalla de ingreso en un **oráculo de qué correos están
registrados**, que es información de otra gente. Llevarla a "Comenzar" cumple la
misma regla sin filtrar nada: si el correo no existe, la única forma de tener
cuenta es crearla, que es exactamente lo que ofrece la otra puerta.

## Costura nueva: ¿existe esa cuenta?

Como `MOCK_CODE`, la consulta de si un correo tiene cuenta **va en una función sola**,
en su propio archivo, para que se sustituya entera cuando haya backend.

En producción esa respuesta la tiene **el backend**, no el front: en Privy se
resuelve con el `PrivyClient` del lado servidor, buscando el usuario por correo. El
front solo pregunta.

## Allowed edit surfaces

`05. UI-UX/src/components/Profile/ProfileView.tsx`
`05. UI-UX/src/components/Onboarding/OnboardingFlow.tsx`
`05. UI-UX/src/components/Auth/`

## Gate

`cd "05. UI-UX" && npm run lint` en verde. Sin tests, sin tocar `package.json`.
