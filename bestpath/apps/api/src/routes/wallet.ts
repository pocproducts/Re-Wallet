import { Hono } from 'hono';
import type { Env } from 'hono';
import { zValidator, type Hook } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireIdempotencyKey } from '../middleware/idempotency';
import { badRequest, internal, notImplemented } from '../lib/errors';
import { movements } from '../db/schema';
import { getYieldPosition } from '../services/aave';
import type { AppEnv } from '../types/context';

/**
 * TODO(feature: send) — the three money routes below are the ones that must
 * call findReplay() first and remember() after, so a retry replays the stored
 * response instead of moving money twice.
 */

/** Movement `type` is `text` in the DB, not an enum. These are the only values the contract allows. */
const movementType = z.enum(['deposit', 'send', 'receive', 'yield']);
const movementStatus = z.enum(['pending', 'completed', 'failed']);

/**
 * `meta` is free-form jsonb (txHash, recipient, failureReason, ...). The shape is
 * not ours to define, so it passes through as an object — but an array or a
 * string in there is corruption, not a variation, and is treated as such.
 */
const movementMeta = z.record(z.string(), z.unknown());

/**
 * Why a bad row fails the whole page instead of being coerced.
 *
 * `type` is the only thing carrying the direction of a movement, and the
 * frontend rebuilds the sign from it. An unrecognised `type` reaching the client
 * renders as something plausible and wrong — a send that looks like a deposit
 * looks perfect, which is the most expensive bug in this repo. A 500 with a log
 * line is loud and harmless next to that.
 */
function toMovementItem(row: {
  id: string;
  type: string;
  amount: string;
  title: string;
  status: string;
  meta: unknown;
  createdAt: Date;
}) {
  const type = movementType.safeParse(row.type);
  const status = movementStatus.safeParse(row.status);
  const meta = movementMeta.safeParse(row.meta);
  if (!type.success || !status.success || !meta.success) throw internal('Error interno.');
  return {
    id: row.id,
    type: type.data,
    // Passed through EXACTLY as stored, sign included (which is always +).
    // Direction lives in `type`, never in this number, and the frontend mapper
    // is the one place allowed to put the minus sign back. Negating here
    // instead would double-flip once the mapper runs, and the failure mode is
    // invisible: the rows still render, just with the wrong arrow.
    amount: row.amount,
    title: row.title,
    status: status.data,
    createdAt: row.createdAt.toISOString(),
    meta: meta.data,
  };
}

/**
 * Opaque keyset cursor: base64url of `${createdAt.toISOString()}|${id}`.
 *
 * The client is not meant to read it, only to hand it back. base64 is not
 * secrecy — it just keeps the tuple out of the URL bar and out of the
 * frontend's notion of what a movement looks like.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

/** Returns null for anything we did not mint. A malformed cursor is a client bug, not a crash. */
function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  const sepAt = (() => {
    try {
      // base64url decoding is lenient: it drops invalid characters instead of
      // throwing, so a bad cursor survives to the structural checks below.
      return Buffer.from(raw, 'base64url').toString('utf8').indexOf('|');
    } catch {
      return -1;
    }
  })();
  if (sepAt < 1) return null;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const createdAt = new Date(decoded.slice(0, sepAt));
  const id = decoded.slice(sepAt + 1);
  if (Number.isNaN(createdAt.getTime()) || !UUID_RE.test(id)) return null;
  return { createdAt, id };
}

const movementsQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Same shape of failure as every other error in the app.
 *
 * zValidator's default hook answers with its own `{ success: false }` body,
 * which would make this the one route in the API that does not speak the
 * documented envelope — a client parsing errors would need a special case here.
 */
const rejectInvalidQuery: Hook<z.infer<typeof movementsQuery>, Env, string, 'query'> = (result) => {
  if (result.success) return;
  const issue = result.error.issues[0];
  throw badRequest(
    'validation_failed',
    `${issue?.path.join('.') || 'query'}: ${issue?.message ?? 'valor inválido'}`,
  );
};

export const walletRoutes = new Hono<AppEnv>()
  // PUBLIC, and registered BEFORE requireAuth() on purpose: in Hono, `use()`
  // only guards handlers registered after it. This is the /pay/{id} link — the
  // whole point is that it resolves with no session.
  .get('/request/:id', zValidator('param', z.object({ id: z.string().min(1) })), (c) =>
    c.json({ ok: true as const, data: { request: null } }),
  )
  .use(requireAuth())

  /**
   * The ON-CHAIN position: what the wallet actually holds, read from Monad.
   *
   * WHY A SEPARATE ROUTE, and not extra fields on `GET /wallet`
   *
   * Two different truths, and conflating them is how a wallet app starts lying
   * to people:
   *
   *   - `GET /wallet` is the LEDGER: our record of what we believe happened.
   *     Fast, always available, and the source for the activity list.
   *   - this route is the CHAIN: the aUSDC that is earning and the USDC that is
   *     idle in the same wallet. Slower, and it can fail while the ledger is fine.
   *
   * The headline number the user sees must be the chain, because that is where
   * the money is. If the two ever disagree, the ledger is the thing that is
   * wrong — and the fix is a reconciliation, not a nicer display.
   *
   * `earning` and `available` are SEPARATE on purpose. Showing only the aUSDC
   * would hide money that is in the wallet but not earning, which reads as a
   * product that works better than it does.
   *
   * All amounts are 6-decimal strings, never numbers. Same rule as everywhere
   * else: a float cannot hold `numeric(20,6)`.
   */
  .get('/position', async (c) => {
    const actor = c.get('actor');
    try {
      const position = await getYieldPosition(actor.address as `0x${string}`, c.get('env'));
      return c.json({
        ok: true as const,
        data: {
          wallet: actor.address,
          // Earning: deposited in the Aave market.
          earning: (position.aTokenUnits / 1_000_000n).toString() + '.' +
            (position.aTokenUnits % 1_000_000n).toString().padStart(6, '0'),
          // Available: in the wallet, not earning.
          available: (position.idleUsdcUnits / 1_000_000n).toString() + '.' +
            (position.idleUsdcUnits % 1_000_000n).toString().padStart(6, '0'),
          total: position.total,
          aToken: position.aTokenAddress,
          usdc: position.usdcAddress,
          readAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      // A chain read that fails must not become a 500 with a stack trace in the
      // log and a generic message to the user. The ledger is still readable, so
      // the app keeps working with a clearly-marked "sin verificar" position
      // rather than pretending the account does not exist.
      const log = c.get('log');
      log.warn({ err, walletId: actor.walletId }, 'on-chain position unreadable');
      return c.json(
        {
          ok: false as const,
          error: 'position_unavailable',
          message: 'No pudimos leer tu saldo en la red. Intentá de nuevo en un momento.',
          code: 503,
        },
        503,
      );
    }
  })

  /**
   * Served entirely from the actor that requireAuth already resolved.
   *
   * The tempting version opens a second query for the same row. That is one
   * extra round trip on the hottest read in the app, to re-read data that
   * arrived milliseconds ago in the same request — and it introduces a window
   * where the balance and the movements on the next screen disagree. The actor
   * carries `balance`, `address` and both timestamps precisely so this route
   * stays a pure projection of what the session lookup already proved.
   *
   * `balance` crosses the wire as the raw numeric(20,6) string. It is never
   * parsed to a number on the way out; a float cannot hold 20 digits of
   * precision and this is money.
   */
  .get('/', (c) => {
    const actor = c.get('actor');
    return c.json({
      ok: true as const,
      data: {
        id: actor.walletId,
        address: actor.address,
        balance: actor.balance,
        currency: 'USD' as const,
        firstFundsAt: actor.firstFundsAt?.toISOString() ?? null,
        yieldStartedAt: actor.yieldStartedAt?.toISOString() ?? null,
      },
    });
  })

  /**
   * Keyset pagination over movements_wallet_created_idx, newest first.
   *
   * Offset pagination drifts on a table the user appends to: a new movement
   * between two page fetches shifts every row by one and the client either
   * repeats or drops one. Keyset anchors the page on the last row already seen,
   * so the list is stable no matter what arrives in the meantime. That is why
   * the tiebreak is `id` and not nothing: two movements in the same transaction
   * can share a timestamp, and without a total order the boundary row is
   * ambiguous.
   *
   * Scope is the actor's walletId, never a userId from the query string. The
   * client does not get to name whose movements it reads.
   */
  .get('/movements', zValidator('query', movementsQuery, rejectInvalidQuery), async (c) => {
    const { cursor, limit } = c.req.valid('query');
    const actor = c.get('actor');
    const log = c.get('log');

    const after = cursor === undefined ? null : decodeCursor(cursor);
    if (cursor !== undefined && after === null) {
      throw badRequest('invalid_cursor', 'Cursor inválido.');
    }

    // One extra row is how "is there a next page?" is answered: counting is a
    // second query we do not need, and the extra row is never returned.
    const rows = await c
      .get('db')
      .select({
        id: movements.id,
        type: movements.type,
        amount: movements.amount,
        title: movements.title,
        status: movements.status,
        meta: movements.meta,
        createdAt: movements.createdAt,
      })
      .from(movements)
      .where(
        and(
          eq(movements.walletId, actor.walletId),
          after === null
            ? undefined
            : or(
                lt(movements.createdAt, after.createdAt),
                and(eq(movements.createdAt, after.createdAt), lt(movements.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(movements.createdAt), desc(movements.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    let items: ReturnType<typeof toMovementItem>[];
    try {
      items = page.map(toMovementItem);
    } catch (err) {
      // The row is the evidence and the id is the only handle the log will ever
      // get, so it goes in before the generic 500 does.
      log.error({ err, walletId: actor.walletId }, 'movement row outside the contract');
      throw err;
    }

    // The next cursor points at the last row WE returned, not at the extra
    // probe row. Pointing at the probe is the classic off-by-one: the client
    // would refetch the row it already has.
    const last = hasMore ? page[limit - 1] : undefined;
    return c.json({
      ok: true as const,
      data: {
        items,
        cursor: last ? encodeCursor(last.createdAt, last.id) : null,
      },
    });
  })

  // ── The three money routes, and why they answer 501 ───────────────────────
  //
  // They used to answer `200 { ok: true, data: { address: null, … } }`. A 200
  // with nulls is the same lie the frontend mock told, from the other side: the
  // client cannot tell "it worked and there is nothing here" from "this does not
  // exist yet", and a client that cannot tell will invent the rest. That is
  // exactly what happened — the deposit flow took the 200, added the amount to
  // the balance on screen and wrote a movement, so a user could watch their
  // balance grow by pressing "Recibir".
  //
  // `notImplemented` is already in `lib/errors.ts` and is the honest answer: a
  // 501 the client can branch on, and a message that says what is missing.
  // Signing is the hard part (TEE, gas, idempotency); a null is not a prototype
  // of it, it is a hole with a success code on it.
  .post('/deposit-intent', requireIdempotencyKey(), (c) => {
    void c;
    throw notImplemented('la/intención de depósito: hace falta firmar y pagar el gas');
  })
  .post('/send', requireIdempotencyKey(), (c) => {
    void c;
    throw notImplemented('el envío: hace falta firmar con la TEE y registrar el movimiento');
  })
  .post('/request', requireIdempotencyKey(), (c) => {
    void c;
    throw notImplemented('la solicitud de pago: falta crearla y exponerla por tag');
  });
