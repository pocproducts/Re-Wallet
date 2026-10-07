/**
 * `POST /api/webhooks/privy` — the intake, over HTTP.
 *
 * ── The contract ──────────────────────────────────────────────────────────────
 *
 * ```
 * POST /api/webhooks/privy
 * svix-id: msg_…
 * svix-timestamp: 1748779200
 * svix-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">
 *
 * 200  — stored, or already on file. Empty body.
 * 400  — signed, but the body is not a webhook this Worker understands. Nothing stored.
 * 401  — no signature, a malformed one, a stale timestamp, or a wrong one. Nothing stored.
 * ```
 *
 * The 200 is empty on purpose: it is an acknowledgement, not a document, and a
 * webhook endpoint that answers with content is a second surface to maintain.
 *
 * ── Why this route has no cookie ──────────────────────────────────────────────
 *
 * Privy is a server calling a server; it has no session and must not be given
 * one. Its credential is the signature, and the signature is the whole door. The
 * route therefore reads no cookie and takes no identity from the request: the
 * only person-shaped thing in the body is the DID attribution reads, which is a
 * claim about a provider's event and never an authorisation.
 *
 * ── Why 401 for a stale timestamp too ─────────────────────────────────────────
 *
 * A stale request is a request whose signature no longer proves anything about
 * now. Answering anything but 401 would tell a sender that this endpoint accepts
 * deliveries it cannot authenticate.
 */
import { Hono } from 'hono';

import type { IngestPrivyWebhook, WebhookRejection } from '../../../application/webhooks/ingestPrivyWebhook';
import type { SignatureRejection } from '../../../domain/webhooks/svixSignature';
import type { Logger } from '../../../domain/ports/logger';
import { noopLogger } from '../../../domain/ports/logger';
import {
  SVIX_ID_HEADER,
  SVIX_SIGNATURE_HEADER,
  SVIX_TIMESTAMP_HEADER,
} from '../../../domain/webhooks/svixSignature';

/** One body per signature rejection, all of them 401. Nothing about the secret. */
const REJECTION_BODIES: Record<SignatureRejection, { readonly error: { readonly code: string } }> = {
  MISSING_HEADERS: { error: { code: 'WEBHOOK_UNAUTHENTICATED' } },
  MALFORMED: { error: { code: 'WEBHOOK_SIGNATURE_MALFORMED' } },
  STALE: { error: { code: 'WEBHOOK_SIGNATURE_STALE' } },
  BAD_SIGNATURE: { error: { code: 'WEBHOOK_SIGNATURE_INVALID' } },
};

const isSignatureRejection = (reason: WebhookRejection): reason is SignatureRejection =>
  (SIGNATURE_REJECTIONS as readonly string[]).includes(reason);

export const BAD_WEBHOOK_BODY = { error: { code: 'BAD_REQUEST' } } as const;

const SIGNATURE_REJECTIONS: readonly SignatureRejection[] = ['MISSING_HEADERS', 'MALFORMED', 'STALE', 'BAD_SIGNATURE'];

export interface WebhooksDeps {
  readonly ingest: IngestPrivyWebhook;
  readonly now?: () => Date;
  readonly log?: Logger;
}

export const createWebhookRoutes = (deps: WebhooksDeps) => {
  const app = new Hono();
  const clock = deps.now ?? ((): Date => new Date());
  const log = deps.log ?? noopLogger;

  app.post('/', async (c) => {
    // The **raw** body. A signature covers bytes, and re-serialising the parsed
    // JSON to verify it would change them for every payload with any spacing.
    const body = await c.req.text();

    const result = await deps.ingest({
      body,
      headers: {
        id: c.req.header(SVIX_ID_HEADER) ?? null,
        timestamp: c.req.header(SVIX_TIMESTAMP_HEADER) ?? null,
        signature: c.req.header(SVIX_SIGNATURE_HEADER) ?? null,
      },
      now: clock(),
    });

    if (!result.ok) {
      if (isSignatureRejection(result.reason)) {
        // The reason is already in the log; the sender learns only that it failed.
        return c.json(REJECTION_BODIES[result.reason], 401);
      }
      return c.json(BAD_WEBHOOK_BODY, 400);
    }

    // Stored, or already on file. Either way: stop retrying.
    return c.body(null, 200);
  });

  return app;
};
