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

export async function getCloudflareTunnelConfig(): Promise<CloudflareTunnelConfig> {
  await ensureSettingsRow();

  const rows = await db
    .select({
      enabled: settings.cloudflareTunnelEnabled,
      domain: settings.cloudflareTunnelDomain,
      tokenCiphertext: settings.cloudflareTunnelTokenCiphertext,
      tokenIv: settings.cloudflareTunnelTokenIv,
      tokenTag: settings.cloudflareTunnelTokenTag,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  const row = rows[0];
  const hasToken = Boolean(row?.tokenCiphertext && row.tokenIv && row.tokenTag);

  return {
    enabled: Boolean(row?.enabled),
    domain: row?.domain ?? "",
    token: hasToken
      ? decryptSecret({
          ciphertext: row!.tokenCiphertext!,
          iv: row!.tokenIv!,
          tag: row!.tokenTag!,
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
  };
}

export async function saveCloudflareTunnelConfig(input: {
  enabled: boolean;
  domain: string;
  /** Undefined keeps the stored token, empty string clears it. */
  token?: string;
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
      updatedAt: new Date(),
    })
    .where(eq(settings.id, "singleton"));
}

export { normalizeDomain as normalizeTunnelDomain };
