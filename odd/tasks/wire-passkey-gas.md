# Feature — Pasada 1: Auth passkey + capa de gas

**Feature**: `wire-passkey-gas`
**Status**: pasada 1 CERRADA (auth + gas + isla) — 2026-09-27
**Created**: 2026-09-27
**Specs**: prompt maestro de Gas Sponsorship Layer + prompt maestro de Passkey Auth Layer
**Deadline**: 2026-10-13 (16 días)

---

## Decisiones ya tomadas por el usuario

| Decisión | Valor |
|---|---|
| Custodia (D1) | **Opción A** — el backend custodia los fondos |
| Red (D2) | **Mainnet directo** (chainId 143) |
| SDK cliente | **Preact** con alias `react`/`react-dom` |
| Credenciales | El usuario crea el app en Privy Dashboard |
| Orden | auth + gas → contratos on-chain |

---

## Verificación que cambió el plan

**`@privy-io/server-auth` está deprecado.** Los dos prompts lo usan:

> *"This package is deprecated. If you are looking for the latest features and
> support, use @privy-io/node instead."*

| paquete | versión | estado |
|---|---|---|
| `@privy-io/node` | 0.35.0 | **usar este** |
| `@privy-io/server-auth` | 1.32.5 | deprecado |
| `@privy-io/react-auth` | 3.45.0 | usar este (cliente) |
| `@privy-io/js-sdk-core` | 0.76.2 | no usar |

---

## C1 — La custodia contradice el diseño de la capa de gas

Esto es lo que bloquea.

**Lo que dice el prompt de gas:** "Privy custodia la wallet", y el código de ejemplo
hace `privy.walletApi.ethereum.sendTransaction()` — o sea, **una embedded wallet por
usuario** que firma, y el paymaster patrocina esa transacción.

**Lo que decidimos en D1 (Opción A):** el backend custodia los fondos.

**Son arquitecturas distintas.** Con la Opción A:

- El usuario **no necesita** una embedded wallet de Privy para transacciones
- Quien firma es el **backend**
- El paymaster patrocina las transacciones **del backend**, no de cada usuario
- La embedded wallet de Privy queda como **identidad**, no como custodia

La buena noticia: **es más simple de lo que parece.** "App pays" significa que la
wallet que firma no tiene MON. Con la Opción A esa wallet es la del backend, y el
paymaster la cubre igual. El modelo de costos no cambia.

**Consecuencia concreta:** `embeddedWallets.createOnLogin` debe quedar **apagado**.
Apuntar a una embedded wallet por usuario es trabajo y superficie de ataque sin uso.

---

## C2 — Alcance del Preact: isla o migración completa

El SDK de Privy es React y necesita `PrivyProvider` + hooks. Nuestro frontend es
TypeScript vanilla con un namespace `BP` y 121 tests, **incluyendo un test de paridad
de DOM** que compara el markup contra el prototipo original.

| | Isla de auth | Migración completa |
|---|---|---|
| Qué cambia | Solo el árbol de Privy monta en Preact | Toda la app pasa a componentes |
| Paridad de DOM | intacta | se rompe (JSX genera otro markup) |
| Tests | los 121 siguen valiendo | hay que reescribirlos |
| Riesgo con 16 días | bajo | alto |
| Encodeo de estado | puente de eventos hacia `Router`/`Store` | `props` |

**Mi recomendación: isla.** Se monta `preact/compat` con alias, se renderiza solo el
provider y los componentes de Privy, y un puente de eventos conecta con el
`Router` y el `Store` existentes. La UI no se toca.

---

## C3 — "Eliminar localStorage" choca con el estado actual

El prompt de passkey dice eliminar localStorage para el estado de auth. Correcto: la
cookie es httpOnly y el frontend no debe poder leerla.

Pero el prototype **vive entero** en localStorage con datos mock, y el flujo de dev
(`resetOnBoot`) depende de eso. Además solo vamos a cablear **auth** en esta pasada:
`GET /wallet` y `GET /wallet/movements` siguen mockeados.

**Propuesta: estado híbrido y explícito.**
- **Auth**: solo cookie httpOnly. El store no persiste `session` ni `userName`.
- **Resto** (saldo, movimientos, contactos): sigue en localStorage hasta que se cablee.
- El mapper marca el origen de cada campo para que la transición sea visible.

Es un estado transitorio, y conviene que sea explícito en el código y no una mezcla
silenciosa.

---

## Conflictos menores a resolver en la implementación

| # | Conflicto | Resolución propuesta |
|---|---|---|
| M1 | Cookie `session` (prompt) vs `bp_session` (código actual) | **`bp_session`** — el código ya lo usa y los tests lo fijan |
| M2 | Ambos prompts dicen "BestPath Wallet" | **ReWallet** — renombrado hace dos features |
| M3 | `MONAD_CHAIN_ID` default 10143 vs decisión de mainnet | **143**, y sin default: se falla al arrancar si falta |
| M4 | El prompt de gas pone `gas_sponsorships` como tabla nueva | **ya existe** del skeleton, solo le faltan columnas `provider`, `mode`, `error` |
| M5 | Prompt pide `gas_sponsorship_config` en DB | **Fuera.** La fase se configura por env (`GAS_PHASE`). Una tabla para un valor que ya está en el entorno es una fuente de verdad duplicada |

---

## C4 — El mapper pasó de opcional a obligatorio

Con **mainnet** y custodia en el backend, esto dejó de ser deuda técnica:

```
web.balance            number FLOAT     ←→  numeric(20,6) STRING
web.movements[].amount  number NEGATIVO ←→  SIEMPRE POSITIVO
web.movements[].at     epoch ms         ←→  createdAt ISO string
web.hasReceivedFunds   boolean          ←→  firstFundsAt timestamptz
web.userName           string           ←→  user{firstName,lastName}
web.bpTag              "@ana"          ←→  tag + tagNormalized
```

El caso de `movements[].amount` es el que más duele: la UI deduce entrada/salida
**por el signo** (`m.amount >= 0 ? '+' : '−'`) y el backend lleva la dirección en
`type`. Sin mapper, **cada envío se muestra como depósito** — y se ve perfecto.

Y `balance` en float es exactamente lo que `lib/money.ts` existe para evitar.

**Con plata real, esto no se patea.**

---

## Orden de ejecución propuesto

```
1. Mapper API ⇄ store          (desbloquea todo, es independiente)   → HECHO
2. shared/src/types/gas.ts     (provider-agnostic, seguro)           → HECHO
3. gas/{types,config}.ts + env Zod                                   → HECHO
4. Migración: columnas de gas_sponsorships                           → HECHO
5. GasService (interfaz) + getPhase/getProvider                      → HECHO
6. PrivySponsor (stub real, falla claro sin credenciales)            → HECHO
7. PimlicoSponsor (stub)                                               → HECHO
8. session.ts (create/verify/revoke)  ← ya es casi todo, falta la DB  → HECHO
9. routes/auth.ts real (6 endpoints)                                  → HECHO
10. Isla de Preact + PrivyProvider                                    → HECHO
11. Puente de eventos hacia Router/Store                              → HECHO
12. Tests de contrato                                                 → HECHO
```

Los pasos 10-12 se cerraron en `odd/tasks/wire-privy-island-mount.md` (182/182
tests, typecheck 5/5, build ok). La isla se monta desde `boot.ts` con import
dinámico y el login/logout delegan por `wire/privy.ts`, que nunca importa
Preact. Siguen mockeados `GET /wallet` y `GET /wallet/movements`: eso es la
pasada 2.

## Lo que necesito del usuario

1. **¿Isla de Preact o migración completa?** (recomiendo isla)
2. **¿Estado híbrido?** (auth por cookie, resto mock hasta cablear) — o ¿paramos y
   cableamos wallet + movements en esta misma pasada?
3. **¿Confirmás mainnet con saldo real?** Con 16 días y plata de verdad, esto cambia
   el nivel de cuidado que pongamos en idempotencia, manejo de claves y pruebas.
