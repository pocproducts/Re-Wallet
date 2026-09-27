# Feature — Passkey de Privy (primera integración real)

**Feature**: `feature-passkey`
**Status**: bloqueado — esperando decisiones
**Created**: 2026-09-27
**Predecesor**: `onboarding-v2`, `design-system-v2` (cerrados)

---

## Investigación del ecosistema

### Lo que está confirmado

| Dato | Fuente | Estado |
|---|---|---|
| Privy soporta Monad como EVM | docs.privy.io — *Configuring EVM networks*: "Ethereum, Base, Polygon, Arbitrum, **Monad**, Berachain, MegaETH, Mantle, Story" | ✅ |
| Tokens de acceso: JWT ES256, 1 h de vida, refresh automático | docs.privy.io — *Tokens* | ✅ |
| Verificación server-side | `@privy-io/node` → `PrivyClient({appId, appSecret})` → `getUser({ id_token })` | ✅ |
| El server SDK es independiente del cliente | docs.privy.io — *Node.js setup* | ✅ |
| Passkeys funcionan en `localhost` | contexto seguro por definición en 127.0.0.1/localhost | ✅ |
| Hay que crear la app en el Dashboard y habilitar passkey como login method | docs.privy.io — *Configure login methods* | ✅ |

### El bloqueo: el SDK cliente es React

Los SDKs cliente oficiales de Privy son **React, React Native, Swift y Kotlin**. Nuestro
frontend es **TypeScript vanilla, sin React ni framework**. Hay una tercera vía:

`@privy-io/js-sdk-core` — cliente vanilla, pero la documentación dice textualmente:

> *"This is a low-level library and **not intended for general consumption**.*
> *Before building, please reach out to the Privy team."*

Es usable, pero es un riesgo de soporte para un hackathon con 15 días.

### El mapa de la decisión

```
                     ┌─ A) Preact con alias de react/react-dom (3KB)
                     │     y @privy-io/react-auth. SDK oficial, soportado.
                     │
  Frontend vanilla ─┼─ B) @privy-io/js-sdk-core. Funciona, pero Privy pide
                     │     hablar con su equipo antes de usarlo.
                     │
                     └─ C) SimpleWebAuthn directo, sin Privy.
                           Control total, cero vendor lock-in, pero se pierde
                           el bounty de Privy y la historia de embedded wallet.
```

---

## Consecuencia de la decisión de custodia (D1 = Opción A)

Con custodia en el backend, **la embedded wallet de Privy no se usa para los fondos**.
Privy pasa a ser solo autenticación. Eso significa:

- `embeddedWallets.createOnLogin: 'all-users'` debería quedar **apagado**
- Menos superficie de ataque, menos configuración
- Pero el bounty de "Privy integration documentada" se apoya en **passkey**, no en
  custodia de wallet. Hay que documentarlo así.

---

## Riesgos de producto que hay que decidir

### Passkey como único método de acceso

La documentación de Privy recomienda explícitamente **no usar un solo login method**:

> *"For most apps, we recommend either including alternative login options alongside
> the following, or enabling Multi-Factor Authentication... users can continue
> accessing their accounts in the event that they lose their [device]."*

Un passkey perdido o un teléfono roto = **cuenta perdida**. Para un producto de dinero
eso es serio, y es una decisión de producto, no técnica.

---

## Flujo técnico previsto

```
cliente                          backend (Hono)
────────                         ───────────────
signupWithPasskey()
  ↓ WebAuthn
  → access token (ES256, 1h)
      POST /auth/register/finish
      Authorization: Bearer <token>
                          →  PrivyClient.getUser({id_token})
                          →  { privyDid, linkedAccounts }
                          →  transacción:
                             · upsert users (privyDid UNIQUE)
                             · allocateTag(firstName)   ← el server, no el cliente
                             · create wallet
                             · create session (token hasheado)
                          →  Set-Cookie: bp_session (httpOnly, SameSite=Lax)
      GET /me
      Cookie: bp_session
                          →  resuelve session → user + wallet + yieldSummary
```

El cliente nunca ve la key. El tag lo aloca el servidor. Eso es exactamente
`apps/api/src/services/tag.ts`, que ya está escrito y testeado.

---

## Tareas (bloqueadas)

- [ ] B1 — Crear app en Privy Dashboard, obtener App ID + App Secret
- [ ] B2 — Decidir el camino del SDK cliente (A / B / C)
- [ ] B3 — Instalar y configurar el SDK elegido
- [ ] B4 — `services/privy.ts`: `PrivyClient` + `getUser` + `createUser`
- [ ] B5 — `POST /auth/register/finish` real
- [ ] B6 — `GET /me` real
- [ ] B7 — Mapper API ⇄ store (los 6 mismatches que encontré)
- [ ] B8 — Sesión por cookie, cierre de sesión
- [ ] B9 — Tests de contrato

## El mapper (B7) es innegociable

La UI y el backend hoy **no hablan el mismo idioma**:

```
web.balance            number FLOAT   ←→   numeric(20,6) STRING
web.movements[].at     epoch ms      ←→   createdAt ISO string
web.movements[].amount number, NEGATIVO ←→   SIEMPRE POSITIVO
web.hasReceivedFunds   boolean       ←→   firstFundsAt timestamptz
web.userName           string       ←→   user{firstName,lastName}
web.bpTag              "@ana"       ←→   tag + tagNormalized
```

El caso de `movements[].amount` es el peligroso: la UI deduce entrada/salida **por el
signo** (`m.amount >= 0 ? '+' : '−'`), y el backend dice que el signo va en `type`. Sin
mapper, **cada envío se muestra como depósito** — y se ve perfecto.
