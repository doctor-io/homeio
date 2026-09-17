import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/server/modules/files/secrets";
import type { CloudflareTunnelConfigPublic } from "@/lib/shared/contracts/cloudflare-tunnel";

export type CloudflareTunnelConfig = {
  enabled: boolean;
  domain: string;
  token: string | null;
  apiToken: string | null;
};

async function ensureSettingsRow() {
  await db.execute(sql`
    INSERT INTO settings (id, appearance_json, updated_at)
    VALUES ('singleton', '{}', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

function normalizeDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

/**
 * Raised when a stored Cloudflare secret cannot be opened with the key this
 * process holds. Named, so the route can say what to do about it — enter the
 * token again — rather than report an internal error about itself.
 */
export class CloudflareSecretUnreadableError extends Error {
  readonly code = "secret_unreadable";

  constructor(what: string, cause?: unknown) {
    super(
      `The stored Cloudflare ${what} cannot be read. It was encrypted with a ` +
        `different AUTH_SESSION_SECRET than this server is running with — set a ` +
        `fixed one, then enter the token again.`,
    );
    this.name = "CloudflareSecretUnreadableError";
    this.cause = cause;
  }
}

export async function getCloudflareTunnelConfig(): Promise<CloudflareTunnelConfig> {
  await ensureSettingsRow();

  const rows = await db
    .select({
      enabled: settings.cloudflareTunnelEnabled,
      domain: settings.cloudflareTunnelDomain,
      tokenCiphertext: settings.cloudflareTunnelTokenCiphertext,
      tokenIv: settings.cloudflareTunnelTokenIv,
      tokenTag: settings.cloudflareTunnelTokenTag,
      apiCiphertext: settings.cloudflareApiTokenCiphertext,
      apiIv: settings.cloudflareApiTokenIv,
      apiTag: settings.cloudflareApiTokenTag,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  const row = rows[0];
  const hasToken = Boolean(row?.tokenCiphertext && row.tokenIv && row.tokenTag);
  const hasApiToken = Boolean(row?.apiCiphertext && row.apiIv && row.apiTag);

  // Sealed with a key derived from AUTH_SESSION_SECRET, and that secret is not
  // always the same one twice: the container entrypoint generates a fresh one
  // on every boot when it cannot persist it, and warns about sessions. It is
  // just as true of anything encrypted with it — except a lost session asks you
  // to sign in again, while this threw "Unsupported state or unable to
  // authenticate data" and the route answered "Failed to read config" with a
  // 500. The integration stops working and nothing says the stored token simply
  // cannot be opened any more.
  const openSealed = (
    what: string,
    sealed: { ciphertext: string; iv: string; tag: string },
  ) => {
    try {
      return decryptSecret(sealed);
    } catch (error) {
      throw new CloudflareSecretUnreadableError(what, error);
    }
  };

  return {
    enabled: Boolean(row?.enabled),
    domain: row?.domain ?? "",
    token: hasToken
      ? openSealed("tunnel token", {
          ciphertext: row!.tokenCiphertext!,
          iv: row!.tokenIv!,
          tag: row!.tokenTag!,
        })
      : null,
    apiToken: hasApiToken
      ? openSealed("API token", {
          ciphertext: row!.apiCiphertext!,
          iv: row!.apiIv!,
          tag: row!.apiTag!,
        })
      : null,
  };
}

export async function getCloudflareTunnelConfigPublic(): Promise<CloudflareTunnelConfigPublic> {
  const config = await getCloudflareTunnelConfig();

  return {
    enabled: config.enabled,
    domain: config.domain,
    hasToken: config.token !== null,
    hasApiToken: config.apiToken !== null,
  };
}

export async function saveCloudflareTunnelConfig(input: {
  enabled: boolean;
  domain: string;
  /** Undefined keeps the stored token, empty string clears it. */
  token?: string;
  apiToken?: string;
}): Promise<CloudflareTunnelConfigPublic> {
  await ensureSettingsRow();

  const values: Record<string, unknown> = {
    cloudflareTunnelEnabled: input.enabled,
    cloudflareTunnelDomain: normalizeDomain(input.domain) || null,
    updatedAt: new Date(),
  };

  if (input.token !== undefined) {
    if (input.token.trim().length === 0) {
      values.cloudflareTunnelTokenCiphertext = null;
      values.cloudflareTunnelTokenIv = null;
      values.cloudflareTunnelTokenTag = null;
    } else {
      const encrypted = encryptSecret(input.token.trim());
      values.cloudflareTunnelTokenCiphertext = encrypted.ciphertext;
      values.cloudflareTunnelTokenIv = encrypted.iv;
      values.cloudflareTunnelTokenTag = encrypted.tag;
    }
  }

  if (input.apiToken !== undefined) {
    if (input.apiToken.trim().length === 0) {
      values.cloudflareApiTokenCiphertext = null;
      values.cloudflareApiTokenIv = null;
      values.cloudflareApiTokenTag = null;
    } else {
      const encrypted = encryptSecret(input.apiToken.trim());
      values.cloudflareApiTokenCiphertext = encrypted.ciphertext;
      values.cloudflareApiTokenIv = encrypted.iv;
      values.cloudflareApiTokenTag = encrypted.tag;
    }
  }

  await db.update(settings).set(values).where(eq(settings.id, "singleton"));

  return getCloudflareTunnelConfigPublic();
}

export async function clearCloudflareTunnelConfig(): Promise<void> {
  await ensureSettingsRow();

  await db
    .update(settings)
    .set({
      cloudflareTunnelEnabled: false,
      cloudflareTunnelDomain: null,
      cloudflareTunnelTokenCiphertext: null,
      cloudflareTunnelTokenIv: null,
      cloudflareTunnelTokenTag: null,
      cloudflareApiTokenCiphertext: null,
      cloudflareApiTokenIv: null,
      cloudflareApiTokenTag: null,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, "singleton"));
}

export { normalizeDomain as normalizeTunnelDomain };
