# Estructura de carpetas numeradas

Este feature consiste en reorganizar las carpetas del proyecto a un esquema numerado para definir un orden claro y separado entre código de producto y contexto de laboratorio.

## Mapeo de carpetas

- `apps/api/` → `07.PockBackend`
- `apps/web/` → `05. UI-UX`
- `contexto/` → `02. Contexto iniciar del proyecto`
- `docs/auditorias/` → `03. Auditorias`
- `landing/` → `04. Landing Page`

Las carpetas restantes (`apps/`, `conteo/` vacío, `docs/` con otros subfolders, `landing/` vacío) serán eliminadas o mantenidas según corresponda después del commit.

## Objetivo

Establecer una estructura de carpetas donde los números indiquen el orden de importancia o tipo:
- 02: Contexto inicial del proyecto (diagramas, notas)
- 03: Auditorías (informes de auditoría)
- 04: Landing Page (página de aterrizaje)
- 05: UI-UX (interfaz de usuario)
- 07: PockBackend (backend principal)

Los números 01 y 06 se reservan para posibles futuros usos o fueron descartados.

## Criterios de aceptación

- Después del commit, las carpetas numeradas existen en la raíz con su contenido correspondiente.
- Las carpetas de origen están vacías o eliminadas.
- El historial de cambios muestra claramente la renombración.
- La aplicación sigue construccion y pruebas passant (se verificará post-commit).
