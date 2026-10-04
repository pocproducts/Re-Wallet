/**
 * `GET /api/deposit-info` — qué se puede recibir en esta cuenta, en qué red y con
 * qué dirección **de esta persona**.
 *
 * ── El contrato ───────────────────────────────────────────────────────────────
 *
 * ```json
 * {
 *   "generatedAt": "2025-01-01T00:00:00.000Z",
 *   "networks": [
 *     { "chain": "monad", "label": "Monad", "evmNetwork": "eip155:143",
 *       "hasWallet": true, "address": "0x…",
 *       "assets": [{ "symbol": "MON", "name": "Monad", "decimals": 18,
 *                    "native": true, "token": null, "balanceReadable": true }] },
 *     { "chain": "solana", "label": "Solana", "evmNetwork": null,
 *       "hasWallet": false, "assets": [ … ] }
 *   ]
 * }
 * ```
 *
 * ── Por qué esta ruta existe y el catálogo no viaja al front ─────────────────
 *
 * El catálogo —qué redes, qué activos, qué contrato— vive en el **servidor**
 * (`src/domain/deposit/catalog.ts`). La razón no es puramente de arquitectura: la
 * verdad de "se puede recibir USDC en Monad" la sabe el que puede verificar el
 * contrato en la cadena, y una lista en el cliente tendría además activos que el
 * producto todavía no ofrece. El front no lleva ninguna lista de depósito: pide
 * esta ruta y dibuja lo que viene.
 *
 * ── Por qué nada en el pedido se lee ─────────────────────────────────────────
 *
 * Sin `address`, sin `chain`, sin cuerpo, sin query. La dirección sale de
 * `rewallet.wallets` para el usuario que la cookie probó, así que el conjunto de
 * cuentas que esta ruta puede describir es exactamente el conjunto de carteras
 * que la persona tiene. Una ruta que tomara una dirección podría preguntarse por
 * el saldo de otra, y "lo ignoramos" es una propiedad mucho mejor que "lo
 * validamos".
 *
 * ── Por qué los códigos de estado son los del resto ──────────────────────────
 *
 * 401: no hay cookie, o la cookie no verifica. No se leyó nada.
 * 502 `WALLETS_UNAVAILABLE`: las filas no se pudieron leer, así que no hay
 * ninguna dirección que resolver y **ninguna** red tiene una verdad que
 * reportar. Eso es una petición fallida, no una parcial: un 200 con todas las
 * redes en `hasWallet: false` sería una mentira sobre la cuenta de alguien.
 */
import { Hono } from 'hono';

import type { ReadDepositInfo } from '../../../application/deposit-info/readDepositInfo';
import { WalletsUnavailable } from '../../../application/portfolio/readPortfolio';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import type { SessionCodec } from '../../../domain/ports/session-codec';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../cookie';
import { UNAUTHENTICATED_BODY } from './auth';

/** El mismo 502 que el portfolio, con el mismo motivo y la misma lectura. */
export const WALLETS_UNAVAILABLE_BODY = { error: { code: 'WALLETS_UNAVAILABLE' } } as const;

export interface DepositInfoDeps {
  readonly sessions: SessionCodec;
  readonly readDepositInfo: ReadDepositInfo;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createDepositInfoRoutes = (deps: DepositInfoDeps) => {
  const app = new Hono();
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME;
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.get('/', async (c) => {
    // La misma puerta que `GET /api/portfolio`: misma cookie, mismo codec, mismo 401.
    const presented = readSessionCookie(c.req.header('cookie'), cookieName);
    if (presented === null) return c.json(UNAUTHENTICATED_BODY, 401);

    const claims = await deps.sessions.read(presented, clock());
    if (claims === null) return c.json(UNAUTHENTICATED_BODY, 401);

    try {
      const info = await deps.readDepositInfo(claims.userId);
      return c.json({ generatedAt: clock().toISOString(), networks: info.networks }, 200);
    } catch (error) {
      if (error instanceof WalletsUnavailable) {
        log.error('GET /deposit-info could not read the wallet rows', error);
        return c.json(WALLETS_UNAVAILABLE_BODY, 502);
      }
      // Lo demás es nuestro y no es una respuesta para esta persona.
      throw error;
    }
  });

  return app;
};
