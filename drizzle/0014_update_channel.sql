ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "update_channel" text DEFAULT 'stable' NOT NULL;
