import "server-only";

import {
  listInstalledStacksFromDb,
  patchInstalledStackMeta,
} from "@/lib/server/modules/apps/stacks-repository";
import { getCloudflareTunnelConfig } from "@/lib/server/modules/integrations/cloudflare-tunnel-config";
import type { CloudflareTunnelAppExposure } from "@/lib/shared/contracts/cloudflare-tunnel";
import type { InstalledStackConfig } from "@/lib/shared/contracts/apps";

/** Subdomains are a DNS label: lowercase alphanumerics and dashes. */
export function toSubdomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function buildTunnelUrl(subdomain: string, domain: string) {
  const label = toSubdomain(subdomain);
  if (!label || !domain) return null;
  return `https://${label}.${domain}`;
}

function suggestSubdomain(stack: InstalledStackConfig) {
  return (
    toSubdomain(stack.tunnelSubdomain ?? "") ||
    toSubdomain(stack.displayName ?? "") ||
    toSubdomain(stack.templateName) ||
    toSubdomain(stack.appId)
  );
}

export async function listCloudflareTunnelExposures(): Promise<CloudflareTunnelAppExposure[]> {
  const [config, stacks] = await Promise.all([
    getCloudflareTunnelConfig(),
    listInstalledStacksFromDb(),
  ]);

  return stacks
    .filter((stack) => stack.status === "installed")
    .map((stack) => {
      const subdomain = suggestSubdomain(stack);
      const exposed = Boolean(stack.tunnelSubdomain);

      return {
        appId: stack.appId,
        name: stack.displayName || stack.templateName || stack.appId,
        port: stack.webUiPort,
        subdomain,
        exposed,
        publicUrl: exposed ? buildTunnelUrl(subdomain, config.domain) : null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Publish or unpublish one app. Exposing it fills in the app's link, which is
 * the whole point: the operator should not have to retype the address the
 * tunnel already serves.
 */
export async function saveCloudflareTunnelExposure(input: {
  appId: string;
  exposed: boolean;
  subdomain?: string;
}): Promise<CloudflareTunnelAppExposure> {
  const config = await getCloudflareTunnelConfig();
  const stacks = await listInstalledStacksFromDb();
  const stack = stacks.find((entry) => entry.appId === input.appId);

  if (!stack) {
    throw new Error("App not found");
  }

  if (input.exposed && !config.domain) {
    throw new Error("Set the tunnel domain before exposing an app");
  }

  const subdomain = toSubdomain(input.subdomain ?? "") || suggestSubdomain(stack);

  if (input.exposed && !subdomain) {
    throw new Error("Could not derive a subdomain for this app");
  }

  const publicUrl = input.exposed ? buildTunnelUrl(subdomain, config.domain) : null;

  // Only reclaim the link when it is one we set. A link typed by hand stays.
  const previousTunnelUrl = stack.tunnelSubdomain
    ? buildTunnelUrl(stack.tunnelSubdomain, config.domain)
    : null;
  const linkIsOurs = stack.webUiUrl !== null && stack.webUiUrl === previousTunnelUrl;

  await patchInstalledStackMeta(input.appId, {
    tunnelSubdomain: input.exposed ? subdomain : null,
    ...(input.exposed
      ? { webUiUrl: publicUrl }
      : linkIsOurs
        ? { webUiUrl: null }
        : {}),
  });

  return {
    appId: stack.appId,
    name: stack.displayName || stack.templateName || stack.appId,
    port: stack.webUiPort,
    subdomain,
    exposed: input.exposed,
    publicUrl,
  };
}
