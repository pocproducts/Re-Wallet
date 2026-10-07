# ReWALLET — Landing Page

Landing pública de [ReWALLET](https://rewallet.win): una cuenta en dólares digitales
para ahorrar, enviar y hacer rendir el dinero sin aprender cripto.

## Stack

- Next.js 16 con `output: 'export'` (static export, sin runtime de servidor)
- Tailwind CSS
- Framer Motion
- Cloudflare Pages (proyecto `rewallet-landing`)

## Desarrollo

```bash
pnpm install
pnpm dev
```

En `http://localhost:3000`.

## Build

```bash
pnpm build
```

Genera el sitio estático en `out/`.

## Deploy

```bash
pnpm build
wrangler pages deploy out --project-name=rewallet-landing
```

El dominio de producción es `rewallet.win` (custom domain del proyecto de Pages).

## Idioma

El copy vive centralizado en `components/language-provider.tsx` con tres locales:
`es` (default), `en` y `pt`. Para cambiar textos de la landing se edita ese archivo,
no los componentes.
