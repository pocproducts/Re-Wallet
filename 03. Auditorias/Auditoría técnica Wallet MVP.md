# 📋 Marco de Auditoría Técnica Completa — Wallet MVP

## Backend (Hexagonal) · Frontend (Clean Architecture) · Base de Datos · Integración · Testing · Documentación

> **Complemento al Marco de Auditoría DevOps ya existente.**
> Mientras DevOps mide *infraestructura, despliegue y operación*, esta auditoría mide **calidad de código, arquitectura, contratos y mantenibilidad**.
> Juntas dan el panorama completo para decidir si el MVP es *funcional, usable y comprobable* sobre Cloudflare.

---

## 📐 Instrucciones de Uso

| Símbolo | Significado | Puntaje |
|---------|-------------|---------|
| ✅ | Cumple completamente | 1 |
| ⚠️ | Cumple parcialmente / con deuda | 0.5 |
| ❌ | No cumple | 0 |
| N/A | No aplica (se excluye del denominador) | — |

**Fórmula por bloque:**

% Bloque = (Σ puntajes obtenidos / Σ puntajes posibles) × 100


**Fórmula global:**

% Global = Σ (Peso_bloque × (% del bloque / 100))


**Interpretación final:**
- **< 40%** → POC. No presentable como MVP.
- **40–60%** → MVP funcional con deuda crítica. Priorizar.
- **60–80%** → MVP usable con usuarios limitados.
- **> 80%** → Listo para producción controlada.

**Score combinado con auditoría DevOps previa:**

% Técnico Global = (Auditoría Código × 0.6) + (Auditoría DevOps × 0.4)

*(Ajustar ponderación según prioridad del equipo: si el foco es “MVP usable ya”, dar más peso a código.)*

---

# 🧱 BLOQUE 1 — Backend: Arquitectura Hexagonal (Peso: 12%)

**Objetivo:** Verificar que el backend respete puertos/adaptadores: dominio puro, casos de uso aislados, infraestructura intercambiable.

| # | Pregunta | Cómo evaluar | Señal de alerta |
|---|----------|--------------|-----------------|
| 1.1 | ¿Existe separación física en carpetas `domain/`, `application/`, `infrastructure/`? | Revisar árbol de carpetas del Worker. | Todo en `src/handlers/` o `src/routes/`. |
| 1.2 | ¿El **dominio** está libre de dependencias externas (sin `fetch`, sin `pg`, sin `Hono`, sin `wrangler`)? | Buscar imports en `domain/`. | `import { Pool } from 'pg'` dentro del dominio. |
| 1.3 | ¿Las **entidades** y **value objects** modelan reglas de negocio (no son solo DTOs)? | Ver `Wallet.ts`, `Transaction.ts`, `Amount.ts`. | Entidades anémicas (solo getters/setters). |
| 1.4 | ¿Los **casos de uso** (application) orquestan sin conocer infraestructura? | Deben recibir puertos por inyección, no instanciar adaptadores. | `new PgWalletRepository()` dentro de un use case. |
| 1.5 | ¿Existen **puertos** (interfaces) explícitos para repositorios, hashing, firma, notificaciones? | Buscar `WalletRepository.ts`, `SignatureVerifier.ts` como interfaces. | No hay interfaces; se importan clases concretas. |
| 1.6 | ¿Los **adaptadores** (infra) implementan los puertos y son sustituibles? | Ej. `PgWalletRepository implements WalletRepository`. | Adaptador filtra lógica al dominio. |
| 1.7 | ¿La capa HTTP (Hono/Itty) solo traduce request → use case → response? | Handlers ≤ 30 líneas, sin lógica de negocio. | Validaciones de negocio en el handler. |
| 1.8 | ¿Hay inversión de dependencias real (dominio no importa infra)? | Grafo de imports: `domain ← application ← infrastructure`. | Ciclos o imports cruzados. |

**Señales de alerta globales:** queries SQL en handlers, validaciones de negocio en middleware, `env` filtrado al dominio, adaptadores con lógica de decisión.

---

# 🧩 BLOQUE 2 — Backend: Calidad de Código y Patrones (Peso: 10%)

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 2.1 | ¿TypeScript en modo `strict: true` con `noUncheckedIndexedAccess`? | Revisar `tsconfig.json`. |
| 2.2 | ¿Se evita `any` y `as` inseguros? | `grep -r ": any"` y `as unknown as`. |
| 2.3 | ¿Los errores se modelan como tipos (`Result<T, E>` o clases `DomainError`)? | Buscar `throw new Error("...")` genéricos. |
| 2.4 | ¿Los casos de uso devuelven resultados explícitos (no lanzan excepciones para flujo normal)? | Revisar manejo de "saldo insuficiente". |
| 2.5 | ¿Existe un **manejador de errores centralizado** en la capa HTTP? | Middleware `onError` en Hono/Itty. |
| 2.6 | ¿Se validan inputs con esquema (Zod, Valibot, TypeBox) en el borde? | Buscar `z.object({...})` en handlers. |
| 2.7 | ¿Se usan **DTOs** explícitos para request/response (no entidades expuestas)? | Entidad `Wallet` devuelta directamente al cliente = ❌. |
| 2.8 | ¿Hay funciones puras testeables en dominio (sin efectos secundarios)? | Revisar tests unitarios del dominio. |
| 2.9 | ¿Se evita duplicación (DRY) sin sobre-abstraer? | Archivos repetidos > 3 veces con misma lógica. |
| 2.10 | ¿Los nombres son intencionales (`transferFunds` vs `doTransfer`)? | Revisar consistencia. |

---

# 🎨 BLOQUE 3 — Frontend: Clean Architecture (Peso: 12%)

**Objetivo:** Verificar separación `domain / data / presentation` y que la UI no contenga reglas de negocio.

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 3.1 | ¿Existe separación `domain/`, `data/`, `presentation/` (o `features/`)? | Árbol de carpetas del front. |
| 3.2 | ¿El **dominio** frontend define entidades y contratos (interfaces de repositorio)? | `Wallet.ts`, `Transaction.ts`, `WalletRepository.ts`. |
| 3.3 | ¿La capa **data** implementa los repositorios (fetch, axios, ethers)? | `HttpWalletRepository implements WalletRepository`. |
| 3.4 | ¿La capa **presentation** (componentes, hooks) no llama `fetch` directamente? | Buscar `fetch(` en componentes. |
| 3.5 | ¿Se usan **hooks personalizados** para orquestar casos de uso (`useTransfer`, `useBalance`)? | Separación clara de responsabilidades. |
| 3.6 | ¿Los componentes son **puros** y reciben datos por props/context? | Componentes que hacen queries dentro = ❌. |
| 3.7 | ¿Hay manejo explícito de **estados de carga, error y vacío**? | Skeletons, error boundaries, empty states. |
| 3.8 | ¿Se separan **modelos de dominio** de **DTOs de API** (mappers)? | `WalletMapper.toDomain(dto)`. |
| 3.9 | ¿La lógica de firma Web3 vive en un servicio dedicado (no en el componente)? | `SignatureService` en `data/` o `infra/`. |
| 3.10 | ¿El estado global es mínimo y justificado (Zustand, Redux, Context)? | Estado global para todo = ❌. |

---

# 🖥️ BLOQUE 4 — Frontend: Calidad, UX y Accesibilidad (Peso: 8%)

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 4.1 | ¿TypeScript estricto en el front? | `tsconfig.json`. |
| 4.2 | ¿Componentes funcionales con hooks (sin class components)? | Revisar patrones. |
| 4.3 | ¿Hay **design system** o tokens (colores, espaciados, tipografía)? | Tailwind config, theme, o CSS vars. |
| 4.4 | ¿La app es **responsive** (mobile-first)? | Probar en 375px, 768px, 1440px. |
| 4.5 | ¿Cumple **WCAG AA** básico (contraste, labels, foco visible)? | Lighthouse Accessibility ≥ 90. |
| 4.6 | ¿Se manejan **errores de red** con mensajes claros al usuario? | Toasts, banners, retry. |
| 4.7 | ¿Hay **feedback visual** en acciones críticas (transferir, firmar)? | Loading states, confirmaciones. |
| 4.8 | ¿El flujo de conexión de wallet es claro (Connect → Sign → Ready)? | UX de onboarding. |
| 4.9 | ¿Se previenen **doble envío** de formularios (disable + idempotencia)? | Botón bloqueado durante submit. |
| 4.10 | ¿Se muestra el **hash de transacción** y enlace al explorer? | Verificabilidad on-chain. |

---

# 🗄️ BLOQUE 5 — Base de Datos: Esquema e Integridad (Peso: 12%)

**Objetivo:** Auditoría del esquema PostgreSQL más allá de lo DevOps (Hyperdrive, backups).

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 5.1 | ¿El esquema está normalizado (3FN mínimo) sin sobre-normalizar? | Revisar tablas y relaciones. |
| 5.2 | ¿Existen **constraints** en todas las columnas críticas (NOT NULL, UNIQUE, CHECK)? | `\d+ tabla` en psql. |
| 5.3 | ¿Hay **foreign keys** con `ON DELETE` explícito? | Evitar huérfanos. |
| 5.4 | ¿Los **montos** se almacenan como `NUMERIC(78,0)` o `BIGINT` (nunca `FLOAT`)? | Crítico para dinero. |
| 5.5 | ¿Las **direcciones** se almacenan con checksum o normalizadas (`LOWER()`)? | Consistencia de búsqueda. |
| 5.6 | ¿Existe tabla `transactions` **inmutable** (append-only, sin UPDATE/DELETE)? | Revisar triggers/permisos. |
| 5.7 | ¿Hay **idempotency keys** como UNIQUE en transferencias? | Previene duplicados. |
| 5.8 | ¿Se usa `CHECK (amount > 0)` en montos? | Previene negativos. |
| 5.9 | ¿Los timestamps son `TIMESTAMPTZ` (no `TIMESTAMP`)? | Evita bugs de zona horaria. |
| 5.10 | ¿Hay una tabla de **auditoría** o `updated_at` con trigger? | Trazabilidad. |
| 5.11 | ¿Se usa `UUID v7` o `BIGSERIAL` para IDs (no UUID v4 en índices grandes)? | Performance. |
| 5.12 | ¿Las **funciones almacenadas** están versionadas y testeadas? | `SELECT transfer_funds(...)` con tests. |

---

# ⚡ BLOQUE 6 — Base de Datos: Performance y Seguridad (Peso: 10%)

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 6.1 | ¿Existen **índices** en `user_id`, `address`, `tx_hash`, `created_at`? | `\di` en psql. |
| 6.2 | ¿Se usan **índices parciales** o compuestos donde aplica? | Ej. `(from_address, created_at DESC)`. |
| 6.3 | ¿Se evitan **N+1 queries** en endpoints de listado? | Revisar joins vs loops. |
| 6.4 | ¿Las queries usan **parámetros preparados** (`$1`, `$2`)? | Cero concatenación. |
| 6.5 | ¿Las funciones críticas usan `SELECT ... FOR UPDATE` o `SERIALIZABLE`? | Revisar `transfer_funds`. |
| 6.6 | ¿Hay **roles PostgreSQL** diferenciados (app vs admin vs readonly)? | Revisar `GRANT`. |
| 6.7 | ¿Row Level Security (RLS) está evaluado (aunque sea N/A)? | Justificar si no aplica. |
| 6.8 | ¿Las migraciones son **idempotentes** y reversibles? | `up.sql` + `down.sql`. |
| 6.9 | ¿Se monitorean **queries lentas** (> 100ms)? | `pg_stat_statements`. |
| 6.10 | ¿Hay estrategia de **particionado** o archivado para `transactions`? | Pensando en escala. |

---

# 🔗 BLOQUE 7 — Integración y Contratos Backend ↔ Frontend (Peso: 10%)

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 7.1 | ¿Existe un **contrato API** definido (OpenAPI, tRPC, Zod schemas compartidos)? | Archivo `openapi.yaml` o `packages/contracts`. |
| 7.2 | ¿Los **tipos** del backend y frontend se comparten o se duplican manualmente? | Monorepo con `shared/`. |
| 7.3 | ¿Los **errores de API** tienen formato consistente (`{ code, message, details }`)? | Revisar respuestas de error. |
| 7.4 | ¿Los **códigos HTTP** son semánticamente correctos (400, 401, 403, 409, 422, 429, 500)? | No todo es 200 o 500. |
| 7.5 | ¿Hay **versionado de API** (`/v1/`)? | Preparación para cambios. |
| 7.6 | ¿El frontend maneja **timeouts** y **retries** con backoff? | Revisar cliente HTTP. |
| 7.7 | ¿Los **CORS** están alineados entre backend y dominios del frontend? | Sin `*` en producción. |
| 7.8 | ¿Se validan **respuestas del backend** en el frontend (runtime validation)? | Zod parse en data layer. |
| 7.9 | ¿Los **flujos críticos** están documentados end-to-end (login, transfer)? | Diagramas de secuencia. |
| 7.10 | ¿Se usa **idempotency key** generada en el frontend y validada en el backend? | Coherencia entre capas. |

---

# 🧪 BLOQUE 8 — Estrategia de Testing (Peso: 8%)

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 8.1 | ¿Hay **tests unitarios** en el dominio del backend? | Cobertura de reglas de negocio. |
| 8.2 | ¿Hay **tests unitarios** en casos de uso (con mocks de puertos)? | Ver `application/__tests__/`. |
| 8.3 | ¿Hay **tests de integración** con PostgreSQL real o testcontainers? | No solo mocks. |
| 8.4 | ¿Hay **tests de contrato** entre backend y frontend? | Pact, Zod schemas. |
| 8.5 | ¿Hay **tests E2E** de flujos críticos (Playwright, Cypress)? | Login → transfer → verificación. |
| 8.6 | ¿La cobertura es **medida** y con umbral mínimo? | `vitest --coverage`. |
| 8.7 | ¿Se testean **casos de error** (saldo insuficiente, firma inválida, replay)? | No solo happy path. |
| 8.8 | ¿Los tests corren en **CI** antes del deploy? | Workflow de GitHub Actions. |
| 8.9 | ¿Hay **fixtures** o factories para datos de prueba? | Consistencia entre tests. |
| 8.10 | ¿Se testea la **idempotencia** de transferencias? | Enviar dos veces la misma key. |

---

# 📚 BLOQUE 9 — Documentación y Onboarding (Peso: 3%)

| # | Pregunta | Cómo evaluar |
|---|----------|--------------|
| 9.1 | ¿Hay **README** con arquitectura, setup y comandos? | Revisar raíz del repo. |
| 9.2 | ¿Hay **ADR** (Architecture Decision Records) para decisiones clave? | `docs/adr/`. |
| 9.3 | ¿El **diagrama de arquitectura** está actualizado (C4 o informal)? | `docs/architecture.md`. |
| 9.4 | ¿Hay **guía de contribución** y convenciones de código? | `CONTRIBUTING.md`. |
| 9.5 | ¿Los **endpoints** están documentados con ejemplos request/response? | Swagger o markdown. |
| 9.6 | ¿Hay **variables de entorno** documentadas (`.env.example`)? | Sin valores reales. |
| 9.7 | ¿El onboarding permite levantar el proyecto en < 30 min? | Probar con alguien nuevo. |

---

# 📊 Tabla de Puntuación Global

| # | Bloque | Peso | Preguntas | Obtenido | Máximo | % Bloque |
|---|--------|------|-----------|----------|--------|----------|
| 1 | Backend — Hexagonal | 12% | 8 | ___ | 8 | ___% |
| 2 | Backend — Calidad | 10% | 10 | ___ | 10 | ___% |
| 3 | Frontend — Clean Arch | 12% | 10 | ___ | 10 | ___% |
| 4 | Frontend — UX/Accesibilidad | 8% | 10 | ___ | 10 | ___% |
| 5 | DB — Esquema e Integridad | 12% | 12 | ___ | 12 | ___% |
| 6 | DB — Performance y Seguridad | 10% | 10 | ___ | 10 | ___% |
| 7 | Integración y Contratos | 10% | 10 | ___ | 10 | ___% |
| 8 | Testing | 8% | 10 | ___ | 10 | ___% |
| 9 | Documentación | 3% | 7 | ___ | 7 | ___% |
| **TOTAL** | | **100%** | **77** | **___** | **77** | **___%** |

**Fórmula:**

% Global = Σ (Peso × %Bloque/100)


**Score combinado con auditoría DevOps previa:**

% Técnico Global = (Auditoría Código × 0.6) + (Auditoría DevOps × 0.4)


---

# 🚨 Matriz de Priorización (P0 → P3)

| Prioridad | Área | Acción concreta | Impacto |
|-----------|------|-----------------|---------|
| **P0** | Backend Hexagonal | Extraer lógica de negocio de handlers a `application/`. Crear puertos e inyección. | Bloquea escalabilidad y testing. |
| **P0** | DB Integridad | Constraints, `NUMERIC` para montos, `idempotency_key` UNIQUE. | Riesgo de pérdida de fondos. |
| **P0** | Contratos | Zod schemas compartidos backend/frontend. | Bugs silenciosos en integración. |
| **P1** | Frontend Clean Arch | Separar `data/` de `presentation/`. Hooks para casos de uso. | Mantenibilidad y testing. |
| **P1** | Testing | Tests de dominio + integración de `transfer_funds`. | Confianza para desplegar. |
| **P1** | DB Performance | Índices en `address`, `tx_hash`, `user_id`, `created_at`. | Latencia y costos Hyperdrive. |
| **P2** | Backend Calidad | TS strict, manejo de errores tipado, DTOs. | Reducción de bugs. |
| **P2** | Frontend UX | Estados de carga/error, accesibilidad, feedback visual. | Percepción de producto. |
| **P2** | Integración | OpenAPI o contratos versionados, versionado `/v1/`. | Facilita evolución. |
| **P3** | Documentación | README, ADRs, diagrama de arquitectura. | Onboarding y auditoría futura. |

---

# 🎯 Cómo Ejecutar Esta Auditoría (Paso a Paso)

### Paso 1 — Recolección de evidencia
- Repo backend + frontend (o monorepo).
- `wrangler.toml`, `package.json`, `tsconfig.json` de cada Worker.
- Esquema PostgreSQL (`pg_dump --schema-only`).
- Workflows de GitHub Actions.
- Colección Postman/Thunder o archivo `.http`.

### Paso 2 — Entrevista técnica (CTO / Tech Lead)
Preguntar explícitamente:
1. ¿Por qué un solo Worker o varios?
2. ¿Dónde vive la lógica de transferencia: Worker o PostgreSQL? ¿Por qué?
3. ¿Cómo se garantiza idempotencia?
4. ¿Cómo se testea hoy? ¿Qué no se testea y por qué?
5. ¿Qué decisiones arquitectónicas se tomaron por tiempo vs por diseño?

### Paso 3 — Revisión de código asistida
- **Backend:** grafo de imports del dominio → detectar fugas.
- **Frontend:** buscar `fetch(` en `components/` → detectar fugas de capa.
- **DB:** `EXPLAIN ANALYZE` de las 5 queries más frecuentes.
- **Contratos:** diff entre tipos frontend y schemas backend.

### Paso 4 — Pruebas manuales guiadas
- Login con firma → verificar nonce en KV y TTL.
- Transferencia exitosa → verificar atomicidad y ledger.
- Transferencia duplicada (misma idempotency key) → debe rechazar.
- Transferencia con saldo insuficiente → debe fallar limpio.
- Consulta de saldo → verificar reconciliación.

### Paso 5 — Puntuar y priorizar
- Completar tabla global.
- Cruzar con auditoría DevOps.
- Identificar **top 3 bloques con menor %**.
- Generar plan de acción con esfuerzo/impacto.

---

# 📝 Checklist Rápido para el Equipo (antes de la auditoría)

Pídele al equipo que prepare:

- [ ] Árbol de carpetas backend y frontend (con anotaciones).
- [ ] `tsconfig.json` de ambos proyectos.
- [ ] `package.json` con scripts y dependencias.
- [ ] Esquema PostgreSQL (`pg_dump --schema-only`).
- [ ] Lista de funciones almacenadas + su propósito.
- [ ] 5 queries más frecuentes con `EXPLAIN ANALYZE`.
- [ ] Contratos API (OpenAPI, Zod, tRPC o equivalente).
- [ ] Cobertura de tests actual (si existe).
- [ ] Diagrama de flujo: login → transferencia → verificación.
- [ ] Lista de decisiones técnicas “pendientes” o “deuda asumida”.

---

# 🏗️ Anexo A — Estructura Canónica Backend Hexagonal (Cloudflare Workers)

backend/
├── src/
│ ├── domain/ # Núcleo puro (sin dependencias externas)
│ │ ├── entities/
│ │ │ ├── Wallet.ts
│ │ │ ├── Transaction.ts
│ │ │ └── User.ts
│ │ ├── value-objects/
│ │ │ ├── Address.ts
│ │ │ ├── Amount.ts
│ │ │ └── TxHash.ts
│ │ ├── errors/
│ │ │ ├── DomainError.ts
│ │ │ ├── InsufficientFundsError.ts
│ │ │ └── InvalidAddressError.ts
│ │ └── events/
│ │ └── TransferCompleted.ts
│ │
│ ├── application/ # Casos de uso (orquestan dominio + puertos)
│ │ ├── ports/
│ │ │ ├── in/ # Interfaces de entrada (use cases)
│ │ │ │ ├── TransferFundsUseCase.ts
│ │ │ │ └── GetBalanceUseCase.ts
│ │ │ └── out/ # Interfaces de salida (repos, servicios)
│ │ │ ├── WalletRepository.ts
│ │ │ ├── SignatureVerifier.ts
│ │ │ ├── NonceStore.ts
│ │ │ └── NotificationService.ts
│ │ ├── use-cases/
│ │ │ ├── TransferFunds.ts
│ │ │ ├── AuthenticateUser.ts
│ │ │ └── GetBalance.ts
│ │ └── dto/
│ │ ├── TransferRequestDTO.ts
│ │ └── TransferResponseDTO.ts
│ │
│ ├── infrastructure/ # Adaptadores (implementan los puertos)
│ │ ├── persistence/
│ │ │ ├── PgWalletRepository.ts
│ │ │ └── PgTransactionRepository.ts
│ │ ├── crypto/
│ │ │ ├── EthersSignatureVerifier.ts
│ │ │ └── JwtService.ts
│ │ ├── cache/
│ │ │ └── KvNonceStore.ts
│ │ ├── notifications/
│ │ │ └── WebhookNotificationService.ts
│ │ └── config/
│ │ └── Env.ts
│ │
│ ├── interfaces/ # Capa HTTP (Hono/Itty)
│ │ ├── http/
│ │ │ ├── routes/
│ │ │ │ ├── auth.routes.ts
│ │ │ │ ├── wallet.routes.ts
│ │ │ │ └── transfer.routes.ts
│ │ │ ├── middlewares/
│ │ │ │ ├── auth.middleware.ts
│ │ │ │ ├── rate-limit.middleware.ts
│ │ │ │ ├── validate.middleware.ts
│ │ │ │ └── error.middleware.ts
│ │ │ ├── schemas/ # Zod / TypeBox
│ │ │ │ ├── transfer.schema.ts
│ │ │ │ └── auth.schema.ts
│ │ │ └── mappers/
│ │ │ └── TransferMapper.ts
│ │ └── index.ts # Entry point del Worker
│ │
│ └── shared/ # Utilidades compartidas (cuidado: sin lógica)
│ ├── result.ts
│ └── logger.ts
│
├── tests/
│ ├── unit/
│ │ ├── domain/
│ │ └── application/
│ ├── integration/
│ │ └── persistence/
│ └── e2e/
│
├── migrations/ # SQL versionado (up/down)
│ ├── 001_init.sql
│ ├── 002_add_idempotency.sql
│ └── ...
│
├── wrangler.toml
├── tsconfig.json
├── package.json
└── README.md


**Regla de oro del hexágono:** el grafo de imports debe fluir siempre `interfaces → application → domain`. La infraestructura se inyecta desde afuera (composition root en `interfaces/index.ts`).

---

# 🎨 Anexo B — Estructura Canónica Frontend Clean Architecture

rontend/
├── src/
│ ├── domain/ # Entidades y contratos (sin React, sin fetch)
│ │ ├── entities/
│ │ │ ├── Wallet.ts
│ │ │ ├── Transaction.ts
│ │ │ └── User.ts
│ │ ├── value-objects/
│ │ │ ├── Address.ts
│ │ │ └── Amount.ts
│ │ ├── errors/
│ │ │ └── DomainError.ts
│ │ └── repositories/ # Interfaces (puertos)
│ │ ├── WalletRepository.ts
│ │ └── AuthRepository.ts
│ │
│ ├── data/ # Implementación de repositorios
│ │ ├── repositories/
│ │ │ ├── HttpWalletRepository.ts
│ │ │ └── HttpAuthRepository.ts
│ │ ├── datasources/
│ │ │ ├── WalletApiDataSource.ts
│ │ │ └── AuthApiDataSource.ts
│ │ ├── mappers/
│ │ │ ├── WalletMapper.ts
│ │ │ └── TransactionMapper.ts
│ │ ├── schemas/ # Zod runtime validation
│ │ │ ├── wallet.schema.ts
│ │ │ └── transfer.schema.ts
│ │ └── http/
│ │ └── ApiClient.ts # fetch + interceptores + retry
│ │
│ ├── presentation/ # React
│ │ ├── components/ # Puros, sin lógica de negocio
│ │ │ ├── ui/
│ │ │ │ ├── Button.tsx
│ │ │ │ ├── Card.tsx
│ │ │ │ └── Input.tsx
│ │ │ └── wallet/
│ │ │ ├── BalanceCard.tsx
│ │ │ └── TransferForm.tsx
│ │ ├── hooks/ # Orquestan casos de uso
│ │ │ ├── useBalance.ts
│ │ │ ├── useTransfer.ts
│ │ │ └── useAuth.ts
│ │ ├── pages/
│ │ │ ├── LoginPage.tsx
│ │ │ ├── WalletPage.tsx
│ │ │ └── TransferPage.tsx
│ │ ├── context/
│ │ │ └── WalletContext.tsx
│ │ └── providers/
│ │ └── RepositoryProvider.tsx # Composition root del front
│ │
│ ├── shared/
│ │ ├── utils/
│ │ ├── constants/
│ │ └── types/
│ │
│ ├── App.tsx
│ └── main.tsx
│
├── tests/
│ ├── unit/
│ ├── integration/
│ └── e2e/
│
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── package.json
└── README.md



**Regla de oro del front:** los componentes de `presentation/components/` **nunca** importan de `data/`. Solo los hooks importan repositorios, y estos se inyectan vía `RepositoryProvider`.

---

# 🧬 Anexo C — Esquema SQL de Referencia (Wallet MVP)

```sql
-- =====================================================================
-- Migration 001 — Esquema base del Wallet MVP
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT NOT NULL UNIQUE CHECK (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE INDEX idx_users_wallet_address ON users (LOWER(wallet_address));

-- ---------------------------------------------------------------------
-- WALLETS
-- ---------------------------------------------------------------------
CREATE TABLE wallets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chain_id        INTEGER NOT NULL DEFAULT 1,
    balance         NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    currency        TEXT NOT NULL DEFAULT 'ETH',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, chain_id, currency)
);

CREATE INDEX idx_wallets_user_id ON wallets (user_id);

-- ---------------------------------------------------------------------
-- TRANSACTIONS (ledger inmutable, append-only)
-- ---------------------------------------------------------------------
CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key  TEXT NOT NULL UNIQUE,
    from_wallet_id   UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    to_wallet_id     UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount           NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    currency         TEXT NOT NULL DEFAULT 'ETH',
    status           TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    tx_hash          TEXT UNIQUE,
    error_message    TEXT,
    metadata         JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at     TIMESTAMPTZ,
    CHECK (from_wallet_id <> to_wallet_id)
);

CREATE INDEX idx_transactions_from_wallet   ON transactions (from_wallet_id, created_at DESC);
CREATE INDEX idx_transactions_to_wallet     ON transactions (to_wallet_id, created_at DESC);
CREATE INDEX idx_transactions_tx_hash       ON transactions (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_transactions_status        ON transactions (status) WHERE status <> 'confirmed';

-- ---------------------------------------------------------------------
-- AUTH ATTEMPTS (auditoría de intentos fallidos)
-- ---------------------------------------------------------------------
CREATE TABLE auth_attempts (
    id            BIGSERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    success       BOOLEAN NOT NULL,
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_attempts_wallet ON auth_attempts (LOWER(wallet_address), created_at DESC);

-- ---------------------------------------------------------------------
-- TRIGGER updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- Migration 002 — Función almacenada transfer_funds (atómica + idempotente)
-- =====================================================================
CREATE OR REPLACE FUNCTION transfer_funds(
    p_idempotency_key TEXT,
    p_from_wallet_id  UUID,
    p_to_wallet_id    UUID,
    p_amount          NUMERIC,
    p_currency        TEXT DEFAULT 'ETH'
)
RETURNS TABLE (
    transaction_id UUID,
    status         TEXT,
    tx_hash        TEXT,
    error_message  TEXT
) AS $$
DECLARE
    v_existing_id     UUID;
    v_from_balance    NUMERIC;
    v_tx_id           UUID;
BEGIN
    -- 1. Idempotencia: si ya existe, devolver el resultado previo
    SELECT id INTO v_existing_id
    FROM transactions
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY
        SELECT t.id, t.status, t.tx_hash, t.error_message
        FROM transactions t WHERE t.id = v_existing_id;
        RETURN;
    END IF;

    -- 2. Validaciones básicas
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'El monto debe ser positivo';
    END IF;

    IF p_from_wallet_id = p_to_wallet_id THEN
        RAISE EXCEPTION 'No se puede transferir a la misma wallet';
    END IF;

    -- 3. Bloqueo pesimista de la wallet origen
    SELECT balance INTO v_from_balance
    FROM wallets
    WHERE id = p_from_wallet_id
    FOR UPDATE;

    IF v_from_balance IS NULL THEN
        RAISE EXCEPTION 'Wallet origen no existe';
    END IF;

    IF v_from_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;

    -- 4. Registrar transacción pendiente
    INSERT INTO transactions (
        idempotency_key, from_wallet_id, to_wallet_id,
        amount, currency, status
    )
    VALUES (
        p_idempotency_key, p_from_wallet_id, p_to_wallet_id,
        p_amount, p_currency, 'pending'
    )
    RETURNING id INTO v_tx_id;

    -- 5. Debitar y acreditar (dentro de la misma transacción)
    UPDATE wallets SET balance = balance - p_amount WHERE id = p_from_wallet_id;
    UPDATE wallets SET balance = balance + p_amount WHERE id = p_to_wallet_id;

    -- 6. Confirmar
    UPDATE transactions
    SET status = 'confirmed', confirmed_at = now()
    WHERE id = v_tx_id;

    RETURN QUERY
    SELECT t.id, t.status, t.tx_hash, t.error_message
    FROM transactions t WHERE t.id = v_tx_id;

EXCEPTION
    WHEN OTHERS THEN
        -- Rollback implícito: registrar el fallo sin romper idempotencia
        INSERT INTO transactions (
            idempotency_key, from_wallet_id, to_wallet_id,
            amount, currency, status, error_message
        )
        VALUES (
            p_idempotency_key, p_from_wallet_id, p_to_wallet_id,
            p_amount, p_currency, 'failed', SQLERRM
        )
        ON CONFLICT (idempotency_key) DO NOTHING;

        RAISE;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Migration 003 — Función de reconciliación
-- =====================================================================
CREATE OR REPLACE FUNCTION reconcile_wallet_balance(p_wallet_id UUID)
RETURNS TABLE (
    wallet_id       UUID,
    stored_balance  NUMERIC,
    computed_balance NUMERIC,
    difference      NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        w.id,
        w.balance,
        COALESCE(
            (SELECT SUM(amount) FROM transactions
             WHERE to_wallet_id = w.id AND status = 'confirmed'), 0
        ) - COALESCE(
            (SELECT SUM(amount) FROM transactions
             WHERE from_wallet_id = w.id AND status = 'confirmed'), 0
        ),
        w.balance - (
            COALESCE((SELECT SUM(amount) FROM transactions
                      WHERE to_wallet_id = w.id AND status = 'confirmed'), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions
                        WHERE from_wallet_id = w.id AND status = 'confirmed'), 0)
        )
    FROM wallets w
    WHERE w.id = p_wallet_id;
END;
$$ LANGUAGE plpgsql STABLE;

🧪 Anexo D — Ejemplos de Tests Críticos
D.1 — Test unitario de dominio (backend)
ts

// tests/unit/domain/Wallet.test.ts
import { describe, it, expect } from 'vitest';
import { Wallet } from '../../../src/domain/entities/Wallet';
import { Amount } from '../../../src/domain/value-objects/Amount';
import { InsufficientFundsError } from '../../../src/domain/errors/InsufficientFundsError';

describe('Wallet', () => {
  it('debe rechazar débito mayor al saldo', () => {
    const wallet = Wallet.create({ balance: Amount.from(100) });
    expect(() => wallet.debit(Amount.from(150)))
      .toThrow(InsufficientFundsError);
  });

  it('debe debitar correctamente cuando hay saldo suficiente', () => {
    const wallet = Wallet.create({ balance: Amount.from(100) });
    wallet.debit(Amount.from(40));
    expect(wallet.balance.value).toBe(60);
  });
});

D.2 — Test de integración de transfer_funds
ts

// tests/integration/transfer_funds.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Pool } from 'pg';

describe('transfer_funds (integración)', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DB_URL });
    await pool.query('TRUNCATE transactions, wallets, users RESTART IDENTITY CASCADE');
  });

  it('es idempotente: segunda llamada no duplica', async () => {
    // ...setup wallets con saldo
    const key = 'idem-key-001';

    const r1 = await pool.query(
      'SELECT * FROM transfer_funds($1, $2, $3, $4)',
      [key, fromId, toId, 50]
    );
    const r2 = await pool.query(
      'SELECT * FROM transfer_funds($1, $2, $3, $4)',
      [key, fromId, toId, 50]
    );

    expect(r1.rows[0].transaction_id).toBe(r2.rows[0].transaction_id);

    const count = await pool.query(
      'SELECT COUNT(*) FROM transactions WHERE idempotency_key = $1',
      [key]
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });
});

D.3 — Test de contrato entre frontend y backend
ts

// packages/contracts/src/transfer.schema.ts
import { z } from 'zod';

export const TransferRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
  currency: z.enum(['ETH', 'USDC']).default('ETH'),
  signature: z.string(),
});

export const TransferResponseSchema = z.object({
  transactionId: z.string().uuid(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  txHash: z.string().nullable(),
});

export type TransferRequest = z.infer<typeof TransferRequestSchema>;
export type TransferResponse = z.infer<typeof TransferResponseSchema>;

🔥 Entregable Final Esperado

Al terminar esta auditoría tendrás:

    % Global Técnico (código + DB + integración).

    % Global DevOps (del marco existente).

    Score combinado para decidir si el MVP es desplegable.

    Top 5 brechas críticas con plan de acción priorizado.

    Backlog técnico listo para sprint de hardening pre-deploy.

    Evidencia objetiva (no opiniones) para justificar decisiones ante stakeholders.

📌 Notas Finales

    Esta auditoría es complementaria, no reemplaza la auditoría DevOps.

    Se recomienda ejecutarla antes del despliegue en Cloudflare para evitar retrabajos costosos.

    Los anexos A–D sirven como referencia canónica para refactorizar hacia el estado ideal.

    Priorizar siempre: P0 (dinero/seguridad) → P1 (integridad/contratos) → P2 (calidad) → P3 (docs).

    Documentar cada hallazgo con evidencia concreta (archivo:línea, screenshot, query) para que el equipo pueda actuar sin ambigüedad.

Fin del Marco de Auditoría Técnica Completa — Wallet MVP.
text


Listo. El archivo está completo, autocontenido y listo para guardar como `auditoria-tecnica-wallet-mvp.md`. Incluye:

- **9 bloques de evaluación** (Backend Hexagonal, Calidad Backend, Frontend Clean Arch, UX/Accesibilidad, DB Esquema, DB Performance, Integración/Contratos, Testing, Documentación).
- **Tabla de puntuación global** con pesos y fórmula.
- **Matriz de priorización P0–P3**.
- **Pasos de ejecución** y **checklist** para el equipo.
- **4 anexos técnicos**: estructura canónica backend, estructura canónica frontend, esquema SQL de referencia con funciones almacenadas (`transfer_funds` idempotente + `reconcile_wallet_balance`), y ejemplos de tests críticos.

Si quieres, puedo ahora:
1. Generar el **archivo `.md` fusionado** con la auditoría DevOps que ya tenías (todo en uno solo).
2. Crear el **plan de hardening P0/P1** en formato de tickets listos para GitHub Issues.
3. Diseñar el **diagrama C4** en Mermaid para incluir en el mismo `.md`.
