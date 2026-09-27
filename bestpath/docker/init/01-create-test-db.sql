-- La base que los tests de integración pueden escribir.
--
-- Existe por una razón concreta: hasta ahora `pnpm --filter @bestpath/api test`
-- leía `DATABASE_URL` del `.env` del repo, que apunta a la rama `production` de
-- Neon, e insertaba usuarios falsos ahí (4 el 2026-09-27, con DIDs `did:e2e:*`
-- y wallets que no existen en Privy).
--
-- La guarda vive en `apps/api/tests/helpers/testDb.ts`: un test de integración
-- solo abre una base cuyo NOMBRE dice que es descartable. Crearla a mano cada vez
-- era un paso que alguien iba a saltear; este script la deja lista con el mismo
-- `docker compose up -d` que ya levanta Postgres.
--
-- Escala por convención de nombre, no por configuración: el nombre es la
-- declaración, y declararla es la parte que evita el error.

CREATE DATABASE bestpath_test;
