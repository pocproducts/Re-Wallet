ALTER TABLE "users" ALTER COLUMN "name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_phone_country" text;--> statement-breakpoint
ALTER TABLE "yield_positions" ADD COLUMN "first_funds_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_user_seq_unique" UNIQUE("user_seq");