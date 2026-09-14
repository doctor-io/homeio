ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_api_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_api_token_iv" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_api_token_tag" text;
