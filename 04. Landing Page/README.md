# ReWALLET — Landing Page

Landing pública de [ReWALLET](https://rewallet.win): una cuenta en dólares digitales
para ahorrar, enviar y hacer rendir el dinero sin aprender cripto.

## Estructura

- `site/` — la landing vigente: HTML/CSS/JS estático puro (GSAP por CDN). Sin build.
- `legacy/` — la landing anterior (Next.js), **en desuso** desde octubre 2026. Se
  conserva solo como referencia de copy/diseño.

## Desarrollo

No hay build: servir `site/` con cualquier servidor estático:

```bash
cd site
python3 -m http.server 3000
```

En `http://localhost:3000`.

## Deploy

```bash
wrangler pages deploy "04. Landing Page/site" --project-name=rewallet-landing
```

El dominio de producción es `rewallet.win` (custom domain del proyecto de Pages).
