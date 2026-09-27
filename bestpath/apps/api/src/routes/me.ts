import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { internal } from '../lib/errors';
import { users } from '../db/schema';
import { readBody, toUser } from './auth';
import type { AppEnv } from '../types/context';

/**
 * Recovery fields — the part of the profile that used to be a lie.
 *
 * ── What this file was ──────────────────────────────────────────────────────
 *
 * Every route here was a stub that answered `200 { ok: true, data: { user:
 * null } }` and wrote nothing. The dangerous part was not the missing write, it
 * was the SHAPE of the answer: a 200 with `ok: true` is a promise that it
 * happened, and the onboarding form on the frontend REQUIRES an email and a
 * phone before it lets anyone continue. So a user filled in a real recovery
 * email, the app advanced, and the email went nowhere — with no error on either
 * side to say so.
 *
 * `PATCH /me/profile` is the exception and it is real: it lives in
 * `routes/auth.ts` as `profileRoutes` and is mounted BEFORE this router, which
 * is why the stub of the same path below is unreachable. See `routes/index.ts`.
 * It is left here so the file still describes the whole surface, and so deleting
 * it would be a change someone has to notice.
 *
 * ── Why the empty body is a 400 ────────────────────────────────────────────
 *
 * A patch that changes nothing and answers 200 is an endpoint that lies. The
 * caller — and whoever debugs it a week later — has no way to tell "your email
 * was saved" from "your email was thrown away", and both look identical from the
 * outside. So an empty body is rejected with the same `validation_failed` slug
 * every other bad request in this API uses, and the client has something it can
 * act on.
 */
/**
 * The recovery body.
 *
 * Optional on purpose, and NOT "empty string means clear": the client sends
 * `undefined` to mean "leave it alone", so an empty string is a REJECT. If `""`
 * were treated as "leave it alone" too, a form that clears a field on submit
 * would be unable to ever remove a stale recovery address.
 *
 * At least one field has to be present, because a patch that changes nothing and
 * answers 200 is the lie described in the header.
 */
const recoveryBody = z
  .object({
    email: z.string().email().max(320).optional(),
    // E.164, e.g. `+549112345678`. Length rather than a pattern: the strict
    // shape lives in the client and this only has to reject something that
    // cannot be a phone number at all.
    phone: z.string().min(6).max(20).optional(),
    // ISO 3166-1 alpha-2, uppercased, and only meaningful next to a phone.
    country: z.string().length(2).toUpperCase().optional(),
  })
  .refine((v) => v.email !== undefined || v.phone !== undefined || v.country !== undefined, {
    message: 'enviá al menos email, phone o country',
  });

export const meRoutes = new Hono<AppEnv>()
  .use(requireAuth())
  .get('/', (c) =>
    c.json({ ok: true as const, data: { user: null, wallet: null, yieldSummary: null } }),
  )
  .patch('/profile', zValidator('json', z.object({ name: z.string().min(1).max(60) })), (c) =>
    c.json({ ok: true as const, data: { user: null } }),
  )
  .patch('/recovery', async (c) => {
    const body = await readBody(c, recoveryBody);
    const db = c.get('db');
    const actor = c.get('actor');

    // Only the fields that ARRIVED go into the update. Spreading the parsed body
    // instead would write `undefined` over the columns the caller did not
    // mention, and a recovery email is exactly the kind of field a partial form
    // must not erase.
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (body.email !== undefined) patch.recoveryEmail = body.email;
    if (body.phone !== undefined) {
      patch.recoveryPhone = body.phone;
      // The country belongs to the phone, so it only ever moves with it.
      if (body.country !== undefined) patch.recoveryPhoneCountry = body.country;
    }

    const [updated] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, actor.userId))
      .returning();

    if (!updated) {
      // The session proved this user existed a moment ago, so an empty update
      // means the row went away underneath us. Answering with a null user would
      // send the client on to render an empty profile as if it were the user's.
      throw internal('No pudimos guardar tus datos de recuperación.');
    }

    return c.json({ ok: true as const, data: { user: toUser(updated) } });
  });

