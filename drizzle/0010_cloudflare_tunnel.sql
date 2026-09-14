ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_tunnel_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_tunnel_domain" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_tunnel_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_tunnel_token_iv" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "cloudflare_tunnel_token_tag" text;--> statement-breakpoint
ALTER TABLE "app_stacks" ADD COLUMN IF NOT EXISTS "tunnel_subdomain" text;
