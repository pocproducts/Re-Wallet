# ReWallet™ — Design System UI/UX v2
## Sistema visual reestructurado para Wallet, Payments & Fintech

**Versión:** 2.0  
**Producto:** ReWallet™  
**Uso:** UI/UX, Product Design, Frontend, Mobile, Web App y Design System  
**Dirección visual:** Fintech premium · Dark-first · Seguridad · Velocidad · Simplicidad

---

## 1. Dirección estratégica del rediseño

La identidad de ReWallet™ debe dejar de ser simplemente:

> Negro + verde flúor

y evolucionar hacia:

> **Negro profundo + Verde Flúor como identidad + Verde Esmeralda como soporte + escala de grises tecnológicos + colores semánticos controlados.**

### Principios

1. **El negro construye confianza.**
2. **El verde identifica a ReWallet™.**
3. **El verde esmeralda permite interfaces financieras menos agresivas.**
4. **Los grises construyen jerarquía.**
5. **Los colores semánticos informan, no decoran.**
6. **El usuario debe entender una operación financiera sin necesitar interpretar la estética.**

El resultado buscado es una wallet que se sienta:

- Segura
- Moderna
- Premium
- Rápida
- Global
- Simple
- Tecnológica
- Financiera, pero no bancaria tradicional

---

# 2. Brand Core

## Marca

**ReWallet™**

## Wordmark

`Re` → Neutral / blanco / negro según fondo

`Wallet` → Verde de marca

## Isotipo

Símbolo geométrico circular basado en la construcción visual de R/W.

Debe conservar:

- Proporciones originales
- Geometría
- Ángulos
- Espesores
- Relación entre círculo y símbolo

No modificar ni deformar el isotipo para componentes de producto.

---

# 3. Paleta maestra

## 3.1 Brand Colors

| Token | HEX | RGB | Uso |
|---|---|---|---|
| `rw-brand-500` | `#39FF14` | 57,255,20 | Color principal de marca |
| `rw-brand-400` | `#5CFF3D` | 92,255,61 | Hover / highlight |
| `rw-brand-600` | `#24D90C` | 36,217,12 | Active |
| `rw-brand-700` | `#19A800` | 25,168,0 | Texto/acento Light |
| `rw-brand-100` | `#E9FFE5` | 233,255,229 | Fondos suaves |

### #39FF14 — ReWallet Green

Debe utilizarse para:

- CTA principal
- Elementos seleccionados
- Indicadores positivos de marca
- Saldo destacado
- Focus
- Iconos activos
- Highlights
- Branding

**No debe utilizarse como color de texto pequeño sobre blanco.**

---

# 4. Secondary Green

Para evitar que toda la aplicación parezca fluorescente se incorpora un verde secundario.

| Token | HEX | Uso |
|---|---|---|
| `rw-emerald-500` | `#00E676` | Acciones secundarias / gráficos |
| `rw-emerald-400` | `#33EB92` | Hover |
| `rw-emerald-600` | `#00B85C` | Active / Light Mode |
| `rw-emerald-100` | `#D9FBEA` | Fondo suave |

### Diferencia

**Flúor `#39FF14`**
- Branding
- CTA principal
- Estados activos importantes

**Esmeralda `#00E676`**
- Gráficos
- Datos
- Acciones secundarias
- Elementos financieros
- Variaciones positivas

Esto evita sobrecargar visualmente la interfaz con verde flúor.

---

# 5. Dark Palette

## Backgrounds

| Token | HEX | Uso |
|---|---|---|
| `rw-dark-950` | `#050809` | Background extremo |
| `rw-dark-900` | `#080F14` | Background principal |
| `rw-dark-850` | `#0D151B` | Background secundario |
| `rw-dark-800` | `#121C23` | Surface |
| `rw-dark-750` | `#18242C` | Surface elevada |
| `rw-dark-700` | `#202D35` | Input / componentes |
| `rw-dark-600` | `#2E3A42` | Borders |

### Background recomendado

`#080F14`

Este es el negro institucional recomendado para la aplicación.

No utilizar `#000000` como fondo general.

---

# 6. Light Palette

| Token | HEX | Uso |
|---|---|---|
| `rw-light-50` | `#FFFFFF` | Surface |
| `rw-light-100` | `#F7FAFC` | Background |
| `rw-light-200` | `#F1F5F7` | Section |
| `rw-light-300` | `#E7ECEF` | Border |
| `rw-light-400` | `#D4DCE1` | Divider |
| `rw-light-500` | `#B7C2C9` | Disabled / secondary |

### Background Light

`#F7FAFC`

El Light Mode debe sentirse limpio, financiero y tecnológico.

---

# 7. Text Colors

## Dark Mode

| Token | HEX | Uso |
|---|---|---|
| `text-primary-dark` | `#F7FAFC` | Texto principal |
| `text-secondary-dark` | `#B8C2C9` | Texto secundario |
| `text-tertiary-dark` | `#7F8B94` | Metadata |
| `text-disabled-dark` | `#56616A` | Disabled |

## Light Mode

| Token | HEX | Uso |
|---|---|---|
| `text-primary-light` | `#080F14` | Texto principal |
| `text-secondary-light` | `#42505A` | Texto secundario |
| `text-tertiary-light` | `#687780` | Metadata |
| `text-disabled-light` | `#AAB5BC` | Disabled |

---

# 8. Colores semánticos

El color de marca y el color semántico son conceptos diferentes.

## Success

| Token | HEX |
|---|---|
| `success-500` | `#39FF14` |
| `success-600` | `#19A800` |
| `success-soft` | `#E9FFE5` |

Usos:

- Pago exitoso
- Transferencia recibida
- Verificación correcta
- Saldo positivo

## Warning

| Token | HEX |
|---|---|
| `warning-500` | `#FFC857` |
| `warning-soft` | `#FFF5D6` |

Usos:

- Operación pendiente
- Límite cercano
- Verificación pendiente

## Error

| Token | HEX |
|---|---|
| `error-500` | `#FF4D5A` |
| `error-600` | `#D93644` |
| `error-soft` | `#FFE8EA` |

Usos:

- Pago rechazado
- Error
- Cuenta bloqueada
- Datos inválidos

## Info

| Token | HEX |
|---|---|
| `info-500` | `#3D8BFF` |
| `info-soft` | `#E7F1FF` |

Usos:

- Información
- Ayuda
- Estado informativo

### Regla

Nunca utilizar solamente color para comunicar un estado.

Ejemplo:

`✓ Transferencia completada`

en lugar de únicamente una línea verde.

---

# 9. Gradientes oficiales

## Gradient A — Brand Glow

```text
#39FF14 → #00E676
```

Uso:

- Hero
- Cards premium
- Splash
- Marketing

## Gradient B — Dark Energy

```text
#080F14 → #121C23
```

Uso:

- Cards
- Backgrounds

## Gradient C — Financial Glow

```text
#080F14 → #00351F → #080F14
```

Uso:

- Balance Card
- Tarjetas
- Dashboard premium

## Regla

Los gradientes son un recurso de branding.

No convertir todos los componentes en degradados.

---

# 10. Glow

## Brand Glow

```css
box-shadow:
  0 0 24px rgba(57,255,20,0.08);
```

## Strong Glow

```css
box-shadow:
  0 0 32px rgba(57,255,20,0.14);
```

Utilizar únicamente en:

- CTA destacado
- Balance seleccionado
- Elementos premium
- Splash
- Confirmaciones

Evitar glow permanente en todos los componentes.

---

# 11. Tipografía

## Principal

**Montserrat**

Pesos:

- 400 Regular
- 500 Medium
- 600 SemiBold
- 700 Bold

## Jerarquía

| Token | Tamaño | Peso |
|---|---:|---:|
| Display | 44–48 | 700 |
| H1 | 32–40 | 700 |
| H2 | 26–32 | 700 |
| H3 | 22–26 | 600 |
| H4 | 18–20 | 600 |
| Body | 14–16 | 400 |
| Body Strong | 14–16 | 600 |
| Caption | 12–13 | 400 |
| Button | 14–16 | 600 |

---

# 12. Tipografía financiera

Los valores monetarios deben tener una jerarquía superior.

Ejemplo:

```text
Saldo disponible

$ 2.480,50

+12,4% este mes
```

Reglas:

- Saldo: Bold
- Moneda: misma familia
- Variación: verde
- Metadata: gris

Nunca utilizar una tipografía decorativa para cifras financieras.

---

# 13. Sistema de iconografía

## Librería recomendada

**Lucide Icons**

Características:

- Outline
- Stroke 2 px
- Rounded
- Geométrico
- Minimalista

Todos los iconos deben pertenecer a una misma familia.

---

# 14. Iconos Core

| Función | Icono |
|---|---|
| Inicio | `House` |
| Wallet | `Wallet` |
| Dinero | `Banknote` |
| Tarjeta | `CreditCard` |
| Transferencia | `ArrowLeftRight` |
| Enviar | `Send` |
| Recibir | `ArrowDownToLine` |
| Historial | `History` |
| Actividad | `ChartNoAxesCombined` |
| QR | `QrCode` |
| Escanear | `ScanLine` |
| Seguridad | `ShieldCheck` |
| Usuario | `UserRound` |
| Perfil | `CircleUserRound` |
| Configuración | `Settings` |
| Notificaciones | `Bell` |
| Ayuda | `CircleHelp` |
| Soporte | `Headphones` |
| Buscar | `Search` |
| Menú | `Menu` |
| Cerrar | `X` |
| Atrás | `ArrowLeft` |
| Más | `Plus` |
| Editar | `Pencil` |
| Eliminar | `Trash2` |

---

# 15. Iconos fintech específicos

| Concepto | Icono |
|---|---|
| Wallet | `WalletCards` |
| Tarjeta virtual | `CreditCard` |
| Tarjeta física | `CreditCard` |
| Contactless | `Wifi` |
| Transferencia | `ArrowLeftRight` |
| Pago | `CircleDollarSign` |
| Cobro | `BadgeDollarSign` |
| Depósito | `ArrowDownToLine` |
| Retiro | `ArrowUpFromLine` |
| Conversión | `RefreshCcw` |
| Tipo de cambio | `ArrowLeftRight` |
| Cripto | `Coins` |
| Bitcoin | `Bitcoin` |
| Inversión | `ChartCandlestick` |
| Ahorro | `PiggyBank` |
| Límites | `Gauge` |
| Seguridad | `ShieldCheck` |
| Biometría | `ScanFace` |
| PIN | `KeyRound` |
| Bloqueo | `Lock` |
| Desbloqueo | `Unlock` |
| Dispositivo | `Smartphone` |
| Ubicación | `MapPin` |
| Global | `Globe2` |

---

# 16. Tamaños de iconos

| Contexto | Tamaño |
|---|---:|
| Micro | 14 px |
| Small | 16 px |
| Default | 20 px |
| Navigation | 24 px |
| Feature | 28–32 px |
| Hero | 40–48 px |

### Stroke

Default:

`2px`

Para iconos pequeños:

`1.75–2px`

---

# 17. Estado de iconos

## Default

Dark:

`#B8C2C9`

Light:

`#42505A`

## Active

`#39FF14`

## Success

`#39FF14`

## Warning

`#FFC857`

## Error

`#FF4D5A`

## Disabled

`#56616A`

---

# 18. Navigation

## Mobile

Bottom Navigation:

```text
Inicio | Wallet | Transferir | Actividad | Perfil
```

### Active

Icono:

`#39FF14`

Texto:

`#39FF14`

### Inactive

Icono:

`#7F8B94`

Texto:

`#7F8B94`

---

# 19. Desktop Sidebar

Orden recomendado:

```text
Logo

Inicio
Wallet
Transferir
Tarjetas
Actividad

----------------

Seguridad
Configuración
Soporte
```

El área activa debe tener:

- Fondo verde muy sutil
- Icono verde
- Texto blanco
- Indicador lateral verde

Ejemplo conceptual:

```text
▌  Wallet
```

---

# 20. Buttons

## Primary

Dark:

```text
Background: #39FF14
Text: #080F14
```

Hover:

`#5CFF3D`

Active:

`#24D90C`

Radius:

`12px`

---

## Secondary

Dark:

```text
Background: transparent
Border: #2E3A42
Text: #F7FAFC
```

Light:

```text
Background: #FFFFFF
Border: #D4DCE1
Text: #080F14
```

---

## Ghost

Sin background.

Usar para:

- Cancelar
- Volver
- Acciones secundarias
- Links

---

# 21. Button States

Todos los botones deben contemplar:

- Default
- Hover
- Focus
- Active
- Disabled
- Loading
- Success
- Error cuando corresponda

---

# 22. Inputs

## Dark

```text
Background: #121C23
Border: #2E3A42
Text: #F7FAFC
Placeholder: #7F8B94
```

Focus:

```text
Border: #39FF14
Glow: rgba(57,255,20,0.12)
```

## Light

```text
Background: #FFFFFF
Border: #D4DCE1
Text: #080F14
Placeholder: #687780
```

---

# 23. Cards

## Dark Card

```text
Background: #121C23
Border: #202D35
Radius: 16px
```

## Elevated Card

```text
Background: #18242C
Border: #2E3A42
Radius: 16px
```

## Light Card

```text
Background: #FFFFFF
Border: #E7ECEF
Radius: 16px
```

---

# 24. Balance Card

Este es uno de los componentes principales de ReWallet™.

### Estructura

```text
Saldo disponible

$ 2.480,50

+12,4% este mes

[Enviar] [Recibir]
```

### Visual

Dark:

- Fondo `#080F14`
- Glow verde muy sutil
- Verde para variación
- Blanco para saldo

Opcional:

```text
#080F14 → #00351F → #080F14
```

---

# 25. Transaction Item

Cada movimiento debe mostrar:

```text
[Icon]

Recibido de María
Hoy · 14:32

                 + $120,00
```

Elementos:

- Icono
- Título
- Fecha/hora
- Estado
- Importe

### Entrada

Verde.

### Salida

Texto principal blanco/negro.

### Error

Rojo.

### Pendiente

Amarillo.

---

# 26. Tarjeta virtual

La tarjeta debe ser uno de los elementos premium.

### Dark Card

- Fondo `#080F14`
- Gradient opcional
- Isotipo verde
- Número blanco
- Detalles gris
- Línea diagonal verde inspirada en el isotipo

Ejemplo conceptual:

```text
┌─────────────────────────┐
│ ReWallet™          ◉    │
│                         │
│      •••• 4587          │
│                         │
│ CARDHOLDER        VISA  │
└─────────────────────────┘
```

---

# 27. Transferencias

Flujo recomendado:

```text
1. Elegir destinatario
2. Elegir moneda
3. Introducir monto
4. Revisar
5. Confirmar
6. Resultado
```

No esconder información crítica.

Antes de confirmar mostrar:

- Destinatario
- Monto
- Comisión
- Tipo de cambio si corresponde
- Total
- Tiempo estimado
- Método

---

# 28. Confirmación de pago

Pantalla:

```text
✓

Transferencia completada

$ 250.000,00

Enviado a
Juan Pérez

ID de operación
RW-XXXXXXXX

[Compartir comprobante]
[Volver al inicio]
```

La confirmación debe sentirse segura y clara.

---

# 29. QR

## Escanear

Icono:

`ScanLine`

## Mostrar QR

Icono:

`QrCode`

### Recomendación

El QR debe utilizar:

- Negro sobre blanco
- Blanco sobre negro

No utilizar verde flúor como módulo principal del QR.

El verde puede utilizarse en:

- Marco
- CTA
- Header
- Elementos decorativos

---

# 30. Seguridad

Componentes:

- ShieldCheck
- Lock
- ScanFace
- KeyRound
- Smartphone
- Fingerprint

Ejemplo:

```text
Seguridad de tu cuenta

✓ Email verificado
✓ Número verificado
✓ PIN configurado
✓ Biometría activa
```

La seguridad debe sentirse integrada al producto, no como una sección intimidante.

---

# 31. Badges

## Success

```text
✓ Completado
```

Fondo:

`#E9FFE5`

Texto:

`#19A800`

## Pending

```text
◷ Pendiente
```

Fondo:

`#FFF5D6`

Texto:

`#8A6500`

## Error

```text
× Rechazado
```

Fondo:

`#FFE8EA`

Texto:

`#D93644`

---

# 32. Charts

Para gráficos financieros:

### Primary data

`#39FF14`

### Secondary data

`#00E676`

### Neutral

`#7F8B94`

### Reference

`#2E3A42`

No utilizar una paleta multicolor innecesaria.

Los colores deben representar categorías reales.

---

# 33. Gráfico de balance

Ejemplo:

```text
Saldo
│
│           ╭────╮
│       ╭───╯    ╰──╮
│   ╭───╯            ╰
│───╯
└──────────────────────
```

Línea:

`#39FF14`

Área:

`rgba(57,255,20,0.08)`

Grid:

`#202D35`

---

# 34. Patterns

## Pattern A — Diagonales

Derivado del isotipo.

Uso:

- Hero
- Cards
- Tarjetas
- Marketing

Opacity:

`3–12%`

---

## Pattern B — Isotipo Ghost

Isotipo gigante en background.

Opacity:

`2–7%`

Nunca competir con contenido.

---

## Pattern C — Flow

Líneas curvas inspiradas en:

- Flujo de dinero
- Transferencias
- Conectividad
- Globalización

---

# 35. Microinteracciones

## Pago

```text
Tap
↓
Loading
↓
Confirmación
↓
✓
```

Duraciones:

- Tap: 100–150 ms
- Hover: 120–180 ms
- Transition: 200–300 ms
- Modal: 250–350 ms

---

# 36. Feedback háptico

En mobile, cuando la plataforma lo permita:

### Éxito

Micro haptic.

### Error

Haptic ligeramente más marcado.

### Pago confirmado

Micro haptic + animación visual.

No utilizar vibración en cada interacción.

---

# 37. Splash Screen

Dark:

```text
#080F14
```

Centro:

Isotipo:

`#39FF14`

Wordmark:

`#F7FAFC`

Animación:

- Fade
- Scale
- Glow

---

# 38. App Icon

## Variante principal

Background:

`#39FF14`

Isotipo:

`#080F14`

## Variante premium

Background:

`#080F14`

Isotipo:

`#39FF14`

La primera opción debe ser la referencia principal de reconocimiento.

---

# 39. Logo en fondos

## Sobre negro

Isotipo:

`#39FF14`

Wordmark:

`#F7FAFC + #39FF14`

## Sobre blanco

Isotipo:

`#19A800` o `#39FF14` según tamaño/contraste.

Wordmark:

`#080F14 + #19A800`

## Sobre fotografía

Usar versión blanca/verde con área de seguridad suficiente.

---

# 40. Clear Space

Alrededor del logo debe existir una zona de protección.

Referencia:

```text
X = altura aproximada del módulo superior del isotipo
```

No colocar:

- Texto
- Iconos
- Bordes
- Fotografías con alto contraste

dentro del área de protección.

---

# 41. Do / Don't

## DO

- Usar `#39FF14` como identidad.
- Utilizar `#00E676` para soporte.
- Utilizar negros azulados.
- Crear profundidad con superficies.
- Utilizar iconos consistentes.
- Mantener mucho espacio negativo.
- Priorizar información financiera.
- Usar verde con moderación.
- Mantener estados semánticos claros.

## DON'T

- Usar negro absoluto en toda la app.
- Usar verde flúor para todo.
- Usar 10 colores diferentes.
- Mezclar iconos outline y filled.
- Utilizar glow excesivo.
- Usar gradientes en cada componente.
- Colocar texto verde pequeño sobre blanco.
- Convertir cada pantalla en una pieza de marketing.

---

# 42. Accesibilidad

La estética nunca debe comprometer la lectura.

### Especialmente importante

`#39FF14` sobre `#FFFFFF` no debe utilizarse como texto pequeño.

Para Light Mode utilizar:

`#19A800`

para textos verdes que necesiten mayor contraste.

Los estados deben incluir:

- Color
- Icono
- Texto

Ejemplo:

```text
✓ Transferencia completada
```

y no simplemente una línea verde.

---

# 43. Responsive

## Mobile

Prioridad:

1. Saldo
2. Enviar
3. Recibir
4. QR
5. Actividad
6. Tarjetas

Bottom navigation.

## Tablet

- Navigation compacta
- Cards en grid

## Desktop

Sidebar + dashboard.

---

# 44. Spacing

Sistema base:

```text
4
8
12
16
24
32
40
48
64
80
```

### Regla

El espacio de 8 px es la unidad principal.

---

# 45. Radius

| Token | Valor |
|---|---:|
| `radius-xs` | 6px |
| `radius-sm` | 8px |
| `radius-md` | 12px |
| `radius-lg` | 16px |
| `radius-xl` | 24px |
| `radius-full` | 9999px |

---

# 46. CSS Tokens

```css
:root {
  /* BRAND */
  --rw-brand-500: #39FF14;
  --rw-brand-400: #5CFF3D;
  --rw-brand-600: #24D90C;
  --rw-brand-700: #19A800;
  --rw-brand-100: #E9FFE5;

  /* EMERALD */
  --rw-emerald-500: #00E676;
  --rw-emerald-400: #33EB92;
  --rw-emerald-600: #00B85C;
  --rw-emerald-100: #D9FBEA;

  /* DARK */
  --rw-dark-950: #050809;
  --rw-dark-900: #080F14;
  --rw-dark-850: #0D151B;
  --rw-dark-800: #121C23;
  --rw-dark-750: #18242C;
  --rw-dark-700: #202D35;
  --rw-dark-600: #2E3A42;

  /* LIGHT */
  --rw-light-50: #FFFFFF;
  --rw-light-100: #F7FAFC;
  --rw-light-200: #F1F5F7;
  --rw-light-300: #E7ECEF;
  --rw-light-400: #D4DCE1;
  --rw-light-500: #B7C2C9;

  /* TEXT DARK */
  --rw-text-primary-dark: #F7FAFC;
  --rw-text-secondary-dark: #B8C2C9;
  --rw-text-tertiary-dark: #7F8B94;

  /* TEXT LIGHT */
  --rw-text-primary-light: #080F14;
  --rw-text-secondary-light: #42505A;
  --rw-text-tertiary-light: #687780;

  /* SEMANTIC */
  --rw-success: #39FF14;
  --rw-warning: #FFC857;
  --rw-error: #FF4D5A;
  --rw-info: #3D8BFF;

  /* RADIUS */
  --rw-radius-sm: 8px;
  --rw-radius-md: 12px;
  --rw-radius-lg: 16px;
  --rw-radius-xl: 24px;
  --rw-radius-full: 9999px;
}
```

---

# 47. Theme Tokens

## Dark

```css
[data-theme="dark"] {
  --background: #080F14;
  --surface: #121C23;
  --surface-elevated: #18242C;
  --border: #202D35;

  --text-primary: #F7FAFC;
  --text-secondary: #B8C2C9;
  --text-tertiary: #7F8B94;

  --accent: #39FF14;
  --accent-secondary: #00E676;
}
```

## Light

```css
[data-theme="light"] {
  --background: #F7FAFC;
  --surface: #FFFFFF;
  --surface-elevated: #FFFFFF;
  --border: #E7ECEF;

  --text-primary: #080F14;
  --text-secondary: #42505A;
  --text-tertiary: #687780;

  --accent: #19A800;
  --accent-bright: #39FF14;
  --accent-secondary: #00B85C;
}
```

---

# 48. Arquitectura de componentes

## Foundations

- Colors
- Typography
- Spacing
- Radius
- Shadows
- Icons

## Core

- Button
- Input
- Select
- Checkbox
- Radio
- Toggle
- Badge
- Avatar
- Tooltip
- Toast
- Modal
- Tabs
- Dropdown

## Fintech

- Balance Card
- Transaction Item
- Transaction Detail
- Wallet Card
- Virtual Card
- Transfer Form
- QR Scanner
- QR Receiver
- Currency Selector
- Exchange Rate
- Security Status
- Verification Step

---

# 49. Pantallas prioritarias

```text
01 Splash
02 Onboarding
03 Login
04 Register
05 Home
06 Wallet
07 Send Money
08 Receive Money
09 QR
10 Transaction Detail
11 Activity
12 Cards
13 Card Detail
14 Security
15 Profile
16 Settings
17 Notifications
18 Support
```

---

# 50. Estructura recomendada en Figma

```text
ReWallet™

00 — Cover
01 — Brand
02 — Foundations
    ├── Colors
    ├── Typography
    ├── Spacing
    ├── Radius
    └── Shadows

03 — Icons
04 — Core Components
05 — Fintech Components
06 — Navigation
07 — Mobile
08 — Desktop
09 — Screens
10 — Prototype
11 — Assets
```

---

# 51. Regla de oro del producto

La interfaz de ReWallet™ debe cumplir esta secuencia:

> **Entender → Confirmar → Ejecutar → Informar**

Especialmente en operaciones de dinero.

Nunca priorizar una animación o efecto visual por encima de:

- Monto
- Destinatario
- Moneda
- Comisión
- Estado
- Confirmación

---

# 52. Principio final de diseño

ReWallet™ no debe parecer una app bancaria tradicional.

Tampoco debe parecer una app gamer o crypto experimental.

Debe ocupar un punto intermedio:

> **Fintech premium + tecnología + confianza + simplicidad.**

### Identidad visual resumida

```text
NEGRO PROFUNDO
      +
VERDE FLÚOR
      +
VERDE ESMERALDA
      +
GRISES TECNOLÓGICOS
      +
TIPOGRAFÍA LIMPIA
      +
ICONOGRAFÍA OUTLINE
      +
MICROINTERACCIONES
      +
JERARQUÍA FINANCIERA
```

### Concepto de producto

> **Tu dinero, en tus manos.**

La estética debe reforzar la sensación de que el usuario tiene **control, claridad y seguridad sobre su dinero**.

---

# 53. Checklist de entrega UI/UX

Antes de aprobar una pantalla:

- [ ] Usa tokens del Design System.
- [ ] Usa la paleta oficial.
- [ ] No introduce colores arbitrarios.
- [ ] Utiliza Lucide o iconografía aprobada.
- [ ] Tiene estados Default/Hover/Focus/Active/Disabled.
- [ ] Los estados financieros tienen feedback visual + textual.
- [ ] El saldo tiene máxima jerarquía.
- [ ] Los CTA principales son claros.
- [ ] El contraste es accesible.
- [ ] Funciona en Dark Mode.
- [ ] Funciona en Light Mode.
- [ ] Está adaptada a Mobile.
- [ ] Está adaptada a Desktop.
- [ ] No depende exclusivamente del color.
- [ ] Las operaciones monetarias muestran información crítica antes de confirmar.
- [ ] No existe exceso de glow.
- [ ] No existe exceso de verde.
- [ ] No existen gradientes innecesarios.
- [ ] La identidad ReWallet™ sigue siendo reconocible.

---

## ReWallet™ Design System v2

**Primary:** `#39FF14`  
**Secondary:** `#00E676`  
**Dark Background:** `#080F14`  
**Dark Surface:** `#121C23`  
**Light Background:** `#F7FAFC`  
**Light Surface:** `#FFFFFF`  
**Typography:** Montserrat  
**Icons:** Lucide  
**Radius:** 8 / 12 / 16 / 24 px  
**Design language:** Premium · Fintech · Secure · Simple · Fast
