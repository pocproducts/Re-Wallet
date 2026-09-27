import { desc, relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres schema.
 *
 * Money is `numeric(20,6)` everywhere and is read/written as a STRING in the
 * domain types. USDC has 6 decimals; a float would silently lose money and a JS
 * number cannot represent 20 digits of precision. Do not "simplify" this to
 * double.
 *
 * Custody model (decision D1, 2026-09-27): the backend is the custodian.
 * `wallets.balance` is an internal ledger balance, not an on-chain balance.
 */

// ─── users ─────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Stable, never-changing sequence. This — not the tag — is what guarantees
     * two users can never collide. The tag is an editable human-readable alias.
     */
    userSeq: bigserial('user_seq', { mode: 'number' }).notNull().unique(),
    /** Privy DID — the identity anchor. */
    privyDid: text('privy_did').notNull().unique(),
    firstName: text('first_name').notNull().default(''),
    lastName: text('last_name').notNull().default(''),
    /** Display name, derived from first + last. Kept for query convenience. */
    name: text('name').notNull().default(''),
    /** @ana, lowercase. Editable alias, unique at all times. */
    tag: text('tag').notNull(),
    /** ana — the URL-safe form used by /pay/{tag}. */
    tagNormalized: text('tag_normalized').notNull(),
    recoveryEmail: text('recovery_email'),
    /** Full number in E.164, e.g. +549112345678. */
    recoveryPhone: text('recovery_phone'),
    /** ISO 3166-1 alpha-2, kept separately so the picker can preselect it. */
    recoveryPhoneCountry: text('recovery_phone_country'),
    avatarColor: text('avatar_color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_tag_unique').on(t.tag),
    uniqueIndex('users_tag_normalized_unique').on(t.tagNormalized),
  ],
);

// ─── wallets ───────────────────────────────────────────────────────────────

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** EVM address the backend controls (custody model). */
    address: text('address').notNull().unique(),
    /** USDC, 6 decimals. Internal ledger balance. */
    balance: numeric('balance', { precision: 20, scale: 6 }).notNull().default('0'),
    /**
     * Set once, the first time funds land. NEVER reset.
     *
     * A state, not a balance: it drives the "Recibir" emphasis for a brand new
     * user. Deriving it from `balance` would re-onboard anyone who spends down
     * to zero. Lives here and not on yield_positions because a user can hold
     * funds without ever having an Aave position.
     */
    firstFundsAt: timestamp('first_funds_at', { withTimezone: true }),
    yieldStartedAt: timestamp('yield_started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wallets_user_unique').on(t.userId)],
);

// ─── movements ─────────────────────────────────────────────────────────────

export const movements = pgTable(
  'movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    /** deposit | send | receive | yield */
    type: text('type').notNull(),
    /** Always positive; direction is carried by `type`. */
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    title: text('title').notNull(),
    /** pending | completed | failed */
    status: text('status').notNull().default('completed'),
    /** txHash, recipient, failureReason, ... */
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('movements_wallet_created_idx').on(t.walletId, desc(t.createdAt))],
);

// ─── contacts ──────────────────────────────────────────────────────────────

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tag: text('tag').notNull(),
    color: text('color'),
    initials: text('initials'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contacts_user_tag_unique').on(t.userId, t.tag),
    index('contacts_user_idx').on(t.userId),
  ],
);

// ─── sessions ──────────────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the session token. The raw token is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    deviceInfo: jsonb('device_info').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index('sessions_user_expires_idx').on(t.userId, t.expiresAt)],
);

// ─── idempotency_keys ──────────────────────────────────────────────────────

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /** Value of the Idempotency-Key header. */
    key: text('key').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    /** Stored response, replayed verbatim on retry. */
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** key + 24h. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idempotency_keys_user_idx').on(t.userId)],
);

// ─── payment_requests ──────────────────────────────────────────────────────

export const paymentRequests = pgTable(
  'payment_requests',
  {
    /** nanoid(10) — the public /pay/{id} handle. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    /** pending | paid | expired */
    status: text('status').notNull().default('pending'),
    paidByUserId: uuid('paid_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    paidMovementId: uuid('paid_movement_id').references(() => movements.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** created + 7d */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('payment_requests_user_created_idx').on(t.userId, desc(t.createdAt))],
);

// ─── yield_positions ───────────────────────────────────────────────────────

export const yieldPositions = pgTable(
  'yield_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .unique()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    /** aToken balance — the Aave receipt token held for this wallet. */
    aaveATokenBal: numeric('aave_atoken_bal', { precision: 20, scale: 6 }).notNull().default('0'),
    lastAccruedAt: timestamp('last_accrued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('yield_positions_wallet_unique').on(t.walletId)],
);

// ─── yield_accruals ────────────────────────────────────────────────────────

/**
 * One row per wallet per day.
 *
 * The unique constraint on (wallet_id, accrued_for_date) means the daily job
 * MUST be an upsert: a plain re-run on the same day violates the constraint.
 * See the accrual service.
 */
export const yieldAccruals = pgTable(
  'yield_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    /** Basis points: 565 = 5.65%. */
    apyBps: integer('apy_bps').notNull(),
    /** The UTC day this accrual covers. */
    accruedForDate: text('accrued_for_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('yield_accruals_wallet_date_unique').on(t.walletId, t.accruedForDate),
    index('yield_accruals_wallet_date_idx').on(t.walletId, t.accruedForDate),
  ],
);

// ─── webhook_events ────────────────────────────────────────────────────────

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** privy | monad | pimlico */
    source: text('source').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_events_source_type_created_idx').on(t.source, t.eventType, desc(t.createdAt))],
);

// ─── gas_sponsorships ──────────────────────────────────────────────────────

export const gasSponsorships = pgTable(
  'gas_sponsorships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** privy | pimlico — which paymaster actually ran this. */
    provider: text('provider').notNull(),
    /** app_pays | user_pays — who paid for the gas. */
    mode: text('mode').notNull(),
    txHash: text('tx_hash'),
    userOpHash: text('user_op_hash'),
    /** Gas cost in USD, for tracking who pays for what. numeric(20,6). */
    sponsoredAmount: numeric('sponsored_amount', { precision: 20, scale: 6 }),
    /** pending | confirmed | failed */
    status: text('status').notNull().default('pending'),
    /** Internal failure token. NEVER rendered to the user. */
    error: text('error'),
    /**
     * The Idempotency-Key this was sent under.
     *
     * Uniquely indexed so a retry can find the original instead of sending a
     * second transaction. This is the guard against double-spending a user's
     * transfer when the client times out and fires again.
     */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('gas_sponsorships_user_created_idx').on(t.userId, desc(t.createdAt)),
    index('gas_sponsorships_provider_idx').on(t.provider, desc(t.createdAt)),
    uniqueIndex('gas_sponsorships_idem_unique').on(t.idempotencyKey),
  ],
);

// ─── relations ─────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  wallet: one(wallets, { fields: [users.id], references: [wallets.userId] }),
  contacts: many(contacts),
  sessions: many(sessions),
  paymentRequests: many(paymentRequests),
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
  movements: many(movements),
  yieldPosition: one(yieldPositions, { fields: [wallets.id], references: [yieldPositions.walletId] }),
  yieldAccruals: many(yieldAccruals),
}));

export const movementsRelations = relations(movements, ({ one }) => ({
  wallet: one(wallets, { fields: [movements.walletId], references: [wallets.id] }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  user: one(users, { fields: [contacts.userId], references: [users.id] }),
}));

export const yieldPositionsRelations = relations(yieldPositions, ({ one }) => ({
  wallet: one(wallets, { fields: [yieldPositions.walletId], references: [wallets.id] }),
}));

export const yieldAccrualsRelations = relations(yieldAccruals, ({ one }) => ({
  wallet: one(wallets, { fields: [yieldAccruals.walletId], references: [wallets.id] }),
}));

export const paymentRequestsRelations = relations(paymentRequests, ({ one }) => ({
  user: one(users, { fields: [paymentRequests.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type Movement = typeof movements.$inferSelect;
export type NewMovement = typeof movements.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type YieldPosition = typeof yieldPositions.$inferSelect;
export type YieldAccrual = typeof yieldAccruals.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type GasSponsorship = typeof gasSponsorships.$inferSelect;
