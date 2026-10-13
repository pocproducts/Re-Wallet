# Feature: Nueva landing estática (diseño "liquid glass / 3D carousel")

## Objetivo
Reemplazar la landing Next.js por el diseño estático provisto por el usuario (hero con texto gigante, carrusel 3D, cards chunky-clay, GSAP).

## Decisiones
- Adaptación de identidad: copy ReWALLET en español, bronce #a25f28 → neón de marca #ccff00, cards con gradientes abstractos (sin imágenes externas ajenas).
- Navbar: links ancla Producto/Rendimiento/Seguridad + CTA "Entrar a la app" → https://beta.rewallet.win.
- La landing Next vieja queda en `04. Landing Page/legacy/` (en desuso, conservada).
- La nueva vive en `04. Landing Page/site/`, estática, sin build.

## Estado
- [x] index.html / styles.css / main.js creados
- [x] README reescrito con deploy (`wrangler pages deploy site --project-name=rewallet-landing --branch=main`)
- [x] Deploy a producción verificado: https://rewallet.win sirve el nuevo contenido

## Aprendizaje
- `wrangler pages deploy` sin `--branch=main` queda como preview (alias por rama); el dominio custom siguió sirviendo la landing vieja hasta redeployar con `--branch=main`.
