ALTER TABLE "gas_sponsorships" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gas_sponsorships" ADD COLUMN "mode" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gas_sponsorships" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "gas_sponsorships" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE INDEX "gas_sponsorships_provider_idx" ON "gas_sponsorships" USING btree ("provider","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "gas_sponsorships_idem_unique" ON "gas_sponsorships" USING btree ("idempotency_key");