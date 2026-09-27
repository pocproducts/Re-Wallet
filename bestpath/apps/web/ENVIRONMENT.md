# Variables de entorno del frontend (`apps/web`)

Vite las lee **en build time**: cambiarlas exige reiniciar `pnpm dev` o rebuildear.

## Abrí siempre en `localhost`, nunca en `127.0.0.1`

No es preferencia: **el login no funciona en la IP literal.** Privy valida el
`origin` del browser contra su allowlist y rechaza IPs, así que
`http://127.0.0.1:5173` muere con

```
SecurityError: 127.0.0.1 is an invalid domain
```

antes de llegar a WebAuthn. `http://localhost:5173` llega al pedido de huella.
Los dos resuelven al mismo socket; lo que difiere es el string que el browser
pone en `window.location.origin`, y ese string es lo que Privy lee.

Vale para cualquier origen: en el deploy, el dominio tiene que estar en la
allowlist del dashboard de Privy.


> `apps/web/.env.example` no se versiona en este repo (el harness de desarrollo
> bloquea escribir paths `.env*`). Los valores viven en `apps/web/.env.local`,
> que ya está en `.gitignore`.

## `VITE_PRIVY_APP_ID`

App ID de Privy — Dashboard ▸ *Settings* ▸ *Basics*.

Vacío = la isla de passkey **no se monta** y el login queda en modo mock local
(el camino que usan los 172 tests). Con el valor puesto, `boot.ts` monta la isla
y `data-action="biometric"` delega la ceremonia real en Privy.

## `VITE_API_BASE_URL`

Base del API de ReWallet. **Vacío = same origin**, que es lo normal en
desarrollo con el proxy de Vite. Solo poné un origen absoluto si el API vive en
otro host.

## Lo que nunca va acá

Ni el token de Privy, ni `PRIVY_VERIFICATION_KEY`, ni nada de la API. La sesión
es una cookie **httpOnly** emitida por el backend: el frontend no la ve nunca, y
`wire/privy.ts` corre una auditoría que rechaza cualquier patch al store que
huela a credencial.

## Bloque listo para pegar en `.env.local`

```dotenv
VITE_PRIVY_APP_ID=
VITE_API_BASE_URL=
```
