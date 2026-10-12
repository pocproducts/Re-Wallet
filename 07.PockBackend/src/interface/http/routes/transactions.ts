/**
 * GET /api/transactions
 *
 * Returns the authenticated person's financial transaction history.
 *
 * ── Why this endpoint exists ────────────────────────────────────────────────
 *
 * Antes de este endpoint, el ActivityView mostraba solo datos de prueba o estado vacío.
 * Ahora muestra movimientos financieros reales del historial del usuario, permitiéndoles
 * ver cada ingreso y egreso de dinero.
 *
 * La lista de transacciones se construye a partir de eventos de webhook, filtrando aquellos
 * que representan movimientos reales de dinero y convirtiéndolos al formato esperado por
 * el ActivityView.
 *
 * ── Formato de respuesta ─────────────────────────────────────────────────────────
 *
 * Las respuestas exitosas (200) tienen la forma:
 *   { transactions: { id, title, date, amount, isPositive, type, concept?, expiresAt?, qrPayload? }[] }
 *
 * El array está ordenado de más nuevo a más antiguo, con una longitud máxima de
 * TRANSACTIONS_PAGE_SIZE (50) para evitar respuestas ilimitadas.
 *
 * ── Respuestas de error ─────────────────────────────────────────────────────────
 *
 * - 401 UNAUTHENTICATED: no hay cookie de sesión válida
 * - 502 TRANSACTIONS_UNAVAILABLE: no se pudieron leer las filas de transacciones del almacén
 */
import type { GetTransactions } from '../../application/transactions/getTransactions';
import type { SessionCodec } from '../../domain/ports/session-codec';
import { SESSION_COOKIE_NAME } from './cookie';
import { recordingLogger } from '../support/fixtures';
import type { Logger } from '../../domain/ports/logger';

export interface TransactionRouteDeps {
  readonly sessions: SessionCodec;
  readonly getTransactions: GetTransactions;
  readonly cookieName?: string;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createTransactionsoRoutes = (deps: TransactionRouteDeps) => {
  const log = deps.log ?? console;
  const app = new Hono();

  app.get('/', async (c) => {
    const sessionCookie = c.req.header('Cookie') ?? '';
    const token = sessionCookie
      .split('; ')
      .find((pair) => pair.startsWith(`${deps.cookieName ?? SESSION_COOKIE_NAME}=`))
      ?.split('=')[1];

    if (!token) {
      return c.json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    }

    let privyDid: string | null = null;
    try {
      const session = await deps.sessions.read(token);
      privyDid = session?.privyDid ?? null;
    } catch (err) {
      log.error('GET /transactions could not read session', err);
      return c.json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    }

    if (!privyDid) {
      return c.json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    }

    try {
      const response = await deps.getTransactions(privyDid);
      return c.json(response, 200);
    } catch (err) {
      if (err instanceof Error && err.name === 'TransactionsUnavailable') {
        log.error('GET /transactions could not read transaction rows', err.cause);
        return c.json({ error: { code: 'TRANSACTIONS_UNAVAILABLE' } }, 502);
      }
      log.error('GET /transactions unexpected error', err);
      return c.json({ error: { code: 'INTERNAL' } }, 500);
    }
  });

  return app;
};