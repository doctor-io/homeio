ALTER TABLE "custom_store_apps" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint
ALTER TABLE "custom_store_apps" ADD COLUMN IF NOT EXISTS "source_ref" text;--> statement-breakpoint
ALTER TABLE "custom_store_apps" ADD COLUMN IF NOT EXISTS "source_checksum" text;--> statement-breakpoint
ALTER TABLE "custom_store_apps" ADD COLUMN IF NOT EXISTS "last_imported_at" timestamp with time zone;
