# Feature — Cablear el REGISTRO con passkey

**Feature**: `wire-passkey-register`
**Status**: en curso
**Created**: 2026-09-27
**Predecesor**: `wire-privy-island-mount`, `feature-passkey`

---

## El bug

Ningún usuario nuevo puede registrarse. **En ningún dispositivo.**

La isla de Privy solo expone autenticación:

```ts
import { PrivyProvider, useLoginWithPasskey, useLogout, usePrivy } from '@privy-io/react-auth';
// ...
login: () => loginWithPasskey(),
```

No hay ceremonia de registro en ninguna parte. Y `actions/index.ts:55` llama
siempre `requestPrivyLogin()`, ignorando el `mode` que lee dos líneas más arriba:
`mode` solo lo usa la rama del mock que queda debajo del `return`.

## La cadena del fallo

1. El usuario toca "Usar Face ID" en el onboarding (`data-mode="onboarding"`).
2. La acción llama a `requestPrivyLogin()` → `loginWithPasskey()`.
3. WebAuthn busca una credencial **existente** para `rewallet.win`. No hay
   ninguna, porque nunca se pudo crear → `NotAllowedError`.
4. Privy lo reporta como `passkey_not_allowed`.
5. Nunca se llega a `/auth/register/finish`.

## Evidencia (medida, no inferida)

| Comprobación | Resultado |
|---|---|
| `usuarios` en Neon | **0 filas** |
| `wrangler tail` durante el intento | solo `GET /api/auth/session` → 401. Nunca un `register/finish` ni un `login/finish` |
| Consola del navegador | `[rewallet] privy (login) passkey_not_allowed` |

El fallo es íntegramente client-side, antes de tocar nuestra API. Por eso el
celular no deja confirmar la ceremonia: no hay credencial contra la que confirmar.

## Lo que YA está bien y no se toca

- `POST /auth/register/finish` existe, valida el token, crea usuario y wallet en
  UNA transacción, y devuelve 409 `already_registered` si el DID ya existe.
- El bloque de `wire/privy.ts` que llama a `register/finish` ya tiene el
  fallback correcto: ante `already_registered` cae a `login/finish`.

Es código muerto en la práctica: nunca recibe un token, porque el token hay que
pedirlo con una ceremonia de registro que no existe. **Este trabajo es
conectar esa pieza, no reescribir el backend.**

## Lo que hay que hacer

1. **La isla** (`wire/privy-island.tsx`): importar `useSignupWithPasskey` y
   exponer `register` en el `PrivyIslandHandle`.
2. **El puente** (`wire/privy.ts`): extender `PrivyIslandHandle` con `register` y
   agregar `requestPrivyRegister`, espejo de `requestPrivyLogin`.
3. **La acción** (`actions/index.ts`): respetar `mode` — `onboarding` registra,
   `login` autentica.
4. **Tests** (`scripts/privy-island.test.ts`): el contrato de que `mode`
   determina qué ceremonia se pide, y que sin isla sigue el mock.

## Verificado antes de escribir

- El hook se llama **`useSignupWithPasskey`**, NO `useRegisterWithPasskey`. La
  firma es `(callbacks?: PrivyEvents["login"]) => UseSignupWithPasskey`, y el
  retorno expone `signupWithPasskey` y `state`. Exportado en
  `@privy-io/react-auth@3.45.0`.
- El markup ya tiene el discriminante: `passkey.ts:29-30` usa
  `data-mode="login"` y `passkey.ts:50-51` usa `data-mode="onboarding"`.

## La decisión que este trabajo NO toma

Que la ceremonia de registro reutilice el `onComplete` de login o tenga el suyo.
Ambas ceremony expusan `getAccessToken()` y el intercambio es idéntico
(`exchangePrivyToken`). Si se duplica ese bloque, el día que cambie el
intercambio habrá que cambiarlo en dos lugares; si se extrae, hay un solo lugar.
Se extrae, salvo que el worker descubra una razón concreta para no hacerlo.
