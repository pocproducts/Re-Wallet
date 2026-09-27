# ADR-001 — Custodia de fondos

**Estado**: propuesto, esperando firma
**Fecha**: 2026-09-27
**Contexto**: Metropolis, track *Consumer Products & Payments*, cierre 13/10/2026 (16 días)
**Relacionado**: D1 (custodia = backend), peldaños 1, 2 y 5 de `odd/tasks/app-functional-ladder.md`

---

## Contexto

D1 ya está decidido: **el backend custodia los fondos**. En esa decisión, Privy quedó
como proveedor de identidad y la embedded wallet quedó **apagada**
(`embeddedWallets.createOnLogin: 'off'`), porque una wallet en el browser para una app
que nunca firma del lado del cliente es superficie de ataque sin uso.

El bloqueo concreto es `getWalletForUser`, que tira `TODO(feature: passkey)`. Sin él,
`POST /auth/register/finish` responde 500 y no existe cuenta, ni billetera, ni
depósito, ni yield. Es el critical path completo.

Metropolis tiene un bounty de sponsor de **Privy**, y el track pondera literalmente
*"a user's first five minutes"* y que *"the chain stays invisible"*. Eso pesa en las
dos direcciones: premia la integración profunda de Privy, y castiga cualquier decisión
deDeFi visible en pantalla.

## Decisión

**Una wallet creada desde nuestro backend, en TEE, con el dueño en un quórum 2-de-2:
el passkey del usuario más una authorization key de nuestro server.
`createOnLogin` sigue apagado.**

## Por qué esta

1. **No contradice D1 ni el trabajo hecho.** No hay que revertir la decisión de la
   isla, ni la nota de seguridad, ni la regla de que el store nunca toca una clave.
2. **El usuario es co-dueño sin que exista una clave en ningún lado.** El passkey es
   la mitad del usuario; la authorization key vive en nuestro server; el TEE exige
   ambas firmas. Consecuencias reales: **recuperación** (si caemos, el passkey sigue
   siendo dueño) y **story** ("el usuario es dueño, siempre"), que es lo primero que
   un judge pregunta.
3. **El server es un factor, no el dueño único.** La custodia pura de servidor es más
   simple pero deja al usuario sin appeal si el proveedor o nosotros caemos.
4. **Es bounty.** Privy paga integraciones, y ya somos usuarios de Privy para auth.

## Una puerta de un solo sentido

**Cambiar el dueño de una wallet no es un cambio, es una migración.** Después de
emitir wallets, cada usuario tiene dueño, quórum y policies; rehacer eso es un
proyecto, no un refactor. Por eso la decisión se toma ahora y no en la semana del
demo. Está escrita acá justamente para que quede explícita.

## División de responsabilidades

| Dominio | Dueño | Por qué |
|---|---|---|
| Identidad, passkey, llaves | **Privy** | ya integrado, TEE, bounty |
| Yield | **Aave USDC en Monad, leído directo del pool** | la tasa es pública y gratis; es la historia del ecosistema |
| Gas | **nuestra capa de patrocinio** | ya cableada |

**Una sola fuente de yield en la primera instancia.** Un selector de tasas es
exactamente la decisión que el track dice que debe ser invisible, y encima la vía de
Privy para Aave es *sales-gated* ("contact sales@privy.io") sobre vaults ERC-4626 con
endpoints `earn/ethereum/*`: no es una opción, es una dependencia comercial. El
segundo proveedor entra después detrás de una interfaz `YieldStrategy`, no ahora.

## Qué NO hacemos, y por qué

- **Wallet embedded del usuario + signer.** Reintroduce la wallet en el browser y
  contradice D1.
- **Cifrado con master key en env.** La peor de las opciones: una filtración
  compromete a todos, sin audit trail. Con plata real es un incidente, no un atajo.
- **KMS propio ahora.** Es lo correcto para producción y lo imposible para 16 días:
  key management es un proyecto entero.
- **RPC de Privy para Monad.** No existe: Monad hay que configurarlo a mano
  (`supportedChains`) y el RPC lo ponemos nosotros.

## Riesgos aceptados

| Riesgo | Mitigación |
|---|---|
| Dependencia de Privy | la decisión vive detrás de `CustodyProvider` |
| Nuestro server custodia una authorization key P-256 | es una decisión de seguridad, asumida y anotada |
| Privy TEE es one-way para wallets on-device | no creamos ninguna, así que no aplicamos |
| Costo de Privy escala con uso | reevaluar antes de 100k transacciones/mes |

## Ruta de salida

Migrar a KMS o a ERC-4337 es **cambiar una implementación de `CustodyProvider`**, no
reescribir el producto. Por eso la interfaz se define antes que la primera
implementación.

## Abierto antes de implementar

1. **Dashboard de Privy**: crear la authorization key y las policies. Es acción del
   usuario, no del código.
2. **Forma exacta de `owner` / `owner_id` al crear la wallet desde el server.** Las
   primitivas existen y están en el SDK instalado (`client.wallets.create` acepta
   `chain_type`, `owner_id`, `owner`, `additional_signers`, `policy_ids`,
   `external_id` y `privy-idempotency-key`), pero la forma concreta del quórum hay que
   resolverla **contra la API real**, no de memoria.
3. **Si el 2-de-2 no se puede crear por API**, el fallback es dueño-solo-servidor, y
   queda como deuda anotada.

## Nota de implementación que ya se conoce

`wallets.create` acepta `privy-idempotency-key`. Hay que usarlo (por ejemplo, el id
de nuestro usuario): sin eso, un reintento de registro crea **dos** wallets, y como
`wallets.address` es única, el segundo intento muere con un 500 — el mismo patrón del
tag hardcodeado que el E2E encontró.
