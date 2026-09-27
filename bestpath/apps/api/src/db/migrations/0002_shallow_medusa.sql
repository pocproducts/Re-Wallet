ALTER TABLE "wallets" ADD COLUMN "first_funds_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yield_positions" DROP COLUMN "first_funds_at";