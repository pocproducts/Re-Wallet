# ReWALLET — Billetera Fintech & Cripto (Clean Architecture)

Aplicación Fintech y Cripto desarrollada con **React + TypeScript + Vite + Tailwind CSS**, estructurada bajo los principios de **Clean Architecture** y **Feature-Driven Architecture**, lista para su integración con backends de producción (REST API, GraphQL o WebSockets).

---

## 🏛️ Clean Architecture & Estructura del Proyecto

El proyecto está organizado en capas desacopladas, lo que permite modificar la lógica de persistencia o el backend sin alterar los componentes de la interfaz de usuario:

```
src/
├── constants/             # [Design Tokens y Configuración de Tema]
│   └── theme.ts           # Paleta unificada (Lemon Lime #ccff00, USDC #2775CA, radios, sombras)
│
├── config/                # [Configuración de producto]
│   ├── countries.ts       # 198 países con ISO alpha-2 y prefijo internacional (archivo generado)
│   └── markets.ts         # Precio del dólar, precio por activo y saldos de la cuenta (simulado)
│
├── scripts/
│   └── generate-countries.mjs  # Regenera `config/countries.ts` desde ISO 3166-1 + ITU
│
├── types/                 # [Capa de Dominio / Domain Entities]
│   ├── user.types.ts      # Perfil de usuario, FaceID y datos de seguridad
│   ├── wallet.types.ts    # Saldos ARS, USDC, métricas de cartera y navegación
│   ├── crypto.types.ts    # Activos digitales, cotizaciones, redes y operaciones
│   ├── yield.types.ts     # Métricas de pools Aave V3 / Monad, tasas APR/APY
│   ├── transaction.types.ts # Historial de transferencias y transacciones
│   └── index.ts           # Barrel file con re-exportación centralizada
│
├── services/              # [Capa de Datos / Data Access Layer / Repositorios]
│   ├── walletService.ts   # Contrato IWalletService y mock intercambiable por API real
│   ├── cryptoService.ts   # Contrato ICryptoService para cotizaciones y balances
│   ├── yieldService.ts    # Contrato IYieldService para lectura on-chain de pools
│   ├── transactionService.ts # Contrato ITransactionService para movimientos
│   └── index.ts           # Barrel file de servicios
│
├── hooks/                 # [Capa de Casos de Uso / Business Logic]
│   ├── useWallet.ts       # Gestión de saldo, visibilidad y estados de carga
│   ├── useCryptoAssets.ts # Ciclo de vida y consulta de activos cripto
│   ├── useYieldPool.ts    # Consulta y estado del Pool USDC
│   └── index.ts           # Barrel file de custom hooks
│
├── components/            # [Capa de Presentación / UI Components]
│   ├── common/            # Componentes atómicos reutilizables (Clean UI)
│   │   ├── BackButton.tsx    # Botón circular de retroceso estándar
│   │   ├── NumericKeypad.tsx # Teclado táctil matricial 3×4 con microinteracciones
│   │   ├── StatusBadge.tsx   # Píldoras de estado ("EN VIVO", "Comisión incluida")
│   │   ├── SectionCard.tsx   # Tarjeta base reutilizable [rounded-28px]
│   │   ├── TradePairCard.tsx # Par de tarjetas reutilizable para Cambiar, Comprar y Vender
│   │   └── index.ts
│   ├── Wallet/            # Feature: Billetera principal, saldo y acciones
│   ├── Investments/       # Feature: Inversiones, Dólares Digitales y Criptos
│   ├── Yield/             # Feature: Métricas y detalle del Pool USDC (Monad / Aave V3)
│   ├── Navigation/        # Feature: Navbar inferior flotante
│   ├── Profile/           # Feature: Perfil y configuración de seguridad
│   └── Activity/          # Feature: Historial de transacciones
│
├── App.tsx                # Orquestador principal y manejo de vistas de nivel superior
├── main.tsx               # Punto de entrada de la aplicación Vite
└── index.css              # Estilos globales y configuración de fuentes
```

---

## 🎨 Design Tokens & UI/UX

Los tokens de diseño están centralizados en `src/constants/theme.ts`:

- **Brand Lemon Lime**: `#ccff00` (Hover: `#b8e600`) — Píldoras destacadas, acentos y llamadas a la acción.
- **USDC Blue**: `#2775CA` — Identificador de Dólares Digitales.
- **Fondos de pantalla**: `#f0f2f5` (Gris suave característico de aplicaciones financieras modernas).
- **Tarjetas y Superficies**: `#ffffff` con radio consistente de `28px` o `32px` y bordes sutiles `border-slate-100`.
- **Tipografía**: Combinación de familias sans-serif para interfaces y fuente monoespaciada para tickers y cifras numéricas.

---

## 📱 Módulos y Funcionalidades Principales

### 1. Billetera (`WalletView`)
- Visualización de saldo principal en ARS con alternador de visibilidad (modo incógnito con asteriscos).
- Píldora de rendimiento anual en verde lima: **"Rindiendo +3,90% anual"**.
- Acciones directas: Depositar, Transferir y Escanear QR / Lemon Tag.

### 2. Rendimientos / Pool USDC (`AavePoolsView`)
Vista de detalle completa según diseño on-chain:
- **Tasa Principal**: `+3,90% anual` con indicador `▪ EN VIVO (Leído de la cadena)`.
- **¿Por qué es confiable?**: Métricas de TVL (`$150.198.641 EN EL POOL`), porcentaje prestado (`89%`) y activos del usuario.
- **Historial & Liquidez**: Disponibilidad de retiro inmediato sin bloqueos ni penalizaciones.
- **Detalle del Pool**: Tasa de depósito (`2,90 APR`), utilización (`89,21 %`) y estados operativos (`Activo`, `Prestable`, `Colateral`, `Operativa`).
- Enlace directo al explorador del contrato en la red Monad.

### 3. Dólares Digitales (`DigitalDollarsView`)
- Tarjeta de balance en USDC (`U$0,82`).
- Acceso directo al pool de rendimiento y registro de movimientos históricos.

### 4. Compraventa de Criptoactivos (`CryptoAssetDetailModal`)
- Operatoria en **Dólares USDC** (sustituyendo ARS por dólar digital).
- Teclado numérico táctil interactivo con cálculo automático de conversión en tiempo real.
- Flujo de depósito por redes blockchain con selector de red, código QR, botón de copia y tarjeta verde lima de **"Información Importante"**.

### 5. Flujo de Onboarding (`OnboardingFlow`)
- **Paso 1 (Bienvenida)**: Ícono `Compass`, título *"Hola ¡Bienvenido!"* y párrafo *"Creá tu cuenta en menos de un minuto. Después entrás con tu huella digital, sin passwords que olvidarte ni que te roben"*, con botones **Comenzar** y **Ya tengo cuenta** (misma pantalla que el proyecto Front End).
- **Paso 2 (Datos del Titular)**: Registro de Nombre y Apellido, Correo Electrónico y Número de Teléfono y botón **Crear cuenta**. El teléfono usa `CountrySelect`: un `<select>` nativo invisible dibujado encima de la fila bandera + prefijo, con los **198 países** de `src/config/countries.ts` (datos generados con `npm run generate:countries`). El prefijo se compone con `composePhone`; nadie escribe un `+`.
- **Paso 3 (Verificación Biométrica)**: Título, subtítulo, visor centrado con logo facial (`ScanFace`) y botón **Verificar cuenta**, con generación directa y celebración con confeti.

### 6. Operaciones con QR (`ChargeQrModal`)
- Botón circular flotante en la barra de navegación con icono QR para operaciones rápidas.
- **Pantalla completa de color lima** (`bg-[#ccff00]`).
- **Selector Inicial "¿Qué querés hacer?"**:
  - **Cobrar con QR**: Flujo de cobro con importe display gigante (`text-8xl`), teclado táctil, generación de QR con enlace para compartir y registrar en Actividad como *"Cobro por QR"*, estado *"Pendiente"* con fecha de expiración.
  - **Pagar con QR**: Visor de escaneo automático con saldo Bitcoin, detección de factura mock, visualización del importe pagado en positivo (`0,000050 BTC`) y débito directo con registro en Actividad (`- 0,000050 BTC`).
- **Botón de Bug en la Cabecera**:
  - Reemplazo del icono QR en la cabecera por el botón de Bug (`FeedbackModal`), replicado de manera uniforme en **Billetera**, **Inversiones** y **Actividad**.

---

## 🔌 Guía de Integración con el Backend

Para conectar la aplicación a un backend real (API REST, GraphQL o WebSockets):

1. **Mantener las interfaces**: Las interfaces `IWalletService`, `ICryptoService`, `IYieldService` y `ITransactionService` en `src/services/` definen el contrato que espera el frontend.
2. **Reemplazar las clases Mock**:
   ```typescript
   // Ejemplo en src/services/walletService.ts
   class ApiWalletService implements IWalletService {
     async getBalance(): Promise<WalletBalance> {
       const res = await fetch('/api/v1/wallet/balance', {
         headers: { Authorization: `Bearer ${token}` }
       });
       return res.json();
     }
   }
   export const walletService: IWalletService = new ApiWalletService();
   ```
3. **Cero cambios en la UI**: Ningún componente de la carpeta `src/components/` necesita ser editado al migrar hacia la API real.

---

## 🛠️ Scripts Disponibles

- `npm run dev`: Inicia el servidor de desarrollo local en el puerto 3000.
- `npm run build`: Compila el proyecto con Vite y TypeScript para producción.
- `npm run lint`: Valida la integridad estática de tipos con `tsc --noEmit`.
