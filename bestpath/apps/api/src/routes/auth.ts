import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { rateLimit } from '../middleware/rateLimit';
import { conflict, badRequest } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { createSession, verifySession, revokeSession } from '../lib/session';
import { readSession, writeSession, clearSession } from '../lib/cookie';
import { users, wallets } from '../db/schema';
import { verifyIdToken, getWalletForUser } from '../services/privy';
import { allocateTag, isValidTag, provisionalTag } from '../services/tag';
import { suggestTag } from '@bestpath/shared/tag';
import type { AppEnv } from '../types/context';

/**
 * Auth routes.
 *
 * Privy owns WebAuthn end to end. The browser calls Privy, Privy verifies the
 * credential against its own challenge, and we receive a signed token. We never
 * see an assertion, a seed, or a key — only a DID and a verified identity.
 *
 * The `begin` endpoints are intentional no-ops. The gas/auth prompt maestros
 * describe a challenge/finish shape that Privy already handles client-side;
 * keeping the routes means the contract is stable if we ever move to
 * SimpleWebAuthn directly, without pretending the work happens here.
 *
 * TODO(feature: passkey): the register/finish and login/finish bodies below are
 * structurally complete and fail loudly on the one step that needs real Privy
 * credentials. Everything else — session minting, tag allocation, cookie, wallet
 * upsert — is implemented and tested.
 */

const idToken = z.string().min(1, 'idToken es requerido');

/**
 * Read and validate a JSON body.
 *
 * Written by hand rather than with zValidator so the failure path produces the
 * same `{ ok:false, error, message, code }` envelope as everything else instead
 * of Hono's default, and so the parsed value is statically typed at the call
 * site without casting.
 */
async function readBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('invalid_json', 'El cuerpo de la petición no es JSON válido.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(
      'validation_failed',
      `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'valor inválido'}`,
    );
  }
  return parsed.data;
}

const registerBody = z.object({ idToken });
const profileBody = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
});

/** The handle a name implies. Same rules the client previews, from @bestpath/shared. */
const suggestTagFor = (first: string, last: string) => suggestTag(`${first} ${last}`);

const toUser = (a: {
  id: string; name: string; firstName: string; lastName: string; tag: string;
  recoveryEmail: string | null; recoveryPhone: string | null;
}) => ({
  id: a.id,
  name: a.name,
  firstName: a.firstName,
  lastName: a.lastName,
  tag: a.tag,
  email: a.recoveryEmail,
  phone: a.recoveryPhone,
});

export const authRoutes = new Hono<AppEnv>()
  .use(rateLimit({ keyPrefix: 'auth' }))

  // No-ops kept for contract stability. See the note above.
  .post('/register/begin', (c) =>
    c.json({ ok: false as const, error: 'not_implemented', message: 'Privy gestiona el challenge en el cliente. Se implementa solo finish.', code: 501 }, 501),
  )
  .post('/login/begin', (c) =>
    c.json({ ok: false as const, error: 'not_implemented', message: 'Privy gestiona el challenge en el cliente. Se implementa solo finish.', code: 501 }, 501),
  )

  /**
   * First registration. Creates the user, allocates their tag, upserts the
   * custodian wallet and mints a session.
   */
  .post('/register/finish', async (c) => {
    const { idToken: token } = await readBody(c, registerBody);
    const db = c.get('db');
    const env = c.get('env');
    const log = c.get('log');

    const verified = await verifyIdToken(token, env);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyDid, verified.privyDid))
      .limit(1);

    if (existing[0]) {
      // register is not idempotent by accident: re-registering means the user
      // should log in instead, and silently creating a second identity is worse
      // than an explicit 409.
      throw conflict('already_registered', 'Esa cuenta ya está registrada. Iniciá sesión.');
    }

    // No name yet — onboarding collects it after the passkey, and the HANDLE is
    // derived from the name there too. So this tag is a placeholder, and it has
    // to be unique anyway: a hardcoded one made the second registration fail on
    // `users_tag_unique`. See `provisionalTag`.
    const handle = provisionalTag();
    const [walletRow, user] = await db.transaction(async (tx) => {
      // ONE transaction for the whole identity. The user insert used to happen
      // before the custodian wallet was provisioned, so any failure in between
      // left an account with no wallet: login/finish then answers 500 "user has
      // no wallet" and the passkey is stuck forever with no way to recover.
      const [created] = await tx
        .insert(users)
        .values({
          privyDid: verified.privyDid,
          name: verified.email?.split('@')[0] ?? 'ReWallet',
          firstName: '',
          lastName: '',
          tag: `@${handle}`,
          tagNormalized: handle,
          recoveryEmail: verified.email ?? null,
        })
        .returning();
      if (!created) throw new Error('register: user insert returned nothing');

      const { address } = await getWalletForUser(verified.privyDid, env);
      const [wallet] = await tx
        .insert(wallets)
        .values({ userId: created.id, address, balance: '0' })
        .onConflictDoNothing()
        .returning();
      if (!wallet) throw new Error('register: wallet insert returned nothing');

      return [wallet, created] as const;
    });

    const { token: sessionToken } = await createSession(db, {
      userId: user.id,
      ...(c.req.header('x-forwarded-for')
        ? { ipAddress: c.req.header('x-forwarded-for') }
        : {}),
      ...(c.req.header('user-agent') ? { userAgent: c.req.header('user-agent') } : {}),
    });
    writeSession(c, sessionToken, env);

    log.info({ userId: user.id, did: verified.privyDid }, 'registered');

    return c.json(
      { ok: true as const, data: { user: toUser(user), wallet: walletRow, isNewUser: true } },
      201,
    );
  })

  /**
   * Login. The user must already exist — a passkey that is new is a
   * registration, and treating it as a login would silently skip the profile
   * step.
   */
  .post('/login/finish', async (c) => {
    const { idToken: token } = await readBody(c, registerBody);
    const db = c.get('db');
    const env = c.get('env');

    const verified = await verifyIdToken(token, env);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.privyDid, verified.privyDid))
      .limit(1);
    if (!user) {
      throw conflict('not_registered', 'No encontramos esa cuenta. Creá una nueva.');
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) throw new Error('login: user has no wallet');

    const { token: sessionToken } = await createSession(db, {
      userId: user.id,
      ...(c.req.header('user-agent') ? { userAgent: c.req.header('user-agent') } : {}),
    });
    writeSession(c, sessionToken, env);

    return c.json({ ok: true as const, data: { user: toUser(user), wallet, isNewUser: false } });
  })

  .post('/logout', async (c) => {
    const env = c.get('env');
    await revokeSession(c.get('db'), readSession(c));
    clearSession(c, env);
    return c.body(null, 204);
  })

  .get('/session', requireAuth(), async (c) => {
    const actor = c.get('actor');
    return c.json({
      ok: true as const,
      data: {
        user: {
          id: actor.userId,
          name: actor.name,
          firstName: actor.firstName,
          lastName: actor.lastName,
          tag: actor.tag,
          email: actor.email,
          phone: actor.phone,
        },
        // The same envelope GET /wallet serves. Two routes projecting the same
        // wallet must not drift apart: the frontend hydrates the store from
        // whichever it happens to call first, and a field present in one and
        // missing in the other is a bug that only shows up on the other screen.
        wallet: {
          id: actor.walletId,
          address: actor.address,
          balance: actor.balance,
          currency: 'USD' as const,
          firstFundsAt: actor.firstFundsAt?.toISOString() ?? null,
          yieldStartedAt: actor.yieldStartedAt?.toISOString() ?? null,
        },
      },
    });
  });

/**
 * Profile. This is where the tag finally gets its real value: it is derived from
 * the name, so it can only be settled once the name exists.
 */
export const profileRoutes = new Hono<AppEnv>()
  .use(requireAuth())
  .patch('/profile', async (c) => {
      const { firstName, lastName } = await readBody(c, profileBody);
      const db = c.get('db');
      const actor = c.get('actor');

      // Sanitised the same way on both sides: suggestTag and allocateTag share
      // the rules in @bestpath/shared, so the client can never disagree.
      const normalized = suggestTagFor(firstName, lastName);
      if (!isValidTag(normalized)) {
        throw conflict('invalid_tag', 'Ese nombre no genera un usuario válido.');
      }

      const handle = await allocateTag(normalized, {
        isTaken: async (candidate) => {
          const [taken] = await db
            .select({ id: users.id })
            .from(users)
            .where(
              sql`${users.tagNormalized} = ${candidate} AND ${users.id} <> ${actor.userId}`,
            )
            .limit(1);
          return Boolean(taken);
        },
        userSeq: 0,
      });

      const [updated] = await db
        .update(users)
        .set({
          firstName,
          lastName,
          name: `${firstName} ${lastName}`.trim(),
          tag: `@${handle}`,
          tagNormalized: handle,
          updatedAt: new Date(),
        })
        .where(eq(users.id, actor.userId))
        .returning();
      if (!updated) throw new Error('profile: update returned nothing');

      return c.json({ ok: true as const, data: { user: toUser(updated) } });
    },
  );
